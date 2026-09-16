#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {assertNarrativePlan,planNarrative,resolveCopySource,stableStringify} from './c27-narrative-plan.mjs';

const dir=path.resolve(process.argv[2]||'examples/book-ad-systems/generated-c29-auto');
const out=path.resolve(process.argv[3]||'artifacts/c29/semantic-audit.json');
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
const evidence=JSON.parse(fs.readFileSync(path.join(dir,'evidence.json'),'utf8'));
if(manifest.schema!=='framewright-c29-auto-creative-matrix-v1')throw new Error('wrong C29 manifest schema');
if(manifest.items.length!==18)throw new Error(`expected 18 plans, got ${manifest.items.length}`);
if(manifest.angles!==3||manifest.hooksPerAngle!==2||manifest.revealTimings.length!==3)throw new Error('wrong C29 matrix dimensions');

const evidenceById=new Map(evidence.items.map(x=>[x.id,x]));
let deterministicReplays=0,copyAtomsVerified=0;
const hookTextByConcept=new Map(),rows=[];
function norm(text){return String(text||'').toLowerCase().replace(/\s+/g,' ').trim();}
for(const item of manifest.items){
  const input=JSON.parse(fs.readFileSync(path.join(dir,item.inputFile),'utf8'));
  const saved=JSON.parse(fs.readFileSync(path.join(dir,item.planFile),'utf8'));
  assertNarrativePlan(saved);
  const replay=planNarrative(input);
  if(stableStringify(replay)!==stableStringify(saved))throw new Error(`deterministic replay drift: ${item.id}`);
  deterministicReplays++;
  if(saved.duration_seconds!==9||saved.cta_treatment!=='intent'||saved.seed!==2901)throw new Error(`fixed semantic axis drift: ${item.id}`);
  const hook=saved.roles.find(x=>x.role==='hook'),revealIndex=saved.roles.findIndex(x=>x.role==='book_reveal');
  if(!hook||revealIndex<0)throw new Error(`missing hook/reveal: ${item.id}`);
  const hookText=hook.atoms.map(x=>x.text).join(' ');hookTextByConcept.set(item.conceptId,hookText);
  const title=norm(input.book.title),author=norm(input.book.author);
  for(const role of saved.roles){
    for(const atom of role.atoms){
      if(atom.source.kind==='reserved_affordance')continue;
      if(resolveCopySource(atom.source,input.book)!==atom.text)throw new Error(`copy provenance drift: ${item.id}/${role.role}`);
      copyAtomsVerified++;
    }
  }
  for(const role of saved.roles.slice(0,revealIndex))for(const atom of role.atoms){
    const text=norm(atom.text);
    if((title&&text.includes(title))||(author&&text.includes(author)))throw new Error(`book identity leaked before reveal: ${item.id}/${role.role}`);
  }
  for(const id of item.evidenceIds){
    const e=evidenceById.get(id);if(!e)throw new Error(`missing evidence ${id}`);
    if(e.spoiler_level>1)throw new Error(`spoiler evidence entered matrix: ${item.id}/${id}`);
  }
  rows.push({id:item.id,angleType:item.angleType,hookCandidateId:item.hookCandidateId,conceptId:item.conceptId,revealTiming:item.revealTiming,revealFrame:saved.checkpoints.reveal,hookText,narrativePlanId:saved.narrative_plan_id});
}

const angleTypes=[...new Set(rows.map(x=>x.angleType))];
if(stableStringify(angleTypes)!==stableStringify(['premise','conflict','identity']))throw new Error(`angle coverage drift ${JSON.stringify(angleTypes)}`);
let revealOrderGroups=0,hookPairs=0;
for(const angleType of angleTypes){
  const hooks=[...new Set(rows.filter(x=>x.angleType===angleType).map(x=>x.hookCandidateId))];
  if(hooks.length!==2)throw new Error(`${angleType}: expected 2 hooks, got ${hooks.length}`);
  const hookTexts=hooks.map(h=>rows.find(x=>x.angleType===angleType&&x.hookCandidateId===h).hookText);
  if(new Set(hookTexts).size!==2)throw new Error(`${angleType}: hook candidates collapsed to same visible text`);
  hookPairs++;
  for(const hookCandidateId of hooks){
    const xs=rows.filter(x=>x.angleType===angleType&&x.hookCandidateId===hookCandidateId);
    if(xs.length!==3)throw new Error(`${angleType}/${hookCandidateId}: expected 3 reveal variants`);
    const by=Object.fromEntries(xs.map(x=>[x.revealTiming,x.revealFrame]));
    if(!(by.early<by.mid&&by.mid<by.late))throw new Error(`${angleType}/${hookCandidateId}: reveal order failed ${JSON.stringify(by)}`);
    revealOrderGroups++;
  }
}

const report={
  schema:'framewright-c29-auto-creative-audit-v1',ok:true,plans:rows.length,angleTypes,angles:angleTypes.length,
  hookCandidates:hookTextByConcept.size,hookPairs,revealOrderGroups,deterministicReplays,copyAtomsVerified,
  fixedAxes:manifest.fixed,checks:['verified source provenance','no high-spoiler evidence','distinct hook copy within angle','early < mid < late per hook','no title/author before reveal','deterministic NarrativePlan replay'],rows
};
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2));
console.log(JSON.stringify({ok:true,plans:report.plans,angles:report.angles,hookCandidates:report.hookCandidates,revealOrderGroups,copyAtomsVerified},null,2));
