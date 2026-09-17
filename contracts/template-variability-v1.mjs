import { readFileSync } from 'node:fs';
import { sha256Canonical } from './factory-identity-v1.mjs';

export const TEMPLATE_VARIABILITY_REGISTRY_SCHEMA='newboo-template-variability-registry-v1';
export const TEMPLATE_VARIANT_SCHEMA='newboo-template-variant-v1';
export const TEMPLATE_VARIABILITY_AXES=[
  'structural_layout',
  'visual_system',
  'typography',
  'motion_grammar',
  'asset_staging',
  'graphic_devices',
];
export const TEMPLATE_VARIABILITY_ASPECTS=['vertical','square','landscape'];
export const TEMPLATE_VARIABILITY_DURATIONS=[3,5,7,9,12,15];
export const TEMPLATE_VARIABILITY_ROLES=['hook','tension','desire_payoff','book_reveal','cta'];

const SINGLE_AXES=TEMPLATE_VARIABILITY_AXES.filter(axis=>axis!=='graphic_devices');
const OPTION_FIELDS=new Set([
  'id','version','supported_semantic_roles','supported_duration_seconds','supported_aspects','required_asset_kinds','requires',
]);
const REQUIREMENT_FIELDS=new Set(['axis','any_of']);
const SELECTION_FIELDS=new Set(TEMPLATE_VARIABILITY_AXES);
const REGISTRY_FIELDS=new Set(['schema','version','registry_id','axes','legacy_presets']);
const VARIANT_FIELDS=new Set(['schema','registry_id','template_variant_id','axes']);
const ID_RE=/^[a-z][a-z0-9_]{0,95}$/;

