#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const outDir=path.resolve(process.argv[2]||'examples/book-ad-systems/generated-c21');
const e13Dir=path.resolve('examples/book-ad-systems/generated-e13-c21');
const e13Script=path.resolve('.agents/skills/framewright/scripts/make-e13-routed-fixtures.mjs');
const r=spawnSync(process.execPath,[e13Script,e13Dir],{stdio:'inherit'});
if(r.status!==0)throw new Error(`E13 routed fixtures exited ${r.status}`);
fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});

const e13=JSON.parse(fs.readFileSync(path.join(e13Dir,'manifest.json'),'utf8'));
const primary=e13.items.filter(x=>x.rank===1);
if(primary.length!==10)throw new Error(`expected 10 routed-primary books, got ${primary.length}`);

const GRAMMARS=[
  {id:'hook-led',description:'existing verified hook opening; baseline'},
  {id:'cover-led',description:'cover identity before verified hook'},
  {id:'title-led',description:'verified title before verified hook'},
  {id:'progressive-hook',description:'same verified hook progressively revealed, then full hook'}
];
const manifest={schema:'framewright-c21-opening-grammar-fixtures-v1',grammars:GRAMMARS,books:primary.length,items:[]};
for(let i=0;i<primary.length;i++){
  const source=primary[i],payload=JSON.parse(fs.readFileSync(path.join(e13Dir,source.payloadFile),'utf8')),n=String(i+1).padStart(2,'0');
  for(const grammar of GRAMMARS){
    const p={...payload,creative_variant:'hook-first',opening_grammar:grammar.id,art_direction_mode:'cover',delivery_profile:'vertical'};
    const payloadFile=`payload-${n}-${grammar.id}-${source.style}.json`;
    fs.writeFileSync(path.join(outDir,payloadFile),JSON.stringify(p,null,2));
    manifest.items.push({id:`${source.bookId}-${grammar.id}-${source.style}`,bookId:source.bookId,grammar:grammar.id,style:source.style,variant:'hook-first',profile:'vertical',width:1080,height:1920,seed:source.seed,payloadFile});
  }
}
fs.writeFileSync(path.join(outDir,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(`C21 generated ${manifest.items.length} videos: ${primary.length} books x ${GRAMMARS.length} opening grammars`);
for(const bookId of [...new Set(manifest.items.map(x=>x.bookId))]){
  const xs=manifest.items.filter(x=>x.bookId===bookId);console.log(`${bookId}: ${xs[0].style} seed=${xs[0].seed} -> ${xs.map(x=>x.grammar).join(', ')}`);
}
