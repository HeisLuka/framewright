#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '../../../..');
const FACTORY = path.join(SCRIPT_DIR, 'run-video-factory.mjs');
const JOB_SCHEMA = 'newboo-local-render-job-v1';
const ATTEMPT_SCHEMA = 'newboo-local-render-attempt-v1';
const QUEUE_DIRS = ['pending', 'running', 'done', 'failed', 'results', 'canonical-artifacts'];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`unexpected positional argument: ${token}`);
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next != null && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

async function atomicWrite(filename, content) {
  await fsp.mkdir(path.dirname(filename), { recursive: true });
  const tmp = `${filename}.tmp-${process.pid}-${randomUUID()}`;
  await fsp.writeFile(tmp, content);
  await fsp.rename(tmp, filename);
}

async function pathExists(filename) {
  try {
    await fsp.access(filename);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function listJobDirs(dir) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function assertJobId(jobId) {
  if (!/^lrj_[0-9a-f]{64}$/.test(jobId)) throw new Error(`invalid local render job id: ${jobId}`);
}

export async function ensureLocalQueue(queueRoot) {
  const root = path.resolve(queueRoot);
  await fsp.mkdir(root, { recursive: true });
  await Promise.all(QUEUE_DIRS.map(name => fsp.mkdir(path.join(root, name), { recursive: true })));
  return root;
}

export async function findLocalJobState(queueRoot, jobId) {
  assertJobId(jobId);
  const root = path.resolve(queueRoot);
  for (const state of ['pending', 'running', 'done', 'failed']) {
    if (await pathExists(path.join(root, state, jobId))) return state;
  }
  return null;
}

export async function enqueueLocalRenderJob({ queueRoot, requestPath, workspace = process.cwd() }) {
  const root = await ensureLocalQueue(queueRoot);
  const absoluteRequest = path.resolve(requestPath);
  const requestBytes = await fsp.readFile(absoluteRequest);
  JSON.parse(requestBytes.toString('utf8'));
  const requestSha256 = sha256(requestBytes);
  const jobId = `lrj_${requestSha256}`;
  const existing = await findLocalJobState(root, jobId);
  if (existing) return { job_id: jobId, request_sha256: requestSha256, state: existing, duplicate: true };

  const tmpDir = path.join(root, 'pending', `.tmp-${jobId}-${process.pid}-${randomUUID()}`);
  const finalDir = path.join(root, 'pending', jobId);
  await fsp.mkdir(tmpDir, { recursive: false });
  try {
    await fsp.writeFile(path.join(tmpDir, 'request.json'), requestBytes);
    await atomicWrite(path.join(tmpDir, 'job.json'), `${JSON.stringify({
      schema: JOB_SCHEMA,
      job_id: jobId,
      request_sha256: requestSha256,
      request_file: 'request.json',
      workspace_hint: path.resolve(workspace),
      enqueued_at: new Date().toISOString(),
    }, null, 2)}\n`);
    await fsp.rename(tmpDir, finalDir);
  } catch (error) {
    await fsp.rm(tmpDir, { recursive: true, force: true });
    if (error?.code === 'EEXIST' || error?.code === 'ENOTEMPTY') {
      const state = await findLocalJobState(root, jobId);
      if (state) return { job_id: jobId, request_sha256: requestSha256, state, duplicate: true };
    }
    throw error;
  }

  return { job_id: jobId, request_sha256: requestSha256, state: 'pending', duplicate: false };
}

async function readAndVerifyJob(jobDir) {
  const job = JSON.parse(await fsp.readFile(path.join(jobDir, 'job.json'), 'utf8'));
  if (job.schema !== JOB_SCHEMA) throw new Error(`${path.basename(jobDir)}: unsupported job schema ${job.schema}`);
  assertJobId(job.job_id);
  if (path.basename(jobDir) !== job.job_id) throw new Error(`${job.job_id}: queue directory identity mismatch`);
  if (job.request_file !== 'request.json') throw new Error(`${job.job_id}: request_file must be request.json`);
  const requestPath = path.join(jobDir, job.request_file);
  const requestBytes = await fsp.readFile(requestPath);
  const observed = sha256(requestBytes);
  if (observed !== job.request_sha256) throw new Error(`${job.job_id}: queued request SHA mismatch`);
  if (`lrj_${observed}` !== job.job_id) throw new Error(`${job.job_id}: job identity does not match request bytes`);
  JSON.parse(requestBytes.toString('utf8'));
  return { job, requestPath };
}

export async function recoverAbandonedLocalJobs(queueRoot) {
  const root = await ensureLocalQueue(queueRoot);
  const recovered = [];
  for (const jobId of await listJobDirs(path.join(root, 'running'))) {
    assertJobId(jobId);
    const source = path.join(root, 'running', jobId);
    const target = path.join(root, 'pending', jobId);
    if (await pathExists(target)) throw new Error(`${jobId}: both running and pending copies exist; refusing automatic recovery`);
    await fsp.rename(source, target);
    recovered.push(jobId);
  }
  return recovered;
}

export async function retryFailedLocalJob(queueRoot, jobId) {
  assertJobId(jobId);
  const root = await ensureLocalQueue(queueRoot);
  const source = path.join(root, 'failed', jobId);
  const target = path.join(root, 'pending', jobId);
  if (!(await pathExists(source))) throw new Error(`${jobId}: failed job not found`);
  if (await pathExists(target)) throw new Error(`${jobId}: pending copy already exists`);
  await fsp.rename(source, target);
  return { job_id: jobId, state: 'pending' };
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (error?.code === 'EPERM') return true;
    throw error;
  }
}

export async function acquireLocalQueueLock(queueRoot) {
  const root = await ensureLocalQueue(queueRoot);
  const lockPath = path.join(root, '.worker.lock');
  const token = randomUUID();
  const lock = {
    schema: 'newboo-local-render-worker-lock-v1',
    token,
    pid: process.pid,
    hostname: os.hostname(),
    started_at: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fsp.open(lockPath, 'wx');
      await handle.writeFile(`${JSON.stringify(lock, null, 2)}\n`);
      await handle.close();
      return async () => {
        try {
          const current = JSON.parse(await fsp.readFile(lockPath, 'utf8'));
          if (current.token === token) await fsp.unlink(lockPath);
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let current;
      try {
        current = JSON.parse(await fsp.readFile(lockPath, 'utf8'));
      } catch {
        throw new Error(`queue lock exists and is unreadable: ${lockPath}`);
      }
      const sameHost = current.hostname === os.hostname();
      if (sameHost && !processExists(Number(current.pid))) {
        await fsp.unlink(lockPath);
        continue;
      }
      throw new Error(`queue is already owned by pid ${current.pid ?? '?'} on ${current.hostname ?? 'unknown host'}`);
    }
  }
  throw new Error(`unable to acquire queue lock: ${lockPath}`);
}

async function claimNextJob(queueRoot) {
  const pending = path.join(queueRoot, 'pending');
  const running = path.join(queueRoot, 'running');
  for (const jobId of await listJobDirs(pending)) {
    assertJobId(jobId);
    try {
      await fsp.rename(path.join(pending, jobId), path.join(running, jobId));
      return { jobId, jobDir: path.join(running, jobId) };
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
  }
  return null;
}

async function spawnFactory({ requestPath, outDir, artifactDir, workspace }) {
  await fsp.rm(outDir, { recursive: true, force: true });
  await fsp.mkdir(outDir, { recursive: true });
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      FACTORY,
      '--request', requestPath,
      '--out-dir', outDir,
      '--artifact-dir', artifactDir,
    ], {
      cwd: workspace,
      env: { ...process.env },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`canonical factory exited with ${code ?? signal}`));
    });
  });
}

