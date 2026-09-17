import { createHash } from 'node:crypto';
import { sha256Canonical } from './factory-identity-v1.mjs';
import {
  TEMPLATE_VARIABILITY_ROLES,
  loadDefaultTemplateVariabilityRegistry,
  materializeTemplateVariant,
  validateTemplateVariantForContext,
} from './template-variability-v1.mjs';
import {
  extendRegistryWithStructuralLayouts,
  loadStructuralLayoutFamilyRegistry,
  resolveStructuralLayout,
} from './structural-layout-families-v2.mjs';
import {
  extendRegistryWithMotionGrammars,
  loadMotionGrammarFamilyRegistry,
} from './motion-grammar-families-v2.mjs';
import {
  extendRegistryWithTypographyAndDevices,
  fitTypography,
  loadTypographyGraphicDeviceLibrary,
  resolveGraphicDevice,
} from './typography-graphic-device-library-v2.mjs';
import {
  extendRegistryWithCoverStagingFamilies,
  loadCoverAssetStagingFamilyRegistry,
  resolveCoverAssetStaging,
} from './cover-asset-staging-families-v2.mjs';

export const TEMPLATE_AUTO_POLICY_SCHEMA='newboo-template-auto-policy-v1';
export const TEMPLATE_COMPOSITION_RECEIPT_SCHEMA='newboo-template-composition-receipt-v1';
export const TEMPLATE_SCENE_PROGRAM_SCHEMA='newboo-template-scene-program-v1';
const VISUAL_SYSTEMS=['newspaper','paper','swiss'];
const ROLE_SLOT={hook:'primary_text',tension:'primary_text',desire_payoff:'primary_text',book_reveal:'secondary_text',cta:'cta'};

