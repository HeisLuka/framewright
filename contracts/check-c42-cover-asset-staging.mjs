import assert from 'node:assert/strict';
import {
  loadDefaultTemplateVariabilityRegistry,
  materializeTemplateVariant,
  validateTemplateVariantForContext,
} from './template-variability-v1.mjs';
import {
  extendRegistryWithStructuralLayouts,
  loadStructuralLayoutFamilyRegistry,
  resolveStructuralLayout,
} from './structural-layout-families-v2.mjs';
import { extendRegistryWithMotionGrammars, loadMotionGrammarFamilyRegistry } from './motion-grammar-families-v2.mjs';
import { extendRegistryWithTypographyAndDevices, loadTypographyGraphicDeviceLibrary } from './typography-graphic-device-library-v2.mjs';
import {
  classifyCoverShape,
  extendRegistryWithCoverStagingFamilies,
  loadCoverAssetStagingFamilyRegistry,
  resolveCoverAssetStaging,
  validateCoverAssetStagingFamilyRegistry,
  validateCoverAssetStagingState,
  validateTrustedCoverAsset,
} from './cover-asset-staging-families-v2.mjs';

const registry=loadCoverAssetStagingFamilyRegistry();
const registryReport=validateCoverAssetStagingFamilyRegistry(registry);
assert.equal(registryReport.valid,true,JSON.stringify(registryReport.errors));
assert.equal(registry.families.length,6);
assert.equal(new Set(registry.families.map(family=>family.mode)).size,6);
assert.ok(registry.families.every(family=>family.max_instances<=3));

const covers=[
  {asset_id:'asset_portrait_cover',kind:'cover',sha256:'1'.repeat(64),width:1200,height:1800},
  {asset_id:'asset_square_cover',kind:'cover',sha256:'2'.repeat(64),width:1600,height:1500},
  {asset_id:'asset_wide_cover',kind:'cover',sha256:'3'.repeat(64),width:1800,height:1200},
];
assert.deepEqual(covers.map(classifyCoverShape),['portrait','squareish','wide']);
for(const cover of covers)assert.equal(validateTrustedCoverAsset(cover).valid,true);

const layoutRegistry=loadStructuralLayoutFamilyRegistry();
const aspects=['vertical','square','landscape'];
let stagingCases=0;
let maxInstances=0;
const stateIds=new Set();
for(const family of registry.families){
  for(const layoutFamily of layoutRegistry.families){
    for(const aspect of aspects){
      const layout=resolveStructuralLayout({family_id:layoutFamily.id,aspect,copy:{title:'Архив ночного города',author:'А. Морозов',hook:'Город помнит всё.',cta:'Открыть'}});
      for(const cover of covers){
        const state=resolveCoverAssetStaging({registry,family_id:family.id,layout,asset:cover,seed:441});
        const replay=resolveCoverAssetStaging({registry,family_id:family.id,layout,asset:{...cover},seed:441});
        assert.deepEqual(state,replay,`${family.id}/${layoutFamily.id}/${aspect}/${cover.asset_id}: replay mismatch`);
        const report=validateCoverAssetStagingState(state,layout,registry);
        assert.equal(report.valid,true,`${family.id}/${layoutFamily.id}/${aspect}/${cover.asset_id}: ${JSON.stringify(report.errors)}`);
        assert.equal(state.asset.sha256,cover.sha256);
        assert.equal(state.asset.asset_id,cover.asset_id);
        assert.equal(state.fallback.single_asset_safe,true);
        assert.equal(state.fallback.requires_only_asset_kind,'cover');
        maxInstances=Math.max(maxInstances,state.placements.length);
        stateIds.add(state.staging_state_id);
        stagingCases++;
      }
    }
  }
}
assert.equal(stagingCases,6*6*3*3,'6 staging x 6 layout x 3 aspects x 3 cover shapes');
assert.ok(maxInstances<=3);
assert.equal(stateIds.size,stagingCases,'family/layout/aspect/cover-shape state must remain content-addressed and distinct for this corpus');

