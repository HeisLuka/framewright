#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const outDir=path.resolve(process.argv[2]||'examples/book-ad-systems/generated-e14');
const e13Dir=path.resolve('examples/book-ad-systems/generated-e13');
const e13Script=path.resolve('.agents/skills/framewright/scripts/make-e13-routed-fixtures.mjs');
const r=spawnSync(process.execPath,[e13Script,e13Dir],{stdio:'inherit'});
if(r.status!==0)throw new Error(`E13 routed fixtures exited ${r.status}`);
fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});

const e13=JSON.parse(fs.readFileSync(path.join(e13Dir,'manifest.json'),'utf8'));
const primary=e13.items.filter(x=>x.rank===1);
if(primary.length!==10)throw new Error(`expected 10 E13 primary routes, got ${primary.length}`);

const VARIANTS=[
  {id:'hook-first',description:'hook -> product detail -> CTA'},
  {id:'cover-first',description:'product detail -> hook -> CTA'},
  {id:'title-first',description:'title/cover statement -> product detail -> CTA'},
  {id:'hook-title',description:'hook -> title/cover statement -> CTA'}
];
const manifest={schema:'framewright-e14-variant-factory-v1',variants:VARIANTS,items:[]};
for(let i=0;i<primary.length;i++){
  const source=primary[i],payload=JSON.parse(fs.readFileSync(path.join(e13Dir,source.payloadFile),'utf8'));
  for(let v=0;v<VARIANTS.length;v++){
    const variant=VARIANTS[v],n=String(i+1).padStart(2,'0');
    const p={...payload,creative_variant:variant.id,motion_density:'active'};
    const payloadFile=`payload-${n}-${variant.id}-${source.style}.json`;
    fs.writeFileSync(path.join(outDir,payloadFile),JSON.stringify(p,null,2));
    // Same seed across the four variants: measured differences should come from structure, not RNG noise.
    manifest.items.push({id:`${source.bookId}-${variant.id}-${source.style}`,bookId:source.bookId,variant:variant.id,style:source.style,seed:source.seed,payloadFile});
  }
}
fs.writeFileSync(path.join(outDir,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(`E14 generated ${manifest.items.length} videos: ${primary.length} routed-primary books x ${VARIANTS.length} structural variants`);
for(const bookId of [...new Set(manifest.items.map(x=>x.bookId))]){
  const xs=manifest.items.filter(x=>x.bookId===bookId);console.log(`${bookId}: ${xs[0].style} -> ${xs.map(x=>x.variant).join(', ')}`);
}