async function nextAttemptNumber(jobDir) {
  const attemptsDir = path.join(jobDir, 'attempts');
  await fsp.mkdir(attemptsDir, { recursive: true });
  const files = (await fsp.readdir(attemptsDir)).filter(name => /^\d{4}\.json$/.test(name));
  return files.length + 1;
}

async function writeAttempt(jobDir, attempt) {
  const attemptsDir = path.join(jobDir, 'attempts');
  await fsp.mkdir(attemptsDir, { recursive: true });
  const filename = path.join(attemptsDir, `${String(attempt.attempt).padStart(4, '0')}.json`);
  await atomicWrite(filename, `${JSON.stringify(attempt, null, 2)}\n`);
}

function relativeToQueue(queueRoot, filename) {
  return path.relative(queueRoot, filename).split(path.sep).join('/');
}

export async function processOneLocalJob({ queueRoot, workspace, executor = spawnFactory }) {
  const root = await ensureLocalQueue(queueRoot);
  const claimed = await claimNextJob(root);
  if (!claimed) return null;

  const { jobId, jobDir } = claimed;
  const startedAt = new Date().toISOString();
  let attemptNumber = 1;
  try {
    const { job, requestPath } = await readAndVerifyJob(jobDir);
    attemptNumber = await nextAttemptNumber(jobDir);
    const executionWorkspace = path.resolve(workspace || job.workspace_hint || ROOT);
    const outDir = path.join(root, 'results', jobId);
    const artifactDir = path.join(root, 'canonical-artifacts');

    await executor({
      job,
      requestPath,
      outDir,
      artifactDir,
      workspace: executionWorkspace,
    });

    const runPath = path.join(outDir, 'run.json');
    const manifestPath = path.join(outDir, 'canonical-artifacts.json');
    if (!(await pathExists(runPath))) throw new Error(`${jobId}: canonical factory did not produce run.json`);
    if (!(await pathExists(manifestPath))) throw new Error(`${jobId}: canonical factory did not produce canonical-artifacts.json`);
    const run = JSON.parse(await fsp.readFile(runPath, 'utf8'));
    const manifestBytes = await fsp.readFile(manifestPath);
    const completedAt = new Date().toISOString();
    const attempt = {
      schema: ATTEMPT_SCHEMA,
      job_id: jobId,
      attempt: attemptNumber,
      status: 'succeeded',
      request_sha256: job.request_sha256,
      started_at: startedAt,
      completed_at: completedAt,
      canonical_manifest_sha256: run.canonical_manifest_sha256 || sha256(manifestBytes),
      result_dir: relativeToQueue(root, outDir),
      run_receipt: relativeToQueue(root, runPath),
      canonical_manifest: relativeToQueue(root, manifestPath),
    };
    await writeAttempt(jobDir, attempt);
    await fsp.rename(jobDir, path.join(root, 'done', jobId));
    return attempt;
  } catch (error) {
    const attempt = {
      schema: ATTEMPT_SCHEMA,
      job_id: jobId,
      attempt: attemptNumber,
      status: 'failed',
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      error: {
        name: error?.name || 'Error',
        message: String(error?.message || error),
      },
    };
    try { await writeAttempt(jobDir, attempt); } catch {}
    await fsp.rename(jobDir, path.join(root, 'failed', jobId));
    return attempt;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function runLocalWorker({ queueRoot, workspace, once = false, pollMs = 1000, retryJobId = null }) {
  const root = await ensureLocalQueue(queueRoot);
  const release = await acquireLocalQueueLock(root);
  try {
    const recovered = await recoverAbandonedLocalJobs(root);
    if (retryJobId) await retryFailedLocalJob(root, retryJobId);
    do {
      const result = await processOneLocalJob({ queueRoot: root, workspace });
      if (once) return { recovered, result };
      if (!result) await sleep(pollMs);
    } while (true);
  } finally {
    await release();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const queueRoot = path.resolve(String(options.queue || '.local-render-queue'));
  const workspace = path.resolve(String(options.workspace || process.cwd()));
  const pollMs = Number(options['poll-ms'] || 1000);
  if (!Number.isFinite(pollMs) || pollMs < 100) throw new Error('--poll-ms must be at least 100');
  const retryJobId = options.retry ? String(options.retry) : null;
  const outcome = await runLocalWorker({
    queueRoot,
    workspace,
    once: Boolean(options.once),
    pollMs,
    retryJobId,
  });
  if (options.once) console.log(JSON.stringify(outcome, null, 2));
}

const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  main().catch(error => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
