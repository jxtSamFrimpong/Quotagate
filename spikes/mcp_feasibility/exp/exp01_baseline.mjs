// WS_10 T1 / exp01_baseline.mjs — cold-spawn `claude --print` latency baseline.
//
// Protocol (docs/active/TASK_WS10_T1.md + ws10 plan §WS_10-D3/D4):
//   - ONE fixed trivial prompt (D1) × 10 sequential runs; per-run wall time via performance.now().
//   - PID capture at spawn; kill in finally + SIGINT/SIGTERM handlers; post-run orphan sweep.
//   - Modest load only (D4): sequential, inter-run pause, back-off-and-record on throttle/error.
//
// Usage: node spikes/mcp_feasibility/exp/exp01_baseline.mjs

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = path.resolve(__dirname, '..', 'artifacts');

// D1: fixed prompt constant — identical across every sample; no runtime-generated tokens.
const FIXED_PROMPT = 'Reply with the word OK.';
const SAMPLES = 10;
const RUN_TIMEOUT_MS = 120_000; // watchdog: hard cap per invocation (hung-invocation guard)
const INTER_RUN_PAUSE_MS = 2_000; // D4 courtesy gap between sequential cold spawns
const THROTTLE_BACKOFF_MS = 30_000; // EF6/D4: back off when throttle/error detected, then retry once

const CLI = process.env.CLAUDE_BIN ?? 'claude';

mkdirSync(ARTIFACTS_DIR, { recursive: true });
const DATE = new Date().toISOString().slice(0, 10);
const LOG_PATH = path.join(ARTIFACTS_DIR, `exp01-${DATE}.log`);
const logStream = createWriteStream(LOG_PATH, { flags: 'a' });

let activeChild = null;
let shuttingDown = false;
const spawnedPids = []; // D3-3: tracked pids so the sweep report is derived, not asserted

function log(line) {
  const stamped = `${new Date().toISOString()} ${line}`;
  console.log(stamped);
  logStream.write(stamped + '\n');
}

function terminateActiveChild(reason) {
  if (!activeChild || activeChild.exitCode !== null || activeChild.signalCode !== null) return;
  log(`[teardown] killing child pid=${activeChild.pid} (${reason})`);
  try {
    activeChild.kill('SIGTERM');
    setTimeout(() => {
      if (activeChild && activeChild.exitCode === null && activeChild.signalCode === null) {
        log(`[teardown] SIGKILL escalation pid=${activeChild.pid}`);
        activeChild.kill('SIGKILL');
      }
    }, 5_000).unref();
  } catch {
    /* already gone */
  }
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`[signal] ${sig} received — tearing down`);
    terminateActiveChild(`signal ${sig}`);
    setTimeout(() => process.exit(130), 6_500).unref();
  });
}

/** Spawn one cold `claude --print <FIXED_PROMPT>`, resolve wall time + outcome. */
function runOnce() {
  return new Promise((resolve) => {
    // D3-1: PID capture at spawn — logged before anything else can fail.
    log(`[spawn] starting ${CLI} --print (prompt=${JSON.stringify(FIXED_PROMPT)})`);
    const t0 = performance.now();
    const child = spawn(CLI, ['--print', FIXED_PROMPT], {
      cwd: ARTIFACTS_DIR, // neutral cwd inside quarantine zone
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'quotagate-ws10-exp01' },
    });
    activeChild = child;
    spawnedPids.push(child.pid);
    log(`[pid] child pid=${child.pid}`);

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      log(`[timeout] pid=${child.pid} exceeded ${RUN_TIMEOUT_MS}ms — terminating`);
      terminateActiveChild('watchdog timeout');
    }, RUN_TIMEOUT_MS);

    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const wallMs = Math.round(performance.now() - t0);
      resolve({ wallMs, ...outcome });
      activeChild = null;
    };

    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));

    child.on('error', (err) => finish({ status: 'spawn-error', detail: String(err), stdout, stderr }));
    child.on('close', (code, signal) => {
      const out = stdout.trim();
      if (signal) {
        finish({ status: 'killed', detail: `signal=${signal}`, stdout: out, stderr: stderr.trim() });
      } else if (code === 0) {
        // Throttle heuristic (D4/EF6): success exit code but refusal/rate-limit phrasing in body.
        const lower = out.toLowerCase();
        const throttled =
          lower.includes('rate limit') ||
          lower.includes('rate_limit') ||
          lower.includes('overloaded') ||
          lower.includes('quota');
        finish({ status: throttled ? 'throttled' : 'ok', stdout: out, stderr: stderr.trim() });
      } else {
        finish({ status: 'error', detail: `exit=${code}`, stdout: out, stderr: stderr.trim() });
      }
    });
  });
}

