import { sha256Canonical } from './factory-identity-v1.mjs';
import { validateTemplateVariant } from './template-variability-v1.mjs';
import { buildCanonicalTemplateVariabilityRegistry } from './template-variant-composer-v1.mjs';
import {
  buildDefaultBatchTemplateDiversityPolicy,
  validateDiverseTemplateBatchReceipt,
} from './batch-template-diversity-v1.mjs';
import {
  BATCH_TEMPLATE_DIVERSITY_RECEIPT_V2_SCHEMA,
  buildDefaultBatchTemplateDiversityPolicyV2,
  selectDiverseTemplateBatchV2,
} from './batch-template-diversity-v2.mjs';

export const TEMPLATE_CAMPAIGN_SELECTION_SCHEMA='newboo-template-campaign-selection-v1';
export const TEMPLATE_CAMPAIGN_SELECTION_PROVENANCE_SCHEMA='newboo-template-campaign-selection-provenance-v1';
export const TEMPLATE_CAMPAIGN_CURRENT_MODE='current_macro_aware_v2';
export const TEMPLATE_CAMPAIGN_LEGACY_V1_MODE='legacy_c44_v1_replay';
const C44_RECEIPT_SCHEMA='newboo-batch-template-diversity-receipt-v1';

function isObject(value){return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function assert(condition,message){if(!condition)throw new Error(message);}
function assertExactKeys(value,allowed,label){
  assert(isObject(value),`${label} must be an object`);
  const unknown=Object.keys(value).filter(key=>!allowed.includes(key));
  assert(unknown.length===0,`${label} contains unsupported fields: ${unknown.sort().join(', ')}`);
}
function stableStrings(values){return [...values].map(String).sort((a,b)=>a.localeCompare(b));}
function selectorCandidates(candidates){return candidates.map(item=>({candidate_id:item.candidate_id,template_variant:item.template_variant}));}

function normalizeCandidates(candidates){
  assert(Array.isArray(candidates)&&candidates.length>0,'candidates must be a non-empty array');
  const registry=buildCanonicalTemplateVariabilityRegistry();
  const normalized=candidates.map((candidate,index)=>{
    assertExactKeys(candidate,['candidate_id','template_variant'],`candidates[${index}]`);
    assert(typeof candidate.candidate_id==='string'&&candidate.candidate_id.length>0,`candidates[${index}].candidate_id required`);
    const report=validateTemplateVariant(registry,candidate.template_variant);
    assert(report.valid,`candidates[${index}].template_variant rejected: ${JSON.stringify(report.errors)}`);
    return {candidate_id:candidate.candidate_id,template_variant:structuredClone(candidate.template_variant)};
  });
  assert(new Set(normalized.map(item=>item.candidate_id)).size===normalized.length,'candidate_id values must be unique');
  assert(new Set(normalized.map(item=>item.template_variant.template_variant_id)).size===normalized.length,'candidate template_variant_id values must be unique');
  return normalized;
}

function provenanceProjection(provenance){
  return {
    schema:TEMPLATE_CAMPAIGN_SELECTION_PROVENANCE_SCHEMA,
    mode:provenance.mode,
    selector_schema:provenance.selector_schema,
    policy_id:provenance.policy_id,
    batch_id:provenance.batch_id,
    candidate_set_sha256:provenance.candidate_set_sha256,
    batch_size:provenance.batch_size,
    selection_seed:provenance.selection_seed,
    receipt_sha256:provenance.receipt_sha256,
  };
}
function computeSelectionId(provenance){return `nbsel1_${sha256Canonical(provenanceProjection(provenance))}`;}
function buildProvenance(mode,receipt){
  const selectorSchema=mode===TEMPLATE_CAMPAIGN_CURRENT_MODE?'newboo-batch-template-diversity-policy-v2':'newboo-batch-template-diversity-policy-v1';
  const provenance={
    schema:TEMPLATE_CAMPAIGN_SELECTION_PROVENANCE_SCHEMA,
    selection_id:'',
    mode,
    selector_schema:selectorSchema,
    policy_id:receipt.policy_id,
    batch_id:receipt.batch_id,
    candidate_set_sha256:receipt.candidate_set_sha256,
    batch_size:receipt.batch_size,
    selection_seed:receipt.seed,
    receipt_sha256:sha256Canonical(receipt),
    receipt:structuredClone(receipt),
  };
  provenance.selection_id=computeSelectionId(provenance);
  return provenance;
}

export function validateTemplateCampaignSelectionProvenance(provenance){
  const errors=[];
  try{
    assertExactKeys(provenance,['schema','selection_id','mode','selector_schema','policy_id','batch_id','candidate_set_sha256','batch_size','selection_seed','receipt_sha256','receipt'],'selection_provenance');
    assert(provenance.schema===TEMPLATE_CAMPAIGN_SELECTION_PROVENANCE_SCHEMA,`selection provenance schema must be ${TEMPLATE_CAMPAIGN_SELECTION_PROVENANCE_SCHEMA}`);
    assert([TEMPLATE_CAMPAIGN_CURRENT_MODE,TEMPLATE_CAMPAIGN_LEGACY_V1_MODE].includes(provenance.mode),`unsupported selection provenance mode ${provenance.mode}`);
    assert(isObject(provenance.receipt),'selection provenance receipt required');
    const expectedReceiptSchema=provenance.mode===TEMPLATE_CAMPAIGN_CURRENT_MODE?BATCH_TEMPLATE_DIVERSITY_RECEIPT_V2_SCHEMA:C44_RECEIPT_SCHEMA;
    const expectedSelectorSchema=provenance.mode===TEMPLATE_CAMPAIGN_CURRENT_MODE?'newboo-batch-template-diversity-policy-v2':'newboo-batch-template-diversity-policy-v1';
    assert(provenance.receipt.schema===expectedReceiptSchema,`selection receipt schema must be ${expectedReceiptSchema}`);
    assert(provenance.selector_schema===expectedSelectorSchema,`selection selector_schema must be ${expectedSelectorSchema}`);
    assert(provenance.policy_id===provenance.receipt.policy_id,'selection provenance policy_id mismatch');
    assert(provenance.batch_id===provenance.receipt.batch_id,'selection provenance batch_id mismatch');
    assert(provenance.candidate_set_sha256===provenance.receipt.candidate_set_sha256,'selection provenance candidate_set_sha256 mismatch');
    assert(provenance.batch_size===provenance.receipt.batch_size,'selection provenance batch_size mismatch');
    assert(provenance.selection_seed===provenance.receipt.seed,'selection provenance selection_seed mismatch');
    assert(provenance.receipt_sha256===sha256Canonical(provenance.receipt),'selection provenance receipt_sha256 mismatch');
    assert(provenance.selection_id===computeSelectionId(provenance),'selection provenance selection_id mismatch');
  }catch(error){errors.push(String(error.message||error));}
  return {valid:errors.length===0,errors};
}

function buildSelection(mode,candidates,receipt){
  const candidateIds=stableStrings(candidates.map(item=>item.candidate_id));
  const selectedIds=receipt.assignments.map(item=>item.candidate_id);
  const selectedSet=new Set(selectedIds);
  assert(selectedSet.size===selectedIds.length,'selection receipt contains duplicate candidate assignments');
  for(const id of selectedIds)assert(candidateIds.includes(id),`selection receipt references unknown candidate ${id}`);
  const provenance=buildProvenance(mode,receipt);
  const selection={
    schema:TEMPLATE_CAMPAIGN_SELECTION_SCHEMA,
    selection_id:provenance.selection_id,
    mode,
    candidate_ids:candidateIds,
    ordered_selected_candidate_ids:selectedIds,
    provenance,
  };
  return selection;
}

export function validateTemplateCampaignSelection(selection){
  const errors=[];
  try{
    assertExactKeys(selection,['schema','selection_id','mode','candidate_ids','ordered_selected_candidate_ids','provenance'],'template selection');
    assert(selection.schema===TEMPLATE_CAMPAIGN_SELECTION_SCHEMA,`selection schema must be ${TEMPLATE_CAMPAIGN_SELECTION_SCHEMA}`);
    assert([TEMPLATE_CAMPAIGN_CURRENT_MODE,TEMPLATE_CAMPAIGN_LEGACY_V1_MODE].includes(selection.mode),`unsupported selection mode ${selection.mode}`);
    assert(Array.isArray(selection.candidate_ids)&&selection.candidate_ids.length>0,'selection candidate_ids required');
    assert(Array.isArray(selection.ordered_selected_candidate_ids)&&selection.ordered_selected_candidate_ids.length>0,'selection ordered_selected_candidate_ids required');
    assert(new Set(selection.candidate_ids).size===selection.candidate_ids.length,'selection candidate_ids must be unique');
    assert(new Set(selection.ordered_selected_candidate_ids).size===selection.ordered_selected_candidate_ids.length,'selection ordered selected IDs must be unique');
    assert(JSON.stringify(selection.candidate_ids)===JSON.stringify(stableStrings(selection.candidate_ids)),'selection candidate_ids must be sorted');
    for(const id of selection.ordered_selected_candidate_ids)assert(selection.candidate_ids.includes(id),`selected candidate ${id} is not in candidate_ids`);
    const provenanceReport=validateTemplateCampaignSelectionProvenance(selection.provenance);
    assert(provenanceReport.valid,`selection provenance rejected: ${JSON.stringify(provenanceReport.errors)}`);
    assert(selection.selection_id===selection.provenance.selection_id,'selection/provenance selection_id mismatch');
    assert(selection.mode===selection.provenance.mode,'selection/provenance mode mismatch');
    assert(selection.ordered_selected_candidate_ids.length===selection.provenance.batch_size,'selection selected count does not match receipt batch_size');
    assert(JSON.stringify(selection.ordered_selected_candidate_ids)===JSON.stringify(selection.provenance.receipt.assignments.map(item=>item.candidate_id)),'selection order does not match receipt assignments');
  }catch(error){errors.push(String(error.message||error));}
  return {valid:errors.length===0,errors};
}

// Current production entrypoint. The candidate JSON surface has no selector mode,
// policy ID, macro-axis or threshold fields; policy is a server-owned argument.
export function selectCurrentTemplateCampaignBatch(options){
  assertExactKeys(options,['candidates','batch_size','selection_seed','server_policy'],'current template campaign selection options');
  const candidates=normalizeCandidates(options.candidates);
  assert(Number.isInteger(options.batch_size)&&options.batch_size>0,'batch_size must be a positive integer');
  assert(Number.isInteger(options.selection_seed),'selection_seed must be an integer');
  const policy=options.server_policy??buildDefaultBatchTemplateDiversityPolicyV2();
  const receipt=selectDiverseTemplateBatchV2({candidates:selectorCandidates(candidates),batch_size:options.batch_size,seed:options.selection_seed,policy});
  return buildSelection(TEMPLATE_CAMPAIGN_CURRENT_MODE,candidates,receipt);
}

// Historical replay is deliberately a separate API. It requires a pre-existing
// C44 receipt and never silently falls back from current v2 selection.
export function replayLegacyTemplateCampaignV1(options){
  assertExactKeys(options,['candidates','legacy_receipt','server_policy'],'legacy template campaign replay options');
  const candidates=normalizeCandidates(options.candidates);
  const policy=options.server_policy??buildDefaultBatchTemplateDiversityPolicy();
  const report=validateDiverseTemplateBatchReceipt(options.legacy_receipt,{candidates:selectorCandidates(candidates),policy});
  assert(report.valid,`legacy C44 receipt rejected: ${JSON.stringify(report.errors)}`);
  return buildSelection(TEMPLATE_CAMPAIGN_LEGACY_V1_MODE,candidates,options.legacy_receipt);
}

export function assembleC19TemplateCampaignRequest(options){
  assertExactKeys(options,['selection','materialized_selected','campaign_id','runtime','delivery_profiles','compiler_policy_version'],'C19 template campaign assembly options');
  const selectionReport=validateTemplateCampaignSelection(options.selection);
  assert(selectionReport.valid,`template selection rejected: ${JSON.stringify(selectionReport.errors)}`);
  assert(typeof options.campaign_id==='string'&&options.campaign_id.length>0,'campaign_id required');
  assert(isObject(options.runtime),'runtime required');
  assert(Array.isArray(options.delivery_profiles)&&options.delivery_profiles.length>0,'delivery_profiles required');
  assert(Array.isArray(options.materialized_selected),'materialized_selected must be an array');

  const materialized=new Map();
  for(const [index,item] of options.materialized_selected.entries()){
    assertExactKeys(item,['candidate_id','row'],`materialized_selected[${index}]`);
    assert(typeof item.candidate_id==='string'&&item.candidate_id.length>0,`materialized_selected[${index}].candidate_id required`);
    assert(!materialized.has(item.candidate_id),`duplicate materialized candidate ${item.candidate_id}`);
    assert(isObject(item.row),`materialized_selected[${index}].row required`);
    materialized.set(item.candidate_id,structuredClone(item.row));
  }
  const expected=options.selection.ordered_selected_candidate_ids;
  assert(materialized.size===expected.length,`materialized selected count ${materialized.size} does not match receipt count ${expected.length}`);
  for(const id of materialized.keys())assert(expected.includes(id),`materialized row supplied for unselected candidate ${id}`);

  const assignmentByCandidate=new Map(options.selection.provenance.receipt.assignments.map(item=>[item.candidate_id,item]));
  const selected=expected.map((candidateId,index)=>{
    const row=materialized.get(candidateId);
    assert(row,`missing materialized row for selected candidate ${candidateId}`);
    assert(typeof row.selection_id==='string'&&row.selection_id.length>0,`${candidateId}: materialized row selection_id required`);
    assert(isObject(row.creative),`${candidateId}: materialized row creative required`);
    const assignment=assignmentByCandidate.get(candidateId);
    assert(assignment,`${candidateId}: missing selection receipt assignment`);
    if(row.creative.template_variant_id!=null)assert(row.creative.template_variant_id===assignment.template_variant_id,`${candidateId}: materialized CreativeSpec template_variant_id does not match selection receipt`);
    assert(row.selection_order==null,`${candidateId}: selection_order is server-owned and must not be pre-authored`);
    row.selection_order=index;
    return row;
  });
  assert(new Set(selected.map(row=>row.selection_id)).size===selected.length,'materialized selected selection_id values must be unique');
  const selectedCandidates=new Set(expected);
  const reserves=options.selection.candidate_ids.filter(id=>!selectedCandidates.has(id)).map(id=>({reserve_id:id,reason:'not-selected-by-template-batch-policy'}));
  const selectedIds=new Set(selected.map(row=>row.selection_id));
  for(const reserve of reserves)assert(!selectedIds.has(reserve.reserve_id),`reserve candidate ID collides with selected selection_id ${reserve.reserve_id}`);

  return {
    schema:'framewright-c19-campaign-request-v1',
    campaign_id:options.campaign_id,
    compiler_policy_version:options.compiler_policy_version||'c19-delivery-package-v1',
    runtime:structuredClone(options.runtime),
    delivery_profiles:structuredClone(options.delivery_profiles),
    selection_provenance:structuredClone(options.selection.provenance),
    selected,
    reserves,
  };
}
