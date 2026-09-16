#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  findLocalJobState,
  enqueueLocalRenderJob,
  runLocalWorker,
} from './local-render-worker.mjs';
import { ensureLocalVideoTemplate } from './build-local-video-template.mjs';
import {
  loadContextPackForProposal,
  normalizeOperatorProposal,
  parseProposalJson,
  preflightLocalVideo,
  prepareLocalVideoRequest,
} from '../../../../contracts/i09-local-video-job-v1.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '../../../..');
const MAX_BODY = 640 * 1024;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`unexpected positional argument: ${token}`);
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next != null && !next.startsWith('--')) { out[key] = next; i += 1; }
    else out[key] = true;
  }
  return out;
}

function json(res, status, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': bytes.length,
    'cache-control': 'no-store',
  });
  res.end(bytes);
}

function errorPayload(error) {
  const details = Array.isArray(error?.details) ? error.details : null;
  return {
    ok: false,
    code: error?.code || 'LOCAL_CONSOLE_ERROR',
    message: String(error?.message || error),
    errors: details,
  };
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) {
      const error = new Error(`request exceeds ${MAX_BODY} bytes`);
      error.code = 'HTTP_BODY_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch (error) {
    const out = new Error(`invalid API JSON: ${error.message}`);
    out.code = 'HTTP_JSON_PARSE_ERROR';
    throw out;
  }
  return value;
}

