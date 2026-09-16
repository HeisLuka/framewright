import crypto from 'node:crypto';
import { sha256Canonical } from './factory-identity-v1.mjs';
import { validateContextPack } from './creative-proposal-v1.mjs';
import {
  C27_ANGLE_TYPES,
  C27_CTA_TREATMENTS,
  C27_DURATION_PROFILES,
  C27_REVEAL_TIMINGS,
  planNarrative,
} from '../.agents/skills/framewright/scripts/c27-narrative-plan.mjs';

export const EXTERNAL_DRAFT_SCHEMA='newboo-external-creative-draft-v1';
export const ACCEPTED_EXTERNAL_DRAFT_SCHEMA='newboo-accepted-external-creative-draft-v1';
export const REVIEW_REQUIRED_PROGRAM_SCHEMA='newboo-review-required-creative-program-v1';
export const CREATIVE_APPROVAL_SCHEMA='newboo-creative-approval-v1';
export const C33_TRUST_MODE='external_llm_review_required';
export const C33_REVIEW_POLICY_VERSION='c33-review-boundary-v1';
export const COPY_LIMITS=Object.freeze({hook:220,tension:280,payoff:280});

const AUTHORIZATION_KEYS=new Set(['approval','approved','approval_id','publish','publish_allowed','reviewed','review_status','autopublish','autopublish_allowed']);
const COPY_ROLES=['hook','tension','payoff'];

