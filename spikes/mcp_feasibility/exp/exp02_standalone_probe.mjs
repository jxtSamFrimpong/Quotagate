// WS_10 T2 / exp02_standalone_probe.mjs — prove exp02_hello_server works BEFORE registration.
// Drives: initialize → initialized → tools/list → tools/call(ws10_hello_echo). D3 teardown:
// PID logged, killed on exit; no Claude Code involvement at this stage.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, 'exp02_hello_server.mjs');

const child = spawn('node', [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
console.log(`[pid] server pid=${child.pid}`);
let buf = '';
const pending = new Map();
let nextId = 1;

child.stdout.on('data', (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    } catch {
      console.log(`[non-json] ${line.slice(0, 120)}`);
    }
  }
});
child.stderr.on('data', (d) => console.log(`[server-stderr] ${d.toString().trim()}`));

function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }
    }, 10_000);
  });
}

try {
  const init = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'ws10-probe', version: '0.0.1' },
  });
  console.log(`[init] server=${JSON.stringify(init.result?.serverInfo)}`);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const listed = await rpc('tools/list', {});
  const names = (listed.result?.tools ?? []).map((t) => t.name);
  console.log(`[tools] ${JSON.stringify(names)}`);

  const call = await rpc('tools/call', { name: 'ws10_hello_echo', arguments: { text: 'WS_10-T2-STANDALONE' } });
  const out = call.result?.content?.[0]?.text;
  console.log(`[invoke] result=${out}`);
  console.log(out === 'ECHO:WS_10-T2-STANDALONE' ? '[verdict] STANDALONE PASS' : '[verdict] STANDALONE MISMATCH');
} catch (err) {
  console.error(`[fatal] ${err.message}`);
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
  setTimeout(() => child.kill('SIGKILL'), 3000).unref();
}
