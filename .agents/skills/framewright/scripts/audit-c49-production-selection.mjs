#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const inputDir=path.resolve(process.argv[2]||'.bench/c49/input');
const run1Dir=path.resolve(process.argv[3]||'.bench/c49/run1');
const run2Dir=path.resolve(process.argv[4]||'.bench/c49/run2');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const request=read(path.join(inputDir,'campaign.json'));
const selection=read(path.join(inputDir,'selection.json'));
const materialization=read(path.join(inputDir,'materialization-manifest.json'));
const package1=read(path.join(run1Dir,'delivery-package.json'));
const canonical1=read(path.join(run1Dir,'canonical-artifacts.json'));
const canonical2=read(path.join(run2Dir,'canonical-artifacts.json'));
const run1=read(path.join(run1Dir,'run.json'));
const run2=read(path.join(run2Dir,'run.json'));

assert.equal(selection.schema,'newboo-template-campaign-selection-v1');
assert.equal(selection.mode,'current_macro_aware_v2');
assert.equal(selection.provenance.receipt.schema,'newboo-batch-template-diversity-receipt-v2');
assert.deepEqual(selection.provenance.receipt.macro_axes,['asset_staging','structural_layout','visual_system']);
assert.ok(materialization.candidate_count>=1000);
assert.equal(materialization.selected_count,6);
assert.equal(materialization.reserve_count,materialization.candidate_count-6);
assert.equal(request.selected.length,6);
assert.equal(request.reserves.length,materialization.candidate_count-6);
assert.equal(new Set(request.reserves.map(row=>row.reserve_id)).size,request.reserves.length);
assert.equal(request.selection_provenance.selection_id,selection.selection_id);
assert.deepEqual(request.selection_provenance,selection.provenance);
assert.deepEqual(request.selected.map(row=>row.selection_order),[0,1,2,3,4,5]);
assert.deepEqual(materialization.rows.map(row=>row.candidate_id),selection.ordered_selected_candidate_ids);
assert.deepEqual(materialization.rows.map(row=>row.selection_id),request.selected.map(row=>row.selection_id));
assert.equal(new Set(materialization.rows.map(row=>row.template_variant_id)).size,6);
assert.equal(new Set(materialization.rows.map(row=>row.scene_program_id)).size,6);
assert.equal(new Set(materialization.rows.map(row=>row.payload_sha256)).size,6);
const payloadFiles=fs.readdirSync(inputDir).filter(name=>name.endsWith('.payload.json')).sort();
assert.equal(payloadFiles.length,6,'only selected candidates should be physically materialized');
assert.deepEqual(payloadFiles,request.selected.map(row=>path.basename(row.execution.payload)).sort());

assert.equal(package1.schema,'framewright-c19-delivery-package-v1');
assert.deepEqual(package1.selection_provenance,selection.provenance);
assert.deepEqual(package1.selected.map(row=>row.selection_order),[0,1,2,3,4,5]);
assert.deepEqual(package1.selected.map(row=>row.selection_id),request.selected.map(row=>row.selection_id));
assert.equal(package1.renders.length,6);
assert.deepEqual(package1.renders.map(row=>row.selection_order),[0,1,2,3,4,5]);
assert.equal(package1.reserves.length,materialization.candidate_count-6);
assert.equal(package1.renders.some(render=>request.reserves.some(reserve=>reserve.reserve_id===render.selection_id)),false,'reserve received a RenderSpec');

assert.equal(canonical1.selected_creatives,6);
assert.equal(canonical1.render_specs,6);
assert.equal(canonical1.reserves,materialization.candidate_count-6);
assert.deepEqual(canonical1.selection_provenance,selection.provenance);
assert.equal(canonical1.artifacts.length,6);
assert.ok(canonical1.artifacts.every(artifact=>artifact.qa?.status==='pass'));
assert.deepEqual(new Set(canonical1.artifacts.map(artifact=>artifact.selection_id)),new Set(request.selected.map(row=>row.selection_id)));
assert.equal(run1.cache_hits,0);
assert.equal(run2.cache_hits,6);
assert.deepEqual(canonical2,canonical1,'exact factory replay must preserve canonical artifact manifest including selection provenance');
assert.equal(run1.canonical_manifest_sha256,run2.canonical_manifest_sha256);

console.log(JSON.stringify({
  schema:'c49-production-selection-physical-acceptance-v1',candidate_count:materialization.candidate_count,selected_count:6,reserve_count:materialization.reserve_count,physical_payload_files:payloadFiles.length,selection_id:selection.selection_id,policy_id:selection.provenance.policy_id,batch_id:selection.provenance.batch_id,macro_axes:selection.provenance.receipt.macro_axes,c19_selection_order_preserved:true,c19_selection_provenance_preserved:true,canonical_artifact_provenance_preserved:true,reserves_receive_no_render_specs:true,selected_only_materialization:true,first_run_cache_hits:run1.cache_hits,replay_cache_hits:run2.cache_hits,canonical_replay_equal:true},null,2));
