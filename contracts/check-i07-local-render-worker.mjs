#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  acquireLocalQueueLock,
  enqueueLocalRenderJob,
  findLocalJobState,
  processOneLocalJob,
  recoverAbandonedLocalJobs,
  retryFailedLocalJob,
} from '../.agents/skills/framewright/scripts/local-render-worker.mjs';

async function exists(filename) {
  try { await fsp.access(filename); return true; }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'newboo-i07-'));
const queue = path.join(tmp, 'queue');
const workspace = path.join(tmp, 'workspace');
await fsp.mkdir(workspace, { recursive: true });
const request = path.join(workspace, 'campaign.json');
await fsp.writeFile(request, `${JSON.stringify({campaign_id:'i07-fixture',selected:[],delivery_profiles:[]}, null, 2)}\n`);

try {
  const first = await enqueueLocalRenderJob({ queueRoot: queue, requestPath: request, workspace });
  assert.match(first.job_id, /^lrj_[0-9a-f]{64}$/);
  assert.equal(first.state, 'pending');
  assert.equal(first.duplicate, false);
  assert.equal(await findLocalJobState(queue, first.job_id), 'pending');

  const duplicate = await enqueueLocalRenderJob({ queueRoot: queue, requestPath: request, workspace });
  assert.equal(duplicate.job_id, first.job_id);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.state, 'pending');

  const release = await acquireLocalQueueLock(queue);
  await assert.rejects(() => acquireLocalQueueLock(queue), /already owned/);
  await release();
  const releaseAgain = await acquireLocalQueueLock(queue);
  await releaseAgain();

  const pendingDir = path.join(queue, 'pending', first.job_id);
  const runningDir = path.join(queue, 'running', first.job_id);
  await fsp.rename(pendingDir, runningDir);
  const recovered = await recoverAbandonedLocalJobs(queue);
  assert.deepEqual(recovered, [first.job_id]);
  assert.equal(await findLocalJobState(queue, first.job_id), 'pending');

  const successExecutor = async ({ job, outDir }) => {
    await fsp.mkdir(outDir, { recursive: true });
    await fsp.writeFile(path.join(outDir, 'canonical-artifacts.json'), `${JSON.stringify({schema:'fixture',job_id:job.job_id})}\n`);
    await fsp.writeFile(path.join(outDir, 'run.json'), `${JSON.stringify({canonical_manifest_sha256:'a'.repeat(64)})}\n`);
  };
  const success = await processOneLocalJob({ queueRoot: queue, workspace, executor: successExecutor });
  assert.equal(success.status, 'succeeded');
  assert.equal(success.attempt, 1);
  assert.equal(success.canonical_manifest_sha256, 'a'.repeat(64));
  assert.equal(await findLocalJobState(queue, first.job_id), 'done');
  assert.equal(await exists(path.join(queue, 'done', first.job_id, 'attempts', '0001.json')), true);
  assert.equal(await exists(path.join(queue, 'results', first.job_id, 'run.json')), true);

  const failedRequest = path.join(workspace, 'campaign-fail.json');
  await fsp.writeFile(failedRequest, `${JSON.stringify({campaign_id:'i07-fail',selected:[],delivery_profiles:[]}, null, 2)}\n`);
  const failedJob = await enqueueLocalRenderJob({ queueRoot: queue, requestPath: failedRequest, workspace });
  const failed = await processOneLocalJob({
    queueRoot: queue,
    workspace,
    executor: async () => { throw new Error('fixture executor failure'); },
  });
  assert.equal(failed.status, 'failed');
  assert.match(failed.error.message, /fixture executor failure/);
  assert.equal(await findLocalJobState(queue, failedJob.job_id), 'failed');

  const retried = await retryFailedLocalJob(queue, failedJob.job_id);
  assert.equal(retried.state, 'pending');
  assert.equal(await findLocalJobState(queue, failedJob.job_id), 'pending');
  const retrySuccess = await processOneLocalJob({ queueRoot: queue, workspace, executor: successExecutor });
  assert.equal(retrySuccess.status, 'succeeded');
  assert.equal(retrySuccess.attempt, 2);
  assert.equal(await findLocalJobState(queue, failedJob.job_id), 'done');
  assert.equal(await exists(path.join(queue, 'done', failedJob.job_id, 'attempts', '0001.json')), true);
  assert.equal(await exists(path.join(queue, 'done', failedJob.job_id, 'attempts', '0002.json')), true);

  console.log(JSON.stringify({
    schema: 'newboo-i07-local-worker-check-v1',
    status: 'pass',
    checks: ['content-addressed-enqueue','dedupe','worker-lock','crash-recovery','success-terminal','failure-terminal','explicit-retry','attempt-history'],
  }, null, 2));
} finally {
  await fsp.rm(tmp, { recursive: true, force: true });
}
