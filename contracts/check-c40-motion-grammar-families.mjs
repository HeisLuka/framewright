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
  applyMotionToBox,
  extendRegistryWithMotionGrammars,
  loadMotionGrammarFamilyRegistry,
  motionTargetsForRole,
  motionTrajectoryFingerprint,
  resolveMotionState,
  validateMotionGrammarFamilyRegistry,
  validateMotionSettledState,
} from './motion-grammar-families-v2.mjs';

const motionRegistry=loadMotionGrammarFamilyRegistry();
const motionReport=validateMotionGrammarFamilyRegistry(motionRegistry);
assert.equal(motionReport.valid,true,JSON.stringify(motionReport.errors));
assert.equal(motionRegistry.families.length,6);
assert.equal(new Set(motionRegistry.families.map(family=>family.signature)).size,6);

const roles=['hook','tension','desire_payoff','book_reveal','cta'];
const progressSamples=[0,0.1,0.2,0.3,0.4,0.5,0.75,1];
const seed=14011;
let stateCount=0;
for(const family of motionRegistry.families){
  for(const role of roles){
    for(const target of motionTargetsForRole(role)){
      const states=progressSamples.map(progress=>resolveMotionState({family_id:family.id,role,target,progress,seed}));
      stateCount+=states.length;
      const replay=progressSamples.map(progress=>resolveMotionState({family_id:family.id,role,target,progress,seed}));
      assert.deepEqual(states,replay,`${family.id}/${role}/${target}: deterministic replay failed`);
      assert.equal(validateMotionSettledState(states.at(-1)),true,`${family.id}/${role}/${target}: final state must settle exactly`);
      for(const state of states.filter(item=>item.progress>=0.5))assert.equal(validateMotionSettledState(state),true,`${family.id}/${role}/${target}: readability hold must be settled by progress 0.5`);
      for(const state of states){
        assert.ok(state.transform.opacity>=0&&state.transform.opacity<=1);
        assert.ok(Math.abs(state.transform.dx)<=80&&Math.abs(state.transform.dy)<=80);
        assert.ok(state.transform.scale>=0.8&&state.transform.scale<=1.1);
        assert.ok(Math.abs(state.transform.rotate_deg)<=5);
      }
    }
  }
}

const trajectoryFingerprints=motionRegistry.families.map(family=>motionTrajectoryFingerprint({
  family_id:family.id,role:'book_reveal',target:'asset',seed,
}));
assert.equal(new Set(trajectoryFingerprints).size,6,'all six motion families need distinct sampled trajectories');

const layoutRegistry=loadStructuralLayoutFamilyRegistry();
const aspectClasses=['vertical','square','landscape'];
const roleSlot={hook:'primary_text',tension:'primary_text',desire_payoff:'primary_text',book_reveal:'secondary_text',cta:'cta'};
let settledGeometryChecks=0;
for(const family of motionRegistry.families){
  for(const layoutFamily of layoutRegistry.families){
    for(const aspect of aspectClasses){
      const layout=resolveStructuralLayout({
        family_id:layoutFamily.id,
        aspect,
        copy:{title:'Архив ночного города',author:'Алексей Морозов',hook:'Каждый вечер архив возвращает одну забытую ночь.',cta:'Открыть книгу'},
      });
      for(const role of roles){
        const textTarget=role==='cta'?'cta':'text';
        const textState=resolveMotionState({family_id:family.id,role,target:textTarget,progress:0.5,seed});
        const baseBox=layout.slots[roleSlot[role]];
        const moved=applyMotionToBox(baseBox,textState);
        assert.deepEqual({x:moved.x,y:moved.y,w:moved.w,h:moved.h},{x:baseBox.x,y:baseBox.y,w:baseBox.w,h:baseBox.h},`${family.id}/${layoutFamily.id}/${aspect}/${role}: settled text geometry drift`);
        assert.equal(moved.opacity,1);
        assert.equal(moved.rotate_deg,0);
        settledGeometryChecks++;
        if(role==='book_reveal'||role==='cta'){
          const assetState=resolveMotionState({family_id:family.id,role,target:'asset',progress:0.5,seed});
          const cover=layout.slots.cover;
          const movedCover=applyMotionToBox(cover,assetState);
          assert.deepEqual({x:movedCover.x,y:movedCover.y,w:movedCover.w,h:movedCover.h},{x:cover.x,y:cover.y,w:cover.w,h:cover.h},`${family.id}/${layoutFamily.id}/${aspect}/${role}: settled cover geometry drift`);
          settledGeometryChecks++;
        }
      }
    }
  }
}

