#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const input=path.resolve(process.argv[2]||'examples/book-ad-systems/index-c20.html');
const output=path.resolve(process.argv[3]||'examples/book-ad-systems/index-c21.html');
let html=fs.readFileSync(input,'utf8');

const marker="const CREATIVE_VARIANT=String((window.FRAMEWRIGHT_PAYLOAD&&window.FRAMEWRIGHT_PAYLOAD.creative_variant)||'hook-first').toLowerCase();";
if(!html.includes(marker))throw new Error('C21 requires the E14/E18 semantic-variant marker');

const injection=String.raw`
const OPENING_GRAMMAR=String((window.FRAMEWRIGHT_PAYLOAD&&window.FRAMEWRIGHT_PAYLOAD.opening_grammar)||'hook-led').toLowerCase();
const OPENING_GRAMMARS=new Set(['hook-led','cover-led','title-led','progressive-hook']);
const ACTIVE_OPENING_GRAMMAR=OPENING_GRAMMARS.has(OPENING_GRAMMAR)?OPENING_GRAMMAR:'hook-led';

function __c21Bg(g,S,style){
  // Keep the exact baseline hook background/motif. C21 is allowed to change foreground hierarchy and timing only.
  if(typeof __profileBg==='function')return __profileBg(g,S,style,'hook');
  if(style==='swiss')return swissBg(g,S.seed,'hook');
  if(style==='newspaper')return newspaperBg(g,S.seed,'hook');
  return paperBg(g,S.seed,'hook');
}
function __c21Header(g,style){if(typeof __profileHeader==='function')return __profileHeader(g,style);}
function __c21Fade(S){return 1-easeIO(span(S.t,.52,.72));}
function __c21Words(text){return String(text).trim().split(/\s+/).filter(Boolean);}
function __c21ProgressiveHook(text,t){
  const words=__c21Words(text);if(!words.length)return '';
  const reveal=easeOut(span(t,.02,.42));
  const n=Math.max(1,Math.min(words.length,Math.ceil(words.length*reveal)));
  return words.slice(0,n).join(' ')+(n<words.length?'…':'');
}
function __c21OpeningOverlay(g,S,style){
  if(ACTIVE_OPENING_GRAMMAR==='hook-led'||S.t>.72)return;
  const out=__c21Fade(S);if(out<=0)return;
  g.save();g.globalAlpha=out;__c21Bg(g,S,style);__c21Header(g,style);
  const top=SAFE.y+(PROFILE==='vertical'?145:120),cx=SAFE.x+SAFE.w/2;
  if(ACTIVE_OPENING_GRAMMAR==='cover-led'){
    const p=easeOut(span(S.t,0,.34));
    const maxH=PROFILE==='vertical'?720:Math.min(620,SAFE.h*.68),h=maxH*(.78+.22*p),w=h*(2/3);
    drawCover(g,cx-w/2,top+lerp(70,0,p),w,h,{r:style==='paper'?-0.045:style==='swiss'?-0.015:0,alpha:p,shadow:style!=='newspaper',shadowColor:style==='paper'?P.accent:undefined,offset:style==='paper'?8:0});
    label(g,P.eyebrow,cx,top+h+92,{size:22,min:15,maxW:SAFE.w*.85,weight:800,color:P.accent,align:'center'});
  }else if(ACTIVE_OPENING_GRAMMAR==='title-led'){
    const p=easeOut(span(S.t,0,.28));
    label(g,P.eyebrow,SAFE.x,top,{size:22,min:15,maxW:SAFE.w,weight:800,color:P.accent});
    textBlock(g,P.title,{x:SAFE.x,y:top+150+lerp(46,0,p),maxW:SAFE.w,maxH:PROFILE==='vertical'?630:420,size:PROFILE==='vertical'?104:84,min:30,maxLines:7,lineHeight:.91,weight:800});
    g.fillStyle=P.accent;g.fillRect(SAFE.x,top+(PROFILE==='vertical'?860:620),Math.min(240,SAFE.w*.28),8);
  }else{
    const revealed=__c21ProgressiveHook(P.hook,S.t),p=easeOut(span(S.t,0,.22));
    label(g,'01',SAFE.x,top,{size:26,weight:800,color:P.accent});
    textBlock(g,revealed,{x:SAFE.x,y:top+190+lerp(55,0,p),maxW:SAFE.w,maxH:PROFILE==='vertical'?620:400,size:PROFILE==='vertical'?108:82,min:30,maxLines:6,lineHeight:.92,weight:800});
    const tick=Math.max(1,__c21Words(revealed).length);
    g.fillStyle=P.accent;g.fillRect(SAFE.x,top+(PROFILE==='vertical'?860:590),Math.max(80,Math.min(SAFE.w,tick*72)),8);
  }
  g.restore();
}

for(const style of ['swiss','newspaper','paper']){
  if(!SYSTEM[style]||!SYSTEM[style][0])continue;
  const base=SYSTEM[style][0];
  SYSTEM[style][0]=(g,S)=>{base(g,S);__c21OpeningOverlay(g,S,style);};
}
window.__C21_OPENING_GRAMMAR=ACTIVE_OPENING_GRAMMAR;
`;

html=html.replace(marker,injection+'\n'+marker);
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,html);
console.log(`prepared C21 deterministic opening grammar: ${output}`);
