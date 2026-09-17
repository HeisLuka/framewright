import { sha256Canonical } from './factory-identity-v1.mjs';
import {
  PROPOSAL_SCHEMA,
  computeProposalId,
  validateContextPack,
} from './creative-proposal-v1.mjs';
import { compileCreativeProposal } from './compile-creative-proposal-v1.mjs';
import { COMPOSED_PROPOSAL_SCHEMA } from './compositional-copy-v1.mjs';
import { compileComposedCreativeProposal } from './compile-composed-creative-proposal-v1.mjs';
import {
  EXTERNAL_DRAFT_SCHEMA,
  CREATIVE_APPROVAL_SCHEMA,
  compileExternalCreativeDraft,
  computeCreativeApprovalId,
} from './external-creative-draft-v1.mjs';

export const CREATIVE_INGRESS_SCHEMA='newboo-creative-ingress-v2';
export const CREATIVE_INGRESS_RESULT_SCHEMA='newboo-creative-ingress-result-v2';
export const PROFILE_INDEPENDENT_INPUT_SCHEMA='newboo-profile-independent-creative-input-v2';
export const PROFILE_INDEPENDENT_PROGRAM_SCHEMA='newboo-profile-independent-creative-program-v2';
export const ACCEPTED_EXTERNAL_DRAFT_SCHEMA='newboo-accepted-external-creative-draft-v2';
export const CREATIVE_INGRESS_MODES=['trusted_atoms','verified_composition','external_copy_review_required'];

