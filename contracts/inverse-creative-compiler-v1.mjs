import { sha256Canonical } from './factory-identity-v1.mjs';
import { loadMotionGrammarFamilyRegistry } from './motion-grammar-families-v2.mjs';

export const OBSERVATION_IR_SCHEMA='newboo-video-observation-ir-v1';
export const INVERSE_CANDIDATE_SCHEMA='newboo-inverse-creative-candidate-v1';
export const INVERSE_RESULT_SCHEMA='newboo-inverse-creative-result-v1';

function isObject(value){return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function clamp01(value){return Math.max(0,Math.min(1,value));}
function mean(values){return values.length?values.reduce((a,b)=>a+b,0)/values.length:0;}
function stddev(values){if(values.length<2)return 0;const m=mean(values);return Math.sqrt(mean(values.map(v=>(v-m)**2)));}
function quantize(value,step=1e-4){
  if(!Number.isFinite(value)||!Number.isFinite(step)||step<=0)return value;
  const decimals=Math.max(0,Math.min(12,Math.ceil(-Math.log10(step))));
  return Number((Math.round(value/step)*step).toFixed(decimals));
}
function normalizedSeries(values){if(!values.length)return[];const max=Math.max(...values,1e-12);return values.map(v=>v/max);}
function smoothstep(value){const t=clamp01(value);return t*t*(3-2*t);}

export function validateObservationIR(observation){
  const errors=[];
  if(!isObject(observation))return{valid:false,errors:['observation must be an object']};
  if(observation.schema!==OBSERVATION_IR_SCHEMA)errors.push(`schema must be ${OBSERVATION_IR_SCHEMA}`);
  if(observation.version!==1)errors.push('version must be 1');
  const media=observation.media;
  if(!isObject(media))errors.push('media required');
  else{
    if(!Number.isFinite(media.duration_seconds)||media.duration_seconds<=0)errors.push('positive duration_seconds required');
    if(!Number.isFinite(media.fps)||media.fps<=0)errors.push('positive fps required');
    if(!Number.isInteger(media.width)||media.width<=0)errors.push('positive integer width required');
    if(!Number.isInteger(media.height)||media.height<=0)errors.push('positive integer height required');
  }
  if(!Array.isArray(observation.cut_times_seconds))errors.push('cut_times_seconds array required');
  else if(observation.cut_times_seconds.some(v=>!Number.isFinite(v)||v<0))errors.push('cut_times_seconds must contain non-negative finite values');
  if(!Array.isArray(observation.motion_energy))errors.push('motion_energy array required');
  else if(observation.motion_energy.some(item=>!isObject(item)||!Number.isFinite(item.t)||!Number.isFinite(item.value)||item.t<0||item.value<0))errors.push('motion_energy samples must be {t,value} with non-negative finite values');
  const coverageKeys=['temporal','motion','layout','typography','appearance','assets'];
  if(!isObject(observation.coverage))errors.push('coverage required');
  else for(const key of coverageKeys)if(!Number.isFinite(observation.coverage[key])||observation.coverage[key]<0||observation.coverage[key]>1)errors.push(`coverage.${key} must be within 0..1`);
  if(observation.observation_id){const {observation_id,...projection}=observation;const expected=`nbobs1_${sha256Canonical(projection)}`;if(observation.observation_id!==expected)errors.push(`observation_id mismatch expected ${expected}`);}
  return{valid:errors.length===0,errors};
}

export function canonicalizeObservationIR(raw){
  if(!isObject(raw))throw new Error('raw observation required');
  const observation={
    schema:OBSERVATION_IR_SCHEMA,
    version:1,
    source_sha256:typeof raw.source_sha256==='string'?raw.source_sha256:null,
    media:{
      width:Number(raw.media?.width),height:Number(raw.media?.height),
      fps:quantize(Number(raw.media?.fps),1e-6),duration_seconds:quantize(Number(raw.media?.duration_seconds),1e-6),
    },
    cut_times_seconds:[...(raw.cut_times_seconds||[])].map(Number).filter(Number.isFinite).sort((a,b)=>a-b).map(v=>quantize(v,1e-4)),
    motion_energy:[...(raw.motion_energy||[])].map(item=>({t:quantize(Number(item.t),1e-4),value:quantize(Number(item.value),1e-6)})).filter(item=>Number.isFinite(item.t)&&Number.isFinite(item.value)&&item.t>=0&&item.value>=0).sort((a,b)=>a.t-b.t),
    coverage:{
      temporal:clamp01(Number(raw.coverage?.temporal??0)),motion:clamp01(Number(raw.coverage?.motion??0)),layout:clamp01(Number(raw.coverage?.layout??0)),typography:clamp01(Number(raw.coverage?.typography??0)),appearance:clamp01(Number(raw.coverage?.appearance??0)),assets:clamp01(Number(raw.coverage?.assets??0)),
    },
    residuals:Array.isArray(raw.residuals)?raw.residuals.map(item=>String(item)).sort():[],
  };
  observation.observation_id=`nbobs1_${sha256Canonical(observation)}`;
  const report=validateObservationIR(observation);
  if(!report.valid)throw new Error(`observation rejected: ${JSON.stringify(report.errors)}`);
  return observation;
}

function summarizeEnergy(values){
  const normalized=normalizedSeries(values);
  return{
    avg:mean(normalized),variability:stddev(normalized),
    activeFraction:normalized.length?normalized.filter(v=>v>=0.20).length/normalized.length:0,
    burstFraction:normalized.length?normalized.filter(v=>v>=0.65).length/normalized.length:0,
    spikiness:normalized.length?1/Math.max(mean(normalized),1e-9):0,
  };
}

function motionFeatures(observation){
  return{
    ...summarizeEnergy(observation.motion_energy.map(item=>item.value)),
    cutRate:observation.cut_times_seconds.length/Math.max(observation.media.duration_seconds,1e-9),
  };
}

function familyProgress(family,progress){
  if(family.signature==='editorial_cuts')return progress<family.enter_fraction?0:1;
  if(progress<=family.enter_fraction)return 0;
  if(progress>=family.settle_fraction)return 1;
  return smoothstep((progress-family.enter_fraction)/(family.settle_fraction-family.enter_fraction));
}

function familyExpectedFeatures(family){
  const samples=120;
  let previous=null;
  const energy=[];
  for(let index=0;index<=samples;index+=1){
    const progress=index/samples;
    const t=familyProgress(family,progress);
    const vector=[];
    for(const target of ['text','asset','cta']){
      const cfg=family[target];
      vector.push((cfg.dx*(1-t))/80,(cfg.dy*(1-t))/80,((cfg.scale_from+(1-cfg.scale_from)*t)-1)/0.2,(cfg.rotate_deg*(1-t))/5,(cfg.opacity_from+(1-cfg.opacity_from)*t)-1);
    }
    if(previous)energy.push(mean(vector.map((value,i)=>Math.abs(value-previous[i]))));
    previous=vector;
  }
  return summarizeEnergy(energy);
}

function distance(a,b){return Math.abs(a-b);}

export function inferMotionGrammarCandidates(observation,{limit=3}={}){
  const report=validateObservationIR(observation);
  if(!report.valid)throw new Error(`observation rejected: ${JSON.stringify(report.errors)}`);
  if(observation.coverage.motion===0||observation.motion_energy.length<3)return[];
  const actual=motionFeatures(observation);
  return loadMotionGrammarFamilyRegistry().families.map(family=>{
    const expected=familyExpectedFeatures(family);
    const terms=[
      distance(actual.avg,expected.avg),distance(actual.activeFraction,expected.activeFraction),distance(actual.burstFraction,expected.burstFraction),distance(actual.variability,expected.variability),Math.min(1,distance(actual.spikiness,expected.spikiness)/12),
    ];
    const error=mean(terms);
    const confidence=clamp01((1-error)*observation.coverage.motion*0.78);
    return{schema:INVERSE_CANDIDATE_SCHEMA,axis:'motion_grammar',value:family.id,confidence:quantize(confidence,1e-4),evidence:{features:actual,expected,model_error:quantize(error,1e-6),method:'bounded_c40_motion_envelope_v1'}};
  }).sort((a,b)=>b.confidence-a.confidence||a.value.localeCompare(b.value)).slice(0,Math.max(1,limit));
}

function aspectFromMedia(media){const ratio=media.width/media.height;if(Math.abs(ratio-1)<0.03)return'square';return ratio<1?'vertical':'landscape';}

export function decompileObservation(observation){
  const report=validateObservationIR(observation);
  if(!report.valid)throw new Error(`observation rejected: ${JSON.stringify(report.errors)}`);
  const motionCandidates=inferMotionGrammarCandidates(observation);
  const unresolved=['structural_layout','typography','asset_staging','graphic_devices','visual_system'].map(axis=>({axis,reason:'insufficient_observable_evidence_v1'}));
  if(!motionCandidates.length)unresolved.push({axis:'motion_grammar',reason:'insufficient_motion_evidence_v1'});
  const result={
    schema:INVERSE_RESULT_SCHEMA,version:1,observation_id:observation.observation_id,
    recovered:{delivery:{aspect:aspectFromMedia(observation.media),width:observation.media.width,height:observation.media.height,fps:observation.media.fps,duration_seconds:observation.media.duration_seconds},temporal:{cut_times_seconds:observation.cut_times_seconds},motion_grammar:motionCandidates},
    unresolved,
    explainability:{temporal:observation.coverage.temporal,motion:motionCandidates[0]?.confidence||0,layout:0,typography:0,appearance:observation.coverage.appearance,dsl_coverage:quantize((observation.coverage.temporal+(motionCandidates[0]?.confidence||0))/6,1e-4)},
    residuals:[...observation.residuals,...unresolved.map(item=>`${item.axis}:${item.reason}`)].sort(),
  };
  result.result_id=`nbinv1_${sha256Canonical(result)}`;
  return result;
}
