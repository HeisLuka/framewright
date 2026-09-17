import assert from 'node:assert/strict';
import {
  TEMPLATE_VARIANT_SCHEMA,
  computeTemplateVariabilityRegistryId,
  computeTemplateVariantId,
  legacyTemplateVariant,
  loadDefaultTemplateVariabilityRegistry,
  materializeTemplateVariabilityRegistry,
  materializeTemplateVariant,
  validateTemplateVariabilityRegistry,
  validateTemplateVariant,
  validateTemplateVariantForContext,
} from './template-variability-v1.mjs';

function clone(value){return structuredClone(value);}
function expectError(fn,code){
  let error=null;
  try{fn();}catch(caught){error=caught;}
  assert.ok(error,`expected ${code} error`);
  assert.equal(error.report?.code,code);
  return error.report;
}

const registry=loadDefaultTemplateVariabilityRegistry();
assert.equal(registry.schema,'newboo-template-variability-registry-v1');
assert.match(registry.registry_id,/^nbtvr1_[a-f0-9]{64}$/);
assert.equal(computeTemplateVariabilityRegistryId(registry),registry.registry_id);
assert.equal(validateTemplateVariabilityRegistry(registry).valid,true);
assert.deepEqual(Object.keys(registry.axes).sort(),[
  'asset_staging','graphic_devices','motion_grammar','structural_layout','typography','visual_system',
]);

const legacy={};
for(const system of ['swiss','newspaper','paper']){
  const variant=legacyTemplateVariant(registry,system);
  legacy[system]=variant;
  assert.equal(variant.schema,TEMPLATE_VARIANT_SCHEMA);
  assert.match(variant.template_variant_id,/^nbtv1_[a-f0-9]{64}$/);
  assert.equal(validateTemplateVariant(registry,variant).valid,true);
  assert.equal(variant.axes.visual_system,system);
  assert.equal(Object.prototype.hasOwnProperty.call(variant,'delivery_profile'),false);
  assert.equal(Object.prototype.hasOwnProperty.call(variant.axes,'delivery_profile'),false);
}
assert.equal(new Set(Object.values(legacy).map(value=>value.template_variant_id)).size,3,'legacy systems must remain distinct template identities');

const shuffledSelection={
  graphic_devices:[...legacy.swiss.axes.graphic_devices].reverse(),
  asset_staging:legacy.swiss.axes.asset_staging,
  motion_grammar:legacy.swiss.axes.motion_grammar,
  typography:legacy.swiss.axes.typography,
  visual_system:legacy.swiss.axes.visual_system,
  structural_layout:legacy.swiss.axes.structural_layout,
};
const replay=materializeTemplateVariant(registry,shuffledSelection);
assert.equal(replay.template_variant_id,legacy.swiss.template_variant_id,'selection key order must not change identity');
assert.equal(computeTemplateVariantId(replay),legacy.swiss.template_variant_id);

const rawReordered=clone(registry);
rawReordered.registry_id='auto';
for(const axis of Object.keys(rawReordered.axes))rawReordered.axes[axis].reverse();
rawReordered.legacy_presets=Object.fromEntries(Object.entries(rawReordered.legacy_presets).reverse());
const reordered=materializeTemplateVariabilityRegistry(rawReordered);
assert.equal(reordered.registry_id,registry.registry_id,'registry option ordering must not change identity');

const contexts=['vertical','square','landscape'].map(aspect=>({
  aspect,
  duration_seconds:9,
  semantic_roles:['hook','book_reveal','cta'],
  available_asset_kinds:['cover'],
}));
for(const context of contexts){
  const result=validateTemplateVariantForContext(registry,legacy.swiss,context);
  assert.equal(result.valid,true,JSON.stringify(result.errors));
  assert.equal(result.template_variant_id,legacy.swiss.template_variant_id,'delivery aspect validation must not alter template identity');
}

const missingCover=validateTemplateVariantForContext(registry,legacy.paper,{
  aspect:'vertical',duration_seconds:9,semantic_roles:['hook','book_reveal','cta'],available_asset_kinds:[],
});
assert.equal(missingCover.valid,false);
assert.ok(missingCover.errors.some(error=>error.code==='REQUIRED_ASSET_MISSING'));
assert.equal(missingCover.template_variant_id,legacy.paper.template_variant_id);

