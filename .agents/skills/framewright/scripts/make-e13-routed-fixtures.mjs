#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const outDir=path.resolve(process.argv[2]||'examples/book-ad-systems/generated-e13');
const e08Dir=path.resolve('examples/book-ad-v0/generated-e08');
const e08Script=path.resolve('.agents/skills/framewright/scripts/make-e08-fixtures.mjs');
const r=spawnSync(process.execPath,[e08Script,e08Dir],{stdio:'inherit'});if(r.status!==0)throw new Error(`E08 fixtures exited ${r.status}`);
fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});
const base=JSON.parse(fs.readFileSync(path.join(e08Dir,'manifest.json'),'utf8'));

// E13 taxonomy stands in for ordinary catalog metadata. It is deliberately explicit and deterministic.
// Production can source the same fields from the book catalog / editorial metadata; no model is required at render time.
const META={
  'night-archive':{genre:'literary',tone:['atmospheric','reflective'],pace:'slow',objective:'intrigue'},
  'salt':{genre:'literary',tone:['tense','minimal'],pace:'medium',objective:'intrigue'},
  'winter-map':{genre:'literary',tone:['atmospheric','mystery'],pace:'medium',objective:'intrigue'},
  'river-station':{genre:'mystery',tone:['atmospheric','surreal'],pace:'medium',objective:'suspense'},
  'city-seven':{genre:'dystopia',tone:['tense','graphic'],pace:'fast',objective:'suspense'},
  'letters':{genre:'family-drama',tone:['emotional','intimate'],pace:'slow',objective:'emotion'},
  'observatory':{genre:'science-fiction',tone:['mystery','technical'],pace:'fast',objective:'suspense'},
  'long-title':{genre:'contemporary',tone:['reflective','literary'],pace:'slow',objective:'voice'},
  'quotes':{genre:'literary',tone:['intimate','mystery'],pace:'slow',objective:'intrigue'},
  'zero-hour':{genre:'thriller',tone:['tense','dark'],pace:'fast',objective:'suspense'}
};
const SYSTEMS=['swiss','newspaper','paper'];
function add(scores,reasons,system,n,reason){scores[system]+=n;reasons[system].push(`${n>=0?'+':''}${n} ${reason}`);}
function route(payload,meta){
  const scores={swiss:0,newspaper:0,paper:0},reasons={swiss:[],newspaper:[],paper:[]};
  const g=meta.genre,t=new Set(meta.tone),titleLen=payload.title.length,hookLen=payload.hook.length;
  if(['thriller','dystopia','science-fiction'].includes(g)){add(scores,reasons,'swiss',5,`genre:${g}`);add(scores,reasons,'newspaper',1,'structured commercial alternate');}
  if(['literary','contemporary'].includes(g)){add(scores,reasons,'newspaper',5,`genre:${g}`);add(scores,reasons,'paper',2,'tactile literary alternate');}
  if(['family-drama','mystery'].includes(g)){add(scores,reasons,'paper',5,`genre:${g}`);add(scores,reasons,'newspaper',2,'editorial alternate');}
  if(t.has('technical')||t.has('graphic'))add(scores,reasons,'swiss',3,'technical/graphic tone');
  if(t.has('reflective')||t.has('literary'))add(scores,reasons,'newspaper',3,'reflective/literary tone');
  if(t.has('emotional')||t.has('intimate')||t.has('atmospheric'))add(scores,reasons,'paper',2,'emotional/intimate/atmospheric tone');
  if(meta.pace==='fast')add(scores,reasons,'swiss',2,'fast pace');
  if(meta.pace==='slow'){add(scores,reasons,'newspaper',1,'slow pace');add(scores,reasons,'paper',1,'slow pace');}
  if(titleLen>42)add(scores,reasons,'newspaper',2,'long title');
  if(titleLen<18)add(scores,reasons,'swiss',1,'short title');
  if(hookLen>105)add(scores,reasons,'newspaper',1,'long hook');
  if(meta.objective==='emotion')add(scores,reasons,'paper',3,'emotion objective');
  if(meta.objective==='suspense')add(scores,reasons,'swiss',2,'suspense objective');
  const ranked=SYSTEMS.map(system=>({system,score:scores[system],reasons:reasons[system]})).sort((a,b)=>b.score-a.score||SYSTEMS.indexOf(a.system)-SYSTEMS.indexOf(b.system));
  return ranked;
}

const manifest={schema:'framewright-e13-routed-variants-v1',styles:SYSTEMS,items:[]};
const report={schema:'framewright-e13-router-v1',books:[]};
for(let i=0;i<base.items.length;i++){
  const item=base.items[i],payload=JSON.parse(fs.readFileSync(path.join(e08Dir,item.payloadFile),'utf8')),meta=META[item.id];
  if(!meta)throw new Error(`missing E13 metadata for ${item.id}`);
  const ranked=route(payload,meta);report.books.push({bookId:item.id,meta,titleLength:payload.title.length,hookLength:payload.hook.length,ranked});
  for(let rank=0;rank<ranked.length;rank++){
    const choice=ranked[rank],n=String(i+1).padStart(2,'0');
    const p={...payload,cover_url:`../book-ad-v0/generated-e08/${path.basename(payload.cover_url)}`,visual_system:choice.system,motion_density:'active',creative_rank:rank+1,route_reason:choice.reasons.join('; ')};
    const payloadFile=`payload-${n}-r${rank+1}-${choice.system}.json`;fs.writeFileSync(path.join(outDir,payloadFile),JSON.stringify(p,null,2));
    manifest.items.push({id:`${item.id}-r${rank+1}-${choice.system}`,bookId:item.id,rank:rank+1,style:choice.system,seed:item.seed+rank*101,payloadFile});
  }
}
fs.writeFileSync(path.join(outDir,'manifest.json'),JSON.stringify(manifest,null,2));
fs.writeFileSync(path.join(outDir,'route-report.json'),JSON.stringify(report,null,2));
console.log(`E13 routed ${base.items.length} books into ${manifest.items.length} ranked creatives`);
for(const b of report.books)console.log(`${b.bookId}: ${b.ranked.map(x=>`${x.system}(${x.score})`).join(' > ')}`);
