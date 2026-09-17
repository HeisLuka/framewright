#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {loadSemanticSceneObjectFamilyRegistry,resolveSemanticSceneObject} from '../../../../contracts/semantic-scene-object-families-v1.mjs';

const out=path.resolve(process.argv[2]||'artifacts/c53/corpus');
fs.mkdirSync(path.join(out,'candidates'),{recursive:true});
fs.mkdirSync(path.join(out,'tests'),{recursive:true});
const registry=loadSemanticSceneObjectFamilyRegistry();
const candidateManifest=[],testManifest=[],truth={};
const q=(x)=>Math.round(x*1e6)/1e6;
function perturbed(f,phase){const p={};for(const [k,s] of Object.entries(f.parameters)){if(s.type==='number')p[k]=q(s.min+(s.max-s.min)*phase);else if(s.type==='integer')p[k]=Math.round(s.min+(s.max-s.min)*phase);else if(s.type==='boolean')p[k]=phase>.5?!s.default:s.default;else if(s.type==='enum'){const i=Math.min(s.values.length-1,Math.max(0,Math.floor(phase*s.values.length)));p[k]=s.values[i];}}return p;}
const anchors=[{name:'default',seed:41,params:f=>({})},{name:'low',seed:19,params:f=>perturbed(f,.22)},{name:'high',seed:97,params:f=>perturbed(f,.78)}];
for(const f of registry.families){
  for(const a of anchors){
    const params=a.params(f),program=resolveSemanticSceneObject({family_id:f.id,role:f.supported_roles[0],params,seed:a.seed});
    const cName=`${f.id}--${a.name}.json`;fs.writeFileSync(path.join(out,'candidates',cName),JSON.stringify({program},null,2));
    candidateManifest.push({file:cName,family_id:f.id,domain:f.domain,topology:f.topology,anchor:a.name,seed:a.seed});
  }
  for(const t of [{mode:'same_seed',seed:41,phase:.34},{mode:'cross_seed',seed:73,phase:.67}]){
    const params=perturbed(f,t.phase),program=resolveSemanticSceneObject({family_id:f.id,role:f.supported_roles[0],params,seed:t.seed});
    const id='t_'+crypto.createHash('sha256').update(`${f.id}|${t.mode}|${JSON.stringify(params)}`).digest('hex').slice(0,16),file=`${id}.json`;
    fs.writeFileSync(path.join(out,'tests',file),JSON.stringify({program},null,2));
    testManifest.push({file,id,mode:t.mode});truth[id]={family_id:f.id,domain:f.domain,topology:f.topology,mode:t.mode,seed:t.seed,parameters:params};
  }
}
fs.writeFileSync(path.join(out,'candidate-manifest.json'),JSON.stringify(candidateManifest,null,2));
fs.writeFileSync(path.join(out,'test-manifest.json'),JSON.stringify(testManifest,null,2));
fs.writeFileSync(path.join(out,'truth.json'),JSON.stringify(truth,null,2));
console.log(JSON.stringify({families:registry.families.length,candidates:candidateManifest.length,tests:testManifest.length,out},null,2));
