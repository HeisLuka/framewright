#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const input=path.resolve(process.argv[2]||'examples/book-ad-systems/index.html');
const output=path.resolve(process.argv[3]||'examples/book-ad-systems/index-e12.html');
const html=fs.readFileSync(input,'utf8');
const marker="const SYSTEM={swiss:[swissHook,swissBook,swissCta],newspaper:[newspaperHook,newspaperBook,newspaperCta],paper:[paperHook,paperBook,paperCta]};";
if(!html.includes(marker)) throw new Error('E11 SYSTEM marker not found; motion transform needs review');

const injected=String.raw`
const MOTION_MODE=String((window.FRAMEWRIGHT_PAYLOAD&&window.FRAMEWRIGHT_PAYLOAD.motion_density)||'baseline').toLowerCase();
const MOTION_ACTIVE=MOTION_MODE==='active';
let __motionCtx=null,__motionTextCall=0,__motionLabelCall=0;
function __motionProgress(S){const last=S.plate==='hook'?89:S.plate==='book'?149:119;return clamp(S.i/last);}
function __motionTime(S){return S.i/FPS;}
function __motionStep(v){return Math.round(v);}

// Compression rule for E12 v2: move already-rasterized-looking elements by whole pixels.
// Do not continuously scale/rotate them: subpixel edge re-rasterization was the main v1 bitrate tax.
const __drawCoverBase=drawCover;
drawCover=function(g,x,y,w,h,o={}){
  if(!MOTION_ACTIVE||!__motionCtx)return __drawCoverBase(g,x,y,w,h,o);
  const {system,S}=__motionCtx,t=__motionTime(S),p=__motionProgress(S);
  let dx=0,dy=0;
  if(system==='swiss'){
    dx=__motionStep(3*Math.sin(t*.72+S.seed*.13));
    dy=__motionStep(-3*p+1.5*Math.sin(t*.42));
  }else if(system==='newspaper'){
    dx=__motionStep(2*Math.sin(t*.55+1.2));
    dy=__motionStep(-2*p);
  }else if(system==='paper'){
    dx=__motionStep(3*Math.sin(t*.72+S.seed*.07));
    dy=__motionStep(2*Math.cos(t*.58+.5));
  }
  return __drawCoverBase(g,x+dx,y+dy,w,h,o);
};

// Keep a staged entrance, but stop moving text once it has landed.
const __textBlockBase=textBlock;
textBlock=function(g,text,o={}){
  if(!MOTION_ACTIVE||!__motionCtx)return __textBlockBase(g,text,o);
  const {S}=__motionCtx,idx=__motionTextCall++;
  const reveal=easeOut(span(S.i,5+idx*4,21+idx*4));
  const dx=__motionStep(lerp(12,0,reveal));
  g.save();g.translate(dx,0);g.globalAlpha*=reveal;
  const r=__textBlockBase(g,text,o);g.restore();return r;
};

const __labelBase=label;
label=function(g,text,x,y,o={}){
  if(!MOTION_ACTIVE||!__motionCtx)return __labelBase(g,text,x,y,o);
  const {S}=__motionCtx,idx=__motionLabelCall++;
  const reveal=easeOut(span(S.i,2+idx*2,14+idx*2));
  g.save();g.globalAlpha*=reveal;g.translate(0,__motionStep(lerp(5,0,reveal)));
  const r=__labelBase(g,text,x,y,o);g.restore();return r;
};

// Paper retains a physical micro-wobble, but only as +/-1 px translation.
const __tapeBase=tape;
tape=function(g,x,y,w,h,r,color,alpha=.9){
  if(!MOTION_ACTIVE||!__motionCtx||__motionCtx.system!=='paper')return __tapeBase(g,x,y,w,h,r,color,alpha);
  const {S}=__motionCtx,t=__motionTime(S);
  return __tapeBase(g,x+__motionStep(Math.sin(t*.48)),y+__motionStep(Math.cos(t*.41)),w,h,r,color,alpha);
};

// Small moving accents provide motion-per-changed-pixel efficiently.
function __motionOverlay(g,S,system,plate){
  if(!MOTION_ACTIVE)return;
  const t=__motionTime(S);
  g.save();
  if(system==='swiss'){
    const railY=SAFE.y+SAFE.h-82;
    g.globalAlpha=.52;g.fillStyle=P.accent;
    const step=Math.floor(S.i/2),loop=(step%36)/35;
    g.fillRect(SAFE.x,railY,SAFE.w,2);
    g.fillRect(__motionStep(SAFE.x+loop*(SAFE.w-84)),railY-4,84,10);
    g.globalAlpha=.16;g.fillStyle=P.ink;
    g.fillRect(SAFE.x+SAFE.w-12,__motionStep(SAFE.y+150+10*Math.sin(t*.48)),3,132);
  }else if(system==='newspaper'){
    g.beginPath();g.rect(SAFE.x,SAFE.y+92,SAFE.w,14);g.clip();
    const step=Math.floor(S.i/2),loop=((step+9)%42)/41;
    g.globalAlpha=.78;g.fillStyle=P.accent;
    g.fillRect(__motionStep(SAFE.x-96+loop*(SAFE.w+192)),SAFE.y+97,96,4);
    g.globalAlpha=.08;g.fillStyle=P.ink;
    for(let i=0;i<3;i++)g.fillRect(SAFE.x+((i*283+Math.floor(S.i/3)*3)%SAFE.w),SAFE.y+SAFE.h-90-i*8,36,2);
  }else if(system==='paper'){
    const step=Math.floor(S.i/3),tt=step/(FPS/3);
    g.globalAlpha=.20;g.strokeStyle=P.accent;g.lineWidth=3;
    const y=__motionStep(SAFE.y+SAFE.h-115+4*Math.sin(tt*.62));
    g.beginPath();g.moveTo(SAFE.x+40,y);g.lineTo(__motionStep(SAFE.x+220+20*Math.sin(tt*.48)),y-10);g.stroke();
    g.fillStyle=P.accent;g.globalAlpha=.17;
    for(let i=0;i<2;i++){
      const a=tt*.43+i*2.7+S.seed*.03,rr=4+i*2;
      g.beginPath();g.arc(__motionStep(SAFE.x+SAFE.w-100+9*Math.cos(a)),__motionStep(SAFE.y+180+i*38+7*Math.sin(a*.8)),rr,0,Math.PI*2);g.fill();
    }
  }
  g.restore();
}

function __motionWrap(base,system,plate){
  return function(g,S){
    __motionCtx={system,plate,S};__motionTextCall=0;__motionLabelCall=0;
    try{base(g,S);__motionOverlay(g,S,system,plate);}finally{__motionCtx=null;}
  };
}
const SYSTEM={
  swiss:[__motionWrap(swissHook,'swiss','hook'),__motionWrap(swissBook,'swiss','book'),__motionWrap(swissCta,'swiss','cta')],
  newspaper:[__motionWrap(newspaperHook,'newspaper','hook'),__motionWrap(newspaperBook,'newspaper','book'),__motionWrap(newspaperCta,'newspaper','cta')],
  paper:[__motionWrap(paperHook,'paper','hook'),__motionWrap(paperBook,'paper','book'),__motionWrap(paperCta,'paper','cta')]
};`;

const out=html.replace(marker,injected);
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,out);
console.log(`prepared E12 motion template: ${output}`);
