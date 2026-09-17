import assert from 'node:assert/strict';
import { loadMotionGrammarFamilyRegistry } from './motion-grammar-families-v2.mjs';
import { loadStructuralLayoutFamilyRegistry, resolveStructuralLayout } from './structural-layout-families-v2.mjs';
import {
  SEMANTIC_OBSERVATION_SCHEMA,
  canonicalizeSemanticObservation,
  fitStructuralLayoutCandidates,
  fitMotionGrammarCandidates,
  fuseInverseObservation,
  validateSemanticObservation,
} from './inverse-observation-fusion-v1.mjs';

function hash32(...parts){let h=2166136261>>>0;for(const part of parts){for(const ch of `${part}|`){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}}return h>>>0;}
function noise(amplitude,...parts){return((hash32(...parts)/0xffffffff)*2-1)*amplitude;}
function smoothstep(value){const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t);}
function familyProgress(family,progress){if(family.signature==='editorial_cuts')return progress<family.enter_fraction?0:1;if(progress<=family.enter_fraction)return 0;if(progress>=family.settle_fraction)return 1;return smoothstep((progress-family.enter_fraction)/(family.settle_fraction-family.enter_fraction));}
function transformFor(family,target,progress,directionSign=1){const cfg=family[target],t=familyProgress(family,progress),direction=(family.signature==='restrained_parallax'||family.signature==='rhythmic_cards')?directionSign:1;return{progress,dx:cfg.dx*direction*(1-t),dy:cfg.dy*(1-t),scale:cfg.scale_from+(1-cfg.scale_from)*t,rotation_deg:cfg.rotate_deg*direction*(1-t)};}
function layoutObservation(familyId,aspect,seed,amplitude=16){
  const s=resolveStructuralLayout({family_id:familyId,aspect,copy:{}}).slots;
  const p=(slot,key)=>({x:s[slot].x+noise(amplitude,seed,slot,key,'x'),y:s[slot].y+noise(amplitude,seed,slot,key,'y')});
  const b=(slot,key)=>({x:s[slot].x+noise(amplitude,seed,slot,key,'x'),y:s[slot].y+noise(amplitude,seed,slot,key,'y'),w:s[slot].w+noise(amplitude,seed,slot,key,'w'),h:s[slot].h+noise(amplitude,seed,slot,key,'h')});
  return canonicalizeSemanticObservation({schema:SEMANTIC_OBSERVATION_SCHEMA,version:1,delivery:{aspect},layout_evidence:{primary_text_anchor:p('primary_text','primary'),secondary_text_anchor:p('secondary_text','secondary'),cover_box:b('cover','cover'),cta_box:b('cta','cta')},motion_tracks:[],coverage:{layout:1,motion:0},residuals:[]});
}
function motionObservation(family,seed,targets=['asset'],noiseScale=1,directionSign=1){
  const progresses=[0,.08,.16,.26,.38,.52,.72,.92];
  const tracks=targets.map(target=>({target,samples:progresses.map((progress,index)=>{const state=transformFor(family,target,progress,directionSign);return{progress,dx:state.dx+noise(2.5*noiseScale,seed,target,index,'dx'),dy:state.dy+noise(2.5*noiseScale,seed,target,index,'dy'),scale:state.scale+noise(.008*noiseScale,seed,target,index,'scale'),rotation_deg:state.rotation_deg+noise(.18*noiseScale,seed,target,index,'rot')};})}));
  return canonicalizeSemanticObservation({schema:SEMANTIC_OBSERVATION_SCHEMA,version:1,delivery:{aspect:'vertical'},layout_evidence:{},motion_tracks:tracks,coverage:{layout:0,motion:1},residuals:[]});
}

const layouts=loadStructuralLayoutFamilyRegistry().families;
let layoutCases=0,layoutAccepted=0;
for(const aspect of ['vertical','square','landscape'])for(const family of layouts)for(let seed=0;seed<20;seed+=1){
  const observation=layoutObservation(family.id,aspect,seed);
  const fit=fitStructuralLayoutCandidates(observation);
  layoutCases+=1;
  assert.equal(fit.state,'accepted',`${aspect} ${family.id} seed=${seed}: ${JSON.stringify(fit)}`);
  assert.equal(fit.accepted.value,family.id);
  layoutAccepted+=1;
}
assert.equal(layoutAccepted,layoutCases);

