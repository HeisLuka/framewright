#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const outDir=path.resolve(process.argv[2]||'examples/book-ad-systems/generated-e12');
const e11Dir=path.resolve('examples/book-ad-systems/generated-e11');
const e11Script=path.resolve('.agents/skills/framewright/scripts/make-e11-fixtures.mjs');
const r=spawnSync(process.execPath,[e11Script,e11Dir],{stdio:'inherit'});
if(r.status!==0) throw new Error(`E11 fixture generator exited ${r.status}`);
fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});
const base=JSON.parse(fs.readFileSync(path.join(e11Dir,'manifest.json'),'utf8'));
const modes=['baseline','active'];
const manifest={schema:'framewright-e12-motion-grammar-v1',modes,styles:base.styles,items:[]};
for(const source of base.items){
  const payload=JSON.parse(fs.readFileSync(path.join(e11Dir,source.payloadFile),'utf8'));
  for(const mode of modes){
    const p={...payload,motion_density:mode};
    const payloadFile=`payload-${mode}-${source.style}-${source.bookId}.json`;
    fs.writeFileSync(path.join(outDir,payloadFile),JSON.stringify(p,null,2));
    manifest.items.push({id:`${mode}-${source.style}-${source.bookId}`,mode,style:source.style,bookId:source.bookId,seed:source.seed,payloadFile});
  }
}
fs.writeFileSync(path.join(outDir,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(`generated ${manifest.items.length} payloads: ${base.styles.length} systems x ${base.items.length/base.styles.length} books x ${modes.length} modes`);
