#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const outDir=path.resolve(process.argv[2]||'examples/book-ad-systems/generated-r47');
const e14Dir=path.resolve('examples/book-ad-systems/generated-e14');
const makeE14=path.resolve('.agents/skills/framewright/scripts/make-e14-variant-fixtures.mjs');
const r=spawnSync(process.execPath,[makeE14,e14Dir],{stdio:'inherit'});
if(r.status!==0) throw new Error(`E14 fixtures exited ${r.status}`);

fs.rmSync(outDir,{recursive:true,force:true});
fs.mkdirSync(outDir,{recursive:true});
const e14=JSON.parse(fs.readFileSync(path.join(e14Dir,'manifest.json'),'utf8'));
const books=['river-station','letters','city-seven','observatory','long-title','night-archive'];
const profile={id:'vertical',width:1080,height:1920};
const manifest={schema:'nightwill-r47-catalog-bitrate-fixtures-v1',profiles:[profile],items:[]};

for(const source of e14.items.filter(x=>books.includes(x.bookId)&&x.variant==='hook-first')){
  const base=JSON.parse(fs.readFileSync(path.join(e14Dir,source.payloadFile),'utf8'));
  const payload={...base,delivery_profile:profile.id,motion_density:'active'};
  const payloadFile=`payload-${source.bookId}-${source.style}-${source.variant}-${profile.id}.json`;
  fs.writeFileSync(path.join(outDir,payloadFile),JSON.stringify(payload,null,2));
  manifest.items.push({
    id:`${source.bookId}-${source.style}-${source.variant}-${profile.id}`,
    bookId:source.bookId,
    style:source.style,
    variant:source.variant,
    profile:profile.id,
    width:profile.width,
    height:profile.height,
    seed:source.seed,
    payloadFile,
  });
}

const missing=books.filter(bookId=>!manifest.items.some(x=>x.bookId===bookId));
if(missing.length) throw new Error(`missing R47 fixtures: ${missing.join(', ')}`);
for(const style of ['paper','swiss','newspaper']){
  const count=manifest.items.filter(x=>x.style===style).length;
  if(count<2) throw new Error(`need >=2 ${style} fixtures, got ${count}`);
}

fs.writeFileSync(path.join(outDir,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(`R47 generated ${manifest.items.length} hook-first vertical fixtures: ${books.join(', ')}`);
