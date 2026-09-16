#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const input=path.resolve(process.argv[2]||'examples/book-ad-systems/index-e14.html');
const output=path.resolve(process.argv[3]||'examples/book-ad-systems/index-c24.html');
let html=fs.readFileSync(input,'utf8');

const scheduleMarker="if(ACTIVE_VARIANT==='cover-first'){";
if(!html.includes(scheduleMarker))throw new Error('C24 variant-aware schedule marker missing');
const pacing=String.raw`
const PACING_MODE=String((window.FRAMEWRIGHT_PAYLOAD&&window.FRAMEWRIGHT_PAYLOAD.pacing_mode)||'fixed').toLowerCase();
function __c24TextStats(text){const s=String(text||'').trim(),words=s?s.split(/\s+/).filter(Boolean).length:0,chars=Array.from(s).filter(ch=>!\s/.test(ch)).length;return{words,chars};}
function __c24Need(){
  const h=__c24TextStats(P.hook),t=__c24TextStats(P.title),a=__c24TextStats(P.author),c=__c24TextStats(P.cta);
  // Bounded design weights only; not a claim about a universal human reading speed.
  const desired={
    hook:65+.35*h.chars+1.4*h.words,
    book:105+.20*(t.chars+a.chars+h.chars)+.8*(t.words+a.words+h.words),
    cta:90+.12*(t.chars+c.chars)+.5*(t.words+c.words)
  };
  return{stats:{hook:h,title:t,author:a,cta:c},desired};
}
function __c24Allocate(){
  const baseline={hook:90,book:150,cta:120},bounds={hook:[72,126],book:[120,174],cta:[90,132]},load=__c24Need();
  if(PACING_MODE!=='adaptive'&&PACING_MODE!=='reading-adaptive')return{mode:'fixed-v1',frames:baseline,seconds:Object.fromEntries(Object.entries(baseline).map(([k,v])=>[k,v/FPS])),...load};
  const keys=['hook','book','cta'],frames={};for(const k of keys){const [lo,hi]=bounds[k];frames[k]=Math.round(clamp(load.desired[k],lo,hi));}
  let sum=keys.reduce((s,k)=>s+frames[k],0),guard=0;
  while(sum!==360&&guard++<1000){
    if(sum<360){let best=null,bestScore=-Infinity;for(const k of keys){const hi=bounds[k][1];if(frames[k]>=hi)continue;const score=load.desired[k]-frames[k];if(score>bestScore){bestScore=score;best=k;}}if(!best)break;frames[best]++;sum++;}
    else {let best=null,bestScore=-Infinity;for(const k of keys){const lo=bounds[k][0];if(frames[k]<=lo)continue;const score=frames[k]-load.desired[k];if(score>bestScore){bestScore=score;best=k;}}if(!best)break;frames[best]--;sum--;}
  }
  if(sum!==360)throw new Error('C24 allocator could not preserve 360-frame total');
  return{mode:'reading-adaptive-v1',frames,seconds:Object.fromEntries(Object.entries(frames).map(([k,v])=>[k,+((v/FPS).toFixed(3))])),bounds,...load};
}
const __C24_PACING=__c24Allocate();P.pacing=__C24_PACING;
window.__C24_PACING=()=>P.pacing;
`;
html=html.replace(scheduleMarker,pacing+'\n'+scheduleMarker);

// E14 keeps sourceLen at the original plate duration so existing scene animation semantics stay
// stable while C24 changes only dwell. The first len argument becomes the adaptive plate budget.
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

// CTA source animation remains authored against the 120-frame baseline, while duration changes.
// Both title-first and hook-title/normal branches share the same fragment above.

// Swiss hook has a fixed authored exit. Make the exit relative to the new hook duration while
// leaving its entrance timing untouched; E14 remapping keeps the rest of the source scene stable.
html=html.replace('hold=1-easeIO(span(S.i,72,89))','hold=1-easeIO(span(S.t,.81,1))');

fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,html);console.log(`prepared C24 reading-adaptive variant schedule: ${output}`);
