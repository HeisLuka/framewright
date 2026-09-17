import assert from 'node:assert/strict';
import {
  classifyStructuralCopyDensity,
  estimatePrimaryTextCapacity,
  extendRegistryWithStructuralLayouts,
  loadStructuralLayoutFamilyRegistry,
  resolveStructuralLayout,
  structuralLayoutDistance,
  validateResolvedStructuralLayout,
  validateStructuralLayoutFamilyRegistry,
} from './structural-layout-families-v2.mjs';
import {
  loadDefaultTemplateVariabilityRegistry,
  materializeTemplateVariant,
  validateTemplateVariantForContext,
} from './template-variability-v1.mjs';

const copies={
  short:{title:'Ночь',author:'А. Морозов',hook:'Город помнит всё.',cta:'Открыть'},
  medium:{title:'Архив ночного города',author:'Алексей Морозов',hook:'Каждый вечер архив возвращает одну ночь, которую город пытался забыть.',cta:'Открыть книгу'},
  long:{title:'Архив ночного города и карта забытых улиц',author:'Алексей Морозов',hook:'Каждый вечер архив возвращает герою одну ночь, которую город пытался забыть, но новая запись содержит улицу, которой нет ни на одной карте, и имя человека, которого он ещё не встречал.',cta:'Читать историю'},
};
assert.equal(classifyStructuralCopyDensity(copies.short),'short');
assert.equal(classifyStructuralCopyDensity(copies.medium),'medium');
assert.equal(classifyStructuralCopyDensity(copies.long),'long');

const familyRegistry=loadStructuralLayoutFamilyRegistry();
const familyReport=validateStructuralLayoutFamilyRegistry(familyRegistry);
assert.equal(familyReport.valid,true,JSON.stringify(familyReport.errors));
assert.equal(familyRegistry.families.length,6);
assert.equal(new Set(familyRegistry.families.map(family=>family.composition)).size,6,'families must have six distinct composition grammars');
assert.equal(new Set(familyRegistry.families.map(family=>family.book_reveal_mode)).size,6,'families must have six distinct book-reveal structures');

const aspects=['vertical','square','landscape'];
const corpus=[];
for(const family of familyRegistry.families){
  for(const aspect of aspects){
    for(const [copyClass,copy] of Object.entries(copies)){
      const layout=resolveStructuralLayout({family_id:family.id,aspect,copy});
      const report=validateResolvedStructuralLayout(layout);
      assert.equal(report.valid,true,`${family.id}/${aspect}/${copyClass}: ${JSON.stringify(report.errors)}`);
      assert.equal(layout.copy_density,copyClass);
      assert.deepEqual(Object.keys(layout.role_bindings).sort(),['book_reveal','cta','desire_payoff','hook','tension']);
      const capacity=estimatePrimaryTextCapacity(layout);
      assert.ok(capacity>=copy.hook.length,`${family.id}/${aspect}/${copyClass}: primary text capacity ${capacity} < hook length ${copy.hook.length}`);
      corpus.push({family_id:family.id,aspect,copy_class:copyClass,layout_instance_id:layout.layout_instance_id,capacity});
    }
  }
}
assert.equal(corpus.length,54,'6 families x 3 aspects x 3 copy classes expected');
assert.equal(new Set(corpus.map(row=>row.layout_instance_id)).size,54,'copy density/aspect/family must be visible in resolved layout identity');

const distanceFloor=0.035;
const distances=[];
for(const aspect of aspects){
  const layouts=familyRegistry.families.map(family=>resolveStructuralLayout({family_id:family.id,aspect,copy:copies.medium}));
  for(let i=0;i<layouts.length;i++)for(let j=i+1;j<layouts.length;j++){
    const distance=structuralLayoutDistance(layouts[i],layouts[j]);
    distances.push({aspect,a:layouts[i].family_id,b:layouts[j].family_id,distance});
    assert.ok(distance>=distanceFloor,`${aspect}: ${layouts[i].family_id} vs ${layouts[j].family_id} too similar (${distance})`);
  }
}

const baseRegistry=loadDefaultTemplateVariabilityRegistry();
const extendedRegistry=extendRegistryWithStructuralLayouts(baseRegistry,familyRegistry);
assert.notEqual(extendedRegistry.registry_id,baseRegistry.registry_id,'adding visible layout options must create a new registry snapshot');
assert.equal(extendedRegistry.axes.structural_layout.length,baseRegistry.axes.structural_layout.length+6);

let variants=0;
for(const family of familyRegistry.families){
  for(const visualSystem of ['swiss','newspaper','paper']){
    const selection=structuredClone(baseRegistry.legacy_presets[visualSystem]);
    selection.structural_layout=family.id;
    const variant=materializeTemplateVariant(extendedRegistry,selection);
    for(const aspect of aspects){
      const contextReport=validateTemplateVariantForContext(extendedRegistry,variant,{
        aspect,
        duration_seconds:9,
        semantic_roles:['hook','book_reveal','cta'],
        available_asset_kinds:['cover'],
      });
      assert.equal(contextReport.valid,true,`${family.id}/${visualSystem}/${aspect}: ${JSON.stringify(contextReport.errors)}`);
      assert.equal(contextReport.template_variant_id,variant.template_variant_id);
    }
    variants++;
  }
}
assert.equal(variants,18,'six new layouts must compose with all three settled visual systems');

const replayA=resolveStructuralLayout({family_id:'layout_split_editorial_v2',aspect:'square',copy:copies.long});
const replayB=resolveStructuralLayout({family_id:'layout_split_editorial_v2',aspect:'square',copy:{...copies.long}});
assert.deepEqual(replayA,replayB,'layout resolution must replay deterministically');

const minDistance=distances.reduce((min,row)=>Math.min(min,row.distance),Infinity);
console.log(JSON.stringify({
  schema:'newboo-c39-structural-layout-acceptance-v1',
  family_registry_id:familyReport.registry_id,
  family_count:familyRegistry.families.length,
  responsive_layout_cases:corpus.length,
  template_compositions_checked:variants,
  aspect_classes:aspects,
  copy_classes:Object.keys(copies),
  pairwise_distance_floor:distanceFloor,
  observed_min_pairwise_distance:Number(minDistance.toFixed(6)),
  base_template_registry_id:baseRegistry.registry_id,
  extended_template_registry_id:extendedRegistry.registry_id,
  safe_zone_violations:0,
  critical_slot_overlaps:0,
  verdict:'PASS',
},null,2));
