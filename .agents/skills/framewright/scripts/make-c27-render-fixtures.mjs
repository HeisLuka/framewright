#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const sourceDir=path.resolve(process.argv[2]||'examples/book-ad-systems/generated-c27');
const outDir=path.resolve(process.argv[3]||'examples/book-ad-systems/generated-c27-render');
const source=JSON.parse(fs.readFileSync(path.join(sourceDir,'manifest.json'),'utf8'));
if(source.schema!=='framewright-c27-narrative-fixtures-v1')throw new Error('wrong C27 source manifest');
fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});
const manifest={schema:'framewright-c27-render-fixtures-v1',sourceSchema:source.schema,policy:source.policy,visualSystem:'swiss',typographySystem:'baseline',platformProfile:'generic',deliveryProfile:'vertical',items:[]};
for(const item of source.items){
  const input=JSON.parse(fs.readFileSync(path.join(sourceDir,item.inputFile),'utf8'));
  const plan=JSON.parse(fs.readFileSync(path.join(sourceDir,item.planFile),'utf8'));
  const book=structuredClone(input.book),coverBase=path.basename(String(book.cover_url||''));
  if(!coverBase)throw new Error(`${item.id}: cover missing`);
  const payload={
    ...book,
    cover_url:`../book-ad-v0/generated-e08/${coverBase}`,
    visual_system:'swiss',
    creative_variant:'hook-first',
    delivery_profile:'vertical',
    art_direction_mode:'cover',
    cover_composition_mode:'adaptive',
    opening_grammar:'hook-led',
    motion_density:'choreography-v2',
    typography_system:'baseline',
    pacing_mode:'baseline12',
    platform_profile:'generic',
    narrative_plan:plan
  };
  const payloadFile=`payload-${item.id}.json`,planFile=`plan-${item.id}.json`;
  fs.writeFileSync(path.join(outDir,payloadFile),JSON.stringify(payload,null,2));
  fs.writeFileSync(path.join(outDir,planFile),JSON.stringify(plan,null,2));
  manifest.items.push({
    id:item.id,bookId:item.bookId,angleId:item.angleId,angleType:item.angleType,revealTiming:item.revealTiming,
    narrativePlanId:item.narrativePlanId,durationSeconds:item.durationSeconds,ctaTreatment:item.ctaTreatment,
    revealFrame:item.revealFrame,ctaFrame:item.ctaFrame,payloadFile,planFile,
    style:'swiss',variant:'hook-first',profile:'vertical',platform:'generic',width:1080,height:1920,seed:plan.seed
  });
}
fs.writeFileSync(path.join(outDir,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(`C27 renderer fixtures: ${manifest.items.length} plans, visual implementation fixed to Swiss/baseline/generic vertical`);
