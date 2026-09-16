#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const outDir=path.resolve(process.argv[2]||'examples/book-ad-systems/generated-c23');
const baseScript=path.resolve('.agents/skills/framewright/scripts/make-c20-fixtures.mjs');
const tmp=path.resolve('examples/book-ad-systems/generated-c23-base');
const r=spawnSync(process.execPath,[baseScript,tmp],{stdio:'inherit'});if(r.status!==0)throw new Error(`C20 fixture generator exited ${r.status}`);
fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});
const source=JSON.parse(fs.readFileSync(path.join(tmp,'manifest.json'),'utf8'));
const seen=new Set(),manifest={schema:'framewright-c23-composition-fixtures-v1',fixtureCount:36,modes:['fixed','adaptive'],items:[]};
for(const item of source.items){
  if(seen.has(item.bookId))continue;seen.add(item.bookId);
  const srcPayload=JSON.parse(fs.readFileSync(path.join(tmp,item.payloadFile),'utf8'));
  const coverName=path.basename(srcPayload.cover_url);fs.copyFileSync(path.join(tmp,coverName),path.join(outDir,coverName));
  for(const mode of manifest.modes){
    const payload={...srcPayload,cover_url:`./generated-c23/${coverName}`,art_direction_mode:'cover',cover_composition_mode:mode,creative_variant:'hook-first',opening_grammar:'hook-led',motion_density:'choreography-v2',delivery_profile:'vertical'};
    const payloadFile=`payload-${item.bookId}-${mode}.json`;fs.writeFileSync(path.join(outDir,payloadFile),JSON.stringify(payload,null,2));
    manifest.items.push({id:`${item.bookId}-${mode}`,bookId:item.bookId,mode,style:item.style,variant:'hook-first',openingGrammar:'hook-led',profile:'vertical',width:1080,height:1920,seed:item.seed,payloadFile});
  }
}
if(seen.size!==36)throw new Error(`expected 36 covers, got ${seen.size}`);
fs.writeFileSync(path.join(outDir,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(`C23 generated ${manifest.items.length} renders: ${seen.size} covers x ${manifest.modes.length} modes`);