const seededA=resolveCoverAssetStaging({registry,family_id:'stage_floating_tilt_v2',layout:resolveStructuralLayout({family_id:'layout_cover_dominant_stage_v2',aspect:'vertical',copy:{title:'A',hook:'B',cta:'C'}}),asset:covers[0],seed:7});
const seededB=resolveCoverAssetStaging({registry,family_id:'stage_floating_tilt_v2',layout:resolveStructuralLayout({family_id:'layout_cover_dominant_stage_v2',aspect:'vertical',copy:{title:'A',hook:'B',cta:'C'}}),asset:covers[0],seed:7});
const seededOther=resolveCoverAssetStaging({registry,family_id:'stage_floating_tilt_v2',layout:resolveStructuralLayout({family_id:'layout_cover_dominant_stage_v2',aspect:'vertical',copy:{title:'A',hook:'B',cta:'C'}}),asset:covers[0],seed:8});
assert.deepEqual(seededA,seededB);
assert.notEqual(seededA.staging_state_id,seededOther.staging_state_id,'bounded seeded tilt direction should create a deterministic alternate state');

const hostileUrl={...covers[0],url:'https://example.invalid/cover.jpg'};
const hostileUrlReport=validateTrustedCoverAsset(hostileUrl);
assert.equal(hostileUrlReport.valid,false);
assert.ok(hostileUrlReport.errors.some(error=>error.code==='UNKNOWN_FIELD'&&error.path.endsWith('/url')));
const hostilePath={...covers[0],path:'/tmp/cover.jpg'};
assert.equal(validateTrustedCoverAsset(hostilePath).valid,false);
const hostilePrompt={...covers[0],image_prompt:'invent a person holding this book'};
assert.equal(validateTrustedCoverAsset(hostilePrompt).valid,false);
const wrongKind={...covers[0],kind:'generated_image'};
assert.equal(validateTrustedCoverAsset(wrongKind).valid,false);

const baseRegistry=loadDefaultTemplateVariabilityRegistry();
const structuralRegistry=extendRegistryWithStructuralLayouts(baseRegistry,layoutRegistry);
const motionRegistry=extendRegistryWithMotionGrammars(structuralRegistry,loadMotionGrammarFamilyRegistry());
const typographyRegistry=extendRegistryWithTypographyAndDevices(motionRegistry,loadTypographyGraphicDeviceLibrary());
const extendedRegistry=extendRegistryWithCoverStagingFamilies(typographyRegistry,registry);
assert.equal(extendedRegistry.axes.asset_staging.length,typographyRegistry.axes.asset_staging.length+6);

const typeSystems=loadTypographyGraphicDeviceLibrary().type_systems.map(system=>system.id);
let compositionChecks=0;
for(const staging of registry.families){
  for(const layout of layoutRegistry.families){
    for(const typography of typeSystems){
      for(const visualSystem of ['swiss','newspaper','paper']){
        const selection=structuredClone(baseRegistry.legacy_presets[visualSystem]);
        selection.structural_layout=layout.id;
        selection.motion_grammar='motion_directional_slide_v2';
        selection.typography=typography;
        selection.asset_staging=staging.id;
        selection.graphic_devices=['device_rule_pair_v2'];
        const variant=materializeTemplateVariant(extendedRegistry,selection);
        for(const aspect of aspects){
          const report=validateTemplateVariantForContext(extendedRegistry,variant,{aspect,duration_seconds:9,semantic_roles:['hook','book_reveal','cta'],available_asset_kinds:['cover']});
          assert.equal(report.valid,true,`${staging.id}/${layout.id}/${typography}/${visualSystem}/${aspect}: ${JSON.stringify(report.errors)}`);
          assert.equal(report.template_variant_id,variant.template_variant_id);
          compositionChecks++;
        }
      }
    }
  }
}
assert.equal(compositionChecks,6*6*6*3*3,'6 staging x 6 layout x 6 type x 3 visual systems x 3 aspects');

console.log(JSON.stringify({
  schema:'newboo-c42-cover-asset-staging-acceptance-v1',
  staging_registry_id:registryReport.registry_id,
  family_count:registry.families.length,
  trusted_cover_shape_classes:covers.map(classifyCoverShape),
  deterministic_staging_cases:stagingCases,
  unique_staging_states:stateIds.size,
  maximum_instances_observed:maxInstances,
  cross_axis_composition_checks:compositionChecks,
  url_injection_rejected:true,
  path_injection_rejected:true,
  image_prompt_rejected:true,
  non_cover_asset_rejected:true,
  single_asset_safe:true,
  extended_template_registry_id:extendedRegistry.registry_id,
  verdict:'PASS'
},null,2));