// WS_10 T2 / exp02_drive.mjs — persistent headless session driven >=10 turns programmatically.
// Surface: ephemeral --mcp-config (zero persistent mutation). Proves A2: an unattended
// headless session is drivable across many turns with a registered custom tool.
// D3 teardown: PID capture, finally/signal kill w/ SIGKILL escalation, tracked-pid orphan sweep.

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = path.resolve(__dirname, '..', 'artifacts');
const CONFIG = '/tmp/ws10_mcp_config.json';
const TURNS = 10;
const TURN_TIMEOUT_MS = 120_000;

const DATE = new Date().toISOString().slice(0, 10);
const logStream = createWriteStream(path.join(ARTIFACTS, `exp02-drive-${DATE}.log`), { flags: 'a' });
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

// One long-lived session; each turn = one user message on stdin (stream-json), read
// turn results from stdout (stream-json) until that turn's assistant message + result.
async function main() {
  log(`[context] machine=${os.platform()}-${os.arch()} node=${process.version} cli=claude`);
  log('[spawn] claude --print --input-format stream-json --output-format stream-json --mcp-config ... --strict-mcp-config');
  const t0 = Date.now();
  child = spawn(
    'claude',
    [
      '--print',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--mcp-config', CONFIG,
      '--strict-mcp-config',
      '--allowedTools', 'mcp__ws10-hello-server__ws10_hello_echo',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  log(`[pid] session pid=${child.pid}`);

  let buf = '';
  let stderrBuf = '';
  let turnResolvers = [];
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.type === 'result') {
        const resolvers = turnResolvers;
        turnResolvers = [];
        for (const r of resolvers) r(msg);
      }
    }
  });
  child.stderr.on('data', (d) => (stderrBuf += d.toString()));

  const waitTurn = () =>
    new Promise((resolve, reject) => {
      turnResolvers.push(resolve);
      setTimeout(() => reject(new Error('turn timeout')), TURN_TIMEOUT_MS);
    });

  let ok = 0;
  const times = [];
  for (let i = 1; i <= TURNS; i++) {
    const marker = `DRIVE-T${String(i).padStart(2, '0')}-MARKER`;
    const tt0 = Date.now();
    child.stdin.write(
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: `Call the ws10_hello_echo tool with text set exactly to ${marker} and reply with only the tool's raw output.`,
        },
      }) + '\n',
    );
    try {
      const res = await waitTurn();
      const wallMs = Date.now() - tt0;
      const content = res.result ?? '';
      const pass = typeof content === 'string' && content.includes(`ECHO:${marker}`);
      if (pass) ok++;
      times.push(wallMs);
      log(`[turn ${i}/${TURNS}] pass=${pass} wallMs=${wallMs} reply="${String(content).slice(0, 60)}"`);
    } catch (err) {
      log(`[turn ${i}/${TURNS}] FAILED ${err.message} stderr="${stderrBuf.slice(-200)}"`);
      break;
    }
  }

  times.sort((a, b) => a - b);
  const p50 = times.length ? times[Math.min(times.length - 1, Math.ceil(0.5 * times.length) - 1)] : NaN;
  log(`[summary] drive ok=${ok}/${TURNS} | p50=${p50}ms | totalWallMs=${Date.now() - t0}`);
  log(`[verdict] A2 ${ok === TURNS ? 'PROVEN' : 'PARTIAL/FAILED'} — unattended multi-turn driving over one persistent session`);

  child.stdin.end();
  await new Promise((r) => child.once('close', r));
  log(`[exit] session exited code=${child.exitCode}`);
}

main()
  .catch((e) => {
    log(`[fatal] ${e?.stack ?? e}`);
    process.exitCode = 1;
  })
  .finally(() => {
    terminate('finally block');
    // D3-3 orphan sweep derived from tracked pid
    if (child?.pid) {
      try {
        process.kill(child.pid, 0);
        log(`[orphan-sweep] FINDING — pid=${child.pid} still alive after finally`);
      } catch {
        log(`[orphan-sweep] tracked pid=${child.pid} confirmed gone`);
      }
    }
    logStream.end();
  });
