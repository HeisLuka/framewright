#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const input=path.resolve(process.argv[2]||'examples/book-ad-systems/index-c23.html');
const output=path.resolve(process.argv[3]||'examples/book-ad-systems/index-c24.html');
let html=fs.readFileSync(input,'utf8');

const hookPlate=/plate\('hook',\s*90\s*,/;
const bookPlate=/plate\('book',\s*150\s*,/;
const ctaPlate=/plate\('cta',\s*120\s*,/;
if(!hookPlate.test(html)||!bookPlate.test(html)||!ctaPlate.test(html))throw new Error('C24 baseline plate declarations missing');
const pacing=String.raw`
const PACING_MODE=String((window.FRAMEWRIGHT_PAYLOAD&&window.FRAMEWRIGHT_PAYLOAD.pacing_mode)||'fixed').toLowerCase();
function __c24TextStats(text){const s=String(text||'').trim(),words=s?s.split(/\s+/).filter(Boolean).length:0,chars=Array.from(s).filter(ch=>!\s/.test(ch)).length;return{words,chars};}
function __c24Need(){
  const h=__c24TextStats(P.hook),t=__c24TextStats(P.title),a=__c24TextStats(P.author),c=__c24TextStats(P.cta);
  // These are bounded design weights, not a claim about a universal human reading speed.
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
// Insert the allocator before the first plate declaration, then only replace each duration argument.
// Earlier preparers are free to wrap/change the callbacks without breaking C24.
html=html.replace(hookPlate,pacing+"\nplate('hook',__C24_PACING.frames.hook,");
html=html.replace(bookPlate,"plate('book',__C24_PACING.frames.book,");
html=html.replace(ctaPlate,"plate('cta',__C24_PACING.frames.cta,");

// C22 originally normalized motion against fixed 90/150/120-frame plates. The renderer already
// exposes S.t as local-frame / actual-plate-length, so use it after C24 changes the budgets.
const motionFixed="function __motionProgress(S){const last=S.plate==='hook'?89:S.plate==='book'?149:119;return clamp(S.i/last);}";
if(html.includes(motionFixed))html=html.replace(motionFixed,'function __motionProgress(S){return clamp(S.t);}');

// Swiss hook has an explicit fixed-frame exit. Make only this exit relative to the plate duration;
// entry timings stay fixed so C24 varies dwell rather than animation speed.
html=html.replace('hold=1-easeIO(span(S.i,72,89))','hold=1-easeIO(span(S.t,.81,1))');

fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,html);console.log(`prepared C24 reading-adaptive pacing template: ${output}`);