function isObject(value){return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function add(errors,code,path,message){errors.push({code,path,message});}
function sortErrors(errors){return errors.sort((a,b)=>a.path.localeCompare(b.path)||a.code.localeCompare(b.code)||a.message.localeCompare(b.message));}
function checkUnknown(errors,value,allowed,path){
  if(!isObject(value))return;
  for(const key of Object.keys(value).sort())if(!allowed.has(key))add(errors,'UNKNOWN_FIELD',`${path}/${key}`,`unknown field ${key}`);
}
function requireString(errors,value,path){if(typeof value!=='string'||!value.length)add(errors,'INVALID_STRING',path,'expected a non-empty string');}
function clone(value){return structuredClone(value);}
function prefixErrors(errors,prefix){return (errors||[]).map(error=>({...error,path:`${prefix}${error.path||''}`}));}
function hasOwn(value,key){return Object.prototype.hasOwnProperty.call(value,key);}

function validatePresentationShape(errors,presentation,path='/payload/presentation'){
  if(!isObject(presentation)){
    add(errors,'TYPE_OBJECT_REQUIRED',path,'presentation must be an object');
    return;
  }
  checkUnknown(errors,presentation,new Set(['duration_seconds','fps','visual_system','seed']),path);
  if(hasOwn(presentation,'delivery_profile')){
    add(errors,'DELIVERY_OWNERSHIP_VIOLATION',`${path}/delivery_profile`,'delivery_profile is factory-owned request metadata, not creative input');
  }
}

export function validateCreativeIngressEnvelope(ingress){
  const errors=[];
  if(!isObject(ingress)){
    add(errors,'TYPE_OBJECT_REQUIRED','','creative ingress must be an object');
    return {valid:false,errors};
  }
  checkUnknown(errors,ingress,new Set(['schema','mode','context_pack_id','context_hash','payload']),'');
  if(ingress.schema!==CREATIVE_INGRESS_SCHEMA)add(errors,'SCHEMA_VERSION_MISMATCH','/schema',`expected ${CREATIVE_INGRESS_SCHEMA}`);
  requireString(errors,ingress.mode,'/mode');
  if(typeof ingress.mode==='string'&&!CREATIVE_INGRESS_MODES.includes(ingress.mode))add(errors,'INGRESS_MODE_UNSUPPORTED','/mode',`mode must be one of ${CREATIVE_INGRESS_MODES.join(', ')}`);
  requireString(errors,ingress.context_pack_id,'/context_pack_id');
  if(typeof ingress.context_hash!=='string'||!/^[a-f0-9]{64}$/.test(ingress.context_hash))add(errors,'INVALID_SHA256','/context_hash','context_hash must be lowercase sha256 hex');
  if(!isObject(ingress.payload))add(errors,'TYPE_OBJECT_REQUIRED','/payload','payload must be an object');
  else{
    const allowed=new Set(['account_id','book_id','narrative','presentation','selected_asset_ids']);
    if(ingress.mode==='verified_composition'){
      allowed.add('copy_language_id');
      allowed.add('copy_language_hash');
      requireString(errors,ingress.payload.copy_language_id,'/payload/copy_language_id');
      if(typeof ingress.payload.copy_language_hash!=='string'||!/^[a-f0-9]{64}$/.test(ingress.payload.copy_language_hash))add(errors,'INVALID_SHA256','/payload/copy_language_hash','copy_language_hash must be lowercase sha256 hex');
    }
    checkUnknown(errors,ingress.payload,allowed,'/payload');
    validatePresentationShape(errors,ingress.payload.presentation);
  }
  return {valid:errors.length===0,errors:sortErrors(errors)};
}

export class CreativeIngressError extends Error{
  constructor(code,errors){
    super(`Creative ingress failed: ${code}`);
    this.name='CreativeIngressError';
    this.report={valid:false,code,errors:sortErrors(errors||[])};
  }
}
function fail(code,path,message){throw new CreativeIngressError(code,[{code,path,message}]);}

export function validateRequestedDeliveryProfiles(pack,requestedIds){
  const context=validateContextPack(pack);
  if(!context.valid)return {valid:false,code:'INVALID_SERVER_CONTEXT',errors:context.errors};
  const errors=[];
  if(!Array.isArray(requestedIds)||requestedIds.length===0){
    add(errors,'DELIVERY_PROFILE_REQUEST_REQUIRED','/requested_delivery_profile_ids','at least one delivery profile must be requested downstream');
    return {valid:false,code:'DELIVERY_REQUEST_REJECTED',errors};
  }
  const seen=new Set();
  requestedIds.forEach((id,index)=>{
    if(typeof id!=='string'||!id){add(errors,'INVALID_STRING',`/requested_delivery_profile_ids/${index}`,'expected a non-empty delivery profile ID');return;}
    if(seen.has(id))add(errors,'DUPLICATE_REFERENCE',`/requested_delivery_profile_ids/${index}`,`duplicate delivery profile ${id}`);
    seen.add(id);
    if(!pack.capabilities.delivery_profiles.includes(id))add(errors,'CAPABILITY_DENIED',`/requested_delivery_profile_ids/${index}`,`delivery profile ${id} is not allowed by ContextPack`);
  });
  return {valid:errors.length===0,code:errors.length?'DELIVERY_REQUEST_REJECTED':'OK',errors:sortErrors(errors),requested_delivery_profile_ids:[...seen].sort()};
}

function serverValidationProfile(pack){
  const profiles=[...(pack.capabilities?.delivery_profiles||[])].sort();
  if(!profiles.length)fail('INVALID_SERVER_CONTEXT','/server_context/capabilities/delivery_profiles','server ContextPack exposes no delivery profile capability');
  return profiles[0];
}
function withServerValidationProfile(payload,pack){
  const out=clone(payload);
  out.presentation={...out.presentation,delivery_profile:serverValidationProfile(pack)};
  return out;
}
function computeInputId(ingress){
  return `nbci2_${sha256Canonical({schema:PROFILE_INDEPENDENT_INPUT_SCHEMA,mode:ingress.mode,context_pack_id:ingress.context_pack_id,context_hash:ingress.context_hash,payload:ingress.payload})}`;
}
function replaceExactDeep(value,from,to){
  if(Array.isArray(value))return value.map(item=>replaceExactDeep(item,from,to));
  if(isObject(value))return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,replaceExactDeep(item,from,to)]));
  return value===from?to:value;
}
function normalizeProgram(legacyProgram,{inputId,legacyInputId}){
  const program=replaceExactDeep(clone(legacyProgram),legacyInputId,inputId);
  delete program.program_id;
  program.schema=PROFILE_INDEPENDENT_PROGRAM_SCHEMA;
  if(program.proposal_id)program.proposal_id=inputId;
  if(program.draft_id)program.draft_id=inputId;
  if(isObject(program.presentation))delete program.presentation.delivery_profile;
  program.program_id=`nbprog2_${sha256Canonical(program)}`;
  return program;
}
function normalizeAcceptedDraft(legacyAccepted,inputId){
  const accepted=clone(legacyAccepted);
  delete accepted.draft_id;
  accepted.schema=ACCEPTED_EXTERNAL_DRAFT_SCHEMA;
  if(isObject(accepted.presentation))delete accepted.presentation.delivery_profile;
  accepted.draft_id=inputId;
  return accepted;
}
function buildTrustedProposal(ingress,pack){
  const proposal={schema:PROPOSAL_SCHEMA,proposal_id:'',context_pack_id:ingress.context_pack_id,context_hash:ingress.context_hash,...withServerValidationProfile(ingress.payload,pack)};
  proposal.proposal_id=computeProposalId(proposal);
  return proposal;
}
function buildComposedProposal(ingress,pack){
  return {schema:COMPOSED_PROPOSAL_SCHEMA,context_pack_id:ingress.context_pack_id,context_hash:ingress.context_hash,...withServerValidationProfile(ingress.payload,pack)};
}
function buildExternalDraft(ingress,pack){
  return {schema:EXTERNAL_DRAFT_SCHEMA,context_pack_id:ingress.context_pack_id,context_hash:ingress.context_hash,...withServerValidationProfile(ingress.payload,pack)};
}
function computeIngressId({mode,context_pack_id,context_hash,input_id,program_id}){
  return `nbi2_${sha256Canonical({schema:CREATIVE_INGRESS_SCHEMA,mode,context_pack_id,context_hash,input_id,program_id})}`;
}
function computeDecisionId({ingress_id,creative_gate}){return `nbid2_${sha256Canonical({ingress_id,creative_gate})}`;}