function isObject(value){return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function hasOwn(value,key){return Object.prototype.hasOwnProperty.call(value,key);}
function add(errors,code,path,message){errors.push({code,path,message});}
function sortErrors(errors){return errors.sort((a,b)=>a.path.localeCompare(b.path)||a.code.localeCompare(b.code)||a.message.localeCompare(b.message));}
function requireString(errors,value,path){if(typeof value!=='string'||!value.length)add(errors,'INVALID_STRING',path,'expected a non-empty string');}
function requireInteger(errors,value,path,{min=Number.MIN_SAFE_INTEGER}={}){if(!Number.isInteger(value)||value<min)add(errors,'INVALID_INTEGER',path,`expected an integer >= ${min}`);}
function unique(values){return new Set(values).size===values.length;}
function sha256Text(text){return crypto.createHash('sha256').update(text).digest('hex');}
function clone(value){return structuredClone(value);}

function checkUnknown(errors,value,allowed,path){
  if(!isObject(value))return;
  for(const key of Object.keys(value).sort())if(!allowed.has(key))add(errors,'UNKNOWN_FIELD',`${path}/${key}`,`unknown field ${key}`);
}

function scanAuthorizationKeys(errors,value,path=''){
  if(Array.isArray(value)){value.forEach((item,index)=>scanAuthorizationKeys(errors,item,`${path}/${index}`));return;}
  if(!isObject(value))return;
  for(const key of Object.keys(value).sort()){
    const child=`${path}/${key}`;
    if(AUTHORIZATION_KEYS.has(key.toLowerCase()))add(errors,'SELF_APPROVAL_FORBIDDEN',child,`external creative input may not set ${key}; publication approval is server-owned`);
    scanAuthorizationKeys(errors,value[key],child);
  }
}

function validateText(errors,value,role,path){
  if(typeof value!=='string'||!value.length){add(errors,'INVALID_STRING',path,'expected non-empty display text');return;}
  if(value!==value.trim())add(errors,'COPY_WHITESPACE_INVALID',path,'display text must not have leading or trailing whitespace');
  if(value.length>COPY_LIMITS[role])add(errors,'COPY_TOO_LONG',path,`${role} copy exceeds ${COPY_LIMITS[role]} characters`);
  if(/[\u0000-\u001f\u007f]/u.test(value))add(errors,'COPY_CONTROL_CHARACTER',path,'display text may not contain control characters or line breaks');
  if(/(?:https?:\/\/|www\.|mailto:|javascript:|data:|file:\/\/)/iu.test(value))add(errors,'COPY_URL_FORBIDDEN',path,'external display copy may not contain URL or executable URI schemes');
  if(/<\/?(?:script|iframe|object|embed|style)\b/iu.test(value))add(errors,'COPY_MARKUP_FORBIDDEN',path,'external display copy may not contain executable markup');
}

function validateCopyBlock(errors,block,role,path,facts){
  if(!isObject(block)){add(errors,'TYPE_OBJECT_REQUIRED',path,`${role} copy must be an object`);return;}
  checkUnknown(errors,block,new Set(['text','supporting_fact_ids']),path);
  validateText(errors,block.text,role,`${path}/text`);
  if(!Array.isArray(block.supporting_fact_ids)||!block.supporting_fact_ids.length){add(errors,'INVALID_ARRAY',`${path}/supporting_fact_ids`,'at least one supporting fact ID is required');return;}
  const ids=[];
  for(let i=0;i<block.supporting_fact_ids.length;i+=1){
    const id=block.supporting_fact_ids[i];
    if(typeof id!=='string'||!id){add(errors,'INVALID_STRING',`${path}/supporting_fact_ids/${i}`,'expected non-empty fact ID');continue;}
    ids.push(id);
    if(!facts.has(id))add(errors,'UNKNOWN_FACT',`${path}/supporting_fact_ids/${i}`,`fact ${id} is not scoped to the selected book`);
  }
  if(!unique(ids))add(errors,'DUPLICATE_REFERENCE',`${path}/supporting_fact_ids`,'supporting fact IDs must be unique');
}

function indexPack(pack){
  const books=new Map();
  const assets=new Map();
  const ctas=new Map((pack.ctas||[]).map(x=>[x.cta_id,x]));
  for(const book of pack.books||[]){
    const facts=new Map((book.facts||[]).map(x=>[x.fact_id,x]));
    books.set(book.book_id,{book,facts});
    for(const asset of book.assets||[])assets.set(asset.asset_id,{asset,book_id:book.book_id});
  }
  return {books,assets,ctas};
}

export function validateExternalCreativeDraft(pack,draft){
  const context=validateContextPack(pack);
  if(!context.valid)return {valid:false,code:'INVALID_SERVER_CONTEXT',errors:context.errors};
  const errors=[];
  if(!isObject(draft)){add(errors,'TYPE_OBJECT_REQUIRED','','ExternalCreativeDraft must be an object');return {valid:false,code:'EXTERNAL_CREATIVE_DRAFT_REJECTED',errors};}
  scanAuthorizationKeys(errors,draft);
  checkUnknown(errors,draft,new Set(['schema','context_pack_id','context_hash','account_id','book_id','narrative','presentation','selected_asset_ids']),'');
  if(draft.schema!==EXTERNAL_DRAFT_SCHEMA)add(errors,'SCHEMA_VERSION_MISMATCH','/schema',`expected ${EXTERNAL_DRAFT_SCHEMA}`);
  requireString(errors,draft.context_pack_id,'/context_pack_id');
  requireString(errors,draft.context_hash,'/context_hash');
  requireString(errors,draft.account_id,'/account_id');
  requireString(errors,draft.book_id,'/book_id');
  if(draft.context_pack_id!==pack.context_pack_id)add(errors,'CONTEXT_ID_MISMATCH','/context_pack_id',`expected ${pack.context_pack_id}`);
  if(draft.context_hash!==pack.context_hash)add(errors,'CONTEXT_HASH_MISMATCH','/context_hash',`expected ${pack.context_hash}`);
  if(draft.account_id!==pack.account.account_id)add(errors,'ACCOUNT_SCOPE_MISMATCH','/account_id',`expected ${pack.account.account_id}`);

  const ids=indexPack(pack);
  const scoped=ids.books.get(draft.book_id);
  if(!scoped)add(errors,'UNKNOWN_BOOK','/book_id',`book ${draft.book_id} is not in this ContextPack`);

  const narrative=draft.narrative;
  if(!isObject(narrative))add(errors,'TYPE_OBJECT_REQUIRED','/narrative','narrative must be an object');
  else{
    checkUnknown(errors,narrative,new Set(['angle_type','hook','tension','payoff','reveal_timing','cta_treatment','cta_id']),'/narrative');
    requireString(errors,narrative.angle_type,'/narrative/angle_type');
    requireString(errors,narrative.reveal_timing,'/narrative/reveal_timing');
    requireString(errors,narrative.cta_treatment,'/narrative/cta_treatment');
    if(!C27_ANGLE_TYPES.includes(narrative.angle_type)||!pack.capabilities.angle_types.includes(narrative.angle_type))add(errors,'CAPABILITY_DENIED','/narrative/angle_type',`angle ${narrative.angle_type} is not allowed`);
    if(!['none',...C27_REVEAL_TIMINGS].includes(narrative.reveal_timing)||!pack.capabilities.reveal_timings.includes(narrative.reveal_timing))add(errors,'CAPABILITY_DENIED','/narrative/reveal_timing',`reveal timing ${narrative.reveal_timing} is not allowed`);
    if(!C27_CTA_TREATMENTS.includes(narrative.cta_treatment)||!pack.capabilities.cta_treatments.includes(narrative.cta_treatment))add(errors,'CAPABILITY_DENIED','/narrative/cta_treatment',`CTA treatment ${narrative.cta_treatment} is not allowed`);
    if(scoped){
      validateCopyBlock(errors,narrative.hook,'hook','/narrative/hook',scoped.facts);
      if(hasOwn(narrative,'tension'))validateCopyBlock(errors,narrative.tension,'tension','/narrative/tension',scoped.facts);
      if(hasOwn(narrative,'payoff'))validateCopyBlock(errors,narrative.payoff,'payoff','/narrative/payoff',scoped.facts);
    }
    const bodyCount=Number(hasOwn(narrative,'tension'))+Number(hasOwn(narrative,'payoff'));
    if(bodyCount>pack.constraints.max_body_atoms)add(errors,'BODY_COPY_LIMIT_EXCEEDED','/narrative',`body copy count ${bodyCount} exceeds ${pack.constraints.max_body_atoms}`);
  }

  const presentation=draft.presentation;
  if(!isObject(presentation))add(errors,'TYPE_OBJECT_REQUIRED','/presentation','presentation must be an object');
  else{
    checkUnknown(errors,presentation,new Set(['duration_seconds','fps','visual_system','delivery_profile','seed']),'/presentation');
    requireInteger(errors,presentation.duration_seconds,'/presentation/duration_seconds',{min:1});
    requireInteger(errors,presentation.fps,'/presentation/fps',{min:1});
    requireString(errors,presentation.visual_system,'/presentation/visual_system');
    requireString(errors,presentation.delivery_profile,'/presentation/delivery_profile');
    requireInteger(errors,presentation.seed,'/presentation/seed',{min:0});
    if(!C27_DURATION_PROFILES.includes(presentation.duration_seconds)||!pack.capabilities.duration_seconds.includes(presentation.duration_seconds))add(errors,'CAPABILITY_DENIED','/presentation/duration_seconds',`duration ${presentation.duration_seconds}s is not allowed`);
    if(!pack.capabilities.fps.includes(presentation.fps))add(errors,'CAPABILITY_DENIED','/presentation/fps',`fps ${presentation.fps} is not allowed`);
    if(!pack.capabilities.visual_systems.includes(presentation.visual_system))add(errors,'CAPABILITY_DENIED','/presentation/visual_system',`visual system ${presentation.visual_system} is not allowed`);
    if(!pack.capabilities.delivery_profiles.includes(presentation.delivery_profile))add(errors,'CAPABILITY_DENIED','/presentation/delivery_profile',`delivery profile ${presentation.delivery_profile} is not allowed`);
  }

  if(!Array.isArray(draft.selected_asset_ids)||!draft.selected_asset_ids.length)add(errors,'INVALID_ARRAY','/selected_asset_ids','at least one server-owned asset ID is required');
  else{
    const selected=[];let cover=false;
    for(let i=0;i<draft.selected_asset_ids.length;i+=1){
      const id=draft.selected_asset_ids[i];
      if(typeof id!=='string'||!id){add(errors,'INVALID_STRING',`/selected_asset_ids/${i}`,'expected non-empty asset ID');continue;}
      selected.push(id);
      const found=ids.assets.get(id);
      if(!found)add(errors,'UNKNOWN_ASSET',`/selected_asset_ids/${i}`,`unknown asset ${id}`);
      else if(found.book_id!==draft.book_id)add(errors,'ASSET_SCOPE_MISMATCH',`/selected_asset_ids/${i}`,`asset ${id} belongs to ${found.book_id}, not ${draft.book_id}`);
      else if(found.asset.role==='cover')cover=true;
    }
    if(!unique(selected))add(errors,'DUPLICATE_REFERENCE','/selected_asset_ids','asset IDs must be unique');
    if(scoped&&!cover)add(errors,'COVER_ASSET_REQUIRED','/selected_asset_ids','at least one selected asset must be the scoped book cover');
  }

  if(isObject(narrative)&&isObject(presentation)){
    const duration=presentation.duration_seconds;
    if(duration>=7&&!hasOwn(narrative,'tension'))add(errors,'TENSION_REQUIRED','/narrative/tension','7s+ grammar requires tension copy');
    if(duration<7&&(hasOwn(narrative,'tension')||hasOwn(narrative,'payoff')))add(errors,'BODY_COPY_FORBIDDEN','/narrative','3s/5s profiles do not render tension/payoff copy');
    if(duration===3&&narrative.cta_treatment!=='none')add(errors,'DURATION_CTA_CONFLICT','/narrative/cta_treatment','3s profile requires cta_treatment=none');
    if(duration===5&&!['none','soft_reveal'].includes(narrative.cta_treatment))add(errors,'DURATION_CTA_CONFLICT','/narrative/cta_treatment','5s profile supports only none/soft_reveal');
    if(duration===3&&narrative.reveal_timing!=='none')add(errors,'REVEAL_DURATION_CONFLICT','/narrative/reveal_timing','3s profile requires reveal_timing=none');
    if(duration!==3&&narrative.reveal_timing==='none')add(errors,'REVEAL_DURATION_CONFLICT','/narrative/reveal_timing','reveal_timing=none is only valid for 3s');
    const explicit=['intent','direct'].includes(narrative.cta_treatment);
    if(explicit&&!hasOwn(narrative,'cta_id'))add(errors,'CTA_REQUIRED','/narrative/cta_id',`${narrative.cta_treatment} requires server-owned cta_id`);
    if(!explicit&&hasOwn(narrative,'cta_id'))add(errors,'CTA_FORBIDDEN','/narrative/cta_id',`${narrative.cta_treatment} must not include cta_id`);
    if(explicit&&hasOwn(narrative,'cta_id')){
      const cta=ids.ctas.get(narrative.cta_id);
      if(!cta)add(errors,'UNKNOWN_CTA','/narrative/cta_id',`unknown CTA ${narrative.cta_id}`);
      else if(!cta.treatments.includes(narrative.cta_treatment))add(errors,'CTA_TREATMENT_MISMATCH','/narrative/cta_id',`CTA ${narrative.cta_id} does not allow ${narrative.cta_treatment}`);
    }
  }

  return {valid:errors.length===0,code:errors.length?'EXTERNAL_CREATIVE_DRAFT_REJECTED':'OK',errors:sortErrors(errors)};
}

function acceptedDraftIdentityInput(accepted){const {draft_id:_draftId,...rest}=accepted||{};return rest;}
export function computeExternalDraftId(accepted){return `nbd1_${sha256Canonical(acceptedDraftIdentityInput(accepted))}`;}

export class ExternalCreativeDraftValidationError extends Error{
  constructor(report){super(`ExternalCreativeDraft rejected with ${report.errors.length} error(s)`);this.name='ExternalCreativeDraftValidationError';this.report=report;}
}

function normalizeCopyBlock(block){return {text:block.text,supporting_fact_ids:[...block.supporting_fact_ids].sort()};}
function normalizeNarrative(narrative){
  return {
    angle_type:narrative.angle_type,
    hook:normalizeCopyBlock(narrative.hook),
    ...(narrative.tension?{tension:normalizeCopyBlock(narrative.tension)}:{}),
    ...(narrative.payoff?{payoff:normalizeCopyBlock(narrative.payoff)}:{}),
    reveal_timing:narrative.reveal_timing,
    cta_treatment:narrative.cta_treatment,
    ...(narrative.cta_id?{cta_id:narrative.cta_id}:{}),
  };
}

export function acceptExternalCreativeDraft(pack,draft){
  const report=validateExternalCreativeDraft(pack,draft);
  if(!report.valid)throw new ExternalCreativeDraftValidationError(report);
  const accepted={
    schema:ACCEPTED_EXTERNAL_DRAFT_SCHEMA,
    trust_mode:C33_TRUST_MODE,
    context_pack_id:pack.context_pack_id,
    context_hash:pack.context_hash,
    account_id:draft.account_id,
    book_id:draft.book_id,
    narrative:normalizeNarrative(draft.narrative),
    presentation:clone(draft.presentation),
    selected_asset_ids:[...draft.selected_asset_ids],
  };
  accepted.draft_id=computeExternalDraftId(accepted);
  return accepted;
}

function acceptedToRaw(accepted){
  return {
    schema:EXTERNAL_DRAFT_SCHEMA,
    context_pack_id:accepted.context_pack_id,
    context_hash:accepted.context_hash,
    account_id:accepted.account_id,
    book_id:accepted.book_id,
    narrative:clone(accepted.narrative),
    presentation:clone(accepted.presentation),
    selected_asset_ids:[...accepted.selected_asset_ids],
  };
}

function assertAcceptedExternalDraft(pack,accepted){
  if(!accepted||accepted.schema!==ACCEPTED_EXTERNAL_DRAFT_SCHEMA)throw new Error('canonical accepted external draft required');
  if(accepted.trust_mode!==C33_TRUST_MODE)throw new Error('accepted external draft trust_mode drift');
  if(computeExternalDraftId(accepted)!==accepted.draft_id)throw new Error('accepted external draft identity drift');
  const report=validateExternalCreativeDraft(pack,acceptedToRaw(accepted));
  if(!report.valid)throw new ExternalCreativeDraftValidationError(report);
  return accepted;
}

function copyManifest(accepted){
  const items=[];
  for(const role of COPY_ROLES){
    const block=accepted.narrative?.[role];
    if(!block)continue;
    items.push({role,text:block.text,copy_sha256:sha256Text(block.text),supporting_fact_ids:[...block.supporting_fact_ids]});
  }
  return {items,sha256:sha256Canonical(items)};
}
export function computeExternalCopyManifestSha256(accepted){return copyManifest(accepted).sha256;}

function externalSource(pack,accepted,role,block){
  return {
    kind:'external_llm_copy',
    text:block.text,
    context_pack_id:pack.context_pack_id,
    context_hash:pack.context_hash,
    draft_id:accepted.draft_id,
    role,
    supporting_fact_ids:[...block.supporting_fact_ids],
    copy_sha256:sha256Text(block.text),
  };
}

function programIdentityInput(program){const {program_id:_programId,...rest}=program||{};return rest;}
export function computeReviewRequiredProgramId(program){return `nbxprog1_${sha256Canonical(programIdentityInput(program))}`;}

export function compileExternalCreativeDraft(pack,draft){
  const accepted=draft?.schema===ACCEPTED_EXTERNAL_DRAFT_SCHEMA?assertAcceptedExternalDraft(pack,clone(draft)):acceptExternalCreativeDraft(pack,draft);
  const ids=indexPack(pack),scoped=ids.books.get(accepted.book_id);
  if(!scoped)throw new Error('accepted external draft book is no longer in ContextPack');
  const n=accepted.narrative;
  const cta=n.cta_id?ids.ctas.get(n.cta_id):null;
  const angle={
    id:accepted.draft_id,
    type:n.angle_type,
    label:`external-review:${n.angle_type}`,
    source:{kind:'external_creative_draft',context_pack_id:pack.context_pack_id,context_hash:pack.context_hash,draft_id:accepted.draft_id,trust_mode:C33_TRUST_MODE},
    hook:externalSource(pack,accepted,'hook',n.hook),
    ...(n.tension?{tension:externalSource(pack,accepted,'tension',n.tension)}:{}),
    ...(n.payoff?{payoff:externalSource(pack,accepted,'payoff',n.payoff)}:{}),
  };
  const narrativePlan=planNarrative({
    book:{book_id:scoped.book.book_id,title:scoped.book.title,author:scoped.book.author,cta:cta?.text||''},
    angle,
    duration_seconds:accepted.presentation.duration_seconds,
    fps:accepted.presentation.fps,
    reveal_timing:n.reveal_timing==='none'?'mid':n.reveal_timing,
    cta_treatment:n.cta_treatment,
    seed:accepted.presentation.seed,
  });
  const assets=accepted.selected_asset_ids.map(id=>{
    const found=ids.assets.get(id);
    if(!found||found.book_id!==accepted.book_id)throw new Error(`accepted external draft asset ${id} is not scoped to selected book`);
    const asset=found.asset;
    return {asset_id:asset.asset_id,role:asset.role,sha256:asset.sha256,...(asset.media_type?{media_type:asset.media_type}:{})};
  });
  const manifest=copyManifest(accepted);
  const program={
    schema:REVIEW_REQUIRED_PROGRAM_SCHEMA,
    trust_mode:C33_TRUST_MODE,
    publication_class:'review_required',
    context_pack_id:pack.context_pack_id,
    context_hash:pack.context_hash,
    draft_id:accepted.draft_id,
    account_id:accepted.account_id,
    book_id:accepted.book_id,
    copy_manifest_sha256:manifest.sha256,
    narrative_plan:narrativePlan,
    presentation:clone(accepted.presentation),
    assets,
  };
  program.program_id=computeReviewRequiredProgramId(program);
  return {accepted_draft:accepted,program};
}

function approvalIdentityInput(approval){const {approval_id:_approvalId,...rest}=approval||{};return rest;}
export function computeCreativeApprovalId(approval){return `nba1_${sha256Canonical(approvalIdentityInput(approval))}`;}

export function createServerCreativeApproval({accepted_draft,program,decision,issuer_id,review_policy_version=C33_REVIEW_POLICY_VERSION}){
  if(!accepted_draft||accepted_draft.schema!==ACCEPTED_EXTERNAL_DRAFT_SCHEMA||computeExternalDraftId(accepted_draft)!==accepted_draft.draft_id)throw new Error('canonical accepted_draft required');
  if(!program||program.schema!==REVIEW_REQUIRED_PROGRAM_SCHEMA||computeReviewRequiredProgramId(program)!==program.program_id)throw new Error('canonical review-required program required');
  if(program.draft_id!==accepted_draft.draft_id)throw new Error('program/draft mismatch');
  if(!['approved','rejected'].includes(decision))throw new Error('approval decision must be approved or rejected');
  if(typeof issuer_id!=='string'||!issuer_id.trim())throw new Error('issuer_id required');
  if(typeof review_policy_version!=='string'||!review_policy_version.trim())throw new Error('review_policy_version required');
  const approval={
    schema:CREATIVE_APPROVAL_SCHEMA,
    authority:'server_owned',
    draft_id:accepted_draft.draft_id,
    program_id:program.program_id,
    copy_manifest_sha256:program.copy_manifest_sha256,
    decision,
    review_policy_version,
    issuer_id:issuer_id.trim(),
  };
  approval.approval_id=computeCreativeApprovalId(approval);
  return approval;
}

export function validateCreativeApproval(approval,acceptedDraft,program){
  const errors=[];
  if(!isObject(approval)){add(errors,'TYPE_OBJECT_REQUIRED','','CreativeApproval must be an object');return {valid:false,errors};}
  checkUnknown(errors,approval,new Set(['schema','authority','approval_id','draft_id','program_id','copy_manifest_sha256','decision','review_policy_version','issuer_id']),'');
  if(approval.schema!==CREATIVE_APPROVAL_SCHEMA)add(errors,'SCHEMA_VERSION_MISMATCH','/schema',`expected ${CREATIVE_APPROVAL_SCHEMA}`);
  if(approval.authority!=='server_owned')add(errors,'APPROVAL_AUTHORITY_INVALID','/authority','approval authority must be server_owned');
  for(const key of ['approval_id','draft_id','program_id','copy_manifest_sha256','decision','review_policy_version','issuer_id'])requireString(errors,approval[key],`/${key}`);
  if(!['approved','rejected'].includes(approval.decision))add(errors,'APPROVAL_DECISION_INVALID','/decision','decision must be approved or rejected');
  if(typeof approval.approval_id==='string'&&/^nba1_[a-f0-9]{64}$/.test(approval.approval_id)){
    const expected=computeCreativeApprovalId(approval);
    if(expected!==approval.approval_id)add(errors,'APPROVAL_ID_MISMATCH','/approval_id',`expected ${expected}`);
  }else if(typeof approval.approval_id==='string'&&approval.approval_id)add(errors,'APPROVAL_ID_INVALID','/approval_id','approval_id must match nba1_<sha256>');
  if(acceptedDraft){
    if(approval.draft_id!==acceptedDraft.draft_id)add(errors,'APPROVAL_DRAFT_MISMATCH','/draft_id',`expected ${acceptedDraft.draft_id}`);
    const expectedManifest=computeExternalCopyManifestSha256(acceptedDraft);
    if(approval.copy_manifest_sha256!==expectedManifest)add(errors,'APPROVAL_COPY_MISMATCH','/copy_manifest_sha256',`expected ${expectedManifest}`);
  }
  if(program){
    if(approval.program_id!==program.program_id)add(errors,'APPROVAL_PROGRAM_MISMATCH','/program_id',`expected ${program.program_id}`);
    if(approval.copy_manifest_sha256!==program.copy_manifest_sha256)add(errors,'APPROVAL_COPY_MISMATCH','/copy_manifest_sha256',`expected ${program.copy_manifest_sha256}`);
  }
  return {valid:errors.length===0,errors:sortErrors(errors)};
}

export function evaluatePublishEligibility({accepted_draft,program,trusted_approval=null}){
  if(!accepted_draft||accepted_draft.schema!==ACCEPTED_EXTERNAL_DRAFT_SCHEMA||computeExternalDraftId(accepted_draft)!==accepted_draft.draft_id)return {preview_render_allowed:false,publish_allowed:false,reason:'invalid_draft'};
  if(!program||program.schema!==REVIEW_REQUIRED_PROGRAM_SCHEMA||computeReviewRequiredProgramId(program)!==program.program_id||program.draft_id!==accepted_draft.draft_id)return {preview_render_allowed:false,publish_allowed:false,reason:'invalid_program'};
  if(!trusted_approval)return {preview_render_allowed:true,publish_allowed:false,reason:'review_required'};
  const report=validateCreativeApproval(trusted_approval,accepted_draft,program);
  if(!report.valid)return {preview_render_allowed:true,publish_allowed:false,reason:'approval_invalid',errors:report.errors};
  if(trusted_approval.decision!=='approved')return {preview_render_allowed:true,publish_allowed:false,reason:'rejected'};
  return {preview_render_allowed:true,publish_allowed:true,reason:'approved',approval_id:trusted_approval.approval_id};
}
