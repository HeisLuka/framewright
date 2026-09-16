#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const outDir=path.resolve(process.argv[2]||'examples/book-ad-systems/generated-r51');
const e14Dir=path.resolve('examples/book-ad-systems/generated-e14');
const makeE14=path.resolve('.agents/skills/framewright/scripts/make-e14-variant-fixtures.mjs');
const r=spawnSync(process.execPath,[makeE14,e14Dir],{stdio:'inherit'});
if(r.status!==0) throw new Error(`E14 fixtures exited ${r.status}`);
fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});
const e14=JSON.parse(fs.readFileSync(path.join(e14Dir,'manifest.json'),'utf8'));
const calibration=['river-station','letters','city-seven','observatory','long-title','night-archive'];
const heldOut=['salt','winter-map','quotes','zero-hour'];
const books=[...calibration,...heldOut];
const profile={id:'vertical',width:1080,height:1920};
const manifest={schema:'nightwill-r51-codec-acceptance-fixtures-v1',profiles:[profile],calibration,heldOut,items:[]};
for(const source of e14.items.filter(x=>books.includes(x.bookId)&&x.variant==='hook-first')){
  const base=JSON.parse(fs.readFileSync(path.join(e14Dir,source.payloadFile),'utf8'));
  const payload={...base,delivery_profile:profile.id,motion_density:'active'};
  const payloadFile=`payload-${source.bookId}-${source.style}-hook-first-vertical.json`;
  fs.writeFileSync(path.join(outDir,payloadFile),JSON.stringify(payload,null,2));
  manifest.items.push({id:`${source.bookId}-${source.style}-hook-first-vertical`,bookId:source.bookId,style:source.style,variant:'hook-first',profile:'vertical',width:1080,height:1920,seed:source.seed,payloadFile,set:heldOut.includes(source.bookId)?'heldout':'calibration'});
}
const missing=books.filter(b=>!manifest.items.some(x=>x.bookId===b));if(missing.length)throw new Error(`missing R51 fixtures: ${missing.join(', ')}`);
if(manifest.items.length!==10)throw new Error(`expected 10 fixtures, got ${manifest.items.length}`);
fs.writeFileSync(path.join(outDir,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(`R51 generated ${manifest.items.length} fixtures; held-out fixed before evidence: ${heldOut.join(', ')}`);
