import { sha256Canonical } from './factory-identity-v1.mjs';
import {
  PROPOSAL_SCHEMA,
  computeProposalId,
  validateContextPack,
} from './creative-proposal-v1.mjs';
import { compileCreativeProposal } from './compile-creative-proposal-v1.mjs';
import {
  EXTERNAL_DRAFT_SCHEMA,
  compileExternalCreativeDraft,
  evaluatePublishEligibility,
} from './external-creative-draft-v1.mjs';

export const CREATIVE_INGRESS_SCHEMA='newboo-creative-ingress-v1';
export const CREATIVE_INGRESS_RESULT_SCHEMA='newboo-creative-ingress-result-v1';
export const CREATIVE_INGRESS_MODES=['trusted_atoms','external_copy_review_required'];

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
  else checkUnknown(errors,ingress.payload,new Set(['account_id','book_id','narrative','presentation','selected_asset_ids']),'/payload');
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

function buildTrustedProposal(ingress){
  const proposal={
    schema:PROPOSAL_SCHEMA,
    proposal_id:'',
    context_pack_id:ingress.context_pack_id,
    context_hash:ingress.context_hash,
    ...clone(ingress.payload),
  };
  proposal.proposal_id=computeProposalId(proposal);
  return proposal;
}

function buildExternalDraft(ingress){
  return {
    schema:EXTERNAL_DRAFT_SCHEMA,
    context_pack_id:ingress.context_pack_id,
    context_hash:ingress.context_hash,
    ...clone(ingress.payload),
  };
}

function computeIngressId({mode,context_pack_id,context_hash,input_id,program_id}){
  return `nbi1_${sha256Canonical({schema:CREATIVE_INGRESS_SCHEMA,mode,context_pack_id,context_hash,input_id,program_id})}`;
}
function computeDecisionId({ingress_id,creative_gate}){
  return `nbid1_${sha256Canonical({ingress_id,creative_gate})}`;
}

export async function processCreativeIngress({ingress,loadContextPack,loadTrustedApproval=null}){
  const envelope=validateCreativeIngressEnvelope(ingress);
  if(!envelope.valid)throw new CreativeIngressError('CREATIVE_INGRESS_REJECTED',envelope.errors);
  if(typeof loadContextPack!=='function')fail('SERVER_CONTEXT_RESOLVER_REQUIRED','/context_pack_id','server-owned ContextPack resolver is required');

  const pack=await loadContextPack(ingress.context_pack_id);
  if(!pack)fail('CONTEXT_NOT_FOUND','/context_pack_id',`server ContextPack ${ingress.context_pack_id} was not found`);
  const contextReport=validateContextPack(pack);
  if(!contextReport.valid)throw new CreativeIngressError('INVALID_SERVER_CONTEXT',prefixErrors(contextReport.errors,'/server_context'));
  if(pack.context_pack_id!==ingress.context_pack_id)fail('CONTEXT_ID_MISMATCH','/context_pack_id',`server resolver returned ${pack.context_pack_id}`);
  if(pack.context_hash!==ingress.context_hash)fail('CONTEXT_HASH_MISMATCH','/context_hash',`expected server context hash ${pack.context_hash}`);

  let inputId,inputSchema,program,creativeGate,acceptedDraft=null,canonicalInput;
  if(ingress.mode==='trusted_atoms'){
    const proposal=buildTrustedProposal(ingress);
    canonicalInput=proposal;
    inputId=proposal.proposal_id;
    inputSchema=proposal.schema;
    try{
      program=compileCreativeProposal(pack,proposal);
    }catch(error){
      if(error?.report?.errors)throw new CreativeIngressError(error.report.code||'CREATIVE_PROPOSAL_REJECTED',prefixErrors(error.report.errors,'/payload'));
      throw error;
    }
    creativeGate={
      preview_render_allowed:true,
      publication_trust_satisfied:true,
      reason:'trusted_atoms',
    };
  }else{
    const draft=buildExternalDraft(ingress);
    canonicalInput=draft;
    inputSchema=draft.schema;
    let compiled;
    try{
      compiled=compileExternalCreativeDraft(pack,draft);
    }catch(error){
      if(error?.report?.errors)throw new CreativeIngressError(error.report.code||'EXTERNAL_CREATIVE_DRAFT_REJECTED',prefixErrors(error.report.errors,'/payload'));
      throw error;
    }
    acceptedDraft=compiled.accepted_draft;
    program=compiled.program;
    inputId=acceptedDraft.draft_id;
    let trustedApproval=null;
    if(typeof loadTrustedApproval==='function'){
      trustedApproval=await loadTrustedApproval({
        context_pack_id:pack.context_pack_id,
        context_hash:pack.context_hash,
        draft_id:acceptedDraft.draft_id,
        program_id:program.program_id,
        copy_manifest_sha256:program.copy_manifest_sha256,
      });
    }
    const eligibility=evaluatePublishEligibility({accepted_draft:acceptedDraft,program,trusted_approval:trustedApproval||null});
    creativeGate={
      preview_render_allowed:eligibility.preview_render_allowed,
      publication_trust_satisfied:eligibility.publish_allowed,
      reason:eligibility.reason,
      ...(eligibility.approval_id?{approval_id:eligibility.approval_id}:{}),
      ...(eligibility.errors?{approval_errors:eligibility.errors}:{}),
    };
  }

  const ingressId=computeIngressId({
    mode:ingress.mode,
    context_pack_id:pack.context_pack_id,
    context_hash:pack.context_hash,
    input_id:inputId,
    program_id:program.program_id,
  });
  const result={
    schema:CREATIVE_INGRESS_RESULT_SCHEMA,
    ingress_id:ingressId,
    mode:ingress.mode,
    context_pack_id:pack.context_pack_id,
    context_hash:pack.context_hash,
    canonical_input:{schema:inputSchema,id:inputId},
    program,
    creative_gate:creativeGate,
  };
  if(acceptedDraft)result.accepted_draft=acceptedDraft;
  result.decision_id=computeDecisionId({ingress_id:ingressId,creative_gate:creativeGate});
  return result;
}