function validateV2Approval(approval,{acceptedDraft,program}){
  const errors=[];
  if(!isObject(approval)){add(errors,'TYPE_OBJECT_REQUIRED','','CreativeApproval must be an object');return {valid:false,errors};}
  if(approval.schema!==CREATIVE_APPROVAL_SCHEMA)add(errors,'SCHEMA_VERSION_MISMATCH','/schema',`expected ${CREATIVE_APPROVAL_SCHEMA}`);
  if(approval.authority!=='server_owned')add(errors,'APPROVAL_AUTHORITY_INVALID','/authority','approval authority must be server_owned');
  if(approval.draft_id!==acceptedDraft.draft_id)add(errors,'APPROVAL_DRAFT_MISMATCH','/draft_id',`expected ${acceptedDraft.draft_id}`);
  if(approval.program_id!==program.program_id)add(errors,'APPROVAL_PROGRAM_MISMATCH','/program_id',`expected ${program.program_id}`);
  if(approval.copy_manifest_sha256!==program.copy_manifest_sha256)add(errors,'APPROVAL_COPY_MISMATCH','/copy_manifest_sha256',`expected ${program.copy_manifest_sha256}`);
  if(!['approved','rejected'].includes(approval.decision))add(errors,'APPROVAL_DECISION_INVALID','/decision','decision must be approved or rejected');
  if(typeof approval.approval_id!=='string'||computeCreativeApprovalId(approval)!==approval.approval_id)add(errors,'APPROVAL_ID_MISMATCH','/approval_id','approval identity mismatch');
  return {valid:errors.length===0,errors:sortErrors(errors)};
}
export function createServerCreativeApprovalV2({accepted_draft,program,decision,issuer_id,review_policy_version='i18-profile-independent-review-v1'}){
  if(!accepted_draft||accepted_draft.schema!==ACCEPTED_EXTERNAL_DRAFT_SCHEMA)throw new Error('canonical v2 accepted_draft required');
  if(!program||program.schema!==PROFILE_INDEPENDENT_PROGRAM_SCHEMA||program.program_id!==`nbprog2_${sha256Canonical(Object.fromEntries(Object.entries(program).filter(([key])=>key!=='program_id')))}`)throw new Error('canonical v2 program required');
  if(program.draft_id!==accepted_draft.draft_id)throw new Error('program/draft mismatch');
  if(!['approved','rejected'].includes(decision))throw new Error('approval decision must be approved or rejected');
  if(typeof issuer_id!=='string'||!issuer_id.trim())throw new Error('issuer_id required');
  const approval={schema:CREATIVE_APPROVAL_SCHEMA,authority:'server_owned',draft_id:accepted_draft.draft_id,program_id:program.program_id,copy_manifest_sha256:program.copy_manifest_sha256,decision,review_policy_version,issuer_id:issuer_id.trim()};
  approval.approval_id=computeCreativeApprovalId(approval);
  return approval;
}