const onlyPrimary=canonicalizeSemanticObservation({schema:SEMANTIC_OBSERVATION_SCHEMA,version:1,delivery:{aspect:'vertical'},layout_evidence:{primary_text_anchor:{x:40,y:60}},motion_tracks:[],coverage:{layout:1,motion:0},residuals:[]});
assert.equal(fitStructuralLayoutCandidates(onlyPrimary).state,'unsupported','one text anchor must not be enough to force C39 family');

const la=resolveStructuralLayout({family_id:layouts[0].id,aspect:'vertical',copy:{}}).slots;
const lb=resolveStructuralLayout({family_id:layouts[1].id,aspect:'vertical',copy:{}}).slots;
const avgPoint=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
const avgBox=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2,w:(a.w+b.w)/2,h:(a.h+b.h)/2});
const layoutBlend=canonicalizeSemanticObservation({schema:SEMANTIC_OBSERVATION_SCHEMA,version:1,delivery:{aspect:'vertical'},layout_evidence:{primary_text_anchor:avgPoint(la.primary_text,lb.primary_text),secondary_text_anchor:avgPoint(la.secondary_text,lb.secondary_text),cover_box:avgBox(la.cover,lb.cover),cta_box:avgBox(la.cta,lb.cta)},motion_tracks:[],coverage:{layout:1,motion:0},residuals:['synthetic_blend']});
assert.equal(fitStructuralLayoutCandidates(layoutBlend,{min_margin:40}).state,'ambiguous','midpoint blend must be allowed to abstain');

const motions=loadMotionGrammarFamilyRegistry().families;
let motionCases=0,motionAccepted=0;
for(const family of motions)for(let seed=0;seed<20;seed+=1){
  const observation=motionObservation(family,seed,['asset']);
  const fit=fitMotionGrammarCandidates(observation);
  motionCases+=1;
  assert.equal(fit.state,'accepted',`${family.id} seed=${seed}: ${JSON.stringify(fit)}`);
  assert.equal(fit.accepted.value,family.id);
  motionAccepted+=1;
}
assert.equal(motionAccepted,motionCases);

const seededMotions=motions.filter(family=>family.signature==='restrained_parallax'||family.signature==='rhythmic_cards');
assert.equal(seededMotions.length,2,'expected exactly two current C40 seeded-direction families');
let seededSymmetryCases=0;
for(const family of seededMotions)for(let seed=0;seed<10;seed+=1){
  const observation=motionObservation(family,seed,['asset','text','cta'],1,-1);
  const fit=fitMotionGrammarCandidates(observation);
  assert.equal(fit.state,'accepted',`seeded symmetry ${family.id} seed=${seed}: ${JSON.stringify(fit)}`);
  assert.equal(fit.accepted.value,family.id);
  assert.equal(fit.accepted.evidence.latent_direction_sign,-1);
  assert.ok(Object.values(fit.channel_direction_signs).every(sign=>sign===-1),`channel signs must agree for ${family.id}: ${JSON.stringify(fit.channel_direction_signs)}`);
  seededSymmetryCases+=1;
}
assert.equal(seededSymmetryCases,20);

const seededConflictFamily=seededMotions.find(family=>family.signature==='rhythmic_cards')||seededMotions[0];
const seededPositiveAsset=motionObservation(seededConflictFamily,301,['asset'],.2,1).motion_tracks[0];
const seededNegativeText=motionObservation(seededConflictFamily,302,['text'],.2,-1).motion_tracks[0];
const seededDirectionConflict=canonicalizeSemanticObservation({schema:SEMANTIC_OBSERVATION_SCHEMA,version:1,delivery:{aspect:'vertical'},layout_evidence:{},motion_tracks:[seededPositiveAsset,seededNegativeText],coverage:{layout:0,motion:1},residuals:['seeded_direction_conflict']});
const seededDirectionConflictFit=fitMotionGrammarCandidates(seededDirectionConflict);
assert.equal(seededDirectionConflictFit.state,'ambiguous','opposite seeded directions across channels must not be accepted as one runtime family realization');
assert.equal(seededDirectionConflictFit.reason,'channel_disagreement');