const unsupportedRole=validateTemplateVariantForContext(registry,legacy.paper,{
  aspect:'vertical',duration_seconds:9,semantic_roles:['hook','tension','book_reveal'],available_asset_kinds:['cover'],
});
assert.equal(unsupportedRole.valid,false);
assert.ok(unsupportedRole.errors.some(error=>error.code==='OPTION_ROLE_UNSUPPORTED'));

const mixed=clone(registry.legacy_presets.swiss);
mixed.typography=registry.legacy_presets.paper.typography;
const mixedReport=expectError(()=>materializeTemplateVariant(registry,mixed),'TEMPLATE_VARIANT_REJECTED');
assert.ok(mixedReport.errors.some(error=>error.code==='INCOMPATIBLE_OPTION'));

const duplicateDevice=clone(registry.legacy_presets.swiss);
duplicateDevice.graphic_devices.push(duplicateDevice.graphic_devices[0]);
const duplicateReport=expectError(()=>materializeTemplateVariant(registry,duplicateDevice),'TEMPLATE_VARIANT_REJECTED');
assert.ok(duplicateReport.errors.some(error=>error.code==='DUPLICATE_OPTION'));

const unknownOption=clone(registry.legacy_presets.swiss);
unknownOption.motion_grammar='motion_invented_v1';
const unknownReport=expectError(()=>materializeTemplateVariant(registry,unknownOption),'TEMPLATE_VARIANT_REJECTED');
assert.ok(unknownReport.errors.some(error=>error.code==='OPTION_UNKNOWN'));

const forged=clone(legacy.swiss);
forged.template_variant_id='nbtv1_'+'0'.repeat(64);
const forgedReport=validateTemplateVariant(registry,forged);
assert.equal(forgedReport.valid,false);
assert.ok(forgedReport.errors.some(error=>error.code==='TEMPLATE_VARIANT_ID_MISMATCH'));

const deliveryInjected={...clone(legacy.swiss),delivery_profile:'vertical'};
const deliveryReport=validateTemplateVariant(registry,deliveryInjected);
assert.equal(deliveryReport.valid,false);
assert.ok(deliveryReport.errors.some(error=>error.code==='DELIVERY_OWNERSHIP_VIOLATION'));

const rawStyleRegistry=clone(registry);
rawStyleRegistry.registry_id='auto';
rawStyleRegistry.axes.typography[0].css='font-family: fantasy';
const rawStyleReport=validateTemplateVariabilityRegistry(rawStyleRegistry,{allowAutoRegistryId:true});
assert.equal(rawStyleReport.valid,false);
assert.ok(rawStyleReport.errors.some(error=>error.code==='UNKNOWN_FIELD'&&error.path.endsWith('/css')),'raw style blobs must not enter the registry');

const rawUrlRegistry=clone(registry);
rawUrlRegistry.registry_id='auto';
rawUrlRegistry.axes.asset_staging[0].asset_url='https://example.invalid/cover.png';
const rawUrlReport=validateTemplateVariabilityRegistry(rawUrlRegistry,{allowAutoRegistryId:true});
assert.equal(rawUrlReport.valid,false);
assert.ok(rawUrlReport.errors.some(error=>error.code==='UNKNOWN_FIELD'&&error.path.endsWith('/asset_url')),'asset URLs must stay outside template variability');

const autoRegistry=clone(registry);
autoRegistry.registry_id='auto';
const materializedAgain=materializeTemplateVariabilityRegistry(autoRegistry);
assert.equal(materializedAgain.registry_id,registry.registry_id);

console.log(JSON.stringify({
  schema:'newboo-c38-template-variability-check-v1',
  registry_id:registry.registry_id,
  axis_count:Object.keys(registry.axes).length,
  option_counts:Object.fromEntries(Object.entries(registry.axes).map(([axis,options])=>[axis,options.length])),
  legacy_template_variant_ids:Object.fromEntries(Object.entries(legacy).map(([system,variant])=>[system,variant.template_variant_id])),
  downstream_aspects_checked:contexts.map(context=>context.aspect),
  negative_gates:[
    'incompatible_axis_selection','duplicate_graphic_device','unknown_option','forged_variant_id',
    'delivery_ownership_injection','raw_css_injection','raw_asset_url_injection','missing_required_asset','unsupported_semantic_role',
  ],
  verdict:'PASS',
},null,2));
