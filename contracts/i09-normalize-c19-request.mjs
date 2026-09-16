#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const rawPath=path.resolve(process.argv[2]||'artifacts/i09/input/request.json');
const templatePath=path.resolve(process.argv[3]||'artifacts/i09/input/i03-template-request.json');
const outPath=path.resolve(process.argv[4]||rawPath);
const raw=JSON.parse(fs.readFileSync(rawPath,'utf8'));
const template=JSON.parse(fs.readFileSync(templatePath,'utf8'));
const c19=await import('./c19-delivery-package-v1.mjs');
const compile=c19.compileDeliveryPackage||c19.makeDeliveryPackage||c19.buildDeliveryPackage;
if(typeof compile!=='function')throw new Error(`C19 compiler export not found: ${Object.keys(c19).sort().join(',')}`);

function compileAttempt(request){
  try{
    const pkg=compile(request);
    return {ok:true,pkg};
  }catch(error){
    return {ok:false,error:{name:error?.name||null,message:error?.message||String(error),stack:error?.stack||null}};
  }
}

const direct=compileAttempt(raw);
if(direct.ok){
  fs.writeFileSync(outPath,JSON.stringify(raw,null,2)+'\n');
  console.log(JSON.stringify({status:'PASS',strategy:'raw-request-already-canonical',package_schema:direct.pkg?.schema,creatives:direct.pkg?.creatives?.length,render_specs:direct.pkg?.render_specs?.length},null,2));
  process.exit(0);
}

if(!Array.isArray(template?.selected)||!template.selected.length)throw new Error(`canonical I03 template has no selected prototype; raw C19 error=${direct.error.message}`);
if(!Array.isArray(raw?.selected)||!raw.selected.length)throw new Error('I09 raw request has no selected creatives');

function profileId(profile){return profile?.profile_id||profile?.id||profile?.delivery_profile_id||null;}
function isYoutube(profile){return [profile?.platform_ui_profile,profile?.id,profile?.profile_id,profile?.delivery_profile_id].some(value=>String(value||'').includes('youtube')) || String(profile?.platform||'').includes('youtube');}
const templateProfiles=Array.isArray(template.delivery_profiles)?template.delivery_profiles:[];
let chosenProfiles=templateProfiles.filter(isYoutube);
if(!chosenProfiles.length&&templateProfiles.length)chosenProfiles=[templateProfiles[0]];
const requestedProfileIds=chosenProfiles.map(profileId).filter(Boolean);

function currentParts(entry){
  const source=entry?.source||entry;
  return {
    creative:source?.creative||entry?.creative,
    execution:source?.execution||entry?.execution,
    rank:entry?.rank,
    score:entry?.score,
  };
}

function adaptNode(node,parts,index,key=''){
  if(Array.isArray(node)){
    if(key==='requested_delivery_profile_ids'&&requestedProfileIds.length)return [...requestedProfileIds];
    return node.map((value,i)=>adaptNode(value,parts,index,String(i)));
  }
  if(!node||typeof node!=='object'){
    if(key==='selection_id')return `i09-${parts.creative?.hook?.provenance?.mode||index}`;
    if(key==='rank'&&Number.isFinite(parts.rank))return parts.rank;
    if(key==='score'&&Number.isFinite(parts.score))return parts.score;
    return node;
  }
  if(node.schema==='newboo-creative-spec-v1'&&parts.creative)return structuredClone(parts.creative);
  const out={};
  for(const [childKey,value] of Object.entries(node)){
    if(childKey==='creative'&&parts.creative){out[childKey]=structuredClone(parts.creative);continue;}
    if(childKey==='execution'&&parts.execution){out[childKey]=structuredClone(parts.execution);continue;}
    if(childKey==='timeline'&&parts.creative?.timeline){out[childKey]=structuredClone(parts.creative.timeline);continue;}
    if(childKey==='requested_delivery_profile_ids'&&requestedProfileIds.length){out[childKey]=[...requestedProfileIds];continue;}
    if(childKey==='selection_id'){out[childKey]=`i09-${parts.creative?.hook?.provenance?.mode||index}`;continue;}
    if(childKey==='rank'&&Number.isFinite(parts.rank)){out[childKey]=parts.rank;continue;}
    if(childKey==='score'&&Number.isFinite(parts.score)){out[childKey]=parts.score;continue;}
    out[childKey]=adaptNode(value,parts,index,childKey);
  }
  return out;
}

const candidate=structuredClone(template);
candidate.campaign_id=raw.campaign_id||candidate.campaign_id;
if('runtime_mode' in raw)candidate.runtime_mode=raw.runtime_mode;
candidate.reserves=[];
if(chosenProfiles.length)candidate.delivery_profiles=structuredClone(chosenProfiles);
candidate.selected=raw.selected.map((entry,index)=>adaptNode(structuredClone(template.selected[0]),currentParts(entry),index));

const normalized=compileAttempt(candidate);
if(!normalized.ok){
  const diagnostic={
    schema:'newboo-i09-c19-normalization-error-v1',
    raw_error:direct.error,
    normalized_error:normalized.error,
    raw_keys:Object.keys(raw||{}).sort(),
    template_keys:Object.keys(template||{}).sort(),
    raw_selected_keys:Object.keys(raw.selected?.[0]||{}).sort(),
    template_selected_keys:Object.keys(template.selected?.[0]||{}).sort(),
    template_profile_ids:templateProfiles.map(profileId),
    chosen_profile_ids:requestedProfileIds,
  };
  const diagPath=path.join(path.dirname(outPath),'c19-normalization-error.json');
  fs.writeFileSync(diagPath,JSON.stringify(diagnostic,null,2)+'\n');
  console.error(JSON.stringify(diagnostic,null,2));
  process.exitCode=2;
}else{
  if(normalized.pkg?.creatives?.length!==raw.selected.length||normalized.pkg?.render_specs?.length!==raw.selected.length){
    throw new Error(`normalized C19 accounting mismatch: creatives=${normalized.pkg?.creatives?.length}, render_specs=${normalized.pkg?.render_specs?.length}, expected=${raw.selected.length}`);
  }
  fs.writeFileSync(outPath,JSON.stringify(candidate,null,2)+'\n');
  console.log(JSON.stringify({
    status:'PASS',strategy:'canonical-i03-shape-adapter',
    raw_error:direct.error.message,
    package_schema:normalized.pkg?.schema,
    creatives:normalized.pkg?.creatives?.length,
    render_specs:normalized.pkg?.render_specs?.length,
    selected_keys:Object.keys(candidate.selected?.[0]||{}).sort(),
    delivery_profile_ids:requestedProfileIds,
  },null,2));
}