const baseRegistry=loadDefaultTemplateVariabilityRegistry();
const structuralRegistry=extendRegistryWithStructuralLayouts(baseRegistry,layoutRegistry);
const extendedRegistry=extendRegistryWithMotionGrammars(structuralRegistry,motionRegistry);
assert.notEqual(extendedRegistry.registry_id,structuralRegistry.registry_id);
assert.equal(extendedRegistry.axes.motion_grammar.length,structuralRegistry.axes.motion_grammar.length+6);

let compatibilityChecks=0;
const durations=[3,5,7,9,12,15];
for(const motionFamily of motionRegistry.families){
  for(const layoutFamily of layoutRegistry.families){
    for(const visualSystem of ['swiss','newspaper','paper']){
      const selection=structuredClone(baseRegistry.legacy_presets[visualSystem]);
      selection.structural_layout=layoutFamily.id;
      selection.motion_grammar=motionFamily.id;
      const variant=materializeTemplateVariant(extendedRegistry,selection);
      for(const aspect of aspectClasses){
        for(const duration_seconds of durations){
          const report=validateTemplateVariantForContext(extendedRegistry,variant,{
            aspect,duration_seconds,semantic_roles:roles,available_asset_kinds:['cover'],
          });
          assert.equal(report.valid,true,`${motionFamily.id}/${layoutFamily.id}/${visualSystem}/${aspect}/${duration_seconds}: ${JSON.stringify(report.errors)}`);
          assert.equal(report.template_variant_id,variant.template_variant_id);
          compatibilityChecks++;
        }
      }
    }
  }
}
assert.equal(compatibilityChecks,1944,'6 motion x 6 layout x 3 systems x 3 aspects x 6 durations');

const semanticIntervals={hook:[0,59],tension:[59,120],desire_payoff:[120,180],book_reveal:[180,240],cta:[240,270]};
const intervalFingerprint=sha256Canonical(semanticIntervals);
for(const family of motionRegistry.families){
  const before=sha256Canonical(semanticIntervals);
  for(const role of roles)for(const target of motionTargetsForRole(role))resolveMotionState({family_id:family.id,role,target,progress:0.25,seed});
  assert.equal(sha256Canonical(semanticIntervals),before,`${family.id}: motion must not mutate semantic intervals`);
}

const seededA=motionTrajectoryFingerprint({family_id:'motion_restrained_parallax_v2',role:'book_reveal',target:'asset',seed:17});
const seededB=motionTrajectoryFingerprint({family_id:'motion_restrained_parallax_v2',role:'book_reveal',target:'asset',seed:17});
assert.equal(seededA,seededB);
const seededOther=motionTrajectoryFingerprint({family_id:'motion_restrained_parallax_v2',role:'book_reveal',target:'asset',seed:18});
assert.notEqual(seededA,seededOther,'seeded direction may vary but must remain deterministic');

console.log(JSON.stringify({
  schema:'newboo-c40-motion-grammar-acceptance-v1',
  motion_registry_id:motionReport.registry_id,
  motion_family_count:motionRegistry.families.length,
  semantic_roles_checked:roles,
  sampled_motion_states:stateCount,
  distinct_book_reveal_asset_trajectories:new Set(trajectoryFingerprints).size,
  settled_geometry_checks:settledGeometryChecks,
  compatibility_checks:compatibilityChecks,
  durations_checked:durations,
  aspects_checked:aspectClasses,
  semantic_interval_fingerprint:intervalFingerprint,
  structural_registry_id:structuralRegistry.registry_id,
  extended_template_registry_id:extendedRegistry.registry_id,
  final_geometry_drift:0,
  readability_hold_from_progress:0.5,
  verdict:'PASS',
},null,2));
