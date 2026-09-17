import { sha256Canonical } from './factory-identity-v1.mjs';

export const BATCH_TEMPLATE_DIVERSITY_POLICY_SCHEMA='newboo-batch-template-diversity-policy-v1';
export const BATCH_TEMPLATE_DIVERSITY_RECEIPT_SCHEMA='newboo-batch-template-diversity-receipt-v1';
export const BATCH_TEMPLATE_DIVERSITY_AXES=[
  'structural_layout',
  'visual_system',
  'typography',
  'motion_grammar',
  'asset_staging',
  'graphic_devices',
];

const POLICY_FIELDS=[
  'schema','version','min_categorical_distance','lookback_window','require_unique_full_tuple','max_option_share_bps','policy_id',
];
const CANDIDATE_FIELDS=new Set(['candidate_id','template_variant']);
const SINGLE_AXES=BATCH_TEMPLATE_DIVERSITY_AXES.filter(axis=>axis!=='graphic_devices');

function assert(condition,message){if(!condition)throw new Error(message);}
function isObject(value){return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function stableSort(values){return [...values].sort((a,b)=>String(a).localeCompare(String(b)));}
function graphicKey(value){return stableSort(Array.isArray(value)?value:[]).join('+');}
function axisValue(axes,axis){return axis==='graphic_devices'?graphicKey(axes.graphic_devices):axes[axis];}
function tupleProjection(axes){return Object.fromEntries(BATCH_TEMPLATE_DIVERSITY_AXES.map(axis=>[axis,axisValue(axes,axis)]));}
function tupleKey(axes){return BATCH_TEMPLATE_DIVERSITY_AXES.map(axis=>`${axis}=${axisValue(axes,axis)}`).join('|');}
function stableRank(seed,candidateId){return sha256Canonical({seed,candidate_id:candidateId});}

export function categoricalTemplateDistance(leftAxes,rightAxes){
  assert(isObject(leftAxes)&&isObject(rightAxes),'axis objects required');
  const components=Object.fromEntries(BATCH_TEMPLATE_DIVERSITY_AXES.map(axis=>[axis,axisValue(leftAxes,axis)!==axisValue(rightAxes,axis)]));
  return {distance:Object.values(components).filter(Boolean).length,components};
}

export function buildDefaultBatchTemplateDiversityPolicy(){
  const policy={
    schema:BATCH_TEMPLATE_DIVERSITY_POLICY_SCHEMA,
    version:1,
    min_categorical_distance:3,
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
  policy.policy_id=`nbdivpol1_${sha256Canonical(policy)}`;
  return policy;
}

export function validateBatchTemplateDiversityPolicy(policy){
  const errors=[];
  if(!isObject(policy))return {valid:false,errors:['policy must be an object']};
  if(JSON.stringify(Object.keys(policy).sort())!==JSON.stringify([...POLICY_FIELDS].sort()))errors.push('policy fields must match bounded v1 schema exactly');
  if(policy.schema!==BATCH_TEMPLATE_DIVERSITY_POLICY_SCHEMA)errors.push(`schema must be ${BATCH_TEMPLATE_DIVERSITY_POLICY_SCHEMA}`);
  if(policy.version!==1)errors.push('version must be 1');
  if(!Number.isInteger(policy.min_categorical_distance)||policy.min_categorical_distance<1||policy.min_categorical_distance>BATCH_TEMPLATE_DIVERSITY_AXES.length)errors.push('min_categorical_distance must be integer 1..6');
  if(!Number.isInteger(policy.lookback_window)||policy.lookback_window<1||policy.lookback_window>10)errors.push('lookback_window must be integer 1..10');
  if(policy.require_unique_full_tuple!==true)errors.push('v1 requires unique full template tuples');
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
  const expected=`nbdivpol1_${sha256Canonical(projection)}`;
  if(policy_id!==expected)errors.push(`policy_id mismatch expected ${expected}`);
  return {valid:errors.length===0,errors};
}

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
  return {
    candidate_id:candidate.candidate_id,
    template_variant_id:variant.template_variant_id,
    axes:tupleProjection(variant.axes),
  };
}

function optionCap(batchSize,bps){return Math.ceil(batchSize*bps/10000);}
function wouldExceedCaps(counts,candidate,batchSize,policy){
  for(const axis of BATCH_TEMPLATE_DIVERSITY_AXES){
    const value=candidate.axes[axis];
    const current=counts[axis].get(value)||0;
    if(current+1>optionCap(batchSize,policy.max_option_share_bps[axis]))return true;
  }
  return false;
}
function incrementCounts(counts,candidate){
  for(const axis of BATCH_TEMPLATE_DIVERSITY_AXES){
    const value=candidate.axes[axis];
    counts[axis].set(value,(counts[axis].get(value)||0)+1);
  }
}
function emptyCounts(){return Object.fromEntries(BATCH_TEMPLATE_DIVERSITY_AXES.map(axis=>[axis,new Map()]));}
function serializeCounts(counts){
  return Object.fromEntries(BATCH_TEMPLATE_DIVERSITY_AXES.map(axis=>[axis,Object.fromEntries([...counts[axis].entries()].sort((a,b)=>a[0].localeCompare(b[0])))]));
}

export function selectDiverseTemplateBatch({candidates,batch_size=40,seed=0,policy=buildDefaultBatchTemplateDiversityPolicy()}){
  assert(Array.isArray(candidates)&&candidates.length>0,'candidate set must be non-empty');
  assert(Number.isInteger(batch_size)&&batch_size>0,'batch_size must be positive integer');
  assert(Number.isInteger(seed),'seed must be integer');
  const policyReport=validateBatchTemplateDiversityPolicy(policy);
  if(!policyReport.valid)throw new Error(`diversity policy rejected: ${JSON.stringify(policyReport.errors)}`);
  const normalized=candidates.map(normalizeCandidate);
  const candidateIds=normalized.map(item=>item.candidate_id);
  assert(new Set(candidateIds).size===candidateIds.length,'candidate_id values must be unique');
  const variantIds=normalized.map(item=>item.template_variant_id);
  assert(new Set(variantIds).size===variantIds.length,'candidate set must not contain duplicate template_variant_id values');
  const fullTuples=normalized.map(item=>tupleKey(item.axes));
  assert(new Set(fullTuples).size===fullTuples.length,'candidate set must not contain duplicate full template tuples');
  assert(normalized.length>=batch_size,`candidate set has ${normalized.length} items but batch_size is ${batch_size}`);

  const ordered=[...normalized].sort((a,b)=>stableRank(seed,a.candidate_id).localeCompare(stableRank(seed,b.candidate_id))||a.candidate_id.localeCompare(b.candidate_id));
  const selected=[];
  const selectedTupleKeys=new Set();
  const counts=emptyCounts();
  for(const candidate of ordered){
    if(policy.require_unique_full_tuple&&selectedTupleKeys.has(tupleKey(candidate.axes)))continue;
    if(wouldExceedCaps(counts,candidate,batch_size,policy))continue;
    const recent=selected.slice(-policy.lookback_window);
    const distances=recent.map(item=>categoricalTemplateDistance(item.axes,candidate.axes));
    if(distances.some(item=>item.distance<policy.min_categorical_distance))continue;
    const previous=selected.at(-1);
    const previousDistance=previous?categoricalTemplateDistance(previous.axes,candidate.axes):null;
    selected.push({...candidate,distance_from_previous:previousDistance});
    selectedTupleKeys.add(tupleKey(candidate.axes));
    incrementCounts(counts,candidate);
    if(selected.length===batch_size)break;
  }
  if(selected.length!==batch_size){
    throw new Error(`diversity constraints unsatisfied: selected ${selected.length}/${batch_size} from ${normalized.length} candidates`);
  }

  const transitionDistances=selected.slice(1).map((item,index)=>categoricalTemplateDistance(selected[index].axes,item.axes).distance);
  const receipt={
    schema:BATCH_TEMPLATE_DIVERSITY_RECEIPT_SCHEMA,
    version:1,
    policy_id:policy.policy_id,
    seed,
    batch_size,
    candidate_set_sha256:sha256Canonical(normalized.map(item=>({candidate_id:item.candidate_id,template_variant_id:item.template_variant_id,axes:item.axes})).sort((a,b)=>a.candidate_id.localeCompare(b.candidate_id))),
    assignments:selected.map((item,index)=>({
      index,
      candidate_id:item.candidate_id,
      template_variant_id:item.template_variant_id,
      axes:item.axes,
      distance_from_previous:item.distance_from_previous,
    })),
    axis_distribution:serializeCounts(counts),
    min_observed_transition_distance:transitionDistances.length?Math.min(...transitionDistances):BATCH_TEMPLATE_DIVERSITY_AXES.length,
    duplicate_full_tuple_count:0,
  };
  receipt.batch_id=`nbdiv1_${sha256Canonical(receipt)}`;
  return receipt;
}

export function validateDiverseTemplateBatchReceipt(receipt,{candidates,policy=buildDefaultBatchTemplateDiversityPolicy()}){
  const errors=[];
  try{
    const replay=selectDiverseTemplateBatch({candidates,batch_size:receipt?.batch_size,seed:receipt?.seed,policy});
    if(receipt?.schema!==BATCH_TEMPLATE_DIVERSITY_RECEIPT_SCHEMA)errors.push('receipt schema mismatch');
    if(receipt?.policy_id!==policy.policy_id)errors.push('receipt policy mismatch');
    if(receipt?.batch_id!==replay.batch_id)errors.push('batch_id mismatch');
    if(JSON.stringify(receipt)!==JSON.stringify(replay))errors.push('receipt does not match deterministic replay');
  }catch(error){errors.push(String(error.message||error));}
  return {valid:errors.length===0,errors};
}