const assetFamily=motions.find(f=>f.id==='motion_directional_slide_v2')||motions[0];
const textFamily=motions.find(f=>f.id==='motion_staggered_type_v2')||motions[1];
const assetTrack=motionObservation(assetFamily,77,['asset']).motion_tracks[0];
const textTrack=motionObservation(textFamily,88,['text']).motion_tracks[0];
const disagreement=canonicalizeSemanticObservation({schema:SEMANTIC_OBSERVATION_SCHEMA,version:1,delivery:{aspect:'vertical'},layout_evidence:{},motion_tracks:[assetTrack,textTrack],coverage:{layout:0,motion:1},residuals:['cross_channel_conflict']});
const disagreementFit=fitMotionGrammarCandidates(disagreement);
assert.equal(disagreementFit.state,'ambiguous');
assert.equal(disagreementFit.reason,'channel_disagreement');

const unsupportedMotion=canonicalizeSemanticObservation({schema:SEMANTIC_OBSERVATION_SCHEMA,version:1,delivery:{aspect:'vertical'},layout_evidence:{},motion_tracks:[{target:'asset',samples:[0,.2,.4,.6,.8,1].map(progress=>({progress,dx:320*(1-progress),dy:-280*(1-progress),scale:.55+.45*progress,rotation_deg:18*(1-progress)}))}],coverage:{layout:0,motion:1},residuals:['synthetic_unsupported_motion']});
const unsupportedFit=fitMotionGrammarCandidates(unsupportedMotion);
assert.equal(unsupportedFit.state,'ambiguous');
assert.equal(unsupportedFit.reason,'fit_residual_too_high');

let leakageRejected=false;
try{canonicalizeSemanticObservation({schema:SEMANTIC_OBSERVATION_SCHEMA,version:1,delivery:{aspect:'vertical'},layout_evidence:{},motion_tracks:[],coverage:{layout:0,motion:0},residuals:[],scene_program_id:'forbidden'});}catch{leakageRejected=true;}
assert.equal(leakageRejected,true,'hidden forward identity must not enter observation contract');

const combinedLayout=layoutObservation('layout_split_editorial_v2','vertical',2026,8);
const combinedMotion=motionObservation(assetFamily,2026,['asset']);
const combined=canonicalizeSemanticObservation({schema:SEMANTIC_OBSERVATION_SCHEMA,version:1,delivery:{aspect:'vertical'},layout_evidence:combinedLayout.layout_evidence,motion_tracks:combinedMotion.motion_tracks,coverage:{layout:1,motion:1},residuals:[]});
const fused=fuseInverseObservation(combined);
assert.equal(fused.recovered.structural_layout.state,'accepted');
assert.equal(fused.recovered.structural_layout.accepted.value,'layout_split_editorial_v2');
assert.equal(fused.recovered.motion_grammar.state,'accepted');
assert.equal(fused.recovered.motion_grammar.accepted.value,assetFamily.id);
for(const axis of ['visual_system','typography','asset_staging','graphic_devices'])assert.ok(fused.unresolved.some(item=>item.axis===axis&&item.reason==='observer_not_promoted_v1'));
assert.equal(JSON.stringify(fused).includes('scene_program_id'),false);
assert.deepEqual(fuseInverseObservation(combined),fused,'fusion must replay exactly');
assert.equal(validateSemanticObservation(combined).valid,true);

console.log(JSON.stringify({schema:'newboo-c51-inverse-observation-fusion-acceptance-v1',layout_cases:layoutCases,layout_accepted:layoutAccepted,motion_cases:motionCases,motion_accepted:motionAccepted,seeded_direction_symmetry_cases:seededSymmetryCases,seeded_direction_conflict_abstains:true,layout_single_anchor_abstains:true,layout_blend_abstains:true,motion_channel_disagreement_abstains:true,unsupported_motion_abstains:true,hidden_identity_rejected:leakageRejected,unpromoted_axes:['visual_system','typography','asset_staging','graphic_devices'],example_result_id:fused.result_id,verdict:'PASS'},null,2));