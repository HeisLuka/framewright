#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const outDir=path.resolve(process.argv[2]||'examples/book-ad-systems/generated-e17');
const e14Dir=path.resolve('examples/book-ad-systems/generated-e14');
const makeE14=path.resolve('.agents/skills/framewright/scripts/make-e14-variant-fixtures.mjs');
const r=spawnSync(process.execPath,[makeE14,e14Dir],{stdio:'inherit'});if(r.status!==0)throw new Error(`E14 fixtures exited ${r.status}`);
fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});
const e14=JSON.parse(fs.readFileSync(path.join(e14Dir,'manifest.json'),'utf8'));
const wanted=['river-station','city-seven','long-title'];
const profiles=[{id:'vertical',width:1080,height:1920},{id:'square',width:1080,height:1080},{id:'landscape',width:1920,height:1080}];
const manifest={schema:'framewright-e17-responsive-v1',profiles,items:[]};
for(const bookId of wanted){
  const source=e14.items.find(x=>x.bookId===bookId&&x.variant==='hook-first');if(!source)throw new Error(`missing ${bookId}`);
  const base=JSON.parse(fs.readFileSync(path.join(e14Dir,source.payloadFile),'utf8'));
  for(const p of profiles){
    const payload={...base,delivery_profile:p.id,creative_variant:'hook-first',motion_density:'active'};
    const payloadFile=`payload-${bookId}-${source.style}-${p.id}.json`;fs.writeFileSync(path.join(outDir,payloadFile),JSON.stringify(payload,null,2));
    manifest.items.push({id:`${bookId}-${source.style}-${p.id}`,bookId,style:source.style,variant:'hook-first',profile:p.id,width:p.width,height:p.height,seed:source.seed,payloadFile});
  }
}
fs.writeFileSync(path.join(outDir,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(`E17 generated ${manifest.items.length} renders: ${wanted.length} systems x ${profiles.length} delivery profiles`);