function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function main() {
  log('=== exp01_baseline — cold-spawn `claude --print` latency ===');
  log(
    `[context] machine=${os.platform()}(${os.arch()}) release=${os.release()} cpus=${os.cpus().length} ` +
      `model=${os.cpus()[0]?.model ?? 'unknown'} node=${process.version} cli=${CLI} ` +
      `concurrentSubscriptionUse=none-recorded (single-operator dev machine)`
  );
  log(`[context] samples=${SAMPLES} prompt=${JSON.stringify(FIXED_PROMPT)} artifact=${LOG_PATH}`);

  const okTimes = [];
  let anomalies = 0;
  let consecutiveFailures = 0;

  for (let i = 1; i <= SAMPLES; i++) {
    if (shuttingDown) break;
    let r = await runOnce();

    // D4: never hammer. On throttle/error, back off once and retry that sample.
    if (r.status !== 'ok') {
      log(
        `[run ${i}/${SAMPLES}] status=${r.status} wallMs=${r.wallMs} — backing off ${THROTTLE_BACKOFF_MS}ms (D4) then retrying this sample`
      );
      await new Promise((res) => setTimeout(res, THROTTLE_BACKOFF_MS));
      r = await runOnce();
    }

    if (r.status === 'ok') {
      okTimes.push(r.wallMs);
      consecutiveFailures = 0;
      const reply = r.stdout.replace(/\s+/g, ' ').slice(0, 80);
      log(`[run ${i}/${SAMPLES}] OK wallMs=${r.wallMs} reply="${reply}"`);
    } else {
      anomalies++;
      consecutiveFailures++;
      log(
        `[run ${i}/${SAMPLES}] FAILED status=${r.status} wallMs=${r.wallMs} ` +
          `detail=${r.detail ?? ''} stdout="${(r.stdout ?? '').slice(0, 200)}" ` +
          `stderr="${(r.stderr ?? '').slice(0, 200)}"`
      );
      if (consecutiveFailures >= 3) {
        log('[abort] 3 consecutive failures — stopping early rather than hammering (D4).');
        break;
      }
    }
    if (i < SAMPLES) await new Promise((res) => setTimeout(res, INTER_RUN_PAUSE_MS));
  }

  const sorted = [...okTimes].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const mean =
    sorted.length > 0 ? Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length) : NaN;
  log(
    `[summary] exp01 cold-spawn baseline | n_ok=${sorted.length}/${SAMPLES} anomalies=${anomalies} | ` +
      `p50=${p50}ms p95=${p95}ms mean=${mean}ms min=${sorted[0] ?? 'NA'}ms max=${sorted.at(-1) ?? 'NA'}ms | ` +
      `machine=${os.platform()}-${os.arch()} cpus=${os.cpus().length} node=${process.version}`
  );

  // D3-3: post-run orphan sweep — verify each tracked pid is actually gone, then sweep for stragglers.
  log('[orphan-sweep] verifying tracked children exited');
  const trackedSurvivors = spawnedPids.filter((pid) => {
    try {
      process.kill(pid, 0); // signal 0 = existence probe only
      return true;
    } catch {
      return false;
    }
  });
  log(
    trackedSurvivors.length === 0
      ? `[orphan-sweep] all ${spawnedPids.length} tracked children confirmed exited`
      : `[orphan-sweep] FINDING — tracked pids still alive: ${trackedSurvivors.join(', ')}`
  );
  const sweep = spawn('pgrep', ['-f', 'claude.*--print'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let sweepOut = '';
  sweep.stdout.on('data', (d) => (sweepOut += d.toString()));
  await new Promise((res) => sweep.on('close', res));
  const survivors = sweepOut.split('\n').map((s) => s.trim()).filter(Boolean);
  log(
    survivors.length === 0
      ? '[orphan-sweep] CLEAN — pgrep -f "claude.*--print" returned no surviving processes'
      : `[orphan-sweep] FINDING — surviving pids: ${survivors.join(', ')} (inspect manually)`
  );
  log('=== exp01_baseline complete ===');
}

main()
  .catch((err) => {
    log(`[fatal] ${err?.stack ?? err}`);
    process.exitCode = 1;
  })
  .finally(() => {
    terminateActiveChild('finally block'); // D3-2: cleanup never happy-path-only
    logStream.end();
  });
