import assert from 'node:assert/strict';
import { sha256Canonical } from './factory-identity-v1.mjs';
import {
  buildCanonicalTemplateVariabilityRegistry,
  buildDefaultTemplateAutoPolicy,
  composeAutomaticTemplateVariant,
  composeExplicitTemplateVariant,
  deriveTemplateSceneProgram,
  templateDesignSpaceLowerBound,
  validateTemplateAutoPolicy,
} from './template-variant-composer-v1.mjs';

const registry=buildCanonicalTemplateVariabilityRegistry();
const policy=buildDefaultTemplateAutoPolicy();
const policyReport=validateTemplateAutoPolicy(policy,registry);
assert.equal(policyReport.valid,true,JSON.stringify(policyReport.errors));
assert.equal(templateDesignSpaceLowerBound(policy),34992,'6 layout x 3 visual x 6 type x 6 motion x 6 staging x 9 device');
assert.ok(policyReport.design_space_lower_bound>=30000);

const context={aspect:'vertical',duration_seconds:9,semantic_roles:['hook','book_reveal','cta'],available_asset_kinds:['cover']};
const selection={
  structural_layout:'layout_split_editorial_v2',
  visual_system:'swiss',
  typography:'type_editorial_hierarchy_v2',
  motion_grammar:'motion_directional_slide_v2',
  asset_staging:'stage_depth_stack_v2',
  graphic_devices:['device_rule_pair_v2'],
};
const explicit=composeExplicitTemplateVariant({selection,context,registry});
const explicitReordered=composeExplicitTemplateVariant({selection:{graphic_devices:['device_rule_pair_v2'],asset_staging:'stage_depth_stack_v2',motion_grammar:'motion_directional_slide_v2',typography:'type_editorial_hierarchy_v2',visual_system:'swiss',structural_layout:'layout_split_editorial_v2'},context:{...context},registry});
assert.equal(explicit.template_variant.template_variant_id,explicitReordered.template_variant.template_variant_id,'explicit key order must not change template identity');

const changed=composeExplicitTemplateVariant({selection:{...selection,typography:'type_mono_dossier_v2'},context,registry});
assert.notEqual(changed.template_variant.template_variant_id,explicit.template_variant.template_variant_id,'visible typography change must change template identity');

let incompatibleError=null;
try{composeExplicitTemplateVariant({selection:{...selection,typography:'type_paper_shadow_display_v1'},context,registry});}catch(error){incompatibleError=error;}
assert.ok(incompatibleError,'legacy cross-system incompatible option must fail before render');

const receipts=[];
for(let i=0;i<1000;i++)receipts.push(composeAutomaticTemplateVariant({subject_key:`book-${i}`,seed:20260917,context,policy,registry}));
const uniqueVariants=new Set(receipts.map(receipt=>receipt.template_variant.template_variant_id));
assert.ok(uniqueVariants.size>=900,`expected broad deterministic exploration, got ${uniqueVariants.size} unique variants`);
const replay=composeAutomaticTemplateVariant({subject_key:'book-417',seed:20260917,context,policy,registry});
assert.deepEqual(replay,receipts[417],'automatic composition must replay exactly');
assert.equal(replay.subject_ref.length,64);
assert.equal(Object.prototype.hasOwnProperty.call(replay,'subject_key'),false,'receipt must not expose raw subject key');

for(const field of ['visual_system','structural_layout','typography','motion_grammar','asset_staging']){
  const values=new Set(receipts.map(receipt=>receipt.template_variant.axes[field]));
  assert.ok(values.size>=Math.min(3,policy[`${field}${field==='visual_system'?'s':field==='structural_layout'?'s':field==='motion_grammar'?'s':''}`]?.length||3),`${field} did not vary`);
}
assert.ok(new Set(receipts.map(receipt=>receipt.template_variant.axes.graphic_devices[0])).size>=8,'graphic-device selection should cover nearly the full bounded library');