export async function processCreativeIngress({ingress,loadContextPack,loadCopyLanguage=null,loadTrustedApproval=null}){
  const envelope=validateCreativeIngressEnvelope(ingress);
  if(!envelope.valid)throw new CreativeIngressError('CREATIVE_INGRESS_REJECTED',envelope.errors);
  if(typeof loadContextPack!=='function')fail('SERVER_CONTEXT_RESOLVER_REQUIRED','/context_pack_id','server-owned ContextPack resolver is required');
  const pack=await loadContextPack(ingress.context_pack_id);
  if(!pack)fail('CONTEXT_NOT_FOUND','/context_pack_id',`server ContextPack ${ingress.context_pack_id} was not found`);
  const contextReport=validateContextPack(pack);
  if(!contextReport.valid)throw new CreativeIngressError('INVALID_SERVER_CONTEXT',prefixErrors(contextReport.errors,'/server_context'));
  if(pack.context_pack_id!==ingress.context_pack_id)fail('CONTEXT_ID_MISMATCH','/context_pack_id',`server resolver returned ${pack.context_pack_id}`);
  if(pack.context_hash!==ingress.context_hash)fail('CONTEXT_HASH_MISMATCH','/context_hash',`expected server context hash ${pack.context_hash}`);

  const inputId=computeInputId(ingress);
  let program,creativeGate,acceptedDraft=null,legacyInputId;
  if(ingress.mode==='trusted_atoms'){
    const proposal=buildTrustedProposal(ingress,pack);
    legacyInputId=proposal.proposal_id;
    let legacyProgram;
    try{legacyProgram=compileCreativeProposal(pack,proposal);}catch(error){if(error?.report?.errors)throw new CreativeIngressError(error.report.code||'CREATIVE_PROPOSAL_REJECTED',prefixErrors(error.report.errors,'/payload'));throw error;}
    program=normalizeProgram(legacyProgram,{inputId,legacyInputId});
    creativeGate={preview_render_allowed:true,publication_trust_satisfied:true,reason:'trusted_atoms'};
  }else if(ingress.mode==='verified_composition'){
    if(typeof loadCopyLanguage!=='function')fail('SERVER_COPY_LANGUAGE_RESOLVER_REQUIRED','/payload/copy_language_id','server-owned CopyLanguage resolver is required');
    const language=await loadCopyLanguage(ingress.payload.copy_language_id);
    if(!language)fail('COPY_LANGUAGE_NOT_FOUND','/payload/copy_language_id',`server CopyLanguage ${ingress.payload.copy_language_id} was not found`);
    if(language.copy_language_id!==ingress.payload.copy_language_id)fail('COPY_LANGUAGE_ID_MISMATCH','/payload/copy_language_id',`server resolver returned ${language.copy_language_id}`);
    if(language.copy_language_hash!==ingress.payload.copy_language_hash)fail('COPY_LANGUAGE_HASH_MISMATCH','/payload/copy_language_hash',`expected server copy language hash ${language.copy_language_hash}`);
    const proposal=buildComposedProposal(ingress,pack);
    let legacyProgram;
    try{legacyProgram=compileComposedCreativeProposal(pack,language,proposal);}catch(error){if(error?.report?.errors)throw new CreativeIngressError(error.report.code||'COMPOSED_CREATIVE_PROPOSAL_REJECTED',prefixErrors(error.report.errors,'/payload'));throw error;}
    legacyInputId=legacyProgram.proposal_id;
    program=normalizeProgram(legacyProgram,{inputId,legacyInputId});
    creativeGate={preview_render_allowed:true,publication_trust_satisfied:true,reason:'verified_composition'};
  }else{
    const draft=buildExternalDraft(ingress,pack);
    let compiled;
    try{compiled=compileExternalCreativeDraft(pack,draft);}catch(error){if(error?.report?.errors)throw new CreativeIngressError(error.report.code||'EXTERNAL_CREATIVE_DRAFT_REJECTED',prefixErrors(error.report.errors,'/payload'));throw error;}
    legacyInputId=compiled.accepted_draft.draft_id;
    acceptedDraft=normalizeAcceptedDraft(compiled.accepted_draft,inputId);
    program=normalizeProgram(compiled.program,{inputId,legacyInputId});
    let trustedApproval=null;
    if(typeof loadTrustedApproval==='function')trustedApproval=await loadTrustedApproval({context_pack_id:pack.context_pack_id,context_hash:pack.context_hash,draft_id:acceptedDraft.draft_id,program_id:program.program_id,copy_manifest_sha256:program.copy_manifest_sha256});
    if(!trustedApproval)creativeGate={preview_render_allowed:true,publication_trust_satisfied:false,reason:'review_required'};
    else{
      const approvalReport=validateV2Approval(trustedApproval,{acceptedDraft,program});
      if(!approvalReport.valid)creativeGate={preview_render_allowed:true,publication_trust_satisfied:false,reason:'approval_invalid',approval_errors:approvalReport.errors};
      else if(trustedApproval.decision!=='approved')creativeGate={preview_render_allowed:true,publication_trust_satisfied:false,reason:'rejected'};
      else creativeGate={preview_render_allowed:true,publication_trust_satisfied:true,reason:'approved',approval_id:trustedApproval.approval_id};
    }
  }

  const ingressId=computeIngressId({mode:ingress.mode,context_pack_id:pack.context_pack_id,context_hash:pack.context_hash,input_id:inputId,program_id:program.program_id});
  const result={schema:CREATIVE_INGRESS_RESULT_SCHEMA,ingress_id:ingressId,mode:ingress.mode,context_pack_id:pack.context_pack_id,context_hash:pack.context_hash,canonical_input:{schema:PROFILE_INDEPENDENT_INPUT_SCHEMA,id:inputId},program,creative_gate:creativeGate};
  if(acceptedDraft)result.accepted_draft=acceptedDraft;
  result.decision_id=computeDecisionId({ingress_id:ingressId,creative_gate:creativeGate});
  return result;
}