async function listContextIds(contextDir) {
  await fsp.mkdir(contextDir, { recursive: true });
  const out = [];
  for (const entry of (await fsp.readdir(contextDir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const value = JSON.parse(await fsp.readFile(path.join(contextDir, entry.name), 'utf8'));
      if (typeof value.context_pack_id === 'string') out.push({ context_pack_id: value.context_pack_id, revision: value.revision ?? null });
    } catch {}
  }
  return out;
}

function programSummary(pack, proposal, program, binding = null) {
  return {
    context_pack_id: pack.context_pack_id,
    context_hash: pack.context_hash,
    context_revision: pack.revision,
    proposal_id: proposal.proposal_id,
    program_id: program.program_id,
    narrative_plan_id: program.narrative_plan.narrative_plan_id,
    book_id: proposal.book_id,
    duration_seconds: proposal.presentation.duration_seconds,
    fps: proposal.presentation.fps,
    visual_system: proposal.presentation.visual_system,
    delivery_profile: proposal.presentation.delivery_profile,
    roles: (program.narrative_plan.roles || []).map(role => ({ role: role.role, frames: role.frames })),
    binding: binding ? {
      cover_asset_id: binding.cover_asset_id,
      cover_sha256: binding.cover_sha256,
      template_sha256: binding.template_sha256,
    } : null,
  };
}

async function resolveProposal(body, paths, templatePath) {
  const raw = String(body?.proposal_json ?? '');
  const parsed = parseProposalJson(raw);
  const proposal = normalizeOperatorProposal(parsed);
  const { contextPack } = await loadContextPackForProposal({ contextDir: paths.contextDir, proposal });
  const preflight = await preflightLocalVideo({ contextPack, proposal, assetDir: paths.assetDir, templatePath });
  if (!preflight.ok) {
    const error = new Error(preflight.errors?.[0]?.message || preflight.code);
    error.code = preflight.code;
    error.details = preflight.errors;
    throw error;
  }
  return { raw, proposal, contextPack, preflight };
}

async function jobStatus(queueRoot, jobId) {
  const state = await findLocalJobState(queueRoot, jobId);
  if (!state) return { ok: false, code: 'JOB_NOT_FOUND', job_id: jobId };
  const response = { ok: true, job_id: jobId, state };
  if (state === 'done' || state === 'failed') {
    const jobDir = path.join(queueRoot, state, jobId);
    const attemptsDir = path.join(jobDir, 'attempts');
    try {
      const attempts = (await fsp.readdir(attemptsDir)).filter(name => /^\d{4}\.json$/.test(name)).sort();
      if (attempts.length) response.attempt = JSON.parse(await fsp.readFile(path.join(attemptsDir, attempts.at(-1)), 'utf8'));
    } catch {}
  }
  if (state === 'done') {
    const manifestPath = path.join(queueRoot, 'results', jobId, 'canonical-artifacts.json');
    try {
      const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
      response.artifacts = (manifest.artifacts || []).map(row => ({
        render_spec_id: row.render_spec_id,
        sha256: row.output?.sha256 || null,
        bytes: row.output?.bytes || null,
        qa: row.qa?.status || null,
        local_path: path.join(queueRoot, 'results', jobId, 'video', `${row.render_spec_id}.mp4`),
      }));
    } catch {}
  }
  return response;
}

const PAGE = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Newboo Local Video Factory</title>
<style>
:root{font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#171717;background:#f4f1eb}*{box-sizing:border-box}body{margin:0}main{max-width:1160px;margin:0 auto;padding:28px 22px 60px}.top{display:flex;justify-content:space-between;gap:24px;align-items:end;margin-bottom:18px}h1{font-size:28px;margin:0 0 5px}p{margin:0;color:#666}.badge{font-size:12px;padding:6px 9px;border:1px solid #bbb;border-radius:999px;background:#fff}.grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(320px,.65fr);gap:16px}.card{background:#fff;border:1px solid #d8d3ca;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.04);overflow:hidden}.head{padding:13px 15px;border-bottom:1px solid #e5e1da;font-weight:650}.body{padding:15px}textarea{width:100%;height:610px;resize:vertical;border:1px solid #d8d3ca;border-radius:10px;padding:13px;font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;background:#151515;color:#eaeaea;tab-size:2}.actions{display:flex;gap:9px;margin-top:12px}button{border:1px solid #171717;background:#171717;color:white;border-radius:9px;padding:10px 15px;font-weight:650;cursor:pointer}button.secondary{background:#fff;color:#171717;border-color:#bbb}button:disabled{opacity:.45;cursor:wait}.status{white-space:pre-wrap;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;background:#f6f4f0;border-radius:9px;padding:11px;min-height:90px;overflow:auto}.ok{color:#126b36}.bad{color:#a42323}.meta{display:grid;gap:8px;font-size:13px}.row{display:grid;grid-template-columns:125px 1fr;gap:8px}.key{color:#777}.roles{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.role{font-size:12px;background:#ece8e1;padding:5px 7px;border-radius:7px}.artifact{font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere;background:#edf6ef;border-radius:8px;padding:9px;margin-top:8px}@media(max-width:820px){.grid{grid-template-columns:1fr}textarea{height:430px}.top{align-items:start;flex-direction:column}}
</style></head><body><main>
<div class="top"><div><h1>Newboo Local Video Factory</h1><p>Paste a bounded CreativeProposal. Trusted context, assets and renderer stay outside the JSON.</p></div><div id="ctx" class="badge">loading contexts…</div></div>
<div class="grid"><section class="card"><div class="head">CreativeProposal JSON</div><div class="body"><textarea id="proposal" spellcheck="false">{
  "schema": "newboo-creative-proposal-v1"
}</textarea><div class="actions"><button id="validate">Validate</button><button id="render">Render MP4</button><button id="example" class="secondary">Load repo example</button></div></div></section>
<aside class="card"><div class="head">Result</div><div class="body"><div id="summary" class="meta"></div><div id="status" class="status">Ready.</div><div id="artifacts"></div></div></aside></div>
</main><script>
const q=s=>document.querySelector(s), status=q('#status'), summary=q('#summary'), artifacts=q('#artifacts'); let poll=null;
function text(v){return v==null?'—':String(v)}
function showStatus(v,bad=false){status.textContent=typeof v==='string'?v:JSON.stringify(v,null,2);status.className='status '+(bad?'bad':'ok')}
function showSummary(v){summary.textContent='';if(!v)return;for(const [k,val] of Object.entries(v)){if(k==='roles'||k==='binding')continue;const r=document.createElement('div');r.className='row';const a=document.createElement('div');a.className='key';a.textContent=k;const b=document.createElement('div');b.textContent=text(val);r.append(a,b);summary.append(r)}if(Array.isArray(v.roles)){const box=document.createElement('div');box.className='roles';for(const role of v.roles){const x=document.createElement('span');x.className='role';x.textContent=role.role+' · '+role.frames+'f';box.append(x)}summary.append(box)}}
async function api(url,body){const r=await fetch(url,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const v=await r.json();if(!r.ok||v.ok===false)throw v;return v}
async function validate(){artifacts.textContent='';try{const v=await api('/api/validate',{proposal_json:q('#proposal').value});showSummary(v.summary);showStatus({status:'VALID',proposal_id:v.summary.proposal_id,program_id:v.summary.program_id})}catch(e){showSummary(null);showStatus(e,true)}}
async function render(){clearInterval(poll);artifacts.textContent='';try{const v=await api('/api/render',{proposal_json:q('#proposal').value});showSummary(v.summary);showStatus({status:'QUEUED',job_id:v.job.job_id,state:v.job.state});const id=v.job.job_id;poll=setInterval(async()=>{try{const s=await api('/api/jobs/'+encodeURIComponent(id));showStatus(s,s.state==='failed');if(s.state==='done'||s.state==='failed'){clearInterval(poll);if(s.artifacts){for(const a of s.artifacts){const d=document.createElement('div');d.className='artifact';d.textContent='MP4\n'+a.local_path+'\nsha256 '+a.sha256+'\nQA '+a.qa;artifacts.append(d)}}}}catch(e){clearInterval(poll);showStatus(e,true)}},700)}catch(e){showStatus(e,true)}}
q('#validate').onclick=validate;q('#render').onclick=render;q('#example').onclick=async()=>{try{const v=await api('/api/example');q('#proposal').value=v.proposal_json;showStatus('Repo example loaded. It validates only when its matching trusted ContextPack/assets are installed.')}catch(e){showStatus(e,true)}};
api('/api/info').then(v=>{q('#ctx').textContent=v.contexts.length+' trusted context'+(v.contexts.length===1?'':'s')}).catch(e=>{q('#ctx').textContent='context scan failed';showStatus(e,true)});
</script></body></html>`;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const port = Number(options.port || 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port must be 1..65535');
  const stateRoot = path.resolve(String(options.state || path.join(ROOT, '.local-video-console')));
  const paths = {
    stateRoot,
    contextDir: path.resolve(String(options.contexts || path.join(stateRoot, 'context-packs'))),
    assetDir: path.resolve(String(options.assets || path.join(stateRoot, 'assets'))),
    queueRoot: path.resolve(String(options.queue || path.join(stateRoot, 'queue'))),
  };
  for (const dir of [paths.stateRoot, paths.contextDir, paths.assetDir, paths.queueRoot]) await fsp.mkdir(dir, { recursive: true });
  const template = await ensureLocalVideoTemplate({ outDir: path.join(stateRoot, 'runtime') });
  let workerChain = Promise.resolve();
  const kickWorker = () => {
    workerChain = workerChain.then(() => runLocalWorker({ queueRoot: paths.queueRoot, workspace: ROOT, once: true })).catch(error => console.error(error?.stack || error));
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/') {
        const bytes = Buffer.from(PAGE, 'utf8');
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8', 'content-length': bytes.length, 'cache-control': 'no-store',
          'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          'x-content-type-options': 'nosniff',
        });
        res.end(bytes); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/info') {
        json(res, 200, { ok: true, contexts: await listContextIds(paths.contextDir), state_root: paths.stateRoot, template_build_id: template.build_id }); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/example') {
        const example = path.join(ROOT, 'contracts/examples/creative-proposal-v1.example.json');
        json(res, 200, { ok: true, proposal_json: await fsp.readFile(example, 'utf8') }); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/validate') {
        const body = await readJsonBody(req);
        const resolved = await resolveProposal(body, paths, template.template_path);
        json(res, 200, { ok: true, summary: programSummary(resolved.contextPack, resolved.proposal, resolved.preflight.program, resolved.preflight.binding) }); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/render') {
        const body = await readJsonBody(req);
        const resolved = await resolveProposal(body, paths, template.template_path);
        const prepared = await prepareLocalVideoRequest({
          repoRoot: ROOT, stateRoot: paths.stateRoot, contextPack: resolved.contextPack, proposal: resolved.proposal,
          rawProposalJson: resolved.raw, assetDir: paths.assetDir, templatePath: template.template_path,
        });
        const job = await enqueueLocalRenderJob({ queueRoot: paths.queueRoot, requestPath: prepared.request_path, workspace: ROOT });
        if (job.state === 'pending') kickWorker();
        json(res, 202, { ok: true, job, prepared, summary: programSummary(resolved.contextPack, resolved.proposal, resolved.preflight.program, resolved.preflight.binding) }); return;
      }
      const match = req.method === 'GET' && url.pathname.match(/^\/api\/jobs\/(lrj_[0-9a-f]{64})$/);
      if (match) {
        const value = await jobStatus(paths.queueRoot, match[1]);
        json(res, value.ok ? 200 : 404, value); return;
      }
      json(res, 404, { ok: false, code: 'NOT_FOUND', message: 'route not found' });
    } catch (error) {
      json(res, error?.code === 'HTTP_BODY_TOO_LARGE' ? 413 : 400, errorPayload(error));
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  console.log(`Newboo Local Video Factory: http://127.0.0.1:${port}`);
  console.log(`Trusted ContextPacks: ${paths.contextDir}`);
  console.log(`Trusted assets (sha256-filename-v1): ${paths.assetDir}`);
}

main().catch(error => { console.error(error?.stack || error); process.exitCode = 1; });
