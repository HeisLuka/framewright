#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { compileDeliveryPackage } from './c19-delivery-package-v1.mjs';
import {
  computeContextHash,
  computeProposalId,
  validateCreativeProposal,
} from './creative-proposal-v1.mjs';
import {
  normalizeOperatorProposal,
  parseProposalJson,
  prepareLocalVideoRequest,
  preflightLocalVideo,
  sha256File,
} from './i09-local-video-job-v1.mjs';
import {
  enqueueLocalRenderJob,
  findLocalJobState,
  processOneLocalJob,
} from '../.agents/skills/framewright/scripts/local-render-worker.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');

function makePack(coverSha) {
  const pack = {
    schema: 'newboo-context-pack-v1', context_pack_id: 'ctx_i09_test', context_hash: '0'.repeat(64), revision: 1,
    account: { account_id: 'account_i09', brand_name: 'NEWBOO', locale: 'en-US' },
    books: [{
      book_id: 'book_i09', title: 'Tomorrow Writes Back', author: 'A. Example',
      facts: [{ fact_id: 'fact_premise', kind: 'premise', value: 'Every evening a letter arrives from tomorrow.', source_ref: 'fixture:i09' }],
      creative_atoms: [{ atom_id: 'atom_hook', role: 'hook', angle_types: ['premise'], text: 'Every evening, a letter arrives from tomorrow.', source_fact_ids: ['fact_premise'], spoiler_level: 0 }],
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
  return pack;
}

function makeProposal(pack) {
  const proposal = {
    schema: 'newboo-creative-proposal-v1', proposal_id: 'nbp1_' + '0'.repeat(64), context_pack_id: pack.context_pack_id,
    context_hash: pack.context_hash, account_id: pack.account.account_id, book_id: 'book_i09',
    narrative: { angle_type: 'premise', hook_atom_id: 'atom_hook', reveal_timing: 'mid', cta_treatment: 'none' },
    presentation: { duration_seconds: 5, fps: 30, visual_system: 'swiss', delivery_profile: 'youtube_shorts', seed: 17 },
    selected_asset_ids: ['asset_cover'],
  };
  proposal.proposal_id = computeProposalId(proposal);
  return proposal;
}

const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'newboo-i09-'));
const repoRoot = path.join(root, 'repo');
const stateRoot = path.join(repoRoot, '.local-video-console');
const assetDir = path.join(stateRoot, 'assets');
const queueRoot = path.join(stateRoot, 'queue');
await fsp.mkdir(assetDir, { recursive: true });

try {
  const coverBytes = Buffer.from('i09-valid-cover-fixture-bytes');
  const coverSha = sha(coverBytes);
  await fsp.writeFile(path.join(assetDir, `${coverSha}.png`), coverBytes);
  const templatePath = path.join(stateRoot, 'runtime', 'index-c27.html');
  await fsp.mkdir(path.dirname(templatePath), { recursive: true });
  await fsp.writeFile(templatePath, '<!doctype html><canvas id="c"></canvas>\n');

  const pack = makePack(coverSha);
  const proposal = makeProposal(pack);
  assert.equal(validateCreativeProposal(pack, proposal).valid, true);

  const parsed = parseProposalJson(JSON.stringify(proposal));
  assert.equal(parsed.proposal_id, proposal.proposal_id);
  const idless = structuredClone(proposal);
  delete idless.proposal_id;
  const normalized = normalizeOperatorProposal(idless);
  assert.equal(normalized.proposal_id, proposal.proposal_id, 'operator console must own proposal identity');
  assert.throws(() => parseProposalJson('{broken'), error => error.code === 'JSON_PARSE_ERROR');

  const injected = structuredClone(proposal);
  injected.url = 'https://attacker.example/raw';
  injected.proposal_id = computeProposalId(injected);
  const injectedReport = validateCreativeProposal(pack, injected);
  assert.equal(injectedReport.valid, false);
  assert.ok(injectedReport.errors.some(error => error.code === 'FORBIDDEN_RAW_CONTENT'));

  const preflight = await preflightLocalVideo({ contextPack: pack, proposal, assetDir, templatePath });
  assert.equal(preflight.ok, true, JSON.stringify(preflight, null, 2));
  assert.equal(preflight.binding.cover_sha256, coverSha);

  const prepared = await prepareLocalVideoRequest({
    repoRoot, stateRoot, contextPack: pack, proposal, rawProposalJson: JSON.stringify(proposal), assetDir, templatePath,
  });
  const request = JSON.parse(await fsp.readFile(prepared.request_path, 'utf8'));
  const compiled = compileDeliveryPackage(request);
  assert.equal(compiled.counts.render_specs, 1);
  assert.equal(prepared.render_spec_id, compiled.renders[0].render.render_spec_id);
  assert.equal(request.selected[0].execution.html.includes('..'), false);
  assert.equal(request.selected[0].execution.payload.includes('..'), false);
  assert.equal(request.selected[0].creative.hook.text, 'Every evening, a letter arrives from tomorrow.');
  assert.equal(await sha256File(path.join(repoRoot, request.selected[0].execution.payload)), request.selected[0].creative.payload_sha256);
  assert.equal(await sha256File(path.join(repoRoot, request.selected[0].execution.html)), request.selected[0].creative.template.sha256);
  const serializedRequest = JSON.stringify(request);
  assert.equal(serializedRequest.includes('attacker.example'), false);
  assert.equal(serializedRequest.includes('shell'), false);

  const enqueued = await enqueueLocalRenderJob({ queueRoot, requestPath: prepared.request_path, workspace: repoRoot });
  assert.equal(enqueued.state, 'pending');
  assert.equal(await findLocalJobState(queueRoot, enqueued.job_id), 'pending');

  const fakeExecutor = async ({ outDir, job }) => {
    await fsp.mkdir(outDir, { recursive: true });
    await fsp.writeFile(path.join(outDir, 'run.json'), `${JSON.stringify({ canonical_manifest_sha256: 'a'.repeat(64) })}\n`);
    await fsp.writeFile(path.join(outDir, 'canonical-artifacts.json'), `${JSON.stringify({ schema: 'fixture', job_id: job.job_id })}\n`);
  };
  const outcome = await processOneLocalJob({ queueRoot, workspace: repoRoot, executor: fakeExecutor });
  assert.equal(outcome.status, 'succeeded');
  assert.equal(await findLocalJobState(queueRoot, enqueued.job_id), 'done');

  console.log(JSON.stringify({
    schema: 'newboo-i09-local-console-check-v1', status: 'pass',
    checks: [
      'proposal-json-parse', 'proposal-id-auto', 'forbidden-raw-content', 'trusted-cover-hash', 'trusted-template-binding',
      'creative-proposal-to-c19', 'physical-payload-sha', 'physical-template-sha', 'path-isolation', 'i07-enqueue-and-terminal-state',
    ],
    proposal_id: proposal.proposal_id, program_id: preflight.program.program_id,
    creative_id: prepared.creative_id, render_spec_id: prepared.render_spec_id,
  }, null, 2));
} finally {
  await fsp.rm(root, { recursive: true, force: true });
}