const narrative={
  narrative_plan_id:'c27_c43_fixture',
  seed:44117,
  title:'Архив ночного города',
  author:'Алексей Морозов',
  roles:[
    {role:'hook',text:'Каждый вечер город возвращает одну ночь, которую пытался забыть.',start_frame:0,end_frame:90},
    {role:'book_reveal',text:'Архив ночного города — Алексей Морозов',start_frame:90,end_frame:210},
    {role:'cta',text:'Открыть книгу',start_frame:210,end_frame:270},
  ],
};
const cover={asset_id:'asset_c43_cover',kind:'cover',sha256:'a'.repeat(64),width:1200,height:1800};
const deliveries=[
  {aspect:'vertical',width:1080,height:1920,fps:30,duration_seconds:9},
  {aspect:'square',width:1080,height:1080,fps:30,duration_seconds:9},
  {aspect:'landscape',width:1920,height:1080,fps:30,duration_seconds:9},
];
const scenePrograms=deliveries.map(delivery=>deriveTemplateSceneProgram({composition_receipt:explicit,narrative,delivery,trusted_cover:cover,registry}));
assert.equal(new Set(scenePrograms.map(program=>program.scene_program_id)).size,3,'delivery-specific scene programs must have distinct identity');
assert.equal(new Set(scenePrograms.map(program=>program.template_variant_id)).size,1,'delivery must not change template identity');
assert.equal(new Set(scenePrograms.map(program=>program.semantic_schedule_sha256)).size,1,'delivery must not change semantic schedule');
for(const program of scenePrograms){
  assert.deepEqual(program.semantic_schedule,narrative.roles,'SceneProgram must preserve semantic schedule bytes');
  assert.equal(program.semantic_schedule_sha256,sha256Canonical(narrative.roles));
  assert.equal(program.motion_recipe.semantic_schedule_sha256,program.semantic_schedule_sha256);
  assert.equal(program.trusted_cover_sha256,cover.sha256);
  assert.ok(program.typography_fits.every(fit=>fit.overflow===false));
}

const changedCover={...cover,sha256:'b'.repeat(64)};
const changedAssetScene=deriveTemplateSceneProgram({composition_receipt:explicit,narrative,delivery:deliveries[0],trusted_cover:changedCover,registry});
assert.notEqual(changedAssetScene.scene_program_id,scenePrograms[0].scene_program_id,'trusted cover bytes must bind SceneProgram identity');
assert.equal(changedAssetScene.template_variant_id,scenePrograms[0].template_variant_id,'asset instance must not mutate template identity');

const badPolicy=structuredClone(policy);
badPolicy.structural_layouts=[...badPolicy.structural_layouts,'layout_arbitrary_script_v2'].sort();
const badPolicyReport=validateTemplateAutoPolicy(badPolicy,registry);
assert.equal(badPolicyReport.valid,false);
assert.ok(badPolicyReport.errors.some(error=>error.includes('unknown option')));

let rawCodeRejected=false;
try{composeExplicitTemplateVariant({selection:{...selection,css:'body { display:none }'},context,registry});}catch{rawCodeRejected=true;}
assert.equal(rawCodeRejected,true,'arbitrary style/code fields must fail closed');

console.log(JSON.stringify({
  schema:'newboo-c43-template-variant-composer-acceptance-v1',
  registry_id:registry.registry_id,
  policy_id:policy.policy_id,
  design_space_lower_bound:policyReport.design_space_lower_bound,
  automatic_subjects_checked:receipts.length,
  unique_automatic_variants:uniqueVariants.size,
  explicit_variant_id:explicit.template_variant.template_variant_id,
  delivery_scene_program_ids:scenePrograms.map(program=>program.scene_program_id),
  semantic_schedule_sha256:scenePrograms[0].semantic_schedule_sha256,
  profile_independent_template_identity:true,
  delivery_specific_scene_identity:true,
  incompatible_selection_rejected:true,
  raw_code_rejected:rawCodeRejected,
  verdict:'PASS'
},null,2));