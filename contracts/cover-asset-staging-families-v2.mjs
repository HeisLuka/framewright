import { readFileSync } from 'node:fs';
import { sha256Canonical } from './factory-identity-v1.mjs';
import {
  TEMPLATE_VARIABILITY_ASPECTS,
  TEMPLATE_VARIABILITY_DURATIONS,
  TEMPLATE_VARIABILITY_ROLES,
  materializeTemplateVariabilityRegistry,
} from './template-variability-v1.mjs';

export const COVER_STAGING_REGISTRY_SCHEMA='newboo-cover-asset-staging-family-registry-v2';
export const COVER_STAGING_STATE_SCHEMA='newboo-cover-asset-staging-state-v2';
const MODES=new Set(['hero_cover','partial_crop_detail','depth_stack','edge_peek','repeated_card_motif','floating_tilt']);
const FAMILY_FIELDS=new Set(['id','version','mode','max_instances','max_rotation_deg','max_content_scale','clip_required']);
const REGISTRY_FIELDS=new Set(['schema','version','families']);
const ASSET_FIELDS=new Set(['asset_id','kind','sha256','width','height']);

function isObject(value){return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function clone(value){return structuredClone(value);}
function add(errors,code,path,message){errors.push({code,path,message});}
function sortErrors(errors){return errors.sort((a,b)=>a.path.localeCompare(b.path)||a.code.localeCompare(b.code)||a.message.localeCompare(b.message));}
function box(x,y,w,h){return {x:Number(x.toFixed(6)),y:Number(y.toFixed(6)),w:Number(w.toFixed(6)),h:Number(h.toFixed(6))};}
function inset(slot,xRatio,yRatio=xRatio){return box(slot.x+slot.w*xRatio,slot.y+slot.h*yRatio,slot.w*(1-xRatio*2),slot.h*(1-yRatio*2));}
function inside(inner,outer,t=1e-6){return inner.x>=outer.x-t&&inner.y>=outer.y-t&&inner.x+inner.w<=outer.x+outer.w+t&&inner.y+inner.h<=outer.y+outer.h+t;}
function seededSign(seed,salt=0){return ((Math.abs(Number.isInteger(seed)?seed:0)+salt)%2===0)?1:-1;}

export function loadCoverAssetStagingFamilyRegistry(){
  const registry=JSON.parse(readFileSync(new URL('./cover-asset-staging-families-v2.json',import.meta.url),'utf8'));
  const report=validateCoverAssetStagingFamilyRegistry(registry);
  if(!report.valid)throw new Error(`invalid C42 staging registry: ${JSON.stringify(report.errors)}`);
  return registry;
}
export function computeCoverAssetStagingFamilyRegistryId(registry){return `c42sr2_${sha256Canonical(registry)}`;}

export function validateCoverAssetStagingFamilyRegistry(registry){
  const errors=[];
  if(!isObject(registry))return {valid:false,errors:[{code:'TYPE_OBJECT_REQUIRED',path:'',message:'staging registry must be an object'}]};
  for(const key of Object.keys(registry).sort())if(!REGISTRY_FIELDS.has(key))add(errors,'UNKNOWN_FIELD',`/${key}`,`unknown field ${key}`);
  if(registry.schema!==COVER_STAGING_REGISTRY_SCHEMA)add(errors,'SCHEMA_VERSION_MISMATCH','/schema',`expected ${COVER_STAGING_REGISTRY_SCHEMA}`);
  if(registry.version!==2)add(errors,'VERSION_UNSUPPORTED','/version','version must be 2');
  if(!Array.isArray(registry.families)||registry.families.length<6)add(errors,'FAMILY_COUNT_INSUFFICIENT','/families','at least six staging families are required');
  else{
    const ids=[],modes=[];
    registry.families.forEach((family,index)=>{
      const path=`/families/${index}`;
      if(!isObject(family)){add(errors,'TYPE_OBJECT_REQUIRED',path,'family must be an object');return;}
      for(const key of Object.keys(family).sort())if(!FAMILY_FIELDS.has(key))add(errors,'UNKNOWN_FIELD',`${path}/${key}`,`unknown field ${key}`);
      if(typeof family.id!=='string'||!/^stage_[a-z0-9_]+_v2$/.test(family.id))add(errors,'INVALID_FAMILY_ID',`${path}/id`,'family ID must match stage_*_v2');else ids.push(family.id);
      if(family.version!==2)add(errors,'INVALID_VERSION',`${path}/version`,'family version must be 2');
      if(!MODES.has(family.mode))add(errors,'MODE_UNSUPPORTED',`${path}/mode`,`unsupported mode ${family.mode}`);else modes.push(family.mode);
      if(!Number.isInteger(family.max_instances)||family.max_instances<1||family.max_instances>3)add(errors,'INSTANCE_LIMIT_INVALID',`${path}/max_instances`,'max_instances must be 1..3');
      if(typeof family.max_rotation_deg!=='number'||family.max_rotation_deg<0||family.max_rotation_deg>5)add(errors,'ROTATION_LIMIT_INVALID',`${path}/max_rotation_deg`,'max_rotation_deg must be 0..5');
      if(typeof family.max_content_scale!=='number'||family.max_content_scale<0.6||family.max_content_scale>1.4)add(errors,'SCALE_LIMIT_INVALID',`${path}/max_content_scale`,'max_content_scale must be 0.6..1.4');
      if(typeof family.clip_required!=='boolean')add(errors,'CLIP_FLAG_INVALID',`${path}/clip_required`,'clip_required must be boolean');
    });
    if(new Set(ids).size!==ids.length)add(errors,'DUPLICATE_FAMILY_ID','/families','family IDs must be unique');
    if(new Set(modes).size!==modes.length)add(errors,'DUPLICATE_MODE','/families','v2 staging modes must be unique');
  }
  return {valid:errors.length===0,errors:sortErrors(errors),registry_id:errors.length?null:computeCoverAssetStagingFamilyRegistryId(registry)};
}

export function validateTrustedCoverAsset(asset){
  const errors=[];
  if(!isObject(asset))return {valid:false,errors:[{code:'TYPE_OBJECT_REQUIRED',path:'/asset',message:'trusted cover asset must be an object'}]};
  for(const key of Object.keys(asset).sort())if(!ASSET_FIELDS.has(key))add(errors,'UNKNOWN_FIELD',`/asset/${key}`,`unknown asset field ${key}`);
  if(typeof asset.asset_id!=='string'||!/^asset_[a-z0-9_\-]{1,96}$/.test(asset.asset_id))add(errors,'ASSET_ID_INVALID','/asset/asset_id','asset_id must be stable server-owned ID');
  if(asset.kind!=='cover')add(errors,'ASSET_KIND_INVALID','/asset/kind','only trusted cover assets are supported');
  if(typeof asset.sha256!=='string'||!/^[a-f0-9]{64}$/.test(asset.sha256))add(errors,'ASSET_SHA_INVALID','/asset/sha256','cover SHA-256 required');
  if(!Number.isInteger(asset.width)||asset.width<64||asset.width>10000)add(errors,'ASSET_WIDTH_INVALID','/asset/width','width must be integer 64..10000');
  if(!Number.isInteger(asset.height)||asset.height<64||asset.height>10000)add(errors,'ASSET_HEIGHT_INVALID','/asset/height','height must be integer 64..10000');
  return {valid:errors.length===0,errors:sortErrors(errors)};
}

export function classifyCoverShape(asset){
  const ratio=asset.width/asset.height;
  return ratio<0.78?'portrait':ratio>1.22?'wide':'squareish';
}

function placement(frame,{rotation_deg=0,content_scale=1,opacity=1,z=0,crop=null}={}){
  return {frame:clone(frame),rotation_deg:Number(rotation_deg.toFixed(6)),content_scale:Number(content_scale.toFixed(6)),opacity:Number(opacity.toFixed(6)),z,crop};
}
function resolvePlacements(family,slot,shape,seed){
  const sign=seededSign(seed,13);
  switch(family.mode){
    case 'hero_cover': return [placement(inset(slot,0.06,0.04),{z:2})];
    case 'partial_crop_detail': return [placement(clone(slot),{content_scale:shape==='portrait'?1.28:1.35,z:2,crop:{mode:'cover',focus_x:shape==='wide'?0.45:0.5,focus_y:shape==='portrait'?0.42:0.5}})];
    case 'depth_stack': {
      const front=inset(slot,0.12,0.08),back1=box(front.x+slot.w*0.055,front.y+slot.h*0.035,front.w,front.h),back2=box(front.x-slot.w*0.045,front.y+slot.h*0.065,front.w,front.h);
      const candidates=[placement(back2,{rotation_deg:-3*sign,opacity:0.48,z:0}),placement(back1,{rotation_deg:2*sign,opacity:0.68,z:1}),placement(front,{rotation_deg:0,z:2})];
      return candidates.filter(item=>inside(item.frame,slot));
    }
    case 'edge_peek': {
      const w=slot.w*0.72,h=slot.h*0.9,x=sign>0?slot.x+slot.w-w:slot.x,y=slot.y+slot.h*0.05;
      return [placement(box(x,y,w,h),{rotation_deg:1.5*sign,content_scale:1.08,z:2,crop:{mode:'cover',focus_x:sign>0?0.62:0.38,focus_y:0.5}})];
    }
    case 'repeated_card_motif': {
      const w=slot.w*0.54,h=slot.h*0.72;
      const frames=[box(slot.x+slot.w*0.04,slot.y+slot.h*0.14,w,h),box(slot.x+slot.w*0.23,slot.y+slot.h*0.08,w,h),box(slot.x+slot.w*0.42,slot.y+slot.h*0.14,w,h)];
      return frames.map((frame,index)=>placement(frame,{rotation_deg:(index-1)*2.5,content_scale:0.82,opacity:index===1?1:0.72,z:index})).filter(item=>inside(item.frame,slot));
    }
    case 'floating_tilt': return [placement(inset(slot,0.12,0.09),{rotation_deg:4.5*sign,content_scale:0.94,z:2})];
    default: throw new Error(`unsupported staging mode ${family.mode}`);
  }
}

export function resolveCoverAssetStaging({registry=loadCoverAssetStagingFamilyRegistry(),family_id,layout,asset,seed=0}){
  const assetReport=validateTrustedCoverAsset(asset);
  if(!assetReport.valid)throw new Error(`untrusted/invalid cover asset: ${JSON.stringify(assetReport.errors)}`);
  const family=registry.families.find(item=>item.id===family_id);
  if(!family)throw new Error(`unknown staging family ${family_id}`);
  const slot=layout?.slots?.cover;
  if(!isObject(slot))throw new Error('layout cover slot required');
  const shape=classifyCoverShape(asset);
  const placements=resolvePlacements(family,slot,shape,seed);
  if(!placements.length)throw new Error(`${family_id} produced no safe cover placement`);
  const state={
    schema:COVER_STAGING_STATE_SCHEMA,
    family_id:family.id,
    family_version:family.version,
    mode:family.mode,
    asset:{asset_id:asset.asset_id,kind:'cover',sha256:asset.sha256,width:asset.width,height:asset.height,shape},
    seed:Number.isInteger(seed)?seed:0,
    clip_to_cover_slot:family.clip_required,
    placements,
    fallback:{requires_only_asset_kind:'cover',single_asset_safe:true},
  };
  state.staging_state_id=`c42stage2_${sha256Canonical(state)}`;
  return state;
}

export function validateCoverAssetStagingState(state,layout,registry=loadCoverAssetStagingFamilyRegistry()){
  const errors=[];
  if(!isObject(state))return {valid:false,errors:[{code:'TYPE_OBJECT_REQUIRED',path:'',message:'staging state must be an object'}]};
  const family=registry.families.find(item=>item.id===state.family_id);
  if(!family)add(errors,'FAMILY_UNKNOWN','/family_id',`unknown family ${state.family_id}`);
  const slot=layout?.slots?.cover;
  if(!isObject(slot))add(errors,'COVER_SLOT_MISSING','/layout','cover slot missing');
  if(!isObject(state.asset))add(errors,'TYPE_OBJECT_REQUIRED','/asset','derived asset state must be an object');
  else{
    const {shape,...trustedAsset}=state.asset;
    const assetReport=validateTrustedCoverAsset(trustedAsset);
    if(!assetReport.valid)errors.push(...assetReport.errors);
    if(!['portrait','squareish','wide'].includes(shape))add(errors,'COVER_SHAPE_INVALID','/asset/shape',`invalid derived cover shape ${shape}`);
    else if(assetReport.valid&&shape!==classifyCoverShape(trustedAsset))add(errors,'COVER_SHAPE_MISMATCH','/asset/shape',`expected ${classifyCoverShape(trustedAsset)}`);
  }
  if(!Array.isArray(state.placements)||!state.placements.length)add(errors,'PLACEMENT_REQUIRED','/placements','at least one placement required');
  else if(family&&slot){
    if(state.placements.length>family.max_instances)add(errors,'INSTANCE_LIMIT_EXCEEDED','/placements',`maximum ${family.max_instances} instances allowed`);
    for(const [index,item] of state.placements.entries()){
      const path=`/placements/${index}`;
      if(!isObject(item)||!isObject(item.frame)){add(errors,'PLACEMENT_INVALID',path,'placement frame required');continue;}
      if(!inside(item.frame,slot))add(errors,'PLACEMENT_LEAVES_COVER_SLOT',`${path}/frame`,'cover placement must remain inside C39 cover slot');
      if(Math.abs(item.rotation_deg)>family.max_rotation_deg+1e-6)add(errors,'ROTATION_LIMIT_EXCEEDED',`${path}/rotation_deg`,'rotation exceeds family limit');
      if(item.content_scale>family.max_content_scale+1e-6)add(errors,'SCALE_LIMIT_EXCEEDED',`${path}/content_scale`,'content scale exceeds family limit');
      if(item.opacity<0||item.opacity>1)add(errors,'OPACITY_INVALID',`${path}/opacity`,'opacity must be 0..1');
    }
    if(Boolean(state.clip_to_cover_slot)!==family.clip_required)add(errors,'CLIP_POLICY_MISMATCH','/clip_to_cover_slot','clip policy must match family');
  }
  if(state.fallback?.single_asset_safe!==true)add(errors,'SINGLE_ASSET_FALLBACK_REQUIRED','/fallback/single_asset_safe','every family must be safe with one trusted cover');
  if(errors.length===0){
    const {staging_state_id,...projection}=state;
    const expected=`c42stage2_${sha256Canonical(projection)}`;
    if(staging_state_id!==expected)add(errors,'STAGING_STATE_ID_MISMATCH','/staging_state_id',`expected ${expected}`);
  }
  return {valid:errors.length===0,errors:sortErrors(errors)};
}

export function extendRegistryWithCoverStagingFamilies(baseRegistry,registry=loadCoverAssetStagingFamilyRegistry()){
  if(!baseRegistry)throw new Error('base C38 template registry required');
  const report=validateCoverAssetStagingFamilyRegistry(registry);
  if(!report.valid)throw new Error(`invalid staging registry: ${JSON.stringify(report.errors)}`);
  const next=clone(baseRegistry);next.registry_id='auto';
  const existing=new Set(next.axes.asset_staging.map(option=>option.id));
  for(const family of registry.families){
    if(existing.has(family.id))throw new Error(`asset staging option already exists: ${family.id}`);
    next.axes.asset_staging.push({id:family.id,version:family.version,supported_semantic_roles:[...TEMPLATE_VARIABILITY_ROLES],supported_duration_seconds:[...TEMPLATE_VARIABILITY_DURATIONS],supported_aspects:[...TEMPLATE_VARIABILITY_ASPECTS],required_asset_kinds:['cover'],requires:[]});
  }
  return materializeTemplateVariabilityRegistry(next);
}
