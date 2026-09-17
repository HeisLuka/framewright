#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const POOL = path.join(SCRIPT_DIR, 'render-webcodecs-pool.mjs');
const WORKER = path.join(SCRIPT_DIR, 'local-render-worker.mjs');

function parseQueue(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--queue' && argv[i + 1]) return path.resolve(argv[i + 1]);
  }
  return path.resolve('.local-render-queue');
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function waitForPool(portFile, child, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`warm WebCodecs pool exited before ready with ${child.exitCode}`);
    try {
      const state = JSON.parse(await fsp.readFile(portFile, 'utf8'));
      if (state.schema === 'framewright-webcodecs-pool-v1' && state.url && state.concurrency === 2) {
        const response = await fetch(`${String(state.url).replace(/\/+$/, '')}/health`);
        if (response.ok) return state;
      }
    } catch (error) {
      if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    await sleep(100);
  }
  throw new Error(`warm WebCodecs pool did not become ready within ${timeoutMs}ms`);
}

async function terminate(child, signal = 'SIGTERM') {
  if (!child || child.exitCode != null) return;
  child.kill(signal);
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    sleep(5000).then(() => { if (child.exitCode == null) child.kill('SIGKILL'); }),
  ]);
}

async function main() {
  const argv = process.argv.slice(2);
  const queueRoot = parseQueue(argv);
  await fsp.mkdir(queueRoot, { recursive: true });
  const portFile = path.join(queueRoot, '.webcodecs-pool.json');
  await fsp.rm(portFile, { force: true });

  const pool = spawn(process.execPath, [POOL, '--port-file', portFile, '--concurrency', '2'], {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: 'inherit',
  });
  pool.once('error', error => console.error(`warm WebCodecs pool error: ${error.message}`));

  let worker = null;
  let shuttingDown = false;
  const shutdown = async signal => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (worker && worker.exitCode == null) worker.kill(signal || 'SIGTERM');
    await terminate(pool, signal || 'SIGTERM');
    await fsp.rm(portFile, { force: true }).catch(() => {});
  };
  process.once('SIGINT', () => { shutdown('SIGINT').finally(() => { process.exitCode = 130; }); });
  process.once('SIGTERM', () => { shutdown('SIGTERM').finally(() => { process.exitCode = 143; }); });

  try {
    const state = await waitForPool(portFile, pool);
    console.log(JSON.stringify({ standard_worker: true, warm_pool: { pid: state.pid, concurrency: state.concurrency, chromeLaunchMs: state.chromeLaunchMs } }));
    worker = spawn(process.execPath, [WORKER, ...argv], {
      cwd: process.cwd(),
      env: { ...process.env, WEBCODECS_POOL_URL: state.url },
      stdio: 'inherit',
    });
    const code = await new Promise((resolve, reject) => {
      worker.once('error', reject);
      worker.once('exit', (exitCode, signal) => resolve(exitCode ?? (signal ? 1 : 0)));
    });
    if (!shuttingDown) process.exitCode = Number(code || 0);
  } finally {
    await shutdown('SIGTERM');
  }
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
