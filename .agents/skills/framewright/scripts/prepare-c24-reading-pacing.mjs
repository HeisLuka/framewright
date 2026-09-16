#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const input=path.resolve(process.argv[2]||'examples/book-ad-systems/index-c23.html');
const output=path.resolve(process.argv[3]||'examples/book-ad-systems/index-c24.html');
let html=fs.readFileSync(input,'utf8');

const scheduleMarker="if(ACTIVE_VARIANT==='cover-first'){";
if(!html.includes(scheduleMarker))throw new Error('C24 variant-aware schedule marker missing');
const policy=String.raw`
const PACING_MODE=String((window.FRAMEWRIGHT_PAYLOAD&&window.FRAMEWRIGHT_PAYLOAD.pacing_mode)||'baseline12').toLowerCase();
const C24_DURATION_PROFILES=[3,5,7,9,12,15];
function __c24TextStats(text){const s=String(text||'').trim(),words=s?s.split(' ').filter(Boolean).length:0,chars=Array.from(s).filter(ch=>ch.trim()!=='').length;return{words,chars};}
function __c24Load(){
  const hook=__c24TextStats(P.hook),title=__c24TextStats(P.title),author=__c24TextStats(P.author),cta=__c24TextStats(P.cta);
  // Design proxy only: this is not a universal human reading-speed model.
  const score=hook.chars+.65*title.chars+.20*author.chars+.35*cta.chars+2.5*(hook.words+title.words);
  const desired={
    hook:30+.48*hook.chars+1.8*hook.words,
    book:55+.34*(title.chars+author.chars)+1.2*(title.words+author.words)+.10*hook.chars,
    cta:36+.24*cta.chars+1.3*cta.words+.08*title.chars
  };
  return{stats:{hook,title,author,cta},score:+score.toFixed(2),desired};
}
function __c24DurationBand(score){if(score<=40)return 3;if(score<=100)return 5;if(score<=130)return 7;if(score<=210)return 9;if(score<=285)return 12;return 15;}
function __c24Allocate(target,bounds,desired,keys){
  const frames={hook:0,book:0,cta:0},rawTotal=keys.reduce((s,k)=>s+Math.max(.001,desired[k]),0),targetShare={};
  for(const k of keys){const [lo,hi]=bounds[k];targetShare[k]=target*Math.max(.001,desired[k])/rawTotal;frames[k]=Math.round(clamp(targetShare[k],lo,hi));}
  let sum=keys.reduce((s,k)=>s+frames[k],0),guard=0;
  while(sum!==target&&guard++<2000){
    if(sum<target){let best=null,bestScore=-Infinity;for(const k of keys){const hi=bounds[k][1];if(frames[k]>=hi)continue;const score=targetShare[k]-frames[k];if(score>bestScore){bestScore=score;best=k;}}if(!best)break;frames[best]++;sum++;}
    else{let best=null,bestScore=-Infinity;for(const k of keys){const lo=bounds[k][0];if(frames[k]<=lo)continue;const score=frames[k]-targetShare[k];if(score>bestScore){bestScore=score;best=k;}}if(!best)break;frames[best]--;sum--;}
  }
  if(sum!==target)throw new Error('C24 duration allocator could not hit target frames');
  return frames;
}
function __c24Plan(){
  const load=__c24Load(),baseline={hook:90,book:150,cta:120};
  if(PACING_MODE==='baseline12'||PACING_MODE==='fixed'||PACING_MODE==='fixed12')return{mode:'baseline-12-v1',profileSeconds:12,totalFrames:360,grammar:'full',frames:baseline,seconds:{hook:3,book:5,cta:4},reasons:['control:fixed-12s'],...load};
  const profileSeconds=__c24DurationBand(load.score),targetFrames=profileSeconds*FPS;
  if(profileSeconds===3){const frames={hook:90,book:0,cta:0};return{mode:'organic-duration-v1',profileSeconds,totalFrames:90,grammar:'teaser-hook',frames,seconds:{hook:3,book:0,cta:0},reasons:['copy-load:'+load.score,'duration-band:'+profileSeconds+'s'],...load};}
  const grammar=profileSeconds===5?'hook-book':'full';
  const boundsByProfile={
    5:{hook:[54,78],book:[72,96],cta:[0,0]},
    7:{hook:[60,90],book:[90,120],cta:[30,60]},
    9:{hook:[72,105],book:[105,150],cta:[45,75]},
    12:{hook:[90,126],book:[150,198],cta:[72,120]},
    15:{hook:[105,150],book:[195,255],cta:[90,135]}
  };
  const bounds=boundsByProfile[profileSeconds],keys=profileSeconds===5?['hook','book']:['hook','book','cta'];
  const frames=__c24Allocate(targetFrames,bounds,load.desired,keys),seconds=Object.fromEntries(Object.entries(frames).map(([k,v])=>[k,+((v/FPS).toFixed(3))]));
  return{mode:'organic-duration-v1',profileSeconds,totalFrames:targetFrames,grammar,frames,seconds,bounds,reasons:['copy-load:'+load.score,'duration-band:'+profileSeconds+'s','grammar:'+grammar],...load};
}
const __C24_PACING=__c24Plan();P.pacing=__C24_PACING;P.duration_profile=__C24_PACING.profileSeconds;window.__C24_PACING=()=>P.pacing;
`;
html=html.replace(scheduleMarker,policy+'\n'+scheduleMarker);

const semanticNeedle="function __variantSemantic(name,len,index,sourceLen,pageNumber){\n  plate(name,len,(g,S)=>{";
if(!html.includes(semanticNeedle))throw new Error('C24 __variantSemantic marker missing');
html=html.replace(semanticNeedle,"function __variantSemantic(name,len,index,sourceLen,pageNumber){\n  if(len<=0)return;\n  plate(name,len,(g,S)=>{");
const titleNeedle="function __variantTitlePlate(len,pageNumber){\n  plate('title',len,(g,S)=>{";
if(!html.includes(titleNeedle))throw new Error('C24 __variantTitlePlate marker missing');
html=html.replace(titleNeedle,"function __variantTitlePlate(len,pageNumber){\n  if(len<=0)return;\n  plate('title',len,(g,S)=>{");

// Keep existing scene animation authored against sourceLen=90/150/120; only dwell changes.
const replacements=[
  ["__variantSemantic('book',150,1,150,1)","__variantSemantic('book',__C24_PACING.frames.book,1,150,1)"],
  ["__variantSemantic('hook',90,0,90,2)","__variantSemantic('hook',__C24_PACING.frames.hook,0,90,2)"],
  ["__variantSemantic('cta',120,2,120,3)","__variantSemantic('cta',__C24_PACING.frames.cta,2,120,3)"],
  ["__variantTitlePlate(150,1)","__variantTitlePlate(__C24_PACING.frames.book,1)"],
  ["__variantSemantic('hook',90,0,90,1)","__variantSemantic('hook',__C24_PACING.frames.hook,0,90,1)"],
  ["__variantTitlePlate(150,2)","__variantTitlePlate(__C24_PACING.frames.book,2)"],
  ["__variantSemantic('book',150,1,150,2)","__variantSemantic('book',__C24_PACING.frames.book,1,150,2)"]
];
for(const [from,to] of replacements){if(!html.includes(from))throw new Error(`C24 schedule fragment missing: ${from}`);html=html.replaceAll(from,to);}

// Swiss hook exit follows the actual plate tail; its authored entrance remains time-local.
html=html.replace('hold=1-easeIO(span(S.i,72,89))','hold=1-easeIO(span(S.t,.81,1))');

fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,html);console.log(`prepared C24 adaptive organic-duration template: ${output}`);
