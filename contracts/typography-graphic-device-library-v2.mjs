import { readFileSync } from 'node:fs';
import { sha256Canonical } from './factory-identity-v1.mjs';
import {
  TEMPLATE_VARIABILITY_ASPECTS,
  TEMPLATE_VARIABILITY_DURATIONS,
  TEMPLATE_VARIABILITY_ROLES,
  materializeTemplateVariabilityRegistry,
} from './template-variability-v1.mjs';

export const TYPOGRAPHY_DEVICE_LIBRARY_SCHEMA='newboo-typography-graphic-device-library-v2';
export const TYPOGRAPHY_FIT_SCHEMA='newboo-typography-fit-v2';
export const GRAPHIC_DEVICE_STATE_SCHEMA='newboo-graphic-device-state-v2';

const FONT_STACKS=new Set(['dejavu_sans_pinned_v1','dejavu_mono_pinned_v1']);
const DEVICE_KINDS=new Set(['rule_pair','solid_block','label_chip','counter_badge','quote_marks','underline_bar','corner_brackets','stamp_ring','side_panel']);
const DEVICE_LAYERS=new Set(['adjacent','behind','overlay_nondestructive']);
const SLOT_NAMES=new Set(['primary_text','secondary_text','cover','cta','meta']);
const TYPE_FIELDS=new Set(['id','version','font_stack_id','legacy_c25_system','width_factor','display_scale','body_scale','label_scale','display_weight','body_weight','label_weight','measure_scale','line_height','tracking_em','min_font_size']);
const DEVICE_FIELDS=new Set(['id','version','kind','anchor_slot','layer','area_budget','occlusion_budget']);
const LIBRARY_FIELDS=new Set(['schema','version','type_systems','graphic_devices']);
const SAFE_AREA=1_000_000;

