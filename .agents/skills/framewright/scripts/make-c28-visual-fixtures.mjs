#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const semanticPath=path.resolve(process.argv[2]||'artifacts/c28/semantic-report.json');
const c20Dir=path.resolve(process.argv[3]||'examples/book-ad-systems/generated-c20');
const outDir=path.resolve(process.argv[4]||'examples/book-ad-systems/generated-c28');
const semantic=JSON.parse(fs.readFileSync(semanticPath,'utf8'));
const c20=JSON.parse(fs.readFileSync(path.join(c20Dir,'manifest.json'),'utf8'));
fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});

const coverEntries=c20.items.filter(x=>x.mode==='cover');
if(coverEntries.length!==semantic.books)throw new Error(`C28 expected ${semantic.books} real-cover fixtures, got ${coverEntries.length}`);
const byBook=new Map(coverEntries.map(x=>[x.bookId,x]));
const manifest={schema:'framewright-c28-visual-fixtures-v1',source:'C20 real-cover fixture corpus + canonical C28 semantic selections',items:[]};

for(let i=0;i<semantic.books;i++){
  const coverId=`cover-${String(i+1).padStart(2,'0')}`,baseEntry=byBook.get(coverId);if(!baseEntry)throw new Error(`missing ${coverId}`);
  const basePayload=JSON.parse(fs.readFileSync(path.join(c20Dir,baseEntry.payloadFile),'utf8'));
  for(const mode of ['naive','aware']){
    const spec=mode==='naive'?semantic.naive[i]:semantic.selected[i];
    if(!spec||spec.book_id!==`book-${String(i+1).padStart(2,'0')}`)throw new Error(`semantic fixture mismatch at ${i}`);
    const payload={...basePayload,visual_system:spec.visual_system,creative_variant:spec.creative_variant,opening_grammar:spec.opening_grammar,typography_system:spec.typography_system,platform_profile:spec.platform_profile,pacing_mode:'organic',art_direction_mode:'cover',cover_composition_mode:'adaptive'};
    const payloadFile=`payload-${String(i+1).padStart(2,'0')}-${mode}.json`;
    fs.writeFileSync(path.join(outDir,payloadFile),JSON.stringify(payload,null,2)+'\n');
    manifest.items.push({id:`book-${String(i+1).padStart(2,'0')}-${mode}`,bookId:`book-${String(i+1).padStart(2,'0')}`,mode,width:1080,height:1920,profile:'vertical',seed:baseEntry.seed,payloadFile,spec:{candidate:spec.candidate,visual_system:spec.visual_system,creative_variant:spec.creative_variant,opening_grammar:spec.opening_grammar,typography_system:spec.typography_system,platform_profile:spec.platform_profile}});
  }
}
fs.writeFileSync(path.join(outDir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(`C28 visual fixtures: ${manifest.items.length} renders (${semantic.books} naive/aware real-cover pairs)`);
