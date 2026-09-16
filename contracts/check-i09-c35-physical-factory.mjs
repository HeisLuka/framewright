#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root=path.resolve(process.argv[2]||'artifacts/i09');
const inputDir=path.join(root,'input');
const queue=path.join(root,'queue');
const readJson=filename=>JSON.parse(fs.readFileSync(filename,'utf8'));
const sha256=filename=>crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
const must=(condition,message)=>{if(!condition)throw new Error(message);};

const input=readJson(path.join(inputDir,'input-report.json'));
const publishReady=readJson(path.join(inputDir,'publish-ready.json'));
const enqueue=readJson(path.join(root,'enqueue.json'));
const worker=readJson(path.join(root,'worker.json'));
const replay=readJson(path.join(root,'replay-enqueue.json'));

must(input.schema==='newboo-i09-c35-physical-input-v1','wrong I09 input schema');
must(input.modes?.length===3,'expected three C35 input modes');
must(JSON.stringify(input.preview_modes?.slice().sort())===JSON.stringify(['external_copy_review_required','trusted_atoms','verified_composition'].sort()),'all C35 modes must be preview-renderable');
must(JSON.stringify(input.publish_ready_modes?.slice().sort())===JSON.stringify(['trusted_atoms','verified_composition'].sort()),'publish-ready creative trust modes drifted');
must(publishReady.schema==='newboo-i09-publish-ready-v1','wrong publish-ready schema');
must(JSON.stringify(publishReady.items.map(x=>x.mode).sort())===JSON.stringify(['trusted_atoms','verified_composition'].sort()),'unapproved free copy leaked into publish-ready set');

must(enqueue.duplicate===false&&enqueue.state==='pending','first enqueue must create one pending job');
must(worker?.result?.status==='succeeded','I07 worker did not succeed');
must(worker.result.attempt===1,'I07 physical campaign should succeed on first attempt');
must(worker.result.job_id===enqueue.job_id,'worker job identity mismatch');
must(replay.duplicate===true&&replay.state==='done','re-enqueue after success must dedupe to done state');
must(replay.job_id===enqueue.job_id&&replay.request_sha256===enqueue.request_sha256,'replay enqueue identity mismatch');

const jobId=enqueue.job_id;
const doneDir=path.join(queue,'done',jobId);
const attemptsDir=path.join(doneDir,'attempts');
const attemptFiles=fs.readdirSync(attemptsDir).filter(x=>/^\d{4}\.json$/.test(x)).sort();
must(attemptFiles.length===1,`duplicate replay created extra physical attempts: ${attemptFiles.length}`);
const attempt=readJson(path.join(attemptsDir,attemptFiles[0]));
must(attempt.status==='succeeded'&&attempt.attempt===1,'canonical I07 attempt receipt invalid');

const resultDir=path.join(queue,'results',jobId);
const run=readJson(path.join(resultDir,'run.json'));
const pkg=readJson(path.join(resultDir,'delivery-package.json'));
const canonicalManifestPath=path.join(resultDir,'canonical-artifacts.json');
must(fs.existsSync(canonicalManifestPath),'canonical artifact manifest missing');
must(attempt.canonical_manifest_sha256===run.canonical_manifest_sha256,'I07 attempt/run canonical manifest identity mismatch');
must(run.campaign_id===input.campaign_id,'campaign ID drift');
must(run.selected_creatives===3&&run.render_specs===3&&run.reserves===0,'physical factory accounting drift');
must(pkg.schema==='newboo-delivery-package-v1','wrong C19 delivery package schema');
must(pkg.creatives?.length===3&&pkg.render_specs?.length===3,'C19 package lost C35 creatives/render specs');

const inputByMode=new Map(input.modes.map(x=>[x.mode,x]));
const seenModes=new Set();
const artifactShas=new Set();
const creativeIds=new Set();
const renderSpecIds=new Set();
const modeResults=[];

