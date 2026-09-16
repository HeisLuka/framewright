#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {assertNarrativePlan,planNarrative,resolveCopySource,stableStringify} from './c27-narrative-plan.mjs';

const dir=path.resolve(process.argv[2]||'examples/book-ad-systems/generated-c27');
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
if(manifest.schema!=='framewright-c27-narrative-fixtures-v1')throw new Error('wrong C27 fixture manifest schema');
if(manifest.items.length!==36)throw new Error(`expected 36 plans, got ${manifest.items.length}`);
let deterministic=0,copyAtoms=0,exactTimelines=0;
const rows=[];
for(const item of manifest.items){
  const input=JSON.parse(fs.readFileSync(path.join(dir,item.inputFile),'utf8'));
  const saved=JSON.parse(fs.readFileSync(path.join(dir,item.planFile),'utf8'));
  assertNarrativePlan(saved);exactTimelines++;
  const replay=planNarrative(input);
  if(stableStringify(replay)!==stableStringify(saved))throw new Error(`deterministic replay drift: ${item.id}`);
  deterministic++;
  for(const role of saved.roles){
    for(const atom of role.atoms){
      if(atom.source.kind==='book_payload_field'){
        if(resolveCopySource(atom.source,input.book)!==atom.text)throw new Error(`copy drift: ${item.id}/${role.role}`);
        copyAtoms++;
      } else if(atom.source.kind==='human_verified'){
        if(resolveCopySource(atom.source,input.book)!==atom.text)throw new Error(`verified-copy drift: ${item.id}/${role.role}`);
        copyAtoms++;
      }
    }
  }
  rows.push({item,input,plan:saved});
}

let revealOrderGroups=0;
for(const key of new Set(rows.map(x=>`${x.item.bookId}::${x.item.angleId}`))){
  const xs=rows.filter(x=>`${x.item.bookId}::${x.item.angleId}`===key);
  const frame=Object.fromEntries(xs.map(x=>[x.item.revealTiming,x.plan.checkpoints.reveal]));
  if(!(frame.early<frame.mid&&frame.mid<frame.late))throw new Error(`reveal timing order failed for ${key}: ${JSON.stringify(frame)}`);
  revealOrderGroups++;
}

for(const bookId of new Set(rows.map(x=>x.item.bookId))){
  const xs=rows.filter(x=>x.item.bookId===bookId&&x.item.revealTiming==='mid');
  if(xs.length!==2)throw new Error(`expected 2 mid plans for ${bookId}`);
  const semantic=x=>x.plan.roles.filter(r=>!['hook','book_reveal','cta'].includes(r.role)).map(r=>`${r.role}:${r.atoms.map(a=>a.text).join('|')}`).join('>');
  if(!semantic(xs[0])||!semantic(xs[1])||semantic(xs[0])===semantic(xs[1]))throw new Error(`angles do not diverge beyond hook for ${bookId}`);
}

const representative=rows[0].input;
for(const seconds of [3,5,7,9,12,15]){
  const cta=seconds===3?'none':seconds===5?'soft_reveal':'direct';
  const p=planNarrative({...representative,duration_seconds:seconds,cta_treatment:cta,reveal_timing:'mid',seed:700+seconds});
  const names=p.roles.map(r=>r.role);
  if(seconds===3&&stableStringify(names)!==stableStringify(['hook']))throw new Error('3s C24 compatibility failed');
  if(seconds===5&&stableStringify(names)!==stableStringify(['hook','book_reveal']))throw new Error('5s C24 compatibility failed');
  if(seconds>=7&&(!names.includes('book_reveal')||!names.includes('cta')))throw new Error(`${seconds}s full grammar compatibility failed`);
}

const report={
  schema:'framewright-c27-narrative-audit-v1',ok:true,plans:manifest.items.length,books:manifest.books,
  deterministic_replays:deterministic,copy_atoms_verified:copyAtoms,exact_timelines:exactTimelines,
  reveal_order_groups:revealOrderGroups,c24_duration_profiles_checked:6,
  checks:['deterministic replay','copy provenance/no invented text','exact frame coverage','early < mid < late reveal','semantic divergence beyond hook','C24 3/5/7+ grammar compatibility']
};
const out=process.argv[3];if(out)fs.writeFileSync(path.resolve(out),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
