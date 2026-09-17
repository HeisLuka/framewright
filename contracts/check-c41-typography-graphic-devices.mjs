import assert from 'node:assert/strict';
import { sha256Canonical } from './factory-identity-v1.mjs';
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
import {
  extendRegistryWithMotionGrammars,
  loadMotionGrammarFamilyRegistry,
} from './motion-grammar-families-v2.mjs';
import {
  extendRegistryWithTypographyAndDevices,
  fitTypography,
  loadTypographyGraphicDeviceLibrary,
  resolveGraphicDevice,
  validateGraphicDeviceState,
  validateTypographyGraphicDeviceLibrary,
} from './typography-graphic-device-library-v2.mjs';

const library=loadTypographyGraphicDeviceLibrary();
const libraryReport=validateTypographyGraphicDeviceLibrary(library);
assert.equal(libraryReport.valid,true,JSON.stringify(libraryReport.errors));
assert.ok(library.type_systems.length>=5);
assert.ok(library.graphic_devices.length>=8);
assert.equal(library.type_systems.length,6);
assert.equal(library.graphic_devices.length,9);
assert.equal(new Set(library.type_systems.map(system=>system.id)).size,6);
assert.equal(new Set(library.graphic_devices.map(device=>device.kind)).size,9);

const c25Mappings=library.type_systems.filter(system=>system.legacy_c25_system!==null).map(system=>system.legacy_c25_system).sort();
assert.deepEqual(c25Mappings,['baseline','compact-dense','display-led','editorial'],'the four proven C25 systems must remain explicitly traceable');

const tokenFingerprints=library.type_systems.map(system=>sha256Canonical({
  font_stack_id:system.font_stack_id,width_factor:system.width_factor,display_scale:system.display_scale,body_scale:system.body_scale,label_scale:system.label_scale,display_weight:system.display_weight,body_weight:system.body_weight,label_weight:system.label_weight,measure_scale:system.measure_scale,line_height:system.line_height,tracking_em:system.tracking_em,min_font_size:system.min_font_size,
}));
assert.equal(new Set(tokenFingerprints).size,6,'type systems must differ in actual bounded typography tokens');

const layoutRegistry=loadStructuralLayoutFamilyRegistry();
const aspects=['vertical','square','landscape'];
const corpora=[
  {
    id:'ru-long',
    hook:'Каждый вечер архив возвращает герою одну ночь, которую город пытался забыть, но новая запись содержит улицу, которой нет ни на одной карте, и имя человека, которого он ещё не встречал.',
    reveal:'Архив ночного города и карта забытых улиц — Алексей Морозов',
    cta:'Открыть книгу'
  },
  {
    id:'en-long',
    hook:'Every night the archive returns one memory the city tried to erase, until a new record names a street that exists on no map and a person he has not met yet.',
    reveal:'The Night City Archive and the Map of Forgotten Streets — Alex Morozov',
    cta:'Open the book'
  },
  {
    id:'mixed-stress',
    hook:'Досье №17 / FILE 17: город стирает улицу из памяти каждые 24 часа — but one witness keeps writing it back.',
    reveal:'Нулевая улица / ZERO STREET — A. Morozov',
    cta:'Читать / Read'
  }
];

let fitCases=0;
let minFontSize=Infinity;
let maxLineCount=0;
for(const family of layoutRegistry.families){
  for(const aspect of aspects){
    for(const corpus of corpora){
      const layout=resolveStructuralLayout({family_id:family.id,aspect,copy:{title:corpus.reveal,author:'',hook:corpus.hook,cta:corpus.cta}});
      for(const system of library.type_systems){
        const cases=[
          {role:'hook',text:corpus.hook,box:layout.slots.primary_text},
          {role:'book_reveal',text:corpus.reveal,box:layout.slots.secondary_text},
          {role:'cta',text:corpus.cta,box:layout.slots.cta},
        ];
        for(const item of cases){
          const fit=fitTypography({library,system_id:system.id,role:item.role,text:item.text,target_box:item.box});
          const replay=fitTypography({library,system_id:system.id,role:item.role,text:item.text,target_box:{...item.box}});
          assert.deepEqual(fit,replay,`${family.id}/${aspect}/${corpus.id}/${system.id}/${item.role}: fit replay mismatch`);
          assert.equal(fit.overflow,false,`${family.id}/${aspect}/${corpus.id}/${system.id}/${item.role}: overflow ${JSON.stringify(fit.measured)}`);
          assert.ok(fit.measured.widest<=fit.measured.max_width+1e-6);
          assert.ok(fit.measured.height<=fit.measured.max_height+1e-6);
          minFontSize=Math.min(minFontSize,fit.tokens.font_size);
          maxLineCount=Math.max(maxLineCount,fit.measured.line_count);
          fitCases++;
        }
      }
    }
  }
}
assert.equal(fitCases,6*3*3*6*3,'6 layouts x 3 aspects x 3 corpora x 6 type systems x 3 roles');

const signatureBox={x:0,y:0,w:520,h:240};
const signatureText='Каждый вечер город переписывает одну улицу, но герой помнит старую версию.';
const visualSignatures=library.type_systems.map(system=>{
  const fit=fitTypography({library,system_id:system.id,role:'hook',text:signatureText,target_box:signatureBox});
  return sha256Canonical({font_stack_id:fit.font_stack_id,tokens:fit.tokens,lines:fit.lines,measured:fit.measured});
});
assert.equal(new Set(visualSignatures).size,6,'same copy/box must produce six materially distinct typography states');

