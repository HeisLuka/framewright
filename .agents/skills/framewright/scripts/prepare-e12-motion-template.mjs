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
function __motionProgress(S){return S.i/Math.max(1,S.p?.len?S.p.len-1:119);}
function __motionTime(S){return S.i/FPS;}

const __drawCoverBase=drawCover;
drawCover=function(g,x,y,w,h,o={}){
  if(!MOTION_ACTIVE||!__motionCtx)return __drawCoverBase(g,x,y,w,h,o);
  const {system,S}=__motionCtx,t=__motionTime(S),p=__motionProgress(S);
  let dx=0,dy=0,scale=1,dr=0;
  if(system==='swiss'){
    scale=1+.025*p;
    dx=6*Math.sin(t*.9+S.seed*.13);
    dy=-10*p+3*Math.sin(t*.55);
    dr=.004*Math.sin(t*.75);
  }else if(system==='newspaper'){
    scale=1+.014*p;
    dx=3*Math.sin(t*.7+1.2);
    dy=-7*p;
    dr=.0025*Math.sin(t*.55);
  }else if(system==='paper'){
    scale=1+.012*Math.sin(t*.43+.4);
    dx=5*Math.sin(t*1.05+S.seed*.07);
    dy=4*Math.cos(t*.82+.5);
    dr=.010*Math.sin(t*1.12+.3);
  }
  const nw=w*scale,nh=h*scale;
  return __drawCoverBase(g,x-(nw-w)/2+dx,y-(nh-h)/2+dy,nw,nh,{...o,r:(o.r||0)+dr});
};

const __textBlockBase=textBlock;
textBlock=function(g,text,o={}){
  if(!MOTION_ACTIVE||!__motionCtx)return __textBlockBase(g,text,o);
  const {system,S}=__motionCtx,idx=__motionTextCall++,t=__motionTime(S);
  const reveal=easeOut(span(S.i,5+idx*4,21+idx*4));
  const drift=system==='paper'?2.5*Math.sin(t*.72+idx):system==='newspaper'?1.5*Math.sin(t*.45+idx):1.8*Math.sin(t*.55+idx);
  g.save();g.translate(lerp(16,0,reveal)+drift,0);g.globalAlpha*=reveal;
  const r=__textBlockBase(g,text,o);g.restore();return r;
};

const __labelBase=label;
label=function(g,text,x,y,o={}){
  if(!MOTION_ACTIVE||!__motionCtx)return __labelBase(g,text,x,y,o);
  const {S}=__motionCtx,idx=__motionLabelCall++,t=__motionTime(S);
  const reveal=easeOut(span(S.i,2+idx*2,14+idx*2));
  g.save();g.globalAlpha*=reveal;g.translate(0,lerp(7,0,reveal)+.8*Math.sin(t*.6+idx*.7));
  const r=__labelBase(g,text,x,y,o);g.restore();return r;
};

const __tapeBase=tape;
tape=function(g,x,y,w,h,r,color,alpha=.9){
  if(!MOTION_ACTIVE||!__motionCtx||__motionCtx.system!=='paper')return __tapeBase(g,x,y,w,h,r,color,alpha);
  const {S}=__motionCtx,t=__motionTime(S),p=__motionProgress(S);
  return __tapeBase(g,x+3*Math.sin(t*.83),y+2*Math.cos(t*.61),w,h,r+.008*Math.sin(t*.95+p*2),color,alpha);
};

function __motionOverlay(g,S,system,plate){
  if(!MOTION_ACTIVE)return;
  const t=__motionTime(S),p=__motionProgress(S);
  g.save();
  if(system==='swiss'){
    const railY=SAFE.y+SAFE.h-82;
    g.globalAlpha=.58;g.fillStyle=P.accent;
    const loop=(S.i%54)/53;
    g.fillRect(SAFE.x,railY,SAFE.w,2);
    g.fillRect(SAFE.x+loop*(SAFE.w-128),railY-5,128,12);
    g.globalAlpha=.20;g.fillStyle=P.ink;
    g.fillRect(SAFE.x+SAFE.w-12,SAFE.y+130+18*Math.sin(t*.75),4,190);
  }else if(system==='newspaper'){
    g.beginPath();g.rect(SAFE.x,SAFE.y+92,SAFE.w,16);g.clip();
    const loop=((S.i+17)%72)/71;
    g.globalAlpha=.85;g.fillStyle=P.accent;
    g.fillRect(SAFE.x-150+loop*(SAFE.w+300),SAFE.y+97,150,5);
    g.globalAlpha=.10;g.fillStyle=P.ink;
    for(let i=0;i<4;i++)g.fillRect(SAFE.x+((i*247+S.i*3)%SAFE.w),SAFE.y+SAFE.h-92-i*8,52,2);
  }else if(system==='paper'){
    g.globalAlpha=.28;g.strokeStyle=P.accent;g.lineWidth=4;
    const y=SAFE.y+SAFE.h-115+8*Math.sin(t*.8);
    g.beginPath();g.moveTo(SAFE.x+40,y);g.lineTo(SAFE.x+250+45*Math.sin(t*.55),y-14);g.stroke();
    g.fillStyle=P.accent;g.globalAlpha=.22;
    for(let i=0;i<3;i++){
      const a=t*.55+i*2.1+S.seed*.03,rr=5+i*2;
      g.beginPath();g.arc(SAFE.x+SAFE.w-100+20*Math.cos(a),SAFE.y+160+i*34+14*Math.sin(a*.9),rr,0,Math.PI*2);g.fill();
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
