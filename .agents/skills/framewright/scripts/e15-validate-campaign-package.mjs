#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const packageDir=path.resolve(process.argv[2]||'artifacts/e15/package');
const checkDir=path.resolve(process.argv[3]||'artifacts/e15/package-check');
const diversityPath=path.resolve(process.argv[4]||'artifacts/e15/diversity.json');
function shaFile(file){const h=crypto.createHash('sha256');h.update(fs.readFileSync(file));return h.digest('hex');}
function read(dir,name){return fs.readFileSync(path.join(dir,name),'utf8');}
function fail(msg){throw new Error(msg);}
for(const name of ['campaign-manifest.json','candidate-catalog.json','dedupe-report.json','campaign-manifest.sha256']){
  if(read(packageDir,name)!==read(checkDir,name))fail(`non-deterministic package file: ${name}`);
}
const campaign=JSON.parse(read(packageDir,'campaign-manifest.json'));
const catalog=JSON.parse(read(packageDir,'candidate-catalog.json'));
const dedupe=JSON.parse(read(packageDir,'dedupe-report.json'));
const diversity=JSON.parse(fs.readFileSync(diversityPath,'utf8'));
if(campaign.schema!=='framewright-selected-campaign-manifest-v1')fail(`unexpected campaign schema ${campaign.schema}`);
if(campaign.counts.books!==10||campaign.counts.creatives!==30)fail(`expected 10 books / 30 selected, got ${campaign.counts.books}/${campaign.counts.creatives}`);
if(catalog.counts.candidates!==40)fail(`expected 40 candidates, got ${catalog.counts.candidates}`);
if(catalog.counts.selected!==30)fail(`expected 30 catalog selections, got ${catalog.counts.selected}`);
if(dedupe.exactSpecGroups.length)fail(`exact creative-spec duplicates: ${JSON.stringify(dedupe.exactSpecGroups)}`);
if(dedupe.exactOutputGroups.length)fail(`exact MP4 duplicates: ${JSON.stringify(dedupe.exactOutputGroups)}`);
const creativeIds=new Set(),renderIds=new Set(),outputs=new Set();
const divByBook=new Map(diversity.books.map(x=>[x.bookId,x]));
for(const book of campaign.books){
  if(book.selected.length!==3)fail(`${book.bookId}: expected 3 selected creatives`);
  if(book.selected[0].variant!=='hook-first')fail(`${book.bookId}: selection anchor is not hook-first`);
  const variants=book.selected.map(x=>x.variant);
  if(new Set(variants).size!==3)fail(`${book.bookId}: duplicate selected variants`);
  const d=divByBook.get(book.bookId);if(!d)fail(`${book.bookId}: missing diversity row`);
  for(let i=0;i<variants.length;i++)for(let j=i+1;j<variants.length;j++){
    const p=d.pairs.find(x=>(x.a===variants[i]&&x.b===variants[j])||(x.a===variants[j]&&x.b===variants[i]));
    if(!p)fail(`${book.bookId}: missing selected diversity pair ${variants[i]}/${variants[j]}`);
    if(p.mean<0.02)fail(`${book.bookId}: selected pair ${variants[i]}/${variants[j]} too similar: ${p.mean}`);
  }
}
for(const c of campaign.creatives){
  if(creativeIds.has(c.creativeId))fail(`duplicate creativeId ${c.creativeId}`);creativeIds.add(c.creativeId);
  if(renderIds.has(c.renderId))fail(`duplicate renderId ${c.renderId}`);renderIds.add(c.renderId);
  if(outputs.has(c.output.file))fail(`duplicate output filename ${c.output.file}`);outputs.add(c.output.file);
  const file=path.join(packageDir,c.output.file);if(!fs.existsSync(file))fail(`missing selected MP4 ${file}`);
  if(shaFile(file)!==c.output.sha256)fail(`output SHA mismatch ${c.creativeId}`);
  if(!c.creativeId.startsWith('fwc1-'))fail(`bad creative ID contract ${c.creativeId}`);
  if(!c.renderId.startsWith('fwr1-'))fail(`bad render ID contract ${c.renderId}`);
}
const recorded=read(packageDir,'campaign-manifest.sha256').trim().split(/\s+/)[0];
if(recorded!==shaFile(path.join(packageDir,'campaign-manifest.json')))fail('campaign manifest package hash mismatch');
const catalogSelected=catalog.creatives.filter(x=>x.selection.status==='selected');
if(catalogSelected.length!==30)fail(`catalog selected count ${catalogSelected.length}`);
if(catalog.creatives.filter(x=>x.selection.status==='reserve').length+catalog.creatives.filter(x=>x.selection.status==='suppressed').length!==10)fail('candidate pool accounting mismatch');
console.log(JSON.stringify({ok:true,books:campaign.counts.books,candidates:catalog.counts.candidates,selected:campaign.counts.creatives,reserve:catalog.counts.reserve,suppressed:catalog.counts.suppressed,nearDuplicateThreshold:campaign.selectionPolicy.nearDuplicateThreshold,uniqueCreativeIds:creativeIds.size,uniqueRenderIds:renderIds.size,packageSha256:recorded},null,2));
