#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const outDir=path.resolve(process.argv[2]||'examples/book-ad-systems/generated-e11');
const e08Dir=path.resolve('examples/book-ad-v0/generated-e08');
const e08Script=path.resolve('.agents/skills/framewright/scripts/make-e08-fixtures.mjs');
const r=spawnSync(process.execPath,[e08Script,e08Dir],{stdio:'inherit'});
if(r.status!==0) throw new Error(`E08 fixture generator exited ${r.status}`);
fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});
const base=JSON.parse(fs.readFileSync(path.join(e08Dir,'manifest.json'),'utf8'));
const styles=['swiss','newspaper','paper'];
const manifest={schema:'framewright-e11-visual-systems-v1',styles,items:[]};
for(const style of styles){
  for(let i=0;i<base.items.length;i++){
    const item=base.items[i];
    const payload=JSON.parse(fs.readFileSync(path.join(e08Dir,item.payloadFile),'utf8'));
    payload.visual_system=style;
    payload.cover_url=`../book-ad-v0/generated-e08/${path.basename(payload.cover_url)}`;
    const n=String(i+1).padStart(2,'0'),payloadFile=`payload-${style}-${n}.json`;
    fs.writeFileSync(path.join(outDir,payloadFile),JSON.stringify(payload,null,2));
    manifest.items.push({id:`${style}-${item.id}`,bookId:item.id,style,seed:item.seed,payloadFile});
  }
}
fs.writeFileSync(path.join(outDir,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(`generated ${manifest.items.length} payloads: ${styles.length} systems x ${base.items.length} books`);
