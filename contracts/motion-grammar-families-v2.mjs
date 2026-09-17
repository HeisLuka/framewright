import { readFileSync } from 'node:fs';
import { sha256Canonical } from './factory-identity-v1.mjs';
import {
  TEMPLATE_VARIABILITY_ASPECTS,
  TEMPLATE_VARIABILITY_DURATIONS,
  TEMPLATE_VARIABILITY_ROLES,
  materializeTemplateVariabilityRegistry,
} from './template-variability-v1.mjs';

export const MOTION_GRAMMAR_FAMILY_REGISTRY_SCHEMA='newboo-motion-grammar-family-registry-v2';
export const MOTION_STATE_SCHEMA='newboo-motion-state-v2';
export const MOTION_TARGETS=['text','asset','cta'];

const SIGNATURES=new Set([
  'editorial_cuts','staggered_type','directional_slide','scale_depth','restrained_parallax','rhythmic_cards',
]);
const TARGET_FIELDS=new Set(['dx','dy','scale_from','rotate_deg','opacity_from']);
const FAMILY_FIELDS=new Set(['id','version','signature','enter_fraction','settle_fraction','text','asset','cta']);

function isObject(value){return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function clone(value){return structuredClone(value);}
function add(errors,code,path,message){errors.push({code,path,message});}
function sortErrors(errors){return errors.sort((a,b)=>a.path.localeCompare(b.path)||a.code.localeCompare(b.code)||a.message.localeCompare(b.message));}
function clamp01(value){return Math.max(0,Math.min(1,value));}
function smoothstep(value){const t=clamp01(value);return t*t*(3-2*t);}
function lerp(a,b,t){return a+(b-a)*t;}
function normalizedSeed(seed){return Number.isInteger(seed)?seed:0;}
function seedDirection(seed,target){
  const salt=target==='text'?11:target==='asset'?23:37;
  return ((Math.abs(normalizedSeed(seed))+salt)%2===0)?1:-1;
}

export function loadMotionGrammarFamilyRegistry(){
  const registry=JSON.parse(readFileSync(new URL('./motion-grammar-families-v2.json',import.meta.url),'utf8'));
  const report=validateMotionGrammarFamilyRegistry(registry);
  if(!report.valid)throw new Error(`invalid C40 motion registry: ${JSON.stringify(report.errors)}`);
  return registry;
}

export function computeMotionGrammarFamilyRegistryId(registry){
  return `c40mr2_${sha256Canonical(registry)}`;
}

export function validateMotionGrammarFamilyRegistry(registry){
  const errors=[];
  if(!isObject(registry))return {valid:false,errors:[{code:'TYPE_OBJECT_REQUIRED',path:'',message:'motion registry must be an object'}]};
  const allowedTop=new Set(['schema','version','families']);
  for(const key of Object.keys(registry).sort())if(!allowedTop.has(key))add(errors,'UNKNOWN_FIELD',`/${key}`,`unknown field ${key}`);
  if(registry.schema!==MOTION_GRAMMAR_FAMILY_REGISTRY_SCHEMA)add(errors,'SCHEMA_VERSION_MISMATCH','/schema',`expected ${MOTION_GRAMMAR_FAMILY_REGISTRY_SCHEMA}`);
  if(registry.version!==2)add(errors,'VERSION_UNSUPPORTED','/version','version must be 2');
  if(!Array.isArray(registry.families)||registry.families.length<6)add(errors,'FAMILY_COUNT_INSUFFICIENT','/families','at least six motion families are required');
  else{
    const ids=[],signatures=[];
    registry.families.forEach((family,index)=>{
      const path=`/families/${index}`;
      if(!isObject(family)){add(errors,'TYPE_OBJECT_REQUIRED',path,'family must be an object');return;}
      for(const key of Object.keys(family).sort())if(!FAMILY_FIELDS.has(key))add(errors,'UNKNOWN_FIELD',`${path}/${key}`,`unknown field ${key}`);
      if(typeof family.id!=='string'||!/^motion_[a-z0-9_]+_v2$/.test(family.id))add(errors,'INVALID_FAMILY_ID',`${path}/id`,'family ID must be stable motion_*_v2'); else ids.push(family.id);
      if(family.version!==2)add(errors,'INVALID_VERSION',`${path}/version`,'family version must be 2');
      if(!SIGNATURES.has(family.signature))add(errors,'SIGNATURE_UNSUPPORTED',`${path}/signature`,`unsupported signature ${family.signature}`); else signatures.push(family.signature);
      if(!(typeof family.enter_fraction==='number'&&family.enter_fraction>=0&&family.enter_fraction<0.25))add(errors,'ENTER_FRACTION_INVALID',`${path}/enter_fraction`,'enter_fraction must be in [0, 0.25)');
      if(!(typeof family.settle_fraction==='number'&&family.settle_fraction>family.enter_fraction&&family.settle_fraction<=0.5))add(errors,'SETTLE_FRACTION_INVALID',`${path}/settle_fraction`,'settle_fraction must be > enter_fraction and <= 0.5');
      for(const target of MOTION_TARGETS){
        const config=family[target],targetPath=`${path}/${target}`;
        if(!isObject(config)){add(errors,'TYPE_OBJECT_REQUIRED',targetPath,`${target} config must be an object`);continue;}
        for(const key of Object.keys(config).sort())if(!TARGET_FIELDS.has(key))add(errors,'UNKNOWN_FIELD',`${targetPath}/${key}`,`unknown field ${key}`);
        for(const key of ['dx','dy','rotate_deg'])if(typeof config[key]!=='number'||!Number.isFinite(config[key]))add(errors,'INVALID_NUMBER',`${targetPath}/${key}`,`${key} must be finite`);
        if(!(typeof config.scale_from==='number'&&config.scale_from>=0.8&&config.scale_from<=1.1))add(errors,'SCALE_INVALID',`${targetPath}/scale_from`,'scale_from must be in [0.8, 1.1]');
        if(!(typeof config.opacity_from==='number'&&config.opacity_from>=0&&config.opacity_from<=1))add(errors,'OPACITY_INVALID',`${targetPath}/opacity_from`,'opacity_from must be in [0, 1]');
        if(typeof config.dx==='number'&&Math.abs(config.dx)>80)add(errors,'MOTION_OFFSET_EXCESSIVE',`${targetPath}/dx`,'|dx| must be <= 80 normalized units');
        if(typeof config.dy==='number'&&Math.abs(config.dy)>80)add(errors,'MOTION_OFFSET_EXCESSIVE',`${targetPath}/dy`,'|dy| must be <= 80 normalized units');
        if(typeof config.rotate_deg==='number'&&Math.abs(config.rotate_deg)>5)add(errors,'ROTATION_EXCESSIVE',`${targetPath}/rotate_deg`,'|rotate_deg| must be <= 5');
      }
    });
    if(new Set(ids).size!==ids.length)add(errors,'DUPLICATE_FAMILY_ID','/families','motion family IDs must be unique');
    if(new Set(signatures).size!==signatures.length)add(errors,'DUPLICATE_SIGNATURE','/families','motion signatures must be unique');
  }
  return {valid:errors.length===0,errors:sortErrors(errors),registry_id:errors.length?null:computeMotionGrammarFamilyRegistryId(registry)};
}

export function extendRegistryWithMotionGrammars(baseRegistry,familyRegistry=loadMotionGrammarFamilyRegistry()){
  if(!baseRegistry)throw new Error('base C38 template registry required');
  const familyReport=validateMotionGrammarFamilyRegistry(familyRegistry);
  if(!familyReport.valid)throw new Error(`invalid motion registry: ${JSON.stringify(familyReport.errors)}`);
  const next=clone(baseRegistry);
  next.registry_id='auto';
  const existing=new Set(next.axes.motion_grammar.map(option=>option.id));
  for(const family of familyRegistry.families){
    if(existing.has(family.id))throw new Error(`motion grammar option already exists: ${family.id}`);
    next.axes.motion_grammar.push({
      id:family.id,
      version:family.version,
      supported_semantic_roles:[...TEMPLATE_VARIABILITY_ROLES],
      supported_duration_seconds:[...TEMPLATE_VARIABILITY_DURATIONS],
      supported_aspects:[...TEMPLATE_VARIABILITY_ASPECTS],
      required_asset_kinds:[],
      requires:[],
    });
  }
  return materializeTemplateVariabilityRegistry(next);
}

export function motionTargetsForRole(role){
  if(!TEMPLATE_VARIABILITY_ROLES.includes(role))throw new Error(`unsupported semantic role ${role}`);
  if(role==='book_reveal')return ['text','asset'];
  if(role==='cta')return ['cta','asset'];
  return ['text'];
}

export function resolveMotionState({family_id,role,target,progress,seed=0}){
  const registry=loadMotionGrammarFamilyRegistry();
  const family=registry.families.find(item=>item.id===family_id);
  if(!family)throw new Error(`unknown motion family ${family_id}`);
  if(!TEMPLATE_VARIABILITY_ROLES.includes(role))throw new Error(`unsupported semantic role ${role}`);
  if(!MOTION_TARGETS.includes(target))throw new Error(`unsupported motion target ${target}`);
  if(!motionTargetsForRole(role).includes(target))throw new Error(`target ${target} is not active for semantic role ${role}`);
  if(!(typeof progress==='number'&&Number.isFinite(progress)&&progress>=0&&progress<=1))throw new Error('progress must be in [0,1]');
  const config=family[target];
  const direction=family.signature==='restrained_parallax'||family.signature==='rhythmic_cards'?seedDirection(seed,target):1;
  let t;
  if(family.signature==='editorial_cuts')t=progress<family.enter_fraction?0:1;
  else if(progress<=family.enter_fraction)t=0;
  else if(progress>=family.settle_fraction)t=1;
  else t=smoothstep((progress-family.enter_fraction)/(family.settle_fraction-family.enter_fraction));
  const state={
    schema:MOTION_STATE_SCHEMA,
    family_id:family.id,
    family_version:family.version,
    role,
    target,
    progress:Number(progress.toFixed(6)),
    seed:normalizedSeed(seed),
    transform:{
      dx:Number(lerp(config.dx*direction,0,t).toFixed(6)),
      dy:Number(lerp(config.dy,0,t).toFixed(6)),
      scale:Number(lerp(config.scale_from,1,t).toFixed(6)),
      rotate_deg:Number(lerp(config.rotate_deg*direction,0,t).toFixed(6)),
      opacity:Number(lerp(config.opacity_from,1,t).toFixed(6)),
    },
  };
  state.motion_state_id=`c40ms2_${sha256Canonical(state)}`;
  return state;
}

export function applyMotionToBox(box,state){
  if(!isObject(box))throw new Error('target box required');
  if(!state?.transform)throw new Error('motion state required');
  const {dx,dy,scale,rotate_deg,opacity}=state.transform;
  const cx=box.x+box.w/2+dx,cy=box.y+box.h/2+dy;
  const w=box.w*scale,h=box.h*scale;
  return {
    x:Number((cx-w/2).toFixed(6)),
    y:Number((cy-h/2).toFixed(6)),
    w:Number(w.toFixed(6)),
    h:Number(h.toFixed(6)),
    rotate_deg,
    opacity,
  };
}

export function motionTrajectoryFingerprint({family_id,role,target,seed=0,samples=[0,0.1,0.2,0.3,0.4,0.5,0.75,1]}){
  const states=samples.map(progress=>resolveMotionState({family_id,role,target,progress,seed}));
  return `c40traj2_${sha256Canonical(states.map(state=>({progress:state.progress,transform:state.transform})))}`;
}

export function validateMotionSettledState(state,tolerance=1e-9){
  const transform=state?.transform;
  if(!transform)return false;
  return Math.abs(transform.dx)<=tolerance&&Math.abs(transform.dy)<=tolerance&&Math.abs(transform.scale-1)<=tolerance&&Math.abs(transform.rotate_deg)<=tolerance&&Math.abs(transform.opacity-1)<=tolerance;
}
