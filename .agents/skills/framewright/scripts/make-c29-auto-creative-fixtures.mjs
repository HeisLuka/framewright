#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {makeCreativeSourcePack,compileAutoCreativePlans} from './c27-auto-creative.mjs';

const outDir=path.resolve(process.argv[2]||'examples/book-ad-systems/generated-c29-auto');
const baseBook=JSON.parse(fs.readFileSync(path.resolve('examples/book-ad-v0/payload.example.json'),'utf8'));
const book={...baseBook,book_id:'c29-night-archive',cover_url:'../book-ad-v0/cover-demo.svg'};
const sourcePack=makeCreativeSourcePack({book,blocks:[
  {
    id:'synopsis',kind:'publisher_synopsis',verification_id:'lab-c29-synopsis-v1',spoiler_level:0,
    text:'Каждую ночь архивариус получает запись о событии, которого ещё не было. Город забывает улицы, которых нет в утренних картах. Прежде чем рассветёт, он должен решить, какую запись сохранить. Архив открывается только на шесть минут до рассвета.'
  },
  {
    id:'description',kind:'publisher_description',verification_id:'lab-c29-description-v1',spoiler_level:0,
    text:'Он помнит чужие ночи лучше собственной жизни. Его имя появляется в каталоге только после полуночи. Без следующей записи он не узнает, кому принадлежит последнее воспоминание.'
  },
  {
    id:'spoiler-boundary',kind:'book_excerpt',verification_id:'lab-c29-excerpt-v1',spoiler_level:2,
    text:'Последняя запись раскрывает имя человека, который создал архив.'
  }
]});

const compiled=compileAutoCreativePlans({
  book,
  source_pack:sourcePack,
  include_payload_hook:false,
  max_spoiler_level:1,
  max_angle_types:3,
  max_hooks_per_angle:2,
  duration_seconds:9,
  reveal_timing:['early','mid','late'],
  cta_treatment:'intent',
  fps:30,
  seed:2901
});

const angleTypes=compiled.angles.map(x=>x.type);
if(JSON.stringify(angleTypes)!==JSON.stringify(['premise','conflict','identity']))throw new Error(`unexpected C29 angle types: ${JSON.stringify(angleTypes)}`);
if(compiled.angles.some(x=>x.variants.length!==2))throw new Error(`C29 requires exactly two hook candidates per angle: ${compiled.angles.map(x=>`${x.type}:${x.variants.length}`).join(', ')}`);
if(compiled.portfolio.concepts.length!==6)throw new Error(`expected 6 concepts, got ${compiled.portfolio.concepts.length}`);
if(compiled.plans.length!==18)throw new Error(`expected 18 plans, got ${compiled.plans.length}`);

fs.rmSync(outDir,{recursive:true,force:true});
fs.mkdirSync(outDir,{recursive:true});
fs.writeFileSync(path.join(outDir,'source-pack.json'),JSON.stringify(sourcePack,null,2));
fs.writeFileSync(path.join(outDir,'evidence.json'),JSON.stringify(compiled.evidence,null,2));
fs.writeFileSync(path.join(outDir,'angles.json'),JSON.stringify(compiled.angles,null,2));
fs.writeFileSync(path.join(outDir,'portfolio.json'),JSON.stringify(compiled.portfolio,null,2));

const conceptById=new Map(compiled.portfolio.concepts.map(x=>[x.concept_id,x]));
const revealOrder={early:0,mid:1,late:2};
const entries=[];
for(const entry of compiled.plans){
  const plan=entry.narrative_plan,concept=conceptById.get(entry.concept_id);
  if(!concept)throw new Error(`missing concept ${entry.concept_id}`);
  const type=concept.angle_type,hookCandidateId=concept.hook_candidate_id,timing=plan.reveal_timing;
  const hookIndex=compiled.angles.find(x=>x.type===type).variants.findIndex(x=>x.id===hookCandidateId)+1;
  const stem=`${type}-h${hookIndex}-${timing}`;
  const input={book,angle:concept.planner_angle,duration_seconds:9,fps:30,reveal_timing:timing,cta_treatment:'intent',seed:2901};
  const payload={
    ...book,
    visual_system:'swiss',creative_variant:'hook-first',delivery_profile:'vertical',
    art_direction_mode:'cover',cover_composition_mode:'adaptive',opening_grammar:'hook-led',
    motion_density:'choreography-v2',typography_system:'baseline',pacing_mode:'baseline12',
    platform_profile:'generic',narrative_plan:plan
  };
  const inputFile=`input-${stem}.json`,planFile=`plan-${stem}.json`,payloadFile=`payload-${stem}.json`;
  fs.writeFileSync(path.join(outDir,inputFile),JSON.stringify(input,null,2));
  fs.writeFileSync(path.join(outDir,planFile),JSON.stringify(plan,null,2));
  fs.writeFileSync(path.join(outDir,payloadFile),JSON.stringify(payload,null,2));
  entries.push({
    id:stem,bookId:book.book_id,angleId:`auto-${type}`,angleType:type,conceptId:entry.concept_id,
    hookCandidateId,evidenceIds:entry.evidence_ids,revealTiming:timing,revealOrder:revealOrder[timing],
    narrativePlanId:plan.narrative_plan_id,durationSeconds:9,ctaTreatment:'intent',revealFrame:plan.checkpoints.reveal,
    ctaFrame:plan.checkpoints.cta,inputFile,planFile,payloadFile,style:'swiss',variant:'hook-first',profile:'vertical',
    platform:'generic',width:1080,height:1920,seed:2901
  });
}
entries.sort((a,b)=>angleTypes.indexOf(a.angleType)-angleTypes.indexOf(b.angleType)||a.hookCandidateId.localeCompare(b.hookCandidateId)||a.revealOrder-b.revealOrder);
const manifest={
  schema:'framewright-c29-auto-creative-matrix-v1',bookId:book.book_id,sourcePackId:sourcePack.source_pack_id,
  policy:'c27-auto-creative-v1',controlledAxes:['angle_type','hook_candidate','reveal_timing'],
  fixed:{durationSeconds:9,ctaTreatment:'intent',seed:2901,visualSystem:'swiss',typographySystem:'baseline',platformProfile:'generic',deliveryProfile:'vertical'},
  angleTypes,angles:3,hooksPerAngle:2,revealTimings:['early','mid','late'],items:entries
};
fs.writeFileSync(path.join(outDir,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({ok:true,plans:entries.length,angleTypes,hooksPerAngle:2,revealTimings:3,sourcePackId:sourcePack.source_pack_id},null,2));
