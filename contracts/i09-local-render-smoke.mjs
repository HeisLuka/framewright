#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { computeContextHash, computeProposalId } from './creative-proposal-v1.mjs';
import { prepareLocalVideoRequest } from './i09-local-video-job-v1.mjs';
import { ensureLocalVideoTemplate } from '../.agents/skills/framewright/scripts/build-local-video-template.mjs';
import {
  enqueueLocalRenderJob,
  findLocalJobState,
  runLocalWorker,
} from '../.agents/skills/framewright/scripts/local-render-worker.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bench = path.join(ROOT, '.bench/i09-smoke');
const stateRoot = path.join(bench, 'state');
const assetDir = path.join(stateRoot, 'assets');
const queueRoot = path.join(stateRoot, 'queue');
const fixtureDir = path.join(bench, 'e08');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, CI: process.env.CI || '1' } });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code ?? signal}`)));
  });
}

await fsp.rm(bench, { recursive: true, force: true });
await fsp.mkdir(assetDir, { recursive: true });

try {
  await run(process.execPath, [path.join(ROOT, '.agents/skills/framewright/scripts/make-e08-fixtures.mjs'), fixtureDir]);
  const fixtureManifest = JSON.parse(await fsp.readFile(path.join(fixtureDir, 'manifest.json'), 'utf8'));
  const fixture = fixtureManifest.items.find(row => row.id === 'winter-map') || fixtureManifest.items[0];
  assert.ok(fixture, 'E08 fixture missing');
  const payload = JSON.parse(await fsp.readFile(path.join(fixtureDir, fixture.payloadFile), 'utf8'));
  const coverPath = path.join(fixtureDir, path.basename(payload.cover_url));
  assert.equal(fs.existsSync(coverPath), true, `fixture cover missing: ${coverPath}`);
  const coverBytes = await fsp.readFile(coverPath);
  const coverSha = sha(coverBytes);
  await fsp.writeFile(path.join(assetDir, `${coverSha}.png`), coverBytes);

  const pack = {
    schema: 'newboo-context-pack-v1',
    context_pack_id: 'ctx_i09_render_smoke',
    context_hash: '0'.repeat(64),
    revision: 1,
    account: { account_id: 'account_i09_smoke', brand_name: 'NEWBOO', locale: 'en-US' },
    books: [{
      book_id: payload.book_id,
      title: payload.title,
      author: payload.author,
      facts: [{ fact_id: 'fact_hook', kind: 'premise', value: payload.hook, source_ref: 'fixture:e08:hook' }],
      creative_atoms: [{
        atom_id: 'atom_hook', role: 'hook', angle_types: ['premise'], text: payload.hook,
        source_fact_ids: ['fact_hook'], spoiler_level: 0,
      }],
      assets: [{ asset_id: 'asset_cover', role: 'cover', sha256: coverSha, media_type: 'image/png' }],
    }],
    ctas: [],
    capabilities: {
      angle_types: ['premise'], visual_systems: ['swiss'], duration_seconds: [5], fps: [30],
      reveal_timings: ['mid'], cta_treatments: ['none'], delivery_profiles: ['youtube_shorts'],
    },
    constraints: { max_spoiler_level: 0, max_body_atoms: 0 },
  };
  pack.context_hash = computeContextHash(pack);
  const proposal = {
    schema: 'newboo-creative-proposal-v1',
    context_pack_id: pack.context_pack_id,
    context_hash: pack.context_hash,
    account_id: pack.account.account_id,
    book_id: payload.book_id,
    narrative: { angle_type: 'premise', hook_atom_id: 'atom_hook', reveal_timing: 'mid', cta_treatment: 'none' },
    presentation: { duration_seconds: 5, fps: 30, visual_system: 'swiss', delivery_profile: 'youtube_shorts', seed: 17 },
    selected_asset_ids: ['asset_cover'],
  };
  proposal.proposal_id = computeProposalId(proposal);

  const template = await ensureLocalVideoTemplate({ outDir: path.join(bench, 'runtime') });
  const prepared = await prepareLocalVideoRequest({
    repoRoot: ROOT, stateRoot, contextPack: pack, proposal,
    rawProposalJson: JSON.stringify({ ...proposal, proposal_id: undefined }, null, 2),
    assetDir, templatePath: template.template_path,
  });
  const queued = await enqueueLocalRenderJob({ queueRoot, requestPath: prepared.request_path, workspace: ROOT });
  assert.equal(queued.state, 'pending');
  const worker = await runLocalWorker({ queueRoot, workspace: ROOT, once: true });
  assert.equal(worker.result?.status, 'succeeded', JSON.stringify(worker, null, 2));
  assert.equal(await findLocalJobState(queueRoot, queued.job_id), 'done');

  const manifestPath = path.join(queueRoot, 'results', queued.job_id, 'canonical-artifacts.json');
  const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  assert.equal(manifest.schema, 'newboo-campaign-artifact-manifest-v1');
  assert.equal(manifest.artifacts.length, 1);
  const artifact = manifest.artifacts[0];
  assert.equal(artifact.qa.status, 'pass');
  assert.equal(artifact.render_spec_id, prepared.render_spec_id);
  const mp4 = path.join(queueRoot, 'results', queued.job_id, 'video', `${artifact.render_spec_id}.mp4`);
  assert.equal(fs.existsSync(mp4), true, `MP4 missing: ${mp4}`);
  assert.ok((await fsp.stat(mp4)).size > 0, 'MP4 must be non-empty');
  assert.equal(sha(await fsp.readFile(mp4)), artifact.output.sha256);

  console.log(JSON.stringify({
    schema: 'newboo-i09-local-render-smoke-v1', status: 'pass', job_id: queued.job_id,
    proposal_id: proposal.proposal_id, program_id: prepared.program_id,
    creative_id: prepared.creative_id, render_spec_id: prepared.render_spec_id,
    mp4, bytes: (await fsp.stat(mp4)).size, sha256: artifact.output.sha256, qa: artifact.qa.status,
  }, null, 2));
} finally {
  if (!process.env.KEEP_I09_SMOKE) await fsp.rm(bench, { recursive: true, force: true });
}