let deviceCases=0;
let maxDeviceAreaRatio=0;
let maxDeviceOcclusionRatio=0;
for(const family of layoutRegistry.families){
  for(const aspect of aspects){
    const layout=resolveStructuralLayout({family_id:family.id,aspect,copy:{title:'Архив ночного города',author:'А. Морозов',hook:'Город помнит всё.',cta:'Открыть'}});
    for(const device of library.graphic_devices){
      const state=resolveGraphicDevice({library,device_id:device.id,layout});
      const replay=resolveGraphicDevice({library,device_id:device.id,layout});
      assert.deepEqual(state,replay,`${family.id}/${aspect}/${device.id}: device replay mismatch`);
      const report=validateGraphicDeviceState(state,layout);
      assert.equal(report.valid,true,`${family.id}/${aspect}/${device.id}: ${JSON.stringify(report.errors)}`);
      maxDeviceAreaRatio=Math.max(maxDeviceAreaRatio,state.measured.area_ratio);
      maxDeviceOcclusionRatio=Math.max(maxDeviceOcclusionRatio,state.measured.occlusion_ratio);
      deviceCases++;
    }
  }
}
assert.equal(deviceCases,6*3*9,'6 layouts x 3 aspects x 9 devices');

const baseRegistry=loadDefaultTemplateVariabilityRegistry();
const structuralRegistry=extendRegistryWithStructuralLayouts(baseRegistry,layoutRegistry);
const motionRegistry=extendRegistryWithMotionGrammars(structuralRegistry,loadMotionGrammarFamilyRegistry());
const extendedRegistry=extendRegistryWithTypographyAndDevices(motionRegistry,library);
assert.notEqual(extendedRegistry.registry_id,motionRegistry.registry_id);
assert.equal(extendedRegistry.axes.typography.length,motionRegistry.axes.typography.length+6);
assert.equal(extendedRegistry.axes.graphic_devices.length,motionRegistry.axes.graphic_devices.length+9);

const commonRoles=['hook','book_reveal','cta'];
let compositionChecks=0;
for(const system of library.type_systems){
  for(const device of library.graphic_devices){
    for(const visualSystem of ['swiss','newspaper','paper']){
      const selection=structuredClone(baseRegistry.legacy_presets[visualSystem]);
      selection.structural_layout='layout_split_editorial_v2';
      selection.motion_grammar='motion_staggered_type_v2';
      selection.typography=system.id;
      selection.graphic_devices=[device.id];
      const variant=materializeTemplateVariant(extendedRegistry,selection);
      for(const aspect of aspects){
        const report=validateTemplateVariantForContext(extendedRegistry,variant,{aspect,duration_seconds:9,semantic_roles:commonRoles,available_asset_kinds:['cover']});
        assert.equal(report.valid,true,`${system.id}/${device.id}/${visualSystem}/${aspect}: ${JSON.stringify(report.errors)}`);
        assert.equal(report.template_variant_id,variant.template_variant_id);
        compositionChecks++;
      }
    }
  }
}
assert.equal(compositionChecks,6*9*3*3,'6 type x 9 device x 3 systems x 3 aspects');

const hostileCss=structuredClone(library);
hostileCss.type_systems[0].css='font-family: fantasy; position: fixed';
const hostileCssReport=validateTypographyGraphicDeviceLibrary(hostileCss);
assert.equal(hostileCssReport.valid,false);
assert.ok(hostileCssReport.errors.some(error=>error.code==='UNKNOWN_FIELD'&&error.path.endsWith('/css')));

const hostileFontUrl=structuredClone(library);
hostileFontUrl.type_systems[0].font_url='https://example.invalid/font.woff2';
const hostileFontReport=validateTypographyGraphicDeviceLibrary(hostileFontUrl);
assert.equal(hostileFontReport.valid,false);
assert.ok(hostileFontReport.errors.some(error=>error.code==='UNKNOWN_FIELD'&&error.path.endsWith('/font_url')));

const hostileDraw=structuredClone(library);
hostileDraw.graphic_devices[0].draw_code='ctx.fillRect(0,0,999,999)';
const hostileDrawReport=validateTypographyGraphicDeviceLibrary(hostileDraw);
assert.equal(hostileDrawReport.valid,false);
assert.ok(hostileDrawReport.errors.some(error=>error.code==='UNKNOWN_FIELD'&&error.path.endsWith('/draw_code')));

console.log(JSON.stringify({
  schema:'newboo-c41-typography-graphic-device-acceptance-v1',
  library_id:libraryReport.library_id,
  type_system_count:library.type_systems.length,
  graphic_device_count:library.graphic_devices.length,
  c25_legacy_systems:c25Mappings,
  deterministic_fit_cases:fitCases,
  minimum_fitted_font_size:minFontSize,
  maximum_line_count:maxLineCount,
  distinct_fixed_box_typography_states:new Set(visualSignatures).size,
  device_geometry_cases:deviceCases,
  maximum_device_area_ratio:Number(maxDeviceAreaRatio.toFixed(8)),
  maximum_device_occlusion_ratio:Number(maxDeviceOcclusionRatio.toFixed(8)),
  cross_axis_composition_checks:compositionChecks,
  aspects_checked:aspects,
  corpora:corpora.map(corpus=>corpus.id),
  raw_css_rejected:true,
  font_url_rejected:true,
  draw_code_rejected:true,
  extended_template_registry_id:extendedRegistry.registry_id,
  verdict:'PASS'
},null,2));