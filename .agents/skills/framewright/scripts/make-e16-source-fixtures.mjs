#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const outDir=path.resolve(process.argv[2]||'examples/book-ad-systems/generated-e16');
const e14Dir=path.resolve('examples/book-ad-systems/generated-e14');
const e14Script=path.resolve('.agents/skills/framewright/scripts/make-e14-variant-fixtures.mjs');
const r=spawnSync(process.execPath,[e14Script,e14Dir],{stdio:'inherit'});
if(r.status!==0)throw new Error(`E14 fixtures exited ${r.status}`);
fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});
const e14=JSON.parse(fs.readFileSync(path.join(e14Dir,'manifest.json'),'utf8'));
const wanted=['river-station','city-seven','long-title'];
const items=[];
for(const bookId of wanted){
  const source=e14.items.find(x=>x.bookId===bookId&&x.variant==='hook-first');
  if(!source)throw new Error(`missing hook-first source for ${bookId}`);
  items.push({...source,payloadFile:`../generated-e14/${path.basename(source.payloadFile)}`});
}
const manifest={schema:'framewright-e16-source-v1',purpose:'representative routed-primary hook-first creatives for raster format-adaptation probe',items};
fs.writeFileSync(path.join(outDir,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(`E16 selected ${items.length} source creatives: ${items.map(x=>`${x.bookId}/${x.style}`).join(', ')}`);
