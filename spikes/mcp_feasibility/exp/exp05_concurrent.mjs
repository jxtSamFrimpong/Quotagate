// WS_10 T34-REPROBE / exp05_concurrent.mjs — B-T4-1 journaled concurrency probe.
//
// Fixes the exp04 shared-resolver bug: ONE waiter per `result` event (FIFO
// queue — shift(), not broadcast), so attribution is bookkeeping-correct. The
// server-side journal ({tsStart, tsEnd, tool, markers, pid} per invocation)
// is the classifier: queue (non-overlapping spans, own-markers) vs. interleave
// (overlapping spans and/or cross-markers) vs. corrupt (missing rows,
// misattribution, errors). Client observation alone never classifies.
//
// 3 pairs on ONE session (modest load; the question is one-session behavior).
// Write-up language per B-T4-3: any second-sees-first-context outcome routes to
// OD-3 as the reset+lock atomic unit (spec §3.1/§3.8) — never "standard mutex".
//
// Fixed-UUID markers (TD-R3): R5-CONC bases below, pair suffix -P<NN>.

import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = path.resolve(__dirname, '..', 'artifacts');
const SERVER = path.join(__dirname, 'exp05_tool_server.mjs');
const CONFIG = '/tmp/ws10_reprobe_mcp_config.json';
const TURN_TIMEOUT_MS = 300_000;
const STAGGER_MS = 8000; // write B while A is in-flight (true overlap test)
const DATE = new Date().toISOString().slice(0, 10);
const RUN_START_ISO = new Date().toISOString();
const RUN_TAG = 'staggered-overlap';
const PAIRS = 3;

// TD-R3 fixed marker bases (grep: R5-CONC).
const R5_CA = '3f6a9c1e-8b2d-4a5c-9d7e-2f4a6c8e0b11';
const R5_CB = '7b1d4f8a-2c6e-4d9a-b3f5-8e1c5a7d9f33';

const logStream = createWriteStream(path.join(ARTIFACTS, `exp05-concurrent-${DATE}.log`), { flags: 'a' });
const log = (l) => {
  const s = `${new Date().toISOString()} ${l}`;
  console.log(s);
  logStream.write(s + '\n');
};

let child = null;
let shuttingDown = false;
function terminate(reason) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  log(`[teardown] killing pid=${child.pid} (${reason})`);
  try {
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, 5000).unref();
  } catch {}
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    terminate(`signal ${sig}`);
    setTimeout(() => process.exit(130), 6000).unref();
  });
}

