import { sha256Canonical } from './factory-identity-v1.mjs';
import { BATCH_TEMPLATE_DIVERSITY_AXES, categoricalTemplateDistance } from './batch-template-diversity-v1.mjs';

export const BATCH_TEMPLATE_DIVERSITY_POLICY_V2_SCHEMA='newboo-batch-template-diversity-policy-v2';
export const BATCH_TEMPLATE_DIVERSITY_RECEIPT_V2_SCHEMA='newboo-batch-template-diversity-receipt-v2';
export const BATCH_TEMPLATE_DIVERSITY_V2_ALLOWED_MACRO_AXES=[
  'asset_staging',
  'structural_layout',
  'visual_system',
];

const POLICY_FIELDS=[
  'schema','version','min_categorical_distance','macro_axes','min_macro_distance','lookback_window','require_unique_full_tuple','max_option_share_bps','policy_id',
];
const CANDIDATE_FIELDS=new Set(['candidate_id','template_variant']);
const SINGLE_AXES=BATCH_TEMPLATE_DIVERSITY_AXES.filter(axis=>axis!=='graphic_devices');

function assert(condition,message){if(!condition)throw new Error(message);}
function isObject(value){return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function stableSort(values){return [...values].sort((a,b)=>String(a).localeCompare(String(b)));}
function normalizeAxes(axes){
  return {
    structural_layout:axes.structural_layout,
    visual_system:axes.visual_system,
    typography:axes.typography,
    motion_grammar:axes.motion_grammar,
    asset_staging:axes.asset_staging,
    graphic_devices:stableSort(axes.graphic_devices||[]),
  };
}
function graphicKey(value){return stableSort(Array.isArray(value)?value:[value]).filter(Boolean).join('+');}
function axisValue(axes,axis){return axis==='graphic_devices'?graphicKey(axes.graphic_devices):axes[axis];}
function tupleKey(axes){return BATCH_TEMPLATE_DIVERSITY_AXES.map(axis=>`${axis}=${axisValue(axes,axis)}`).join('|');}
function stableRank(seed,candidateId){return sha256Canonical({seed,candidate_id:candidateId});}
function optionCap(batchSize,bps){return Math.ceil(batchSize*bps/10000);}
function emptyCounts(){return Object.fromEntries(BATCH_TEMPLATE_DIVERSITY_AXES.map(axis=>[axis,new Map()]));}
function serializeCounts(counts){return Object.fromEntries(BATCH_TEMPLATE_DIVERSITY_AXES.map(axis=>[axis,Object.fromEntries([...counts[axis].entries()].sort((a,b)=>a[0].localeCompare(b[0])))]));}

function normalizeCandidate(candidate){
  assert(isObject(candidate),'candidate must be an object');
  const unknown=Object.keys(candidate).filter(key=>!CANDIDATE_FIELDS.has(key));
  assert(unknown.length===0,`candidate contains unsupported fields: ${unknown.sort().join(', ')}`);
  assert(typeof candidate.candidate_id==='string'&&candidate.candidate_id.length>0,'candidate_id required');
  const variant=candidate.template_variant;
  assert(isObject(variant),'template_variant required');
  assert(typeof variant.template_variant_id==='string'&&variant.template_variant_id.length>0,'template_variant_id required');
  assert(isObject(variant.axes),'template_variant axes required');
  for(const axis of SINGLE_AXES)assert(typeof variant.axes[axis]==='string'&&variant.axes[axis].length>0,`${axis} required`);
  assert(Array.isArray(variant.axes.graphic_devices)&&variant.axes.graphic_devices.length>0,'graphic_devices required');
  return {candidate_id:candidate.candidate_id,template_variant_id:variant.template_variant_id,axes:normalizeAxes(variant.axes)};
}

export function macroTemplateDistance(leftAxes,rightAxes,macroAxes=BATCH_TEMPLATE_DIVERSITY_V2_ALLOWED_MACRO_AXES){
  assert(isObject(leftAxes)&&isObject(rightAxes),'axis objects required');
  assert(Array.isArray(macroAxes)&&macroAxes.length>0,'macroAxes must be a non-empty array');
  const components=Object.fromEntries(macroAxes.map(axis=>{
    assert(BATCH_TEMPLATE_DIVERSITY_V2_ALLOWED_MACRO_AXES.includes(axis),`unsupported macro axis ${axis}`);
    return [axis,axisValue(leftAxes,axis)!==axisValue(rightAxes,axis)];
  }));
  return {distance:Object.values(components).filter(Boolean).length,components};
}

export function buildDefaultBatchTemplateDiversityPolicyV2(){
  const policy={
    schema:BATCH_TEMPLATE_DIVERSITY_POLICY_V2_SCHEMA,
    version:2,
    min_categorical_distance:3,
    macro_axes:[...BATCH_TEMPLATE_DIVERSITY_V2_ALLOWED_MACRO_AXES],
    min_macro_distance:1,
    lookback_window:3,
    require_unique_full_tuple:true,
    max_option_share_bps:{
      structural_layout:2500,
      visual_system:4000,
      typography:2500,
      motion_grammar:2500,
      asset_staging:2500,
      graphic_devices:2500,
    },
  };
  policy.policy_id=`nbdivpol2_${sha256Canonical(policy)}`;
  return policy;
}

export function validateBatchTemplateDiversityPolicyV2(policy){
  const errors=[];
  if(!isObject(policy))return {valid:false,errors:['policy must be an object']};
  if(JSON.stringify(Object.keys(policy).sort())!==JSON.stringify([...POLICY_FIELDS].sort()))errors.push('policy fields must match bounded v2 schema exactly');
  if(policy.schema!==BATCH_TEMPLATE_DIVERSITY_POLICY_V2_SCHEMA)errors.push(`schema must be ${BATCH_TEMPLATE_DIVERSITY_POLICY_V2_SCHEMA}`);
  if(policy.version!==2)errors.push('version must be 2');
  if(!Number.isInteger(policy.min_categorical_distance)||policy.min_categorical_distance<1||policy.min_categorical_distance>BATCH_TEMPLATE_DIVERSITY_AXES.length)errors.push('min_categorical_distance must be integer 1..6');
  if(!Array.isArray(policy.macro_axes)||policy.macro_axes.length===0)errors.push('macro_axes must be a non-empty array');
  else{
    if(new Set(policy.macro_axes).size!==policy.macro_axes.length)errors.push('macro_axes contains duplicates');
    if(JSON.stringify(policy.macro_axes)!==JSON.stringify(stableSort(policy.macro_axes)))errors.push('macro_axes must be sorted for deterministic policy identity');
    for(const axis of policy.macro_axes)if(!BATCH_TEMPLATE_DIVERSITY_V2_ALLOWED_MACRO_AXES.includes(axis))errors.push(`unsupported macro axis ${axis}`);
  }
  if(!Number.isInteger(policy.min_macro_distance)||policy.min_macro_distance<1||!Array.isArray(policy.macro_axes)||policy.min_macro_distance>policy.macro_axes.length)errors.push('min_macro_distance must be integer 1..macro_axes.length');
  if(!Number.isInteger(policy.lookback_window)||policy.lookback_window<1||policy.lookback_window>10)errors.push('lookback_window must be integer 1..10');
  if(policy.require_unique_full_tuple!==true)errors.push('v2 requires unique full template tuples');
  if(!isObject(policy.max_option_share_bps))errors.push('max_option_share_bps must be an object');
  else{
    const keys=Object.keys(policy.max_option_share_bps).sort();
    if(JSON.stringify(keys)!==JSON.stringify([...BATCH_TEMPLATE_DIVERSITY_AXES].sort()))errors.push('max_option_share_bps must declare every axis exactly once');
    for(const axis of BATCH_TEMPLATE_DIVERSITY_AXES){
      const value=policy.max_option_share_bps[axis];
      if(!Number.isInteger(value)||value<1||value>10000)errors.push(`${axis} share cap must be integer bps 1..10000`);
    }
  }
  const {policy_id,...projection}=policy;
  const expected=`nbdivpol2_${sha256Canonical(projection)}`;
  if(policy_id!==expected)errors.push(`policy_id mismatch expected ${expected}`);
  return {valid:errors.length===0,errors};
}

function wouldExceedCaps(counts,candidate,batchSize,policy){
  for(const axis of BATCH_TEMPLATE_DIVERSITY_AXES){
    const value=axisValue(candidate.axes,axis),current=counts[axis].get(value)||0;
    if(current+1>optionCap(batchSize,policy.max_option_share_bps[axis]))return true;
  }
  return false;
}
function incrementCounts(counts,candidate){
  for(const axis of BATCH_TEMPLATE_DIVERSITY_AXES){
    const value=axisValue(candidate.axes,axis);
    counts[axis].set(value,(counts[axis].get(value)||0)+1);
  }
}
function recentPairDistances(selected,lookback,policy){
  const pairs=[];
  for(let i=0;i<selected.length;i+=1){
    for(let back=1;back<=lookback&&i-back>=0;back+=1){
      const previous=selected[i-back],current=selected[i];
      pairs.push({
        left_index:i-back,
        right_index:i,
        categorical:categoricalTemplateDistance(previous.axes,current.axes).distance,
        macro:macroTemplateDistance(previous.axes,current.axes,policy.macro_axes).distance,
      });
    }
  }
  return pairs;
}

export function selectDiverseTemplateBatchV2({candidates,batch_size=40,seed=0,policy=buildDefaultBatchTemplateDiversityPolicyV2()}){
  assert(Array.isArray(candidates)&&candidates.length>0,'candidate set must be non-empty');
  assert(Number.isInteger(batch_size)&&batch_size>0,'batch_size must be positive integer');
  assert(Number.isInteger(seed),'seed must be integer');
  const policyReport=validateBatchTemplateDiversityPolicyV2(policy);
  if(!policyReport.valid)throw new Error(`diversity policy v2 rejected: ${JSON.stringify(policyReport.errors)}`);
  const normalized=candidates.map(normalizeCandidate);
  const candidateIds=normalized.map(item=>item.candidate_id);
  assert(new Set(candidateIds).size===candidateIds.length,'candidate_id values must be unique');
  const variantIds=normalized.map(item=>item.template_variant_id);
  assert(new Set(variantIds).size===variantIds.length,'candidate set must not contain duplicate template_variant_id values');
  const fullTuples=normalized.map(item=>tupleKey(item.axes));
  assert(new Set(fullTuples).size===fullTuples.length,'candidate set must not contain duplicate full template tuples');
  assert(normalized.length>=batch_size,`candidate set has ${normalized.length} items but batch_size is ${batch_size}`);

  const ordered=[...normalized].sort((a,b)=>stableRank(seed,a.candidate_id).localeCompare(stableRank(seed,b.candidate_id))||a.candidate_id.localeCompare(b.candidate_id));
  const selected=[],selectedTupleKeys=new Set(),counts=emptyCounts();
  for(const candidate of ordered){
    if(policy.require_unique_full_tuple&&selectedTupleKeys.has(tupleKey(candidate.axes)))continue;
    if(wouldExceedCaps(counts,candidate,batch_size,policy))continue;
    const recent=selected.slice(-policy.lookback_window);
    const categorical=recent.map(item=>categoricalTemplateDistance(item.axes,candidate.axes));
    if(categorical.some(item=>item.distance<policy.min_categorical_distance))continue;
    const macro=recent.map(item=>macroTemplateDistance(item.axes,candidate.axes,policy.macro_axes));
    if(macro.some(item=>item.distance<policy.min_macro_distance))continue;
    const previous=selected.at(-1);
    selected.push({
      ...candidate,
      distance_from_previous:previous?categoricalTemplateDistance(previous.axes,candidate.axes):null,
      macro_distance_from_previous:previous?macroTemplateDistance(previous.axes,candidate.axes,policy.macro_axes):null,
    });
    selectedTupleKeys.add(tupleKey(candidate.axes));
    incrementCounts(counts,candidate);
    if(selected.length===batch_size)break;
  }
  if(selected.length!==batch_size)throw new Error(`diversity v2 constraints unsatisfied: selected ${selected.length}/${batch_size} from ${normalized.length} candidates`);

  const lookbackPairs=recentPairDistances(selected,policy.lookback_window,policy);
  const adjacent=lookbackPairs.filter(pair=>pair.right_index-pair.left_index===1);
  const receipt={
    schema:BATCH_TEMPLATE_DIVERSITY_RECEIPT_V2_SCHEMA,
    version:2,
    policy_id:policy.policy_id,
    macro_axes:[...policy.macro_axes],
    seed,
    batch_size,
    candidate_set_sha256:sha256Canonical(normalized.map(item=>({candidate_id:item.candidate_id,template_variant_id:item.template_variant_id,axes:item.axes})).sort((a,b)=>a.candidate_id.localeCompare(b.candidate_id))),
    assignments:selected.map((item,index)=>({
      index,
      candidate_id:item.candidate_id,
      template_variant_id:item.template_variant_id,
      axes:item.axes,
      distance_from_previous:item.distance_from_previous,
      macro_distance_from_previous:item.macro_distance_from_previous,
    })),
    axis_distribution:serializeCounts(counts),
    min_observed_transition_distance:adjacent.length?Math.min(...adjacent.map(x=>x.categorical)):BATCH_TEMPLATE_DIVERSITY_AXES.length,
    min_observed_macro_transition_distance:adjacent.length?Math.min(...adjacent.map(x=>x.macro)):policy.macro_axes.length,
    min_observed_lookback_distance:lookbackPairs.length?Math.min(...lookbackPairs.map(x=>x.categorical)):BATCH_TEMPLATE_DIVERSITY_AXES.length,
    min_observed_macro_lookback_distance:lookbackPairs.length?Math.min(...lookbackPairs.map(x=>x.macro)):policy.macro_axes.length,
    duplicate_full_tuple_count:0,
  };
  receipt.batch_id=`nbdiv2_${sha256Canonical(receipt)}`;
  return receipt;
}

export function validateDiverseTemplateBatchReceiptV2(receipt,{candidates,policy=buildDefaultBatchTemplateDiversityPolicyV2()}){
  const errors=[];
  try{
    const replay=selectDiverseTemplateBatchV2({candidates,batch_size:receipt?.batch_size,seed:receipt?.seed,policy});
    if(receipt?.schema!==BATCH_TEMPLATE_DIVERSITY_RECEIPT_V2_SCHEMA)errors.push('receipt schema mismatch');
    if(receipt?.policy_id!==policy.policy_id)errors.push('receipt policy mismatch');
    if(JSON.stringify(receipt?.macro_axes)!==JSON.stringify(policy.macro_axes))errors.push('receipt macro_axes mismatch');
    if(receipt?.batch_id!==replay.batch_id)errors.push('batch_id mismatch');
    if(JSON.stringify(receipt)!==JSON.stringify(replay))errors.push('receipt does not match deterministic replay');
  }catch(error){errors.push(String(error.message||error));}
  return {valid:errors.length===0,errors};
}
