#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {planNarrative} from './c27-narrative-plan.mjs';

const outDir=path.resolve(process.argv[2]||'examples/book-ad-systems/generated-c27');
const baseDir=path.resolve('examples/book-ad-v0/generated-e08');
const baseScript=path.resolve('.agents/skills/framewright/scripts/make-e08-fixtures.mjs');
const run=spawnSync(process.execPath,[baseScript,baseDir],{stdio:'inherit'});
if(run.status!==0)throw new Error(`E08 fixture generator exited ${run.status}`);
fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});
const manifest0=JSON.parse(fs.readFileSync(path.join(baseDir,'manifest.json'),'utf8'));
const byId=new Map(manifest0.items.map(x=>[x.id,JSON.parse(fs.readFileSync(path.join(baseDir,x.payloadFile),'utf8'))]));
const sentence=(index)=>({kind:'book_payload_field',field:'hook',selector:{kind:'sentence',index}});
const title=()=>({kind:'book_payload_field',field:'title',selector:{kind:'full'}});
const source=(note)=>({kind:'lab_verified_fixture',note});

const ANGLES={
  'winter-map':[
    {id:'map-premise',type:'premise',label:'unfinished map premise',source:source('exact E08 hook sentences'),hook:sentence(0),tension:sentence(1),payoff:sentence(2)},
    {id:'border-countdown',type:'conflict',label:'border countdown',source:source('exact E08 hook sentences, reordered'),hook:sentence(2),tension:sentence(0),payoff:sentence(1)}
  ],
  'city-seven':[
    {id:'rules-world',type:'world',label:'daily rules',source:source('exact E08 hook sentences'),hook:sentence(0),tension:sentence(1),payoff:title()},
    {id:'named-conflict',type:'conflict',label:'her name appears',source:source('exact E08 hook sentences, reordered'),hook:sentence(1),tension:sentence(0),payoff:title()}
  ],
  'letters':[
    {id:'lost-letters',type:'premise',label:'ten years of letters',source:source('exact E08 hook sentences'),hook:sentence(0),tension:sentence(1),payoff:title()},
    {id:'one-arrived',type:'conflict',label:'one envelope arrived',source:source('exact E08 hook sentences, reordered'),hook:sentence(1),tension:sentence(0),payoff:title()}
  ],
  'observatory':[
    {id:'repeating-signal',type:'premise',label:'repeating signal',source:source('exact E08 hook sentences'),hook:sentence(0),tension:sentence(1),payoff:title()},
    {id:'not-from-space',type:'world',label:'signal source reversal',source:source('exact E08 hook sentences, reordered'),hook:sentence(1),tension:sentence(0),payoff:title()}
  ],
  'long-title':[
    {id:'ordinary-route',type:'identity',label:'ordinary route',source:source('exact E08 hook sentences'),hook:sentence(0),tension:sentence(1),payoff:title()},
    {id:'life-changing-route',type:'emotion',label:'route changes life',source:source('exact E08 hook sentences, reordered'),hook:sentence(1),tension:sentence(0),payoff:title()}
  ],
  'zero-hour':[
    {id:'six-minute-blackout',type:'premise',label:'six minute blackout',source:source('exact E08 hook sentences'),hook:sentence(0),tension:sentence(1),payoff:title()},
    {id:'seventh-night',type:'conflict',label:'light does not return',source:source('exact E08 hook sentences, reordered'),hook:sentence(1),tension:sentence(0),payoff:title()}
  ]
};
const timings=['early','mid','late'],bookIds=Object.keys(ANGLES);
const manifest={schema:'framewright-c27-narrative-fixtures-v1',policy:'c27-narrative-v1',books:bookIds.length,anglesPerBook:2,revealTimings:timings,ctaTreatment:'intent',seedPolicy:'fixed-per-book',items:[]};
let n=0;
for(const [bookId,angles] of Object.entries(ANGLES)){
  const book=byId.get(bookId);if(!book)throw new Error(`missing E08 book ${bookId}`);
  const bookSeed=701+bookIds.indexOf(bookId);
  for(const angle of angles){
    for(const revealTiming of timings){
      n++;
      // CTA and seed are fixed within a book. The controlled semantic axes are angle and reveal timing.
      const input={book,angle,duration_seconds:9,fps:30,reveal_timing:revealTiming,cta_treatment:'intent',seed:bookSeed};
      const plan=planNarrative(input);
      const stem=`${String(n).padStart(2,'0')}-${bookId}-${angle.id}-${revealTiming}`;
      const inputFile=`input-${stem}.json`,planFile=`plan-${stem}.json`;
      fs.writeFileSync(path.join(outDir,inputFile),JSON.stringify(input,null,2));
      fs.writeFileSync(path.join(outDir,planFile),JSON.stringify(plan,null,2));
      manifest.items.push({id:stem,bookId,angleId:angle.id,angleType:angle.type,revealTiming,durationSeconds:9,ctaTreatment:'intent',seed:bookSeed,inputFile,planFile,narrativePlanId:plan.narrative_plan_id,revealFrame:plan.checkpoints.reveal,ctaFrame:plan.checkpoints.cta});
    }
  }
}
fs.writeFileSync(path.join(outDir,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(`C27 generated ${manifest.items.length} NarrativePlans: ${manifest.books} books x ${manifest.anglesPerBook} verified angles x ${timings.length} reveal timings; CTA=intent, seed=fixed-per-book`);
