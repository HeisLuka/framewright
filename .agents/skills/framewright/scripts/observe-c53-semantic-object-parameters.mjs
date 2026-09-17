#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import puppeteer from 'puppeteer';
import {pathToFileURL} from 'node:url';
import {loadSemanticSceneObjectFamilyRegistry,resolveSemanticSceneObject} from '../../../../contracts/semantic-scene-object-families-v1.mjs';

const phase1InferenceFile=path.resolve(process.argv[2]||'.bench/c53/phase-a-inference.json');
const phase1PublicBankFile=path.resolve(process.argv[3]||'.bench/c53/input/public-bank.json');
const phase1CanonicalFile=path.resolve(process.argv[4]||'.bench/c53/run/canonical-artifacts.json');
const phase1RunDir=path.resolve(process.argv[5]||'.bench/c53/run');
const phase2PublicTargetsFile=path.resolve(process.argv[6]||'.bench/c53/phase2-input/public-targets.json');
const phase2CanonicalFile=path.resolve(process.argv[7]||'.bench/c53/phase2-target-run/canonical-artifacts.json');
const phase2RunDir=path.resolve(process.argv[8]||'.bench/c53/phase2-target-run');
const html=path.resolve(process.argv[9]||'examples/book-ad-systems/index-c53-semantic-object.html');
const outFile=path.resolve(process.argv[10]||'.bench/c53/phase2-parameter-inference.json');
const SEED_CANDIDATES=[101,202,303,404];
const MAX_PARAMETER_RESIDUAL=.12,MIN_PARAMETER_MARGIN=.0005;
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
for(const f of [phase1InferenceFile,phase1PublicBankFile,phase1CanonicalFile,phase2PublicTargetsFile,phase2CanonicalFile,html])if(!fs.existsSync(f))throw new Error(`missing parameter observer input ${f}`);
const phase1=read(phase1InferenceFile),bank=read(phase1PublicBankFile),publicTargets=read(phase2PublicTargetsFile),canonical1=read(phase1CanonicalFile),canonical2=read(phase2CanonicalFile);
if(phase1.schema!=='c53-pixel-family-inference-v1'||bank.schema!=='c53-public-family-bank-v1'||publicTargets.schema!=='c53-parameter-target-public-v1')throw new Error('C53 Phase2 input schema');
const registry=loadSemanticSceneObjectFamilyRegistry(),familyById=new Map(registry.families.map(f=>[f.id,f]));
const artifact1=new Map(canonical1.artifacts.map(a=>[a.selection_id,a])),artifact2=new Map(canonical2.artifacts.map(a=>[a.selection_id,a]));
function mp4For(selectionId,artifacts,runDir){const a=artifacts.get(selectionId);if(!a)throw new Error(`artifact missing ${selectionId}`);const f=path.join(runDir,'video',`${a.render_spec_id}.mp4`);if(!fs.existsSync(f))throw new Error(`video missing ${f}`);return f;}
function frameVector(file,flags='area'){
 const p=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-ss','1.5','-i',file,'-frames:v','1','-vf',`scale=64:64:flags=${flags},format=gray`,'-f','rawvideo','pipe:1'],{encoding:null,maxBuffer:8*1024*1024});
 if(p.status!==0)throw new Error(`ffmpeg ${file}: ${String(p.stderr||'')}`);if(p.stdout.length!==4096)throw new Error(`unexpected frame bytes ${file}: ${p.stdout.length}`);return [...p.stdout];
}
const distance=(a,b)=>{let s=0;for(let i=0;i<a.length;i++)s+=Math.abs(a[i]-b[i]);return s/(a.length*255);};
const refVectors=bank.references.map(r=>({...r,vector:frameVector(mp4For(r.selection_id,artifact1,phase1RunDir),'area')}));
const familyIds=[...new Set(refVectors.map(r=>r.family_id))].sort();
function familyGate(vector){
 const scores=[];for(const family_id of familyIds){const ds=refVectors.filter(r=>r.family_id===family_id).map(r=>distance(vector,r.vector)).sort((a,b)=>a-b);const use=ds.slice(0,Math.min(2,ds.length));scores.push({family_id,residual:use.reduce((a,b)=>a+b,0)/use.length});}
 scores.sort((a,b)=>a.residual-b.residual||a.family_id.localeCompare(b.family_id));const best=scores[0],runner=scores[1],margin=runner.residual-best.residual;
 return {state:best.residual<=.18&&margin>=.01?'accepted':'ambiguous',family_id:best.family_id,residual:+best.residual.toFixed(8),margin:+margin.toFixed(8),runner_up:runner.family_id};
}
function candidateValues(spec){
 if(spec.type==='number'){const vals=[];for(let i=0;i<=8;i++)vals.push(Number((spec.min+(spec.max-spec.min)*i/8).toFixed(6)));vals.push(spec.default);return [...new Set(vals)].sort((a,b)=>a-b);}
 if(spec.type==='integer'){const vals=[];for(let v=spec.min;v<=spec.max;v++)vals.push(v);return vals;}
 if(spec.type==='boolean')return [false,true];
 if(spec.type==='enum')return [...spec.values];
 throw new Error(`unsupported parameter type ${spec.type}`);
}
const admissionFamily=new Map(phase1.targets.filter(x=>x.state==='accepted'&&x.accepted_family_id).map(x=>[x.selection_id,x.accepted_family_id]));
const firstFamily=familyById.get(publicTargets.phase1_admissions[0]?.family_id);if(!firstFamily)throw new Error('no admitted family for browser bootstrap');
const firstProgram=resolveSemanticSceneObject({family_id:firstFamily.id,role:firstFamily.supported_roles[0],params:{},seed:SEED_CANDIDATES[0]});
const browser=await puppeteer.launch({headless:true,protocolTimeout:600000,args:process.env.CI?['--no-sandbox','--disable-setuid-sandbox','--allow-file-access-from-files']:['--allow-file-access-from-files']});
const page=await browser.newPage();page.on('pageerror',e=>console.error('PAGE ERROR',e.message));
await page.evaluateOnNewDocument(program=>{window.FRAMEWRIGHT_PAYLOAD={schema:'c53-semantic-object-payload-v1',book_id:'c53-hypothesis-raster',delivery_profile:'vertical',semantic_object_program:program};},firstProgram);
await page.goto(pathToFileURL(html).href,{waitUntil:'load',timeout:120000});await page.waitForFunction('window.__ready===true',{timeout:120000});
async function raster(program){return page.evaluate(program=>{window.__C53_SET_PROGRAM(program);window.RISO.frame(45,1080,0);const src=document.getElementById('c'),small=document.createElement('canvas');small.width=64;small.height=64;const c=small.getContext('2d');c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';c.drawImage(src,0,0,64,64);const d=c.getImageData(0,0,64,64).data,out=new Array(4096);for(let i=0,j=0;i<d.length;i+=4,j++)out[j]=Math.round(.299*d[i]+.587*d[i+1]+.114*d[i+2]);return out;},program);}
const rows=[];
for(const target of publicTargets.targets){
 const familyId=admissionFamily.get(target.source_admission_selection_id);if(!familyId)throw new Error(`missing Phase1 family admission ${target.source_admission_selection_id}`);
 const family=familyById.get(familyId),spec=family?.parameters?.[target.parameter_name];if(!family||!spec)throw new Error(`parameter schema missing ${familyId}/${target.parameter_name}`);
 const targetMp4=mp4For(target.selection_id,artifact2,phase2RunDir),familyVector=frameVector(targetMp4,'area'),fitVector=frameVector(targetMp4,'bicubic');
 const gate=familyGate(familyVector);
 if(gate.state!=='accepted'||gate.family_id!==familyId){rows.push({selection_id:target.selection_id,source_admission_selection_id:target.source_admission_selection_id,parameter_name:target.parameter_name,parameter_type:target.parameter_type,state:'ambiguous',reason:'family_gate',family_gate:gate,inferred:null});continue;}
 const byValue=[];
 for(const value of candidateValues(spec)){
  let best=null;for(const seed of SEED_CANDIDATES){const program=resolveSemanticSceneObject({family_id:familyId,role:family.supported_roles[0],params:{[target.parameter_name]:value},seed});const v=await raster(program),r=distance(fitVector,v);if(!best||r<best.residual)best={value,seed,residual:r,object_program_id:program.object_program_id};}
  byValue.push(best);
 }
 byValue.sort((a,b)=>a.residual-b.residual||String(a.value).localeCompare(String(b.value)));const best=byValue[0],runner=byValue[1],margin=runner?runner.residual-best.residual:1;
 const accepted=best.residual<=MAX_PARAMETER_RESIDUAL&&margin>=MIN_PARAMETER_MARGIN;
 rows.push({selection_id:target.selection_id,source_admission_selection_id:target.source_admission_selection_id,parameter_name:target.parameter_name,parameter_type:target.parameter_type,state:accepted?'accepted':'ambiguous',reason:accepted?null:'parameter_fit',family_gate:gate,inferred:accepted?{family_id:familyId,value:best.value,seed:best.seed,residual:+best.residual.toFixed(8),runner_up_margin:+margin.toFixed(8),object_program_id:best.object_program_id}:null,candidates:byValue.slice(0,5).map(x=>({...x,residual:+x.residual.toFixed(8)}))});
}
await page.close();await browser.close();
const report={schema:'c53-parameter-pixel-inference-v1',seed_candidates:SEED_CANDIDATES,parameter_thresholds:{max_residual:MAX_PARAMETER_RESIDUAL,min_margin:MIN_PARAMETER_MARGIN},targets:rows.length,accepted:rows.filter(x=>x.state==='accepted').length,ambiguous:rows.filter(x=>x.state!=='accepted').length,rows};
fs.mkdirSync(path.dirname(outFile),{recursive:true});fs.writeFileSync(outFile,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,rows:undefined},null,2));
