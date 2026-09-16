#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const outDir=path.resolve(process.argv[2]||'examples/book-ad-systems/generated-e18');
const e14Dir=path.resolve('examples/book-ad-systems/generated-e14');
const makeE14=path.resolve('.agents/skills/framewright/scripts/make-e14-variant-fixtures.mjs');
const r=spawnSync(process.execPath,[makeE14,e14Dir],{stdio:'inherit'});if(r.status!==0)throw new Error(`E14 fixtures exited ${r.status}`);
fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});
const e14=JSON.parse(fs.readFileSync(path.join(e14Dir,'manifest.json'),'utf8'));
const books=['river-station','city-seven','long-title'];
const profiles=[{id:'vertical',width:1080,height:1920},{id:'square',width:1080,height:1080},{id:'landscape',width:1920,height:1080}];
const manifest={schema:'framewright-e18-responsive-variants-v1',profiles,items:[]};
for(const source of e14.items.filter(x=>books.includes(x.bookId))){
  const base=JSON.parse(fs.readFileSync(path.join(e14Dir,source.payloadFile),'utf8'));
  for(const p of profiles){
    const payload={...base,delivery_profile:p.id,motion_density:'active'};
    const payloadFile=`payload-${source.bookId}-${source.style}-${source.variant}-${p.id}.json`;fs.writeFileSync(path.join(outDir,payloadFile),JSON.stringify(payload,null,2));
    manifest.items.push({id:`${source.bookId}-${source.style}-${source.variant}-${p.id}`,bookId:source.bookId,style:source.style,variant:source.variant,profile:p.id,width:p.width,height:p.height,seed:source.seed,payloadFile});
  }
}
fs.writeFileSync(path.join(outDir,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(`E18 generated ${manifest.items.length} renders: ${books.length} books x 4 variants x ${profiles.length} profiles`);