for(const creative of pkg.creatives){
  const provenance=creative.hook?.provenance;
  must(provenance?.kind==='c35_creative_ingress','CreativeSpec lost C35 provenance');
  const mode=provenance.mode;
  const expected=inputByMode.get(mode);
  must(expected,`unexpected physical C35 mode ${mode}`);
  must(!seenModes.has(mode),`duplicate physical creative for ${mode}`);
  seenModes.add(mode);
  must(provenance.ingress_id===expected.ingress_id,`${mode}: ingress ID drift through C19`);
  must(provenance.program_id===expected.program_id,`${mode}: program ID drift through C19`);
  must(provenance.narrative_plan_id===expected.narrative_plan_id,`${mode}: NarrativePlan ID drift through C19`);
  must(provenance.publication_trust_satisfied===expected.publication_trust_satisfied,`${mode}: creative trust state drift through C19`);
  must(creative.payload_sha256===expected.payload_sha256,`${mode}: payload identity drift through C19`);
  must(creative.timeline?.duration_ms===9000&&creative.timeline?.frame_count===270&&creative.timeline?.fps===30,`${mode}: physical timeline drift`);
  creativeIds.add(creative.creative_id);

  const execution=pkg.executions?.[creative.creative_id];
  must(execution?.payload&&execution?.html,`${mode}: physical execution binding missing`);
  const payloadPath=path.resolve(execution.payload);
  must(fs.existsSync(payloadPath),`${mode}: physical payload missing`);
  must(sha256(payloadPath)===creative.payload_sha256,`${mode}: execution payload bytes do not match CreativeSpec`);
  const payload=readJson(payloadPath);
  must(payload.narrative_plan?.narrative_plan_id===expected.narrative_plan_id,`${mode}: rendered payload does not contain the C35 NarrativePlan`);
  must(payload.hook===creative.hook.text&&payload.hook===expected.hook_text,`${mode}: rendered hook bytes drifted from C35 program`);
  must(payload.visual_system===expected.visual_system,`${mode}: visual system binding drift`);

  const specs=pkg.render_specs.filter(x=>x.creative_id===creative.creative_id);
  must(specs.length===1,`${mode}: expected exactly one physical RenderSpec`);
  const spec=specs[0];
  renderSpecIds.add(spec.render_spec_id);
  const receiptPath=path.join(resultDir,'receipts',`${spec.render_spec_id}.json`);
  const videoPath=path.join(resultDir,'video',`${spec.render_spec_id}.mp4`);
  must(fs.existsSync(receiptPath)&&fs.existsSync(videoPath),`${mode}: physical receipt/video missing`);
  const receipt=readJson(receiptPath);
  must(receipt.render_spec_id===spec.render_spec_id,`${mode}: receipt RenderSpec mismatch`);
  must(receipt.qa?.status==='pass',`${mode}: runtime QA failed`);
  must(receipt.output?.frame_count===270&&receipt.output?.duration_ms===9000,`${mode}: physical frames/duration drift`);
  must(receipt.output?.mime_type==='video/mp4',`${mode}: output MIME drift`);
  const observedSha=sha256(videoPath);
  must(observedSha===receipt.output.sha256,`${mode}: MP4 SHA mismatch vs physical receipt`);
  artifactShas.add(observedSha);
  modeResults.push({
    mode,
    ingress_id:expected.ingress_id,
    program_id:expected.program_id,
    narrative_plan_id:expected.narrative_plan_id,
    creative_id:creative.creative_id,
    render_spec_id:spec.render_spec_id,
    payload_sha256:creative.payload_sha256,
    artifact_sha256:observedSha,
    bytes:receipt.output.bytes,
    frame_count:receipt.output.frame_count,
    duration_ms:receipt.output.duration_ms,
    publication_trust_satisfied:expected.publication_trust_satisfied,
  });
}

must(seenModes.size===3,'not all three C35 modes reached physical factory');
must(creativeIds.size===3,'C35 mode provenance did not produce three distinct CreativeSpecs');
must(renderSpecIds.size===3,'C35 mode provenance did not produce three distinct RenderSpecs');
must(artifactShas.size===3,'three C35 physical creatives unexpectedly collapsed to identical MP4 bytes');

const external=modeResults.find(x=>x.mode==='external_copy_review_required');
must(external&&!external.publication_trust_satisfied,'unapproved external copy was not preserved as review-required');
must(!publishReady.items.some(x=>x.ingress_id===external.ingress_id),'unapproved external copy entered publish-ready set');

modeResults.sort((a,b)=>a.mode.localeCompare(b.mode));
const report={
  schema:'newboo-i09-c35-physical-factory-audit-v1',
  status:'PASS',
  job_id:jobId,
  request_sha256:enqueue.request_sha256,
  first_attempt:worker.result.attempt,
  duplicate_enqueue_state:replay.state,
  physical_attempt_count:attemptFiles.length,
  campaign_id:run.campaign_id,
  selected_creatives:run.selected_creatives,
  render_specs:run.render_specs,
  distinct_creative_ids:creativeIds.size,
  distinct_render_spec_ids:renderSpecIds.size,
  distinct_artifact_shas:artifactShas.size,
  publish_ready_modes:publishReady.items.map(x=>x.mode).sort(),
  preview_only_modes:modeResults.filter(x=>!x.publication_trust_satisfied).map(x=>x.mode),
  modes:modeResults,
};
fs.writeFileSync(path.join(root,'report.json'),`${JSON.stringify(report,null,2)}\n`);
const summary=`# I11 C35 -> I07 physical factory (internal i09 provenance)\n\n`+
`Status: **PASS**. One C35 campaign produced **${report.selected_creatives} CreativeSpecs -> ${report.render_specs} RenderSpecs -> ${report.distinct_artifact_shas} distinct physical MP4s**.\n\n`+
`I07 attempt count: **${report.physical_attempt_count}**; duplicate enqueue after success resolves to **${report.duplicate_enqueue_state}** without a second render attempt.\n\n`+
`Publish-ready creative trust modes: **${report.publish_ready_modes.join(', ')}**. Preview-only modes: **${report.preview_only_modes.join(', ')}**.\n`;
fs.writeFileSync(path.join(root,'summary.md'),summary);
console.log(summary);
console.log(JSON.stringify(report,null,2));