async function main() {
  let cliVersion = 'unknown';
  try { cliVersion = execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim(); } catch {}
  log(`[header] exp05-concurrent cli=${cliVersion} machine=${os.platform()}-${os.arch()} node=${process.version} runStart=${RUN_START_ISO} runTag=${RUN_TAG} staggerMs=${STAGGER_MS}`);
  const configJson = { mcpServers: { 'ws10-reprobe-server': { command: 'node', args: [SERVER] } } };
  writeFileSync(CONFIG, JSON.stringify(configJson));
  log(`[config] ephemeral ${CONFIG} (no ~/.claude.json touch — D3 backup/diff N/A)`);

  child = spawn(
    'claude',
    ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--mcp-config', CONFIG, '--strict-mcp-config',
      '--allowedTools', 'mcp__ws10-reprobe-server__quotagate_complete mcp__ws10-reprobe-server__ws10_probe_side_effect'],
    { stdio: ['pipe', 'pipe', 'pipe'], cwd: __dirname },
  );
  log(`[pid] session pid=${child.pid} cwd=exp/`);

  let buf = '';
  const waiterQueue = []; // FIFO: one waiter per result event (B-T4-1 fix)
  let pendingCalls = [];
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.type === 'assistant' && msg.message?.content) {
        for (const b of msg.message.content) {
          if (b.type === 'tool_use') pendingCalls.push({ name: b.name, input: b.input });
        }
      }
      if (msg.type === 'result') {
        const waiter = waiterQueue.shift(); // FIFO — never broadcast
        const calls = pendingCalls;
        pendingCalls = [];
        log(`[attribution] result event queueDepthAfterShift=${waiterQueue.length} callsInTurn=${calls.length} served=${waiter && !waiter.settled ? waiter.label : '(none/dead)'}`);
        if (waiter && !waiter.settled) {
          waiter.settled = true;
          waiter.resolve({ result: msg, toolCalls: calls });
        } else if (waiter) {
          log(`[attribution] WARNING — shifted waiter already settled; turn data dropped (calls=${calls.length})`);
        } else {
          log(`[attribution] WARNING — result event with empty waiter queue (calls=${calls.length})`);
        }
      }
    }
  });
  let stderrTail = '';
  child.stderr.on('data', (d) => { stderrTail = (stderrTail + d.toString()).slice(-300); });

  const waitTurn = (label) => {
    let entry;
    const promise = new Promise((resolve, reject) => {
      entry = { resolve, reject, label, settled: false };
      waiterQueue.push(entry);
    });
    const timer = setTimeout(() => {
      if (entry.settled) return;
      entry.settled = true;
      // Cancel-on-timeout: remove from FIFO so a dead waiter can never
      // consume a later result (run-1 harness bug — disclosed in findings).
      const idx = waiterQueue.indexOf(entry);
      if (idx !== -1) waiterQueue.splice(idx, 1);
      entry.reject(new Error(`turn timeout (${label}): ${stderrTail}`));
    }, TURN_TIMEOUT_MS);
    return promise.finally(() => clearTimeout(timer));
  };

  for (let i = 1; i <= PAIRS; i++) {
    const mA = `R5-CONC-A-${R5_CA}-Q${String(i).padStart(2, '0')}`;
    const mB = `R5-CONC-B-${R5_CB}-Q${String(i).padStart(2, '0')}`;
    const tt0 = Date.now();
    // Staggered overlap: B is written while A is in-flight.
    const promiseA = (async () => {
      const p = waitTurn(`pair${i}-A`);
      child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: `Call quotagate_complete with messages containing marker ${mA}.` } }) + '\n');
      return await p;
    })();
    await new Promise((r) => setTimeout(r, STAGGER_MS));
    const promiseB = (async () => {
      const p = waitTurn(`pair${i}-B`);
      child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: `Call quotagate_complete with messages containing marker ${mB}.` } }) + '\n');
      return await p;
    })();
    try {
      const [rA, rB] = await Promise.all([promiseA, promiseB]);
      const wallMs = Date.now() - tt0;
      const str = (tc) => JSON.stringify(tc.input);
      const callA = rA.toolCalls.find((tc) => tc.name === 'mcp__ws10-reprobe-server__quotagate_complete');
      const callB = rB.toolCalls.find((tc) => tc.name === 'mcp__ws10-reprobe-server__quotagate_complete');
      const aOwn = callA && str(callA).includes(mA);
      const aLeak = callA && str(callA).includes(mB);
      const bOwn = callB && str(callB).includes(mB);
      const bLeak = callB && str(callB).includes(mA);
      log(`[concurrent ${i}/${PAIRS}] wallMs=${wallMs} A:own=${aOwn},A:leak=${aLeak} B:own=${bOwn},B:leak=${bLeak} (client-side; journal classifies)`);
    } catch (err) {
      log(`[concurrent ${i}/${PAIRS}] ERROR ${err.message}`);
    }
  }

  child.stdin.end();
  await new Promise((r) => child.once('close', r));
  log(`[exit] session exited code=${child.exitCode}`);

  // Journal classification.
  try {
    const journalPath = path.join(ARTIFACTS, `exp05-journal-${DATE}.jsonl`);
    const rows = readFileSync(journalPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const inWindow = rows.filter((r) => r.tsStart >= RUN_START_ISO && r.tool === 'quotagate_complete');
    log(`[journal] window quotagate_complete rows=${inWindow.length} (expect ${PAIRS * 2})`);
    for (const r of inWindow) {
      log(`[journal] ${r.tsStart}→${r.tsEnd} durMs=${r.durMs} markers=[${(r.markers || []).join(',')}]`);
    }
    // Pairwise overlap analysis per pair suffix (Q-run; P-run rows excluded by window).
    for (let i = 1; i <= PAIRS; i++) {
      const suf = `Q${String(i).padStart(2, '0')}`;
      const pairRows = inWindow.filter((r) => (r.markers || []).some((m) => m.endsWith(suf)));
      if (pairRows.length < 2) {
        log(`[classify pair ${i}] CORRUPT-or-queue-silence: only ${pairRows.length} journal row(s) carry ${suf} (expected 2)`);
        continue;
      }
      const [first, second] = pairRows;
      const overlap = !(first.tsEnd <= second.tsStart || second.tsEnd <= first.tsStart);
      const crossA = (first.markers || []).some((m) => m.includes('R5-CONC-B-')) || (second.markers || []).some((m) => m.includes('R5-CONC-A-'));
      const verdict = !overlap && !crossA ? 'QUEUE (serialized, isolated)' : overlap && crossA ? 'INTERLEAVE (overlap + cross-context)' : overlap ? 'OVERLAP without cross-markers' : 'SEQUENTIAL with cross-markers (second-sees-first-context)';
      log(`[classify pair ${i}] ${verdict} overlap=${overlap} crossMarkers=${crossA}`);
    }
  } catch (err) {
    log(`[journal] classification failed: ${err.message}`);
  }
}

main()
  .catch((e) => { log(`[fatal] ${e?.stack ?? e}`); process.exitCode = 1; })
  .finally(() => {
    terminate('finally block');
    if (child?.pid) {
      try { process.kill(child.pid, 0); log(`[orphan-sweep] FINDING — pid=${child.pid} still alive after finally`); }
      catch { log(`[orphan-sweep] tracked pid=${child.pid} confirmed gone`); }
    }
    logStream.end();
  });
