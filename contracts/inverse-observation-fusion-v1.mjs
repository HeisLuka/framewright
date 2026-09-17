import { sha256Canonical } from './factory-identity-v1.mjs';
import { loadMotionGrammarFamilyRegistry } from './motion-grammar-families-v2.mjs';
import { loadStructuralLayoutFamilyRegistry, resolveStructuralLayout } from './structural-layout-families-v2.mjs';

export const SEMANTIC_OBSERVATION_SCHEMA='newboo-semantic-video-observation-v1';
export const INVERSE_FUSION_RESULT_SCHEMA='newboo-inverse-observation-fusion-result-v1';
export const INVERSE_FUSION_CANDIDATE_SCHEMA='newboo-inverse-axis-fit-candidate-v1';

const ASPECTS=new Set(['vertical','square','landscape']);
const TRACK_TARGETS=new Set(['asset','text','cta']);
const FORBIDDEN_INPUT_KEYS=new Set([
  'template_variant_id','scene_program_id','creative_id','render_spec_id','selection_id','candidate_id',
  'structural_layout','motion_grammar','family_id','visual_system','typography','asset_staging','graphic_devices',
]);
const LAYOUT_CHANNELS=['primary_text_anchor','secondary_text_anchor','cover_box','cta_box'];
const SEEDED_DIRECTION_SIGNATURES=new Set(['restrained_parallax','rhythmic_cards']);

