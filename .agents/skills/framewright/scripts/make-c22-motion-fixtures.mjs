#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const outDir=path.resolve(process.argv[2]||'examples/book-ad-systems/generated-c22');
const routedDir=path.resolve('examples/book-ad-systems/generated-e13-c22');
const routedScript=path.resolve('.agents/skills/framewright/scripts/make-e13-routed-fixtures.mjs');
const r=spawnSync(process.execPath,[routedScript,routedDir],{stdio:'inherit'});
if(r.status!==0)throw new Error(`E13 routed fixtures exited ${r.status}`);
fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});

const routed=JSON.parse(fs.readFileSync(path.join(routedDir,'manifest.json'),'utf8'));
const primary=routed.items.filter(x=>x.rank===1);
if(primary.length!==10)throw new Error(`expected 10 routed-primary books, got ${primary.length}`);
const MODES=[
  {id:'e12-active',motion_density:'active'},
  {id:'c22-v2',motion_density:'choreography-v2'}
];
const manifest={schema:'framewright-c22-motion-fixtures-v1',books:primary.length,modes:MODES,items:[]};
for(let i=0;i<primary.length;i++){
  const source=primary[i],payload=JSON.parse(fs.readFileSync(path.join(routedDir,source.payloadFile),'utf8')),n=String(i+1).padStart(2,'0');
  for(const mode of MODES){
    const p={...payload,creative_variant:'hook-first',opening_grammar:'hook-led',art_direction_mode:'cover',delivery_profile:'vertical',motion_density:mode.motion_density};
    const payloadFile=`payload-${n}-${mode.id}-${source.style}.json`;
    fs.writeFileSync(path.join(outDir,payloadFile),JSON.stringify(p,null,2));
    manifest.items.push({id:`${source.bookId}-${mode.id}-${source.style}`,bookId:source.bookId,mode:mode.id,style:source.style,variant:'hook-first',openingGrammar:'hook-led',profile:'vertical',width:1080,height:1920,seed:source.seed,payloadFile});
  }
}
fs.writeFileSync(path.join(outDir,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(`C22 generated ${manifest.items.length} videos: ${primary.length} books x ${MODES.length} motion modes`);
for(const bookId of [...new Set(manifest.items.map(x=>x.bookId))]){
  const xs=manifest.items.filter(x=>x.bookId===bookId);console.log(`${bookId}: ${xs[0].style} seed=${xs[0].seed} -> ${xs.map(x=>x.mode).join(', ')}`);
}