function isObject(value){return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function clone(value){return structuredClone(value);}
function add(errors,code,path,message){errors.push({code,path,message});}
function sortErrors(errors){return errors.sort((a,b)=>a.path.localeCompare(b.path)||a.code.localeCompare(b.code)||a.message.localeCompare(b.message));}
function finiteBetween(value,min,max){return typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;}
function box(x,y,w,h){return {x:Number(x.toFixed(6)),y:Number(y.toFixed(6)),w:Number(w.toFixed(6)),h:Number(h.toFixed(6))};}
function inset(value,pad){return box(value.x+pad,value.y+pad,Math.max(1,value.w-pad*2),Math.max(1,value.h-pad*2));}
function totalArea(segments){return segments.reduce((sum,item)=>sum+item.w*item.h,0);}
function inside(inner,outer,tolerance=1e-6){return inner.x>=outer.x-tolerance&&inner.y>=outer.y-tolerance&&inner.x+inner.w<=outer.x+outer.w+tolerance&&inner.y+inner.h<=outer.y+outer.h+tolerance;}
function roleClass(role){
  if(role==='hook'||role==='tension'||role==='desire_payoff')return 'display';
  if(role==='cta')return 'label';
  return 'body';
}
function roleBaseSize(role){
  if(role==='hook')return 78;
  if(role==='tension'||role==='desire_payoff')return 62;
  if(role==='book_reveal')return 50;
  if(role==='cta')return 34;
  throw new Error(`unsupported semantic role ${role}`);
}
function roleMaxLines(role){
  if(role==='hook')return 7;
  if(role==='tension'||role==='desire_payoff')return 7;
  if(role==='book_reveal')return 5;
  if(role==='cta')return 2;
  throw new Error(`unsupported semantic role ${role}`);
}
function charFactor(char,system){
  if(/\s/u.test(char))return 0.34;
  if(/[.,:;!?…'"«»()\[\]{}\-–—/\\]/u.test(char))return 0.34;
  if(/[0-9]/u.test(char))return system.width_factor*0.96;
  if(/[A-ZА-ЯЁ]/u.test(char))return system.width_factor*1.08;
  return system.width_factor;
}
function textWidth(text,fontSize,system){
  const chars=Array.from(String(text));
  const glyph=chars.reduce((sum,char)=>sum+charFactor(char,system)*fontSize,0);
  const tracking=Math.max(0,chars.length-1)*system.tracking_em*fontSize;
  return glyph+tracking;
}
function splitLongToken(token,maxWidth,fontSize,system){
  const parts=[];
  let current='';
  for(const char of Array.from(token)){
    const candidate=current+char;
    if(current&&textWidth(candidate,fontSize,system)>maxWidth){parts.push(current);current=char;}else current=candidate;
  }
  if(current)parts.push(current);
  return parts;
}
function wrapText(text,maxWidth,fontSize,system){
  const rawWords=String(text).trim().split(/\s+/u).filter(Boolean);
  if(!rawWords.length)return [''];
  const words=[];
  for(const word of rawWords){
    if(textWidth(word,fontSize,system)<=maxWidth)words.push(word);
    else words.push(...splitLongToken(word,maxWidth,fontSize,system));
  }
  const lines=[];
  let line='';
  for(const word of words){
    const candidate=line?`${line} ${word}`:word;
    if(line&&textWidth(candidate,fontSize,system)>maxWidth){lines.push(line);line=word;}else line=candidate;
  }
  if(line)lines.push(line);
  return lines;
}

export function loadTypographyGraphicDeviceLibrary(){
  const library=JSON.parse(readFileSync(new URL('./typography-graphic-device-library-v2.json',import.meta.url),'utf8'));
  const report=validateTypographyGraphicDeviceLibrary(library);
  if(!report.valid)throw new Error(`invalid C41 library: ${JSON.stringify(report.errors)}`);
  return library;
}

export function computeTypographyGraphicDeviceLibraryId(library){return `c41lib2_${sha256Canonical(library)}`;}

export function validateTypographyGraphicDeviceLibrary(library){
  const errors=[];
  if(!isObject(library))return {valid:false,errors:[{code:'TYPE_OBJECT_REQUIRED',path:'',message:'library must be an object'}]};
  for(const key of Object.keys(library).sort())if(!LIBRARY_FIELDS.has(key))add(errors,'UNKNOWN_FIELD',`/${key}`,`unknown field ${key}`);
  if(library.schema!==TYPOGRAPHY_DEVICE_LIBRARY_SCHEMA)add(errors,'SCHEMA_VERSION_MISMATCH','/schema',`expected ${TYPOGRAPHY_DEVICE_LIBRARY_SCHEMA}`);
  if(library.version!==2)add(errors,'VERSION_UNSUPPORTED','/version','version must be 2');
  if(!Array.isArray(library.type_systems)||library.type_systems.length<5)add(errors,'TYPE_SYSTEM_COUNT_INSUFFICIENT','/type_systems','at least five type systems are required');
  else{
    const ids=[];
    library.type_systems.forEach((system,index)=>{
      const path=`/type_systems/${index}`;
      if(!isObject(system)){add(errors,'TYPE_OBJECT_REQUIRED',path,'type system must be an object');return;}
      for(const key of Object.keys(system).sort())if(!TYPE_FIELDS.has(key))add(errors,'UNKNOWN_FIELD',`${path}/${key}`,`unknown field ${key}`);
      if(typeof system.id!=='string'||!/^type_[a-z0-9_]+_v2$/.test(system.id))add(errors,'INVALID_TYPE_SYSTEM_ID',`${path}/id`,'type system ID must match type_*_v2');else ids.push(system.id);
      if(system.version!==2)add(errors,'INVALID_VERSION',`${path}/version`,'type system version must be 2');
      if(!FONT_STACKS.has(system.font_stack_id))add(errors,'FONT_STACK_UNSUPPORTED',`${path}/font_stack_id`,`unsupported font stack ${system.font_stack_id}`);
      if(system.legacy_c25_system!==null&&!['baseline','display-led','editorial','compact-dense'].includes(system.legacy_c25_system))add(errors,'LEGACY_C25_SYSTEM_INVALID',`${path}/legacy_c25_system`,'legacy C25 system must be known or null');
      for(const [key,min,max] of [['width_factor',0.4,0.72],['display_scale',0.6,1.7],['body_scale',0.65,1.3],['label_scale',0.6,1.3],['measure_scale',0.6,1.05],['line_height',0.82,1.3],['tracking_em',-0.05,0.1]])if(!finiteBetween(system[key],min,max))add(errors,'TOKEN_OUT_OF_RANGE',`${path}/${key}`,`${key} must be in [${min}, ${max}]`);
      for(const key of ['display_weight','body_weight','label_weight'])if(![400,500,600,650,700,800].includes(system[key]))add(errors,'WEIGHT_UNSUPPORTED',`${path}/${key}`,`${key} is not a bounded weight token`);
      if(!Number.isInteger(system.min_font_size)||system.min_font_size<12||system.min_font_size>22)add(errors,'MIN_FONT_SIZE_INVALID',`${path}/min_font_size`,'min_font_size must be integer 12..22');
    });
    if(new Set(ids).size!==ids.length)add(errors,'DUPLICATE_TYPE_SYSTEM_ID','/type_systems','type system IDs must be unique');
  }
  if(!Array.isArray(library.graphic_devices)||library.graphic_devices.length<8)add(errors,'DEVICE_COUNT_INSUFFICIENT','/graphic_devices','at least eight graphic devices are required');
  else{
    const ids=[],kinds=[];
    library.graphic_devices.forEach((device,index)=>{
      const path=`/graphic_devices/${index}`;
      if(!isObject(device)){add(errors,'TYPE_OBJECT_REQUIRED',path,'graphic device must be an object');return;}
      for(const key of Object.keys(device).sort())if(!DEVICE_FIELDS.has(key))add(errors,'UNKNOWN_FIELD',`${path}/${key}`,`unknown field ${key}`);
      if(typeof device.id!=='string'||!/^device_[a-z0-9_]+_v2$/.test(device.id))add(errors,'INVALID_DEVICE_ID',`${path}/id`,'device ID must match device_*_v2');else ids.push(device.id);
      if(device.version!==2)add(errors,'INVALID_VERSION',`${path}/version`,'device version must be 2');
      if(!DEVICE_KINDS.has(device.kind))add(errors,'DEVICE_KIND_UNSUPPORTED',`${path}/kind`,`unsupported device kind ${device.kind}`);else kinds.push(device.kind);
      if(!SLOT_NAMES.has(device.anchor_slot))add(errors,'ANCHOR_SLOT_UNSUPPORTED',`${path}/anchor_slot`,`unsupported anchor slot ${device.anchor_slot}`);
      if(!DEVICE_LAYERS.has(device.layer))add(errors,'DEVICE_LAYER_UNSUPPORTED',`${path}/layer`,`unsupported layer ${device.layer}`);
      if(!finiteBetween(device.area_budget,0.005,0.1))add(errors,'AREA_BUDGET_INVALID',`${path}/area_budget`,'area_budget must be in [0.005,0.1]');
      if(!finiteBetween(device.occlusion_budget,0,0.05))add(errors,'OCCLUSION_BUDGET_INVALID',`${path}/occlusion_budget`,'occlusion_budget must be in [0,0.05]');
      if(device.layer==='overlay_nondestructive'&&device.occlusion_budget<=0)add(errors,'OCCLUSION_BUDGET_REQUIRED',`${path}/occlusion_budget`,'overlay devices need positive occlusion budget');
    });
    if(new Set(ids).size!==ids.length)add(errors,'DUPLICATE_DEVICE_ID','/graphic_devices','device IDs must be unique');
    if(new Set(kinds).size!==kinds.length)add(errors,'DUPLICATE_DEVICE_KIND','/graphic_devices','device kinds must be unique in v2');
  }
  return {valid:errors.length===0,errors:sortErrors(errors),library_id:errors.length?null:computeTypographyGraphicDeviceLibraryId(library)};
}

export function fitTypography({library=loadTypographyGraphicDeviceLibrary(),system_id,role,text,target_box}){
  const system=library.type_systems.find(item=>item.id===system_id);
  if(!system)throw new Error(`unknown type system ${system_id}`);
  if(!TEMPLATE_VARIABILITY_ROLES.includes(role))throw new Error(`unsupported semantic role ${role}`);
  if(typeof text!=='string'||!text.trim())throw new Error('text must be a non-empty string');
  if(!isObject(target_box)||['x','y','w','h'].some(key=>!Number.isFinite(target_box[key])||target_box[key]<=0&&['w','h'].includes(key)))throw new Error('valid target_box required');
  const klass=roleClass(role);
  const scale=klass==='display'?system.display_scale:klass==='label'?system.label_scale:system.body_scale;
  const weight=klass==='display'?system.display_weight:klass==='label'?system.label_weight:system.body_weight;
  const maxWidth=Math.max(1,target_box.w*system.measure_scale);
  const maxLines=roleMaxLines(role);
  const start=Math.max(system.min_font_size,Math.round(roleBaseSize(role)*scale));
  let chosen=null;
  for(let fontSize=start;fontSize>=system.min_font_size;fontSize-=1){
    const lines=wrapText(text,maxWidth,fontSize,system);
    const lineHeightPx=fontSize*system.line_height;
    const height=lines.length*lineHeightPx;
    const widest=Math.max(...lines.map(line=>textWidth(line,fontSize,system)));
    if(lines.length<=maxLines&&height<=target_box.h&&widest<=maxWidth+1e-6){chosen={fontSize,lines,lineHeightPx,height,widest};break;}
  }
  if(!chosen){
    const fontSize=system.min_font_size,lines=wrapText(text,maxWidth,fontSize,system),lineHeightPx=fontSize*system.line_height;
    chosen={fontSize,lines,lineHeightPx,height:lines.length*lineHeightPx,widest:Math.max(...lines.map(line=>textWidth(line,fontSize,system)))};
  }
  const overflow=chosen.lines.length>maxLines||chosen.height>target_box.h+1e-6||chosen.widest>maxWidth+1e-6;
  const result={
    schema:TYPOGRAPHY_FIT_SCHEMA,
    system_id:system.id,
    system_version:system.version,
    font_stack_id:system.font_stack_id,
    role,
    text,
    target_box:clone(target_box),
    tokens:{font_size:chosen.fontSize,weight,line_height:system.line_height,tracking_em:system.tracking_em,measure_scale:system.measure_scale},
    lines:chosen.lines,
    measured:{line_count:chosen.lines.length,widest:Number(chosen.widest.toFixed(6)),height:Number(chosen.height.toFixed(6)),max_width:Number(maxWidth.toFixed(6)),max_height:target_box.h},
    overflow,
  };
  result.fit_id=`c41fit2_${sha256Canonical(result)}`;
  return result;
}

function segmentsForDevice(device,anchor){
  const a=inset(anchor,Math.min(8,anchor.w*0.02,anchor.h*0.08));
  const t=Math.max(3,Math.min(10,a.h*0.07,a.w*0.015));
  switch(device.kind){
    case 'rule_pair': return [box(a.x,a.y,a.w*0.62,t),box(a.x+a.w*0.38,a.y+a.h-t,a.w*0.62,t)];
    case 'solid_block': return [box(a.x,a.y+a.h*0.78,a.w,a.h*0.22)];
    case 'label_chip': return [box(a.x,a.y,Math.min(a.w*0.42,260),Math.min(a.h,42))];
    case 'counter_badge': {const s=Math.min(a.w,a.h,52);return [box(a.x+a.w-s,a.y,s,s)];}
    case 'quote_marks': {const s=Math.min(42,a.w*0.08,a.h*0.14);return [box(a.x,a.y,s,s),box(a.x+a.w-s,a.y+a.h-s,s,s)];}
    case 'underline_bar': return [box(a.x,a.y+a.h-t,a.w*0.48,t)];
    case 'corner_brackets': {const l=Math.min(50,a.w*0.15,a.h*0.15),q=Math.max(3,t*0.65);return [box(a.x,a.y,l,q),box(a.x,a.y,q,l),box(a.x+a.w-l,a.y,l,q),box(a.x+a.w-q,a.y,q,l),box(a.x,a.y+a.h-q,l,q),box(a.x,a.y+a.h-l,q,l),box(a.x+a.w-l,a.y+a.h-q,l,q),box(a.x+a.w-q,a.y+a.h-l,q,l)];}
    case 'stamp_ring': {const s=Math.min(72,a.w*0.28,a.h*0.28);return [box(a.x+a.w-s,a.y,s,s)];}
    case 'side_panel': return [box(a.x,a.y,Math.min(18,a.w*0.08),a.h)];
    default: throw new Error(`unsupported device kind ${device.kind}`);
  }
}

export function resolveGraphicDevice({library=loadTypographyGraphicDeviceLibrary(),device_id,layout}){
  const device=library.graphic_devices.find(item=>item.id===device_id);
  if(!device)throw new Error(`unknown graphic device ${device_id}`);
  const anchor=layout?.slots?.[device.anchor_slot];
  if(!isObject(anchor))throw new Error(`layout missing anchor slot ${device.anchor_slot}`);
  const segments=segmentsForDevice(device,anchor);
  const areaRatio=totalArea(segments)/SAFE_AREA;
  const state={
    schema:GRAPHIC_DEVICE_STATE_SCHEMA,
    device_id:device.id,
    device_version:device.version,
    kind:device.kind,
    anchor_slot:device.anchor_slot,
    layer:device.layer,
    area_budget:device.area_budget,
    occlusion_budget:device.occlusion_budget,
    segments,
    measured:{area_ratio:Number(areaRatio.toFixed(8)),occlusion_ratio:Number((device.layer==='overlay_nondestructive'?areaRatio:0).toFixed(8))},
  };
  state.device_state_id=`c41dev2_${sha256Canonical(state)}`;
  return state;
}

export function validateGraphicDeviceState(state,layout){
  const errors=[];
  if(!isObject(state))return {valid:false,errors:[{code:'TYPE_OBJECT_REQUIRED',path:'',message:'device state must be an object'}]};
  const anchor=layout?.slots?.[state.anchor_slot];
  if(!isObject(anchor))add(errors,'ANCHOR_SLOT_MISSING','/anchor_slot',`layout missing ${state.anchor_slot}`);
  if(!Array.isArray(state.segments)||!state.segments.length)add(errors,'SEGMENTS_REQUIRED','/segments','device needs at least one segment');
  else if(anchor){
    state.segments.forEach((segment,index)=>{
      if(!inside(segment,anchor))add(errors,'DEVICE_LEAVES_ANCHOR',`/segments/${index}`,`segment leaves ${state.anchor_slot}`);
      if(segment.x<0||segment.y<0||segment.x+segment.w>1000||segment.y+segment.h>1000)add(errors,'SAFE_ZONE_VIOLATION',`/segments/${index}`,'device segment leaves normalized safe space');
    });
  }
  if(state.measured?.area_ratio>state.area_budget+1e-8)add(errors,'AREA_BUDGET_EXCEEDED','/measured/area_ratio','device exceeds declared area budget');
  if(state.layer==='overlay_nondestructive'&&state.measured?.occlusion_ratio>state.occlusion_budget+1e-8)add(errors,'OCCLUSION_BUDGET_EXCEEDED','/measured/occlusion_ratio','overlay exceeds declared occlusion budget');
  const expected=errors.length?null:`c41dev2_${sha256Canonical({...state,device_state_id:undefined})}`;
  if(expected&&state.device_state_id!==expected)add(errors,'DEVICE_STATE_ID_MISMATCH','/device_state_id',`expected ${expected}`);
  return {valid:errors.length===0,errors:sortErrors(errors)};
}

export function extendRegistryWithTypographyAndDevices(baseRegistry,library=loadTypographyGraphicDeviceLibrary()){
  if(!baseRegistry)throw new Error('base C38 template registry required');
  const report=validateTypographyGraphicDeviceLibrary(library);
  if(!report.valid)throw new Error(`invalid C41 library: ${JSON.stringify(report.errors)}`);
  const next=clone(baseRegistry);
  next.registry_id='auto';
  const existingTypes=new Set(next.axes.typography.map(option=>option.id));
  const existingDevices=new Set(next.axes.graphic_devices.map(option=>option.id));
  for(const system of library.type_systems){
    if(existingTypes.has(system.id))throw new Error(`typography option already exists: ${system.id}`);
    next.axes.typography.push({id:system.id,version:system.version,supported_semantic_roles:[...TEMPLATE_VARIABILITY_ROLES],supported_duration_seconds:[...TEMPLATE_VARIABILITY_DURATIONS],supported_aspects:[...TEMPLATE_VARIABILITY_ASPECTS],required_asset_kinds:[],requires:[]});
  }
  for(const device of library.graphic_devices){
    if(existingDevices.has(device.id))throw new Error(`graphic device option already exists: ${device.id}`);
    next.axes.graphic_devices.push({id:device.id,version:device.version,supported_semantic_roles:[...TEMPLATE_VARIABILITY_ROLES],supported_duration_seconds:[...TEMPLATE_VARIABILITY_DURATIONS],supported_aspects:[...TEMPLATE_VARIABILITY_ASPECTS],required_asset_kinds:[],requires:[]});
  }
  return materializeTemplateVariabilityRegistry(next);
}