function isObject(value){return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function clone(value){return structuredClone(value);}
function add(errors,code,path,message){errors.push({code,path,message});}
function sortErrors(errors){return errors.sort((a,b)=>a.path.localeCompare(b.path)||a.code.localeCompare(b.code)||a.message.localeCompare(b.message));}
function checkUnknown(errors,value,allowed,path){
  if(!isObject(value))return;
  for(const key of Object.keys(value).sort())if(!allowed.has(key))add(errors,'UNKNOWN_FIELD',`${path}/${key}`,`unknown field ${key}`);
}
function duplicateValues(values){
  const seen=new Set(),dupes=new Set();
  for(const value of values){if(seen.has(value))dupes.add(value);seen.add(value);}
  return [...dupes].sort();
}
function normalizeStringArray(values){return [...new Set((values||[]).map(String))].sort();}
function normalizeNumberArray(values){return [...new Set(values||[])].sort((a,b)=>a-b);}
function normalizeRequirement(requirement){return {axis:requirement.axis,any_of:normalizeStringArray(requirement.any_of)};}
function normalizeOption(option){
  return {
    id:option.id,
    version:option.version,
    supported_semantic_roles:normalizeStringArray(option.supported_semantic_roles),
    supported_duration_seconds:normalizeNumberArray(option.supported_duration_seconds),
    supported_aspects:normalizeStringArray(option.supported_aspects),
    required_asset_kinds:normalizeStringArray(option.required_asset_kinds),
    requires:(option.requires||[]).map(normalizeRequirement).sort((a,b)=>a.axis.localeCompare(b.axis)||JSON.stringify(a.any_of).localeCompare(JSON.stringify(b.any_of))),
  };
}
function normalizeSelection(selection){
  const out={};
  for(const axis of SINGLE_AXES)out[axis]=selection?.[axis];
  out.graphic_devices=normalizeStringArray(selection?.graphic_devices||[]);
  return out;
}
function normalizeLegacyPresets(presets){
  return Object.fromEntries(Object.keys(presets||{}).sort().map(key=>[key,normalizeSelection(presets[key])]));
}
function registryIdentityProjection(registry){
  return {
    schema:TEMPLATE_VARIABILITY_REGISTRY_SCHEMA,
    version:registry.version,
    axes:Object.fromEntries(TEMPLATE_VARIABILITY_AXES.map(axis=>[
      axis,
      (registry.axes?.[axis]||[]).map(normalizeOption).sort((a,b)=>a.id.localeCompare(b.id)),
    ])),
    legacy_presets:normalizeLegacyPresets(registry.legacy_presets),
  };
}
export function computeTemplateVariabilityRegistryId(registry){
  return `nbtvr1_${sha256Canonical(registryIdentityProjection(registry))}`;
}
export function computeTemplateVariantId({registry_id,axes}){
  return `nbtv1_${sha256Canonical({schema:TEMPLATE_VARIANT_SCHEMA,registry_id,axes:normalizeSelection(axes)})}`;
}

function validateStringSet(errors,values,path,{allowed=null,nonEmpty=false}={}){
  if(!Array.isArray(values)){add(errors,'TYPE_ARRAY_REQUIRED',path,'expected an array');return;}
  if(nonEmpty&&values.length===0)add(errors,'EMPTY_ARRAY',path,'array must not be empty');
  values.forEach((value,index)=>{
    if(typeof value!=='string'||!value)add(errors,'INVALID_STRING',`${path}/${index}`,'expected a non-empty string');
    else if(allowed&&!allowed.includes(value))add(errors,'VALUE_UNSUPPORTED',`${path}/${index}`,`unsupported value ${value}`);
  });
  for(const value of duplicateValues(values))add(errors,'DUPLICATE_VALUE',path,`duplicate value ${value}`);
}
function validateOption(errors,option,path){
  if(!isObject(option)){add(errors,'TYPE_OBJECT_REQUIRED',path,'option must be an object');return;}
  checkUnknown(errors,option,OPTION_FIELDS,path);
  if(typeof option.id!=='string'||!ID_RE.test(option.id))add(errors,'INVALID_OPTION_ID',`${path}/id`,'option id must match lowercase stable ID grammar');
  if(!Number.isInteger(option.version)||option.version<1)add(errors,'INVALID_VERSION',`${path}/version`,'option version must be a positive integer');
  validateStringSet(errors,option.supported_semantic_roles,`${path}/supported_semantic_roles`,{allowed:TEMPLATE_VARIABILITY_ROLES,nonEmpty:true});
  if(!Array.isArray(option.supported_duration_seconds)||!option.supported_duration_seconds.length)add(errors,'DURATION_SET_REQUIRED',`${path}/supported_duration_seconds`,'supported durations must be a non-empty array');
  else{
    option.supported_duration_seconds.forEach((value,index)=>{
      if(!TEMPLATE_VARIABILITY_DURATIONS.includes(value))add(errors,'DURATION_UNSUPPORTED',`${path}/supported_duration_seconds/${index}`,`unsupported duration ${value}`);
    });
    for(const value of duplicateValues(option.supported_duration_seconds))add(errors,'DUPLICATE_VALUE',`${path}/supported_duration_seconds`,`duplicate duration ${value}`);
  }
  validateStringSet(errors,option.supported_aspects,`${path}/supported_aspects`,{allowed:TEMPLATE_VARIABILITY_ASPECTS,nonEmpty:true});
  validateStringSet(errors,option.required_asset_kinds,`${path}/required_asset_kinds`);
  if(!Array.isArray(option.requires))add(errors,'TYPE_ARRAY_REQUIRED',`${path}/requires`,'requires must be an array');
  else option.requires.forEach((requirement,index)=>{
    const reqPath=`${path}/requires/${index}`;
    if(!isObject(requirement)){add(errors,'TYPE_OBJECT_REQUIRED',reqPath,'requirement must be an object');return;}
    checkUnknown(errors,requirement,REQUIREMENT_FIELDS,reqPath);
    if(!TEMPLATE_VARIABILITY_AXES.includes(requirement.axis))add(errors,'AXIS_UNKNOWN',`${reqPath}/axis`,`unknown axis ${requirement.axis}`);
    validateStringSet(errors,requirement.any_of,`${reqPath}/any_of`,{nonEmpty:true});
  });
}
function optionIndex(registry){
  return Object.fromEntries(TEMPLATE_VARIABILITY_AXES.map(axis=>[axis,new Map((registry.axes?.[axis]||[]).map(option=>[option.id,option]))]));
}
function selectedIds(selection,axis){return axis==='graphic_devices'?(selection.graphic_devices||[]):[selection[axis]];}
function validateSelectionShape(errors,selection,path='/axes'){
  if(!isObject(selection)){add(errors,'TYPE_OBJECT_REQUIRED',path,'axes must be an object');return;}
  checkUnknown(errors,selection,SELECTION_FIELDS,path);
  for(const axis of SINGLE_AXES){
    const value=selection[axis];
    if(typeof value!=='string'||!ID_RE.test(value||''))add(errors,'INVALID_OPTION_ID',`${path}/${axis}`,`${axis} must be a stable option ID`);
  }
  if(!Array.isArray(selection.graphic_devices))add(errors,'TYPE_ARRAY_REQUIRED',`${path}/graphic_devices`,'graphic_devices must be an array');
  else{
    if(selection.graphic_devices.length>8)add(errors,'DEVICE_LIMIT_EXCEEDED',`${path}/graphic_devices`,'at most 8 graphic devices may be selected');
    selection.graphic_devices.forEach((value,index)=>{if(typeof value!=='string'||!ID_RE.test(value||''))add(errors,'INVALID_OPTION_ID',`${path}/graphic_devices/${index}`,'graphic device must be a stable option ID');});
    for(const value of duplicateValues(selection.graphic_devices))add(errors,'DUPLICATE_OPTION',`${path}/graphic_devices`,`duplicate graphic device ${value}`);
  }
}
function validateSelectionAgainstRegistry(registry,selection,path='/axes'){
  const errors=[];
  validateSelectionShape(errors,selection,path);
  if(errors.length)return errors;
  const index=optionIndex(registry);
  for(const axis of TEMPLATE_VARIABILITY_AXES){
    for(const id of selectedIds(selection,axis))if(!index[axis].has(id))add(errors,'OPTION_UNKNOWN',`${path}/${axis}`,`unknown ${axis} option ${id}`);
  }
  if(errors.length)return errors;
  for(const axis of TEMPLATE_VARIABILITY_AXES){
    for(const id of selectedIds(selection,axis)){
      const option=index[axis].get(id);
      for(const requirement of option.requires||[]){
        const chosen=selectedIds(selection,requirement.axis);
        if(!chosen.some(value=>requirement.any_of.includes(value))){
          add(errors,'INCOMPATIBLE_OPTION',`${path}/${axis}`,`${id} requires ${requirement.axis} in [${requirement.any_of.join(', ')}]`);
        }
      }
    }
  }
  return errors;
}

export function validateTemplateVariabilityRegistry(registry,{allowAutoRegistryId=false}={}){
  const errors=[];
  if(!isObject(registry)){return {valid:false,errors:[{code:'TYPE_OBJECT_REQUIRED',path:'',message:'registry must be an object'}]};}
  checkUnknown(errors,registry,REGISTRY_FIELDS,'');
  if(registry.schema!==TEMPLATE_VARIABILITY_REGISTRY_SCHEMA)add(errors,'SCHEMA_VERSION_MISMATCH','/schema',`expected ${TEMPLATE_VARIABILITY_REGISTRY_SCHEMA}`);
  if(registry.version!==1)add(errors,'REGISTRY_VERSION_UNSUPPORTED','/version','registry version must be 1');
  if(!isObject(registry.axes))add(errors,'TYPE_OBJECT_REQUIRED','/axes','axes must be an object');
  else{
    checkUnknown(errors,registry.axes,new Set(TEMPLATE_VARIABILITY_AXES),'/axes');
    for(const axis of TEMPLATE_VARIABILITY_AXES){
      const options=registry.axes[axis];
      if(!Array.isArray(options)||!options.length){add(errors,'AXIS_OPTIONS_REQUIRED',`/axes/${axis}`,`${axis} must have at least one option`);continue;}
      options.forEach((option,index)=>validateOption(errors,option,`/axes/${axis}/${index}`));
      const ids=options.map(option=>option?.id).filter(value=>typeof value==='string');
      for(const id of duplicateValues(ids))add(errors,'DUPLICATE_OPTION_ID',`/axes/${axis}`,`duplicate option id ${id}`);
    }
  }
  if(!isObject(registry.legacy_presets))add(errors,'TYPE_OBJECT_REQUIRED','/legacy_presets','legacy_presets must be an object');
  else for(const preset of Object.keys(registry.legacy_presets).sort()){
    if(!ID_RE.test(preset))add(errors,'INVALID_PRESET_ID',`/legacy_presets/${preset}`,'legacy preset name must match stable ID grammar');
    errors.push(...validateSelectionAgainstRegistry(registry,registry.legacy_presets[preset],`/legacy_presets/${preset}`));
  }
  const expected=computeTemplateVariabilityRegistryId(registry);
  if(registry.registry_id==='auto'){
    if(!allowAutoRegistryId)add(errors,'REGISTRY_ID_UNMATERIALIZED','/registry_id','registry_id must be materialized before use');
  }else if(registry.registry_id!==expected)add(errors,'REGISTRY_ID_MISMATCH','/registry_id',`expected ${expected}`);
  return {valid:errors.length===0,errors:sortErrors(errors),registry_id:expected};
}

export function materializeTemplateVariabilityRegistry(rawRegistry){
  const raw=clone(rawRegistry);
  const preflight=validateTemplateVariabilityRegistry(raw,{allowAutoRegistryId:true});
  if(!preflight.valid)throw new TemplateVariabilityError('REGISTRY_REJECTED',preflight.errors);
  raw.registry_id=preflight.registry_id;
  const finalReport=validateTemplateVariabilityRegistry(raw);
  if(!finalReport.valid)throw new TemplateVariabilityError('REGISTRY_REJECTED',finalReport.errors);
  return raw;
}

export function loadDefaultTemplateVariabilityRegistry(){
  const raw=JSON.parse(readFileSync(new URL('./template-variability-registry.v1.json',import.meta.url),'utf8'));
  return materializeTemplateVariabilityRegistry(raw);
}

export class TemplateVariabilityError extends Error{
  constructor(code,errors){
    super(`Template variability failed: ${code}`);
    this.name='TemplateVariabilityError';
    this.report={valid:false,code,errors:sortErrors(errors||[])};
  }
}

export function materializeTemplateVariant(registry,selection){
  const registryReport=validateTemplateVariabilityRegistry(registry);
  if(!registryReport.valid)throw new TemplateVariabilityError('REGISTRY_REJECTED',registryReport.errors);
  const errors=validateSelectionAgainstRegistry(registry,selection);
  if(errors.length)throw new TemplateVariabilityError('TEMPLATE_VARIANT_REJECTED',errors);
  const axes=normalizeSelection(selection);
  return {
    schema:TEMPLATE_VARIANT_SCHEMA,
    registry_id:registry.registry_id,
    template_variant_id:computeTemplateVariantId({registry_id:registry.registry_id,axes}),
    axes,
  };
}

export function validateTemplateVariant(registry,variant){
  const errors=[];
  const registryReport=validateTemplateVariabilityRegistry(registry);
  if(!registryReport.valid)return {valid:false,code:'REGISTRY_REJECTED',errors:registryReport.errors};
  if(!isObject(variant))return {valid:false,code:'TEMPLATE_VARIANT_REJECTED',errors:[{code:'TYPE_OBJECT_REQUIRED',path:'',message:'template variant must be an object'}]};
  checkUnknown(errors,variant,VARIANT_FIELDS,'');
  if(Object.prototype.hasOwnProperty.call(variant,'delivery_profile')||Object.prototype.hasOwnProperty.call(variant,'delivery_profile_id')){
    add(errors,'DELIVERY_OWNERSHIP_VIOLATION','/delivery_profile','delivery profile is downstream factory metadata and cannot belong to template identity');
  }
  if(variant.schema!==TEMPLATE_VARIANT_SCHEMA)add(errors,'SCHEMA_VERSION_MISMATCH','/schema',`expected ${TEMPLATE_VARIANT_SCHEMA}`);
  if(variant.registry_id!==registry.registry_id)add(errors,'REGISTRY_ID_MISMATCH','/registry_id',`expected ${registry.registry_id}`);
  errors.push(...validateSelectionAgainstRegistry(registry,variant.axes));
  if(errors.length===0){
    const expected=computeTemplateVariantId({registry_id:variant.registry_id,axes:variant.axes});
    if(variant.template_variant_id!==expected)add(errors,'TEMPLATE_VARIANT_ID_MISMATCH','/template_variant_id',`expected ${expected}`);
  }
  return {valid:errors.length===0,code:errors.length?'TEMPLATE_VARIANT_REJECTED':'OK',errors:sortErrors(errors)};
}

export function validateTemplateVariantForContext(registry,variant,context){
  const base=validateTemplateVariant(registry,variant);
  if(!base.valid)return base;
  const errors=[];
  if(!isObject(context))return {valid:false,code:'TEMPLATE_CONTEXT_REJECTED',errors:[{code:'TYPE_OBJECT_REQUIRED',path:'/context',message:'context must be an object'}]};
  const allowed=new Set(['aspect','duration_seconds','semantic_roles','available_asset_kinds']);
  checkUnknown(errors,context,allowed,'/context');
  if(!TEMPLATE_VARIABILITY_ASPECTS.includes(context.aspect))add(errors,'ASPECT_UNSUPPORTED','/context/aspect',`unsupported aspect ${context.aspect}`);
  if(!TEMPLATE_VARIABILITY_DURATIONS.includes(context.duration_seconds))add(errors,'DURATION_UNSUPPORTED','/context/duration_seconds',`unsupported duration ${context.duration_seconds}`);
  validateStringSet(errors,context.semantic_roles,'/context/semantic_roles',{allowed:TEMPLATE_VARIABILITY_ROLES,nonEmpty:true});
  validateStringSet(errors,context.available_asset_kinds,'/context/available_asset_kinds');
  if(errors.length)return {valid:false,code:'TEMPLATE_CONTEXT_REJECTED',errors:sortErrors(errors),template_variant_id:variant.template_variant_id};
  const availableAssets=new Set(context.available_asset_kinds);
  const index=optionIndex(registry);
  for(const axis of TEMPLATE_VARIABILITY_AXES){
    for(const id of selectedIds(variant.axes,axis)){
      const option=index[axis].get(id);
      if(!option.supported_aspects.includes(context.aspect))add(errors,'OPTION_ASPECT_UNSUPPORTED',`/axes/${axis}`,`${id} does not support ${context.aspect}`);
      if(!option.supported_duration_seconds.includes(context.duration_seconds))add(errors,'OPTION_DURATION_UNSUPPORTED',`/axes/${axis}`,`${id} does not support ${context.duration_seconds}s`);
      for(const role of context.semantic_roles)if(!option.supported_semantic_roles.includes(role))add(errors,'OPTION_ROLE_UNSUPPORTED',`/axes/${axis}`,`${id} does not support semantic role ${role}`);
      for(const assetKind of option.required_asset_kinds)if(!availableAssets.has(assetKind))add(errors,'REQUIRED_ASSET_MISSING',`/axes/${axis}`,`${id} requires asset kind ${assetKind}`);
    }
  }
  return {valid:errors.length===0,code:errors.length?'TEMPLATE_CONTEXT_REJECTED':'OK',errors:sortErrors(errors),template_variant_id:variant.template_variant_id};
}

export function legacyTemplateVariant(registry,legacyVisualSystem){
  const selection=registry.legacy_presets?.[legacyVisualSystem];
  if(!selection)throw new TemplateVariabilityError('LEGACY_PRESET_UNKNOWN',[{code:'LEGACY_PRESET_UNKNOWN',path:'/legacy_visual_system',message:`unknown legacy visual system ${legacyVisualSystem}`}]);
  return materializeTemplateVariant(registry,selection);
}