function isObject(value){return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
function clamp01(value){return clamp(value,0,1);}
function quantize(value,step=1e-6){
  if(!Number.isFinite(value))return value;
  const decimals=Math.max(0,Math.min(12,Math.ceil(-Math.log10(step))));
  return Number((Math.round(value/step)*step).toFixed(decimals));
}
function mean(values){return values.length?values.reduce((sum,value)=>sum+value,0)/values.length:0;}
function rms(values){return values.length?Math.sqrt(mean(values.map(value=>value*value))):Infinity;}
function smoothstep(value){const t=clamp01(value);return t*t*(3-2*t);}
function sortObjectKeys(value){
  if(Array.isArray(value))return value.map(sortObjectKeys);
  if(!isObject(value))return value;
  return Object.fromEntries(Object.keys(value).sort().map(key=>[key,sortObjectKeys(value[key])]));
}
function forbiddenPaths(value,path=''){
  const found=[];
  if(Array.isArray(value)){value.forEach((item,index)=>found.push(...forbiddenPaths(item,`${path}/${index}`)));return found;}
  if(!isObject(value))return found;
  for(const key of Object.keys(value)){
    const next=`${path}/${key}`;
    if(FORBIDDEN_INPUT_KEYS.has(key))found.push(next);
    found.push(...forbiddenPaths(value[key],next));
  }
  return found.sort();
}
function point(value){return{x:quantize(Number(value.x),1e-4),y:quantize(Number(value.y),1e-4)};}
function box(value){return{x:quantize(Number(value.x),1e-4),y:quantize(Number(value.y),1e-4),w:quantize(Number(value.w),1e-4),h:quantize(Number(value.h),1e-4)};}
function finitePoint(value){return isObject(value)&&Number.isFinite(value.x)&&Number.isFinite(value.y);}
function finiteBox(value){return finitePoint(value)&&Number.isFinite(value.w)&&Number.isFinite(value.h)&&value.w>0&&value.h>0;}
function coordinatesWithin(value){return Object.values(value).every(v=>Number.isFinite(v)&&v>=-500&&v<=1500);}
function numericState(sample){
  const out={progress:quantize(Number(sample.progress),1e-6),dx:quantize(Number(sample.dx),1e-5),dy:quantize(Number(sample.dy),1e-5),scale:quantize(Number(sample.scale),1e-6),rotation_deg:quantize(Number(sample.rotation_deg),1e-5)};
  if(sample.opacity!==undefined)out.opacity=quantize(Number(sample.opacity),1e-6);
  return out;
}

export function validateSemanticObservation(observation){
  const errors=[];
  if(!isObject(observation))return{valid:false,errors:['observation must be an object']};
  if(observation.schema!==SEMANTIC_OBSERVATION_SCHEMA)errors.push(`schema must be ${SEMANTIC_OBSERVATION_SCHEMA}`);
  if(observation.version!==1)errors.push('version must be 1');
  const forbidden=forbiddenPaths(observation);
  if(forbidden.length)errors.push(`ground-truth/inference keys are forbidden in observations: ${forbidden.join(', ')}`);
  if(!isObject(observation.delivery)||!ASPECTS.has(observation.delivery.aspect))errors.push('delivery.aspect must be vertical, square or landscape');
  if(!isObject(observation.layout_evidence))errors.push('layout_evidence must be an object');
  else{
    for(const key of Object.keys(observation.layout_evidence))if(!LAYOUT_CHANNELS.includes(key))errors.push(`unknown layout evidence ${key}`);
    for(const key of ['primary_text_anchor','secondary_text_anchor'])if(observation.layout_evidence[key]!==undefined&&(!finitePoint(observation.layout_evidence[key])||!coordinatesWithin(observation.layout_evidence[key])))errors.push(`${key} must be a finite normalized point`);
    for(const key of ['cover_box','cta_box'])if(observation.layout_evidence[key]!==undefined&&(!finiteBox(observation.layout_evidence[key])||!coordinatesWithin(observation.layout_evidence[key])))errors.push(`${key} must be a positive finite normalized box`);
  }
  if(!Array.isArray(observation.motion_tracks))errors.push('motion_tracks must be an array');
  else{
    const targets=[];
    observation.motion_tracks.forEach((track,index)=>{
      if(!isObject(track)||!TRACK_TARGETS.has(track.target)){errors.push(`motion_tracks/${index}.target invalid`);return;}
      targets.push(track.target);
      if(!Array.isArray(track.samples)||track.samples.length<2){errors.push(`motion_tracks/${index}.samples needs at least two samples`);return;}
      let prior=-1;
      track.samples.forEach((sample,sampleIndex)=>{
        if(!isObject(sample)){errors.push(`motion_tracks/${index}/samples/${sampleIndex} must be object`);return;}
        for(const key of ['progress','dx','dy','scale','rotation_deg'])if(!Number.isFinite(sample[key]))errors.push(`motion_tracks/${index}/samples/${sampleIndex}.${key} must be finite`);
        if(Number.isFinite(sample.progress)&&(sample.progress<0||sample.progress>1||sample.progress<prior))errors.push(`motion_tracks/${index}/samples/${sampleIndex}.progress must be sorted within 0..1`);
        prior=Number(sample.progress);
        if(Number.isFinite(sample.scale)&&(sample.scale<=0||sample.scale>2))errors.push(`motion_tracks/${index}/samples/${sampleIndex}.scale out of range`);
        if(sample.opacity!==undefined&&(!Number.isFinite(sample.opacity)||sample.opacity<0||sample.opacity>1))errors.push(`motion_tracks/${index}/samples/${sampleIndex}.opacity out of range`);
      });
    });
    if(new Set(targets).size!==targets.length)errors.push('motion track targets must be unique');
  }
  if(!isObject(observation.coverage))errors.push('coverage must be an object');
  else for(const key of ['layout','motion'])if(!Number.isFinite(observation.coverage[key])||observation.coverage[key]<0||observation.coverage[key]>1)errors.push(`coverage.${key} must be within 0..1`);
  if(!Array.isArray(observation.residuals)||observation.residuals.some(item=>typeof item!=='string'))errors.push('residuals must be a string array');
  if(observation.observation_id){
    const {observation_id,...projection}=observation;
    const expected=`nbsemobs1_${sha256Canonical(projection)}`;
    if(observation.observation_id!==expected)errors.push(`observation_id mismatch expected ${expected}`);
  }
  return{valid:errors.length===0,errors};
}

export function canonicalizeSemanticObservation(raw){
  if(!isObject(raw))throw new Error('raw semantic observation required');
  const forbidden=forbiddenPaths(raw);
  if(forbidden.length)throw new Error(`ground-truth/inference keys forbidden: ${forbidden.join(', ')}`);
  const layout={};
  for(const key of ['primary_text_anchor','secondary_text_anchor'])if(raw.layout_evidence?.[key]!==undefined)layout[key]=point(raw.layout_evidence[key]);
  for(const key of ['cover_box','cta_box'])if(raw.layout_evidence?.[key]!==undefined)layout[key]=box(raw.layout_evidence[key]);
  const tracks=(raw.motion_tracks||[]).map(track=>({target:String(track.target),samples:(track.samples||[]).map(numericState).sort((a,b)=>a.progress-b.progress)})).sort((a,b)=>a.target.localeCompare(b.target));
  const observation={
    schema:SEMANTIC_OBSERVATION_SCHEMA,version:1,
    delivery:{aspect:String(raw.delivery?.aspect||'')},
    layout_evidence:sortObjectKeys(layout),
    motion_tracks:tracks,
    coverage:{layout:quantize(clamp01(Number(raw.coverage?.layout??0)),1e-4),motion:quantize(clamp01(Number(raw.coverage?.motion??0)),1e-4)},
    residuals:[...(raw.residuals||[])].map(String).sort(),
  };
  observation.observation_id=`nbsemobs1_${sha256Canonical(observation)}`;
  const report=validateSemanticObservation(observation);
  if(!report.valid)throw new Error(`semantic observation rejected: ${JSON.stringify(report.errors)}`);
  return observation;
}

function expectedLayoutEvidence(familyId,aspect){
  const resolved=resolveStructuralLayout({family_id:familyId,aspect,copy:{}}),s=resolved.slots;
  return{
    primary_text_anchor:{x:s.primary_text.x,y:s.primary_text.y},
    secondary_text_anchor:{x:s.secondary_text.x,y:s.secondary_text.y},
    cover_box:{...s.cover},
    cta_box:{...s.cta},
  };
}
function channelVector(value){return value.w===undefined?[value.x,value.y]:[value.x,value.y,value.w,value.h];}
function channelResidual(actual,expected){
  const a=channelVector(actual),b=channelVector(expected);
  return rms(a.map((value,index)=>value-b[index]));
}
function confidenceFromResidual(residual,margin,coverage,{residualScale,marginScale}){
  return quantize(clamp01(coverage)*clamp01(1-residual/residualScale)*clamp01(margin/marginScale),1e-4);
}

export function fitStructuralLayoutCandidates(observation,{limit=6,max_residual=85,min_margin=8,min_channels=2}={}){
  const report=validateSemanticObservation(observation);if(!report.valid)throw new Error(`semantic observation rejected: ${JSON.stringify(report.errors)}`);
  const channels=LAYOUT_CHANNELS.filter(key=>observation.layout_evidence[key]);
  if(observation.coverage.layout===0||channels.length<min_channels)return{axis:'structural_layout',state:'unsupported',reason:'insufficient_layout_evidence',channels,candidates:[],accepted:null};
  const rows=loadStructuralLayoutFamilyRegistry().families.map(family=>{
    const expected=expectedLayoutEvidence(family.id,observation.delivery.aspect);
    const byChannel=Object.fromEntries(channels.map(key=>[key,quantize(channelResidual(observation.layout_evidence[key],expected[key]),1e-5)]));
    const residual=quantize(rms(Object.values(byChannel)),1e-5);
    return{schema:INVERSE_FUSION_CANDIDATE_SCHEMA,axis:'structural_layout',value:family.id,residual,evidence:{channels:byChannel,method:'c39_normalized_slot_fit_v1'}};
  }).sort((a,b)=>a.residual-b.residual||a.value.localeCompare(b.value));
  const best=rows[0],runner=rows[1],margin=quantize((runner?.residual??Infinity)-best.residual,1e-5);
  const accepted=best.residual<=max_residual&&margin>=min_margin;
  const candidates=rows.slice(0,Math.max(1,limit)).map(row=>({...row,confidence:confidenceFromResidual(row.residual,Math.max(0,margin),observation.coverage.layout,{residualScale:max_residual*2,marginScale:min_margin*4})}));
  return{axis:'structural_layout',state:accepted?'accepted':'ambiguous',reason:accepted?null:(best.residual>max_residual?'fit_residual_too_high':'runner_up_margin_too_small'),channels,fit_residual:best.residual,runner_up_margin:Number.isFinite(margin)?margin:null,candidates,accepted:accepted?candidates[0]:null};
}

function familyProgress(family,progress){
  if(family.signature==='editorial_cuts')return progress<family.enter_fraction?0:1;
  if(progress<=family.enter_fraction)return 0;
  if(progress>=family.settle_fraction)return 1;
  return smoothstep((progress-family.enter_fraction)/(family.settle_fraction-family.enter_fraction));
}
function allowedDirectionSigns(family){return SEEDED_DIRECTION_SIGNATURES.has(family.signature)?[1,-1]:[1];}
function expectedTransform(family,target,progress,directionSign=1){
  const cfg=family[target],t=familyProgress(family,progress),direction=SEEDED_DIRECTION_SIGNATURES.has(family.signature)?directionSign:1;
  return{dx:cfg.dx*direction*(1-t),dy:cfg.dy*(1-t),scale:cfg.scale_from+(1-cfg.scale_from)*t,rotation_deg:cfg.rotate_deg*direction*(1-t),opacity:cfg.opacity_from+(1-cfg.opacity_from)*t};
}
function transformResidual(actual,expected){
  const terms=[(actual.dx-expected.dx)/80,(actual.dy-expected.dy)/80,(actual.scale-expected.scale)/0.2,(actual.rotation_deg-expected.rotation_deg)/5];
  if(actual.opacity!==undefined)terms.push((actual.opacity-expected.opacity));
  return rms(terms);
}
function trackResidual(track,family,directionSign=1){return rms(track.samples.map(sample=>transformResidual(sample,expectedTransform(family,track.target,sample.progress,directionSign))));}
function familyMotionFit(tracks,family){
  return allowedDirectionSigns(family).map(directionSign=>{
    const channels=Object.fromEntries(tracks.map(track=>[track.target,quantize(trackResidual(track,family,directionSign),1e-6)]));
    return{directionSign,channels,residual:quantize(rms(Object.values(channels)),1e-6)};
  }).sort((a,b)=>a.residual-b.residual||b.directionSign-a.directionSign)[0];
}
function perChannelMotionWinner(track,families){
  return families.map(family=>{
    const fit=familyMotionFit([track],family);
    return{id:family.id,residual:fit.residual,directionSign:fit.directionSign};
  }).sort((a,b)=>a.residual-b.residual||a.id.localeCompare(b.id)||b.directionSign-a.directionSign)[0];
}

export function fitMotionGrammarCandidates(observation,{limit=6,max_residual=0.16,min_margin=0.025}={}){
  const report=validateSemanticObservation(observation);if(!report.valid)throw new Error(`semantic observation rejected: ${JSON.stringify(report.errors)}`);
  const tracks=observation.motion_tracks;
  if(observation.coverage.motion===0||!tracks.length)return{axis:'motion_grammar',state:'unsupported',reason:'insufficient_motion_tracks',channels:[],candidates:[],accepted:null};
  const families=loadMotionGrammarFamilyRegistry().families;
  const rows=families.map(family=>{
    const fit=familyMotionFit(tracks,family);
    return{schema:INVERSE_FUSION_CANDIDATE_SCHEMA,axis:'motion_grammar',value:family.id,residual:fit.residual,evidence:{channels:fit.channels,method:'c40_typed_transform_track_fit_v2_seeded_symmetry',latent_direction_sign:fit.directionSign}};
  }).sort((a,b)=>a.residual-b.residual||a.value.localeCompare(b.value));
  const perChannelFits=Object.fromEntries(tracks.map(track=>[track.target,perChannelMotionWinner(track,families)]));
  const perChannelWinners=Object.fromEntries(Object.entries(perChannelFits).map(([target,fit])=>[target,fit.id]));
  const perChannelDirections=Object.fromEntries(Object.entries(perChannelFits).map(([target,fit])=>[target,fit.directionSign]));
  const familyAgreement=new Set(Object.values(perChannelWinners)).size<=1;
  const agreedFamily=familyAgreement?families.find(family=>family.id===Object.values(perChannelWinners)[0]):null;
  const directionAgreement=!agreedFamily||!SEEDED_DIRECTION_SIGNATURES.has(agreedFamily.signature)||new Set(Object.values(perChannelDirections)).size<=1;
  const channelAgreement=familyAgreement&&directionAgreement;
  const best=rows[0],runner=rows[1],margin=quantize((runner?.residual??Infinity)-best.residual,1e-6);
  const accepted=best.residual<=max_residual&&margin>=min_margin&&channelAgreement;
  const reason=accepted?null:(!channelAgreement?'channel_disagreement':best.residual>max_residual?'fit_residual_too_high':'runner_up_margin_too_small');
  const candidates=rows.slice(0,Math.max(1,limit)).map(row=>({...row,confidence:confidenceFromResidual(row.residual,Math.max(0,margin),observation.coverage.motion,{residualScale:max_residual*2,marginScale:min_margin*4})}));
  return{axis:'motion_grammar',state:accepted?'accepted':'ambiguous',reason,channels:tracks.map(track=>track.target),channel_winners:perChannelWinners,channel_direction_signs:perChannelDirections,fit_residual:best.residual,runner_up_margin:Number.isFinite(margin)?margin:null,candidates,accepted:accepted?candidates[0]:null};
}

export function fuseInverseObservation(observation,options={}){
  const report=validateSemanticObservation(observation);if(!report.valid)throw new Error(`semantic observation rejected: ${JSON.stringify(report.errors)}`);
  const structural=fitStructuralLayoutCandidates(observation,options.layout||{});
  const motion=fitMotionGrammarCandidates(observation,options.motion||{});
  const unresolved=[];
  if(structural.state!=='accepted')unresolved.push({axis:'structural_layout',reason:structural.reason||'not_accepted'});
  if(motion.state!=='accepted')unresolved.push({axis:'motion_grammar',reason:motion.reason||'not_accepted'});
  for(const axis of ['visual_system','typography','asset_staging','graphic_devices'])unresolved.push({axis,reason:'observer_not_promoted_v1'});
  const result={
    schema:INVERSE_FUSION_RESULT_SCHEMA,version:1,observation_id:observation.observation_id,
    recovered:{delivery:{aspect:observation.delivery.aspect},structural_layout:structural,motion_grammar:motion},
    unresolved:unresolved.sort((a,b)=>a.axis.localeCompare(b.axis)),
    explainability:{layout:structural.accepted?.confidence||0,motion:motion.accepted?.confidence||0,channels:{layout:structural.channels,motion:motion.channels}},
    residuals:[...observation.residuals,...unresolved.map(item=>`${item.axis}:${item.reason}`)].sort(),
  };
  result.result_id=`nbfusion1_${sha256Canonical(result)}`;
  return result;
}