function clone(value){return structuredClone(value);}
function isObject(value){return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function assert(condition,message){if(!condition)throw new Error(message);}
function sorted(values){return [...values].sort();}
function stableHashInt(value){return Number.parseInt(sha256Canonical(value).slice(0,12),16);}
function choose(values,key){assert(values.length>0,'candidate set must not be empty');return values[stableHashInt(key)%values.length];}
function subjectRef(subjectKey){return createHash('sha256').update(String(subjectKey)).digest('hex');}

export function buildCanonicalTemplateVariabilityRegistry(){
  const base=loadDefaultTemplateVariabilityRegistry();
  const withLayouts=extendRegistryWithStructuralLayouts(base,loadStructuralLayoutFamilyRegistry());
  const withMotion=extendRegistryWithMotionGrammars(withLayouts,loadMotionGrammarFamilyRegistry());
  const withType=extendRegistryWithTypographyAndDevices(withMotion,loadTypographyGraphicDeviceLibrary());
  return extendRegistryWithCoverStagingFamilies(withType,loadCoverAssetStagingFamilyRegistry());
}

export function buildDefaultTemplateAutoPolicy(){
  const layouts=loadStructuralLayoutFamilyRegistry().families.map(item=>item.id);
  const motion=loadMotionGrammarFamilyRegistry().families.map(item=>item.id);
  const library=loadTypographyGraphicDeviceLibrary();
  const staging=loadCoverAssetStagingFamilyRegistry().families.map(item=>item.id);
  const policy={
    schema:TEMPLATE_AUTO_POLICY_SCHEMA,
    version:1,
    visual_systems:sorted(VISUAL_SYSTEMS),
    structural_layouts:sorted(layouts),
    typography:sorted(library.type_systems.map(item=>item.id)),
    motion_grammars:sorted(motion),
    asset_staging:sorted(staging),
    graphic_devices:sorted(library.graphic_devices.map(item=>item.id)),
    graphic_device_count:1,
  };
  policy.policy_id=`nbtvpol1_${sha256Canonical(policy)}`;
  return policy;
}

export function templateDesignSpaceLowerBound(policy=buildDefaultTemplateAutoPolicy()){
  return policy.visual_systems.length*policy.structural_layouts.length*policy.typography.length*policy.motion_grammars.length*policy.asset_staging.length*policy.graphic_devices.length;
}

export function validateTemplateAutoPolicy(policy,registry=buildCanonicalTemplateVariabilityRegistry()){
  const errors=[];
  if(!isObject(policy))return {valid:false,errors:['policy must be an object']};
  const expectedKeys=['asset_staging','graphic_device_count','graphic_devices','motion_grammars','policy_id','schema','structural_layouts','typography','version','visual_systems'];
  const keys=Object.keys(policy).sort();
  if(JSON.stringify(keys)!==JSON.stringify(expectedKeys))errors.push('policy fields must match bounded v1 schema exactly');
  if(policy.schema!==TEMPLATE_AUTO_POLICY_SCHEMA)errors.push(`schema must be ${TEMPLATE_AUTO_POLICY_SCHEMA}`);
  if(policy.version!==1)errors.push('version must be 1');
  if(policy.graphic_device_count!==1)errors.push('v1 automatic policy selects exactly one graphic device');
  const axisMaps={
    visual_systems:new Set(registry.axes.visual_system.map(item=>item.id)),
    structural_layouts:new Set(registry.axes.structural_layout.map(item=>item.id)),
    typography:new Set(registry.axes.typography.map(item=>item.id)),
    motion_grammars:new Set(registry.axes.motion_grammar.map(item=>item.id)),
    asset_staging:new Set(registry.axes.asset_staging.map(item=>item.id)),
    graphic_devices:new Set(registry.axes.graphic_devices.map(item=>item.id)),
  };
  for(const [field,allowed] of Object.entries(axisMaps)){
    const values=policy[field];
    if(!Array.isArray(values)||!values.length)errors.push(`${field} must be non-empty array`);
    else{
      if(new Set(values).size!==values.length)errors.push(`${field} contains duplicates`);
      for(const value of values)if(!allowed.has(value))errors.push(`${field} contains unknown option ${value}`);
      if(JSON.stringify(values)!==JSON.stringify(sorted(values)))errors.push(`${field} must be sorted for deterministic policy identity`);
    }
  }
  const {policy_id,...projection}=policy;
  const expected=`nbtvpol1_${sha256Canonical(projection)}`;
  if(policy_id!==expected)errors.push(`policy_id mismatch expected ${expected}`);
  return {valid:errors.length===0,errors,design_space_lower_bound:errors.length?0:templateDesignSpaceLowerBound(policy)};
}

export function composeExplicitTemplateVariant({selection,context,registry=buildCanonicalTemplateVariabilityRegistry()}){
  const variant=materializeTemplateVariant(registry,selection);
  const contextReport=validateTemplateVariantForContext(registry,variant,context);
  if(!contextReport.valid)throw new Error(`template context rejected: ${JSON.stringify(contextReport.errors)}`);
  return {
    schema:TEMPLATE_COMPOSITION_RECEIPT_SCHEMA,
    mode:'explicit',
    registry_id:registry.registry_id,
    template_variant:variant,
    context:{...context},
    receipt_id:`nbtvrec1_${sha256Canonical({mode:'explicit',registry_id:registry.registry_id,template_variant_id:variant.template_variant_id,context})}`,
  };
}

export function composeAutomaticTemplateVariant({subject_key,seed=0,context,policy=buildDefaultTemplateAutoPolicy(),registry=buildCanonicalTemplateVariabilityRegistry()}){
  assert(typeof subject_key==='string'&&subject_key.length>0,'subject_key required');
  assert(Number.isInteger(seed),'integer seed required');
  const policyReport=validateTemplateAutoPolicy(policy,registry);
  if(!policyReport.valid)throw new Error(`auto policy rejected: ${JSON.stringify(policyReport.errors)}`);
  const base=loadDefaultTemplateVariabilityRegistry();
  const key={policy_id:policy.policy_id,subject_ref:subjectRef(subject_key),seed};
  const visual_system=choose(policy.visual_systems,{...key,axis:'visual_system'});
  const selection=clone(base.legacy_presets[visual_system]);
  selection.structural_layout=choose(policy.structural_layouts,{...key,axis:'structural_layout'});
  selection.typography=choose(policy.typography,{...key,axis:'typography'});
  selection.motion_grammar=choose(policy.motion_grammars,{...key,axis:'motion_grammar'});
  selection.asset_staging=choose(policy.asset_staging,{...key,axis:'asset_staging'});
  selection.graphic_devices=[choose(policy.graphic_devices,{...key,axis:'graphic_devices',index:0})];
  const explicit=composeExplicitTemplateVariant({selection,context,registry});
  const receipt={
    schema:TEMPLATE_COMPOSITION_RECEIPT_SCHEMA,
    mode:'automatic_bounded',
    registry_id:registry.registry_id,
    policy_id:policy.policy_id,
    subject_ref:key.subject_ref,
    seed,
    design_space_lower_bound:policyReport.design_space_lower_bound,
    template_variant:explicit.template_variant,
    context:{...context},
  };
  receipt.receipt_id=`nbtvrec1_${sha256Canonical(receipt)}`;
  return receipt;
}

function validateNarrativeProjection(narrative,delivery){
  assert(isObject(narrative),'narrative projection required');
  assert(typeof narrative.narrative_plan_id==='string'&&narrative.narrative_plan_id.length>0,'narrative_plan_id required');
  assert(Number.isInteger(narrative.seed),'narrative seed required');
  assert(typeof narrative.title==='string'&&narrative.title.length>0,'title required');
  assert(typeof narrative.author==='string','author string required');
  assert(Array.isArray(narrative.roles)&&narrative.roles.length>0,'narrative roles required');
  let cursor=0;
  for(const item of narrative.roles){
    assert(isObject(item)&&TEMPLATE_VARIABILITY_ROLES.includes(item.role),`unsupported narrative role ${item?.role}`);
    assert(typeof item.text==='string'&&item.text.length>0,`${item.role} text required`);
    assert(Number.isInteger(item.start_frame)&&Number.isInteger(item.end_frame)&&item.start_frame===cursor&&item.end_frame>item.start_frame,`${item.role} schedule must be contiguous`);
    cursor=item.end_frame;
  }
  const expectedFrames=Math.round(delivery.duration_seconds*delivery.fps);
  assert(cursor===expectedFrames,`narrative schedule ends at ${cursor}, expected ${expectedFrames}`);
  return true;
}
function validateDeliveryContext(delivery){
  assert(isObject(delivery),'delivery context required');
  assert(['vertical','square','landscape'].includes(delivery.aspect),'supported delivery aspect required');
  assert(Number.isInteger(delivery.width)&&delivery.width>0,'delivery width required');
  assert(Number.isInteger(delivery.height)&&delivery.height>0,'delivery height required');
  assert(Number.isInteger(delivery.fps)&&delivery.fps>0,'delivery fps required');
  assert([3,5,7,9,12,15].includes(delivery.duration_seconds),'supported duration required');
  const expected=delivery.aspect==='vertical'?[1080,1920]:delivery.aspect==='square'?[1080,1080]:[1920,1080];
  assert(delivery.width===expected[0]&&delivery.height===expected[1],`delivery geometry does not match ${delivery.aspect}`);
}

export function deriveTemplateSceneProgram({composition_receipt,narrative,delivery,trusted_cover,registry=buildCanonicalTemplateVariabilityRegistry()}){
  assert(isObject(composition_receipt)&&composition_receipt.template_variant,'composition receipt required');
  assert(composition_receipt.registry_id===registry.registry_id,'composition registry mismatch');
  validateDeliveryContext(delivery);
  validateNarrativeProjection(narrative,delivery);
  const variant=composition_receipt.template_variant;
  const semanticRoles=narrative.roles.map(item=>item.role);
  const contextReport=validateTemplateVariantForContext(registry,variant,{aspect:delivery.aspect,duration_seconds:delivery.duration_seconds,semantic_roles:semanticRoles,available_asset_kinds:['cover']});
  if(!contextReport.valid)throw new Error(`scene context rejected: ${JSON.stringify(contextReport.errors)}`);
  const roleText=Object.fromEntries(narrative.roles.map(item=>[item.role,item.text]));
  const layout=resolveStructuralLayout({family_id:variant.axes.structural_layout,aspect:delivery.aspect,copy:{title:narrative.title,author:narrative.author,hook:roleText.hook||'',cta:roleText.cta||''}});
  const typography_fits=narrative.roles.map(item=>fitTypography({system_id:variant.axes.typography,role:item.role,text:item.text,target_box:layout.slots[ROLE_SLOT[item.role]]}));
  for(const fit of typography_fits)assert(fit.overflow===false,`typography overflow for ${fit.role}`);
  const cover_staging=resolveCoverAssetStaging({family_id:variant.axes.asset_staging,layout,asset:trusted_cover,seed:narrative.seed});
  const graphic_devices=variant.axes.graphic_devices.map(device_id=>resolveGraphicDevice({device_id,layout}));
  const semantic_schedule=clone(narrative.roles);
  const semantic_schedule_sha256=sha256Canonical(semantic_schedule);
  const program={
    schema:TEMPLATE_SCENE_PROGRAM_SCHEMA,
    registry_id:registry.registry_id,
    template_variant_id:variant.template_variant_id,
    narrative_plan_id:narrative.narrative_plan_id,
    semantic_schedule,
    semantic_schedule_sha256,
    delivery:{...delivery},
    resolved_layout:layout,
    typography_fits,
    motion_recipe:{family_id:variant.axes.motion_grammar,seed:narrative.seed,semantic_schedule_sha256},
    cover_staging,
    graphic_devices,
    visual_system:variant.axes.visual_system,
    trusted_cover_sha256:trusted_cover.sha256,
  };
  program.scene_program_id=`nbscenev1_${sha256Canonical(program)}`;
  return program;
}
