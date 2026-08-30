// WS_10 T4 / exp04_statefulness_probes.mjs — test session state isolation
//
// Tests:
// 1. Sequential requests through one session - does state leak?
// 2. Concurrent requests - can we serialize safely?
// 3. Context reset between requests - is it effective?
//
// Uses the same stream-json approach as T3, but now testing state isolation.

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = path.resolve(__dirname, '..', 'artifacts');
const CONFIG = '/tmp/ws10_mcp_config.json';
const SEQUENTIAL_SAMPLES = 10;
const CONCURRENT_PAIRS = 5;
const TURN_TIMEOUT_MS = 120_000;

const DATE = new Date().toISOString().slice(0, 10);
const logStream = createWriteStream(path.join(ARTIFACTS, `exp04-statefulness-${DATE}.log`), { flags: 'a' });
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
      if (child && child.exitCode === null && child.signalCode !== null) child.kill('SIGKILL');
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
  log(`[context] machine=${os.platform()}-${os.arch()} node=${process.version}`);
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
      '--allowedTools', 'mcp__ws10-quotagate-server__quotagate_complete',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'], cwd: __dirname },
  );
  log(`[pid] session pid=${child.pid}`);

  let buf = '';
  let stderrBuf = '';
  let turnResolvers = [];
  let currentToolCalls = [];

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

      // Track tool_use events
      if (msg.type === 'assistant' && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === 'tool_use') {
            currentToolCalls.push({
              name: block.name,
              input: block.input,
            });
          }
        }
      }

      // Resolve on result event
      if (msg.type === 'result') {
        const resolvers = turnResolvers;
        turnResolvers = [];
        const toolCalls = currentToolCalls;
        currentToolCalls = [];
        for (const r of resolvers) r({ result: msg, toolCalls });
      }
    }
  });
  child.stderr.on('data', (d) => (stderrBuf += d.toString()));

  const waitTurn = () =>
    new Promise((resolve, reject) => {
      turnResolvers.push(resolve);
      setTimeout(() => reject(new Error('turn timeout')), TURN_TIMEOUT_MS);
    });

  // Test 1: Sequential requests - plant unique markers, check for leakage
  log('=== Test 1: Sequential state isolation ===');
  let sequentialPasses = 0;
  let sequentialLeaks = 0;

  for (let i = 1; i <= SEQUENTIAL_SAMPLES; i++) {
    const marker = `SEQ-T${String(i).padStart(2, '0')}-${Date.now()}`;
    const prompt = `Remember this unique code: ${marker}. Now call quotagate_complete with messages containing this marker.`;

    const tt0 = Date.now();
    child.stdin.write(
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: prompt },
      }) + '\n',
    );

    try {
      const { result, toolCalls } = await waitTurn();
      const wallMs = Date.now() - tt0;
      const content = result.result ?? '';
      const contentStr = typeof content === 'string' ? content : JSON.stringify(content);

      // Check if this request's marker appears in the tool call
      const quotagateCall = toolCalls.find(tc => tc.name === 'mcp__ws10-quotagate-server__quotagate_complete');
      const hasOwnMarker = quotagateCall && JSON.stringify(quotagateCall.input).includes(marker);

      // Check if any PREVIOUS markers leak into this request
      const previousMarkers = [];
      for (let j = 1; j < i; j++) {
        const prevMarker = `SEQ-T${String(j).padStart(2, '0')}`;
        if (quotagateCall && JSON.stringify(quotagateCall.input).includes(prevMarker)) {
          previousMarkers.push(prevMarker);
        }
      }

      if (hasOwnMarker && previousMarkers.length === 0) {
        sequentialPasses++;
        log(`[sequential ${i}/${SEQUENTIAL_SAMPLES}] PASS wallMs=${wallMs} — own marker present, no leakage`);
      } else {
        sequentialLeaks++;
        log(`[sequential ${i}/${SEQUENTIAL_SAMPLES}] FAIL wallMs=${wallMs} — own=${hasOwnMarker}, leaked=${previousMarkers.join(',')}`);
      }
    } catch (err) {
      log(`[sequential ${i}/${SEQUENTIAL_SAMPLES}] TIMEOUT ${err.message}`);
      sequentialLeaks++;
    }
  }

  // Test 2: Concurrent requests - fire pairs, check for interleaving
  log('=== Test 2: Concurrent request serialization ===');
  let concurrentPasses = 0;
  let concurrentFailures = 0;

  for (let i = 1; i <= CONCURRENT_PAIRS; i++) {
    const markerA = `CONC-A-T${String(i).padStart(2, '0')}-${Date.now()}`;
    const markerB = `CONC-B-T${String(i).padStart(2, '0')}-${Date.now()}`;

    const promptA = `Call quotagate_complete with messages containing marker ${markerA}.`;
    const promptB = `Call quotagate_complete with messages containing marker ${markerB}.`;

    const tt0 = Date.now();

    // Fire both requests concurrently
    const promiseA = (async () => {
      child.stdin.write(
        JSON.stringify({
          type: 'user',
          message: { role: 'user', content: promptA },
        }) + '\n',
      );
      return await waitTurn();
    })();

    const promiseB = (async () => {
      child.stdin.write(
        JSON.stringify({
          type: 'user',
          message: { role: 'user', content: promptB },
        }) + '\n',
      );
      return await waitTurn();
    })();

    try {
      const [resultA, resultB] = await Promise.all([promiseA, promiseB]);
      const wallMs = Date.now() - tt0;

      // Check if each request got its own marker without leakage
      const callA = resultA.toolCalls.find(tc => tc.name === 'mcp__ws10-quotagate-server__quotagate_complete');
      const callB = resultB.toolCalls.find(tc => tc.name === 'mcp__ws10-quotagate-server__quotagate_complete');

      const aHasOwn = callA && JSON.stringify(callA.input).includes(markerA);
      const aHasB = callA && JSON.stringify(callA.input).includes(markerB);
      const bHasOwn = callB && JSON.stringify(callB.input).includes(markerB);
      const bHasA = callB && JSON.stringify(callB.input).includes(markerA);

      if (aHasOwn && !aHasB && bHasOwn && !bHasA) {
        concurrentPasses++;
        log(`[concurrent ${i}/${CONCURRENT_PAIRS}] PASS wallMs=${wallMs} — both isolated`);
      } else {
        concurrentFailures++;
        log(`[concurrent ${i}/${CONCURRENT_PAIRS}] FAIL wallMs=${wallMs} — A:own=${aHasOwn},A:leak=${aHasB} B:own=${bHasOwn},B:leak=${bHasA}`);
      }
    } catch (err) {
      log(`[concurrent ${i}/${CONCURRENT_PAIRS}] TIMEOUT ${err.message}`);
      concurrentFailures++;
    }
  }

  const sequentialRate = ((sequentialPasses / SEQUENTIAL_SAMPLES) * 100).toFixed(1);
  const concurrentRate = ((concurrentPasses / CONCURRENT_PAIRS) * 100).toFixed(1);

  log(`[summary] sequential isolation: ${sequentialPasses}/${SEQUENTIAL_SAMPLES} (${sequentialRate}%) | leaks: ${sequentialLeaks}`);
  log(`[summary] concurrent isolation: ${concurrentPasses}/${CONCURRENT_PAIRS} (${concurrentRate}%) | failures: ${concurrentFailures}`);
  log(`[verdict] A5 ${sequentialPasses === SEQUENTIAL_SAMPLES ? 'PASS' : 'FAIL'} (100% sequential isolation) | A6 ${concurrentPasses === CONCURRENT_PAIRS ? 'PASS' : 'FAIL'} (100% concurrent isolation)`);

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
