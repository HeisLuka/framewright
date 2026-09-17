#!/usr/bin/env node
import {
  SEMANTIC_SCENE_OBJECT_FEATURES,
  SEMANTIC_SCENE_OBJECT_OBSERVATION_SCHEMA,
  loadSemanticSceneObjectFamilyRegistry,
  validateSemanticSceneObjectFamilyRegistry,
  resolveSemanticSceneObject,
  validateSemanticSceneObjectProgram,
  fitSemanticSceneObjectCandidates,
  semanticSceneObjectSignatureDistance,
} from '../../../contracts/semantic-scene-object-families-v1.mjs';

const registry=loadSemanticSceneObjectFamilyRegistry();
const validation=validateSemanticSceneObjectFamilyRegistry(registry);
if(!validation.valid)throw new Error(`registry invalid: ${validation.errors.join(',')}`);
if(registry.families.length<22)throw new Error(`expected >=22 families, got ${registry.families.length}`);

function edgeParams(f,mode){const out={};for(const [k,s] of Object.entries(f.parameters)){if(s.type==='number'||s.type==='integer')out[k]=mode==='min'?s.min:s.max;else if(s.type==='boolean')out[k]=mode==='max';else if(s.type==='enum')out[k]=mode==='min'?s.values[0]:s.values.at(-1);}return out;}
const programs=[];
for(const f of registry.families){for(const scenario of [{name:'default',params:{}},{name:'min',params:edgeParams(f,'min')},{name:'max',params:edgeParams(f,'max')}]){const a=resolveSemanticSceneObject({family_id:f.id,role:f.supported_roles[0],params:scenario.params,seed:41}),b=resolveSemanticSceneObject({family_id:f.id,role:f.supported_roles[0],params:scenario.params,seed:41}),v=validateSemanticSceneObjectProgram(a);if(!v.valid)throw new Error(`${f.id}/${scenario.name}: invalid ${v.errors.join(',')}`);if(a.object_program_id!==b.object_program_id||JSON.stringify(a.ops)!==JSON.stringify(b.ops))throw new Error(`${f.id}/${scenario.name}: nondeterministic`);if(!a.ops.length||a.ops.length>f.lowering.max_ops)throw new Error(`${f.id}/${scenario.name}: op budget ${a.ops.length}/${f.lowering.max_ops}`);programs.push({family_id:f.id,scenario:scenario.name,ops:a.ops.length,object_program_id:a.object_program_id});}}

let nearest={distance:Infinity,a:null,b:null};
for(let i=0;i<registry.families.length;i++)for(let j=i+1;j<registry.families.length;j++){const a=registry.families[i],b=registry.families[j],d=semanticSceneObjectSignatureDistance(a.observation_signature,b.observation_signature);if(d<nearest.distance)nearest={distance:d,a:a.id,b:b.id};}
if(nearest.distance<.18)throw new Error(`signature collision ${nearest.a}/${nearest.b}: ${nearest.distance}`);

let state=0x52c0ffee>>>0;const rand=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/0xffffffff;};
let trials=0,accepted=0,correct=0,wrong=0;
const perFamily={};
for(const f of registry.families){const m={trials:0,accepted:0,correct:0};perFamily[f.id]=m;for(let t=0;t<64;t++){const features={};for(const k of SEMANTIC_SCENE_OBJECT_FEATURES){const noise=(rand()*2-1)*.055;features[k]=Math.max(0,Math.min(1,f.observation_signature[k]+noise));}const fit=fitSemanticSceneObjectCandidates({schema:SEMANTIC_SCENE_OBJECT_OBSERVATION_SCHEMA,version:1,features,coverage:.92,residuals:[]});trials++;m.trials++;if(fit.state==='accepted'){accepted++;m.accepted++;if(fit.accepted.value===f.id){correct++;m.correct++;}else wrong++;}}}
if(wrong)throw new Error(`inverse wrong accepted=${wrong}`);
if(accepted/trials<.95)throw new Error(`inverse acceptance too low ${(accepted/trials).toFixed(4)}`);

for(const f of registry.families){const exact=fitSemanticSceneObjectCandidates({schema:SEMANTIC_SCENE_OBJECT_OBSERVATION_SCHEMA,version:1,features:f.observation_signature,coverage:1,residuals:[]});if(exact.state!=='accepted'||exact.accepted.value!==f.id)throw new Error(`${f.id}: exact signature not accepted`);}

const report={schema:'c52-semantic-scene-object-audit-v1',registry_id:validation.registry_id,family_count:registry.families.length,domains:[...new Set(registry.families.map(x=>x.domain))].sort(),nearest_signature_pair:{...nearest,distance:+nearest.distance.toFixed(6)},program_scenarios:programs.length,max_ops_observed:Math.max(...programs.map(x=>x.ops)),inverse_noise:{amplitude:.055,trials,accepted,correct,wrong,acceptance:+(accepted/trials).toFixed(6),accepted_accuracy:accepted?+(correct/accepted).toFixed(6):0,per_family:perFamily}};
console.log(JSON.stringify(report,null,2));
