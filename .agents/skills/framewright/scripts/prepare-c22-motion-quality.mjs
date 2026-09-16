#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const input=path.resolve(process.argv[2]||'examples/book-ad-systems/index-e12.html');
const output=path.resolve(process.argv[3]||'examples/book-ad-systems/index-c22.html');
let html=fs.readFileSync(input,'utf8');
const start=html.indexOf("const MOTION_MODE=String((window.FRAMEWRIGHT_PAYLOAD&&window.FRAMEWRIGHT_PAYLOAD.motion_density)||'baseline').toLowerCase();");
const end=html.indexOf('const SYSTEM={',start);
if(start<0||end<0)throw new Error('C22 requires the E12 motion block');

const block=String.raw`const MOTION_MODE=String((window.FRAMEWRIGHT_PAYLOAD&&window.FRAMEWRIGHT_PAYLOAD.motion_density)||'baseline').toLowerCase();
const MOTION_ACTIVE=MOTION_MODE==='active';
const MOTION_C22=MOTION_MODE==='choreography-v2';
let __motionCtx=null,__motionTextCall=0,__motionLabelCall=0,__motionCoverCall=0;
function __motionProgress(S){const last=S.plate==='hook'?89:S.plate==='book'?149:119;return clamp(S.i/last);}
function __motionTime(S){return S.i/FPS;}
function __motionStep(v){return Math.round(v);}
function __c22Pulse(p,c=.52,w=.08){const q=span(p,c-w,c+w);return q<=0||q>=1?0:Math.sin(Math.PI*q);}
function __c22Focus(plate){return plate==='hook'?.52:plate==='book'?.58:.40;}

// E12 active behavior remains intact. C22 adds a second mode with finite motion events.
const __drawCoverBase=drawCover;
drawCover=function(g,x,y,w,h,o={}){
  if((!MOTION_ACTIVE&&!MOTION_C22)||!__motionCtx)return __drawCoverBase(g,x,y,w,h,o);
  const {system,S}=__motionCtx,t=__motionTime(S),p=__motionProgress(S);
  let dx=0,dy=0;
  if(MOTION_ACTIVE){
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
  }else{
    const idx=__motionCoverCall++,enter=easeOut(span(S.i,2+idx*2,18+idx*2));
    const fromX=system==='swiss'?14:system==='paper'?-12:8;
    const focus=__c22Pulse(p,__c22Focus(S.plate),.075);
    dx=__motionStep(lerp(fromX,0,enter));
    dy=__motionStep(lerp(18,0,enter)-4*focus);
  }
  return __drawCoverBase(g,x+dx,y+dy,w,h,o);
};

const __textBlockBase=textBlock;
textBlock=function(g,text,o={}){
  if((!MOTION_ACTIVE&&!MOTION_C22)||!__motionCtx)return __textBlockBase(g,text,o);
  const {S}=__motionCtx,idx=__motionTextCall++;
  const reveal=easeOut(span(S.i,MOTION_C22?4+idx*3:5+idx*4,MOTION_C22?18+idx*3:21+idx*4));
  const dx=__motionStep(lerp(MOTION_C22?18:12,0,reveal));
  g.save();g.translate(dx,0);g.globalAlpha*=reveal;
  const r=__textBlockBase(g,text,o);g.restore();return r;
};

const __labelBase=label;
label=function(g,text,x,y,o={}){
  if((!MOTION_ACTIVE&&!MOTION_C22)||!__motionCtx)return __labelBase(g,text,x,y,o);
  const {S}=__motionCtx,idx=__motionLabelCall++;
  const reveal=easeOut(span(S.i,MOTION_C22?2+idx*2:2+idx*2,MOTION_C22?12+idx*2:14+idx*2));
  g.save();g.globalAlpha*=reveal;g.translate(0,__motionStep(lerp(MOTION_C22?7:5,0,reveal)));
  const r=__labelBase(g,text,x,y,o);g.restore();return r;
};

const __tapeBase=tape;
tape=function(g,x,y,w,h,r,color,alpha=.9){
  if((!MOTION_ACTIVE&&!MOTION_C22)||!__motionCtx||__motionCtx.system!=='paper')return __tapeBase(g,x,y,w,h,r,color,alpha);
  const {S}=__motionCtx;
  if(MOTION_ACTIVE){const t=__motionTime(S);return __tapeBase(g,x+__motionStep(Math.sin(t*.48)),y+__motionStep(Math.cos(t*.41)),w,h,r,color,alpha);}
  const enter=easeOut(span(S.i,1,13));
  return __tapeBase(g,x,y+__motionStep(lerp(7,0,enter)),w,h,r,color,alpha*enter);
};

// C22 uses finite semantic events: entrance -> settle -> one focal emphasis -> settle.
// No continuous loops survive after the planned event windows.
function __motionOverlay(g,S,system,plate){
  if(!MOTION_ACTIVE&&!MOTION_C22)return;
  const t=__motionTime(S),p=__motionProgress(S);
  g.save();
  if(MOTION_ACTIVE){
    if(system==='swiss'){
      const railY=SAFE.y+SAFE.h-82;g.globalAlpha=.52;g.fillStyle=P.accent;
      const step=Math.floor(S.i/2),loop=(step%36)/35;
      g.fillRect(SAFE.x,railY,SAFE.w,2);g.fillRect(__motionStep(SAFE.x+loop*(SAFE.w-84)),railY-4,84,10);
      g.globalAlpha=.16;g.fillStyle=P.ink;g.fillRect(SAFE.x+SAFE.w-12,__motionStep(SAFE.y+150+10*Math.sin(t*.48)),3,132);
    }else if(system==='newspaper'){
      g.beginPath();g.rect(SAFE.x,SAFE.y+92,SAFE.w,14);g.clip();
      const step=Math.floor(S.i/2),loop=((step+9)%42)/41;g.globalAlpha=.78;g.fillStyle=P.accent;
      g.fillRect(__motionStep(SAFE.x-96+loop*(SAFE.w+192)),SAFE.y+97,96,4);
      g.globalAlpha=.08;g.fillStyle=P.ink;for(let i=0;i<3;i++)g.fillRect(SAFE.x+((i*283+Math.floor(S.i/3)*3)%SAFE.w),SAFE.y+SAFE.h-90-i*8,36,2);
    }else if(system==='paper'){
      const step=Math.floor(S.i/3),tt=step/(FPS/3);g.globalAlpha=.20;g.strokeStyle=P.accent;g.lineWidth=3;
      const y=__motionStep(SAFE.y+SAFE.h-115+4*Math.sin(tt*.62));g.beginPath();g.moveTo(SAFE.x+40,y);g.lineTo(__motionStep(SAFE.x+220+20*Math.sin(tt*.48)),y-10);g.stroke();
      g.fillStyle=P.accent;g.globalAlpha=.17;for(let i=0;i<2;i++){const a=tt*.43+i*2.7+S.seed*.03,rr=4+i*2;g.beginPath();g.arc(__motionStep(SAFE.x+SAFE.w-100+9*Math.cos(a)),__motionStep(SAFE.y+180+i*38+7*Math.sin(a*.8)),rr,0,Math.PI*2);g.fill();}
    }
    g.restore();return;
  }

  const enter=easeOut(span(p,.03,.20)),focus=__c22Pulse(p,__c22Focus(plate),.085);
  const railY=SAFE.y+SAFE.h-(plate==='cta'?72:92);
  if(system==='swiss'){
    g.fillStyle=P.accent;g.globalAlpha=.46;g.fillRect(SAFE.x,railY,SAFE.w,2);
    const travel=SAFE.x+enter*(SAFE.w-96);g.fillRect(__motionStep(travel),railY-4,96,10);
    if(focus>0){g.globalAlpha=.20+.42*focus;g.fillRect(SAFE.x+SAFE.w-20,SAFE.y+150,4,__motionStep(90+90*focus));}
  }else if(system==='newspaper'){
    g.beginPath();g.rect(SAFE.x,SAFE.y+92,SAFE.w,16);g.clip();g.fillStyle=P.accent;g.globalAlpha=.78;
    g.fillRect(__motionStep(SAFE.x-100+enter*(SAFE.w+100)),SAFE.y+97,100,4);g.restore();g.save();
    if(focus>0){g.fillStyle=P.accent;g.globalAlpha=.22+.42*focus;g.fillRect(SAFE.x,railY,__motionStep((110+220*focus)),3);}
  }else{
    g.strokeStyle=P.accent;g.lineWidth=3;g.globalAlpha=.20;g.beginPath();g.moveTo(SAFE.x+40,railY);g.lineTo(__motionStep(SAFE.x+40+enter*210),railY-8);g.stroke();
    if(focus>0){g.fillStyle=P.accent;g.globalAlpha=.14+.38*focus;g.beginPath();g.arc(SAFE.x+SAFE.w-92,SAFE.y+185,4+7*focus,0,Math.PI*2);g.fill();}
  }
  if(plate==='cta'&&focus>0){
    g.globalAlpha=.10+.18*focus;g.strokeStyle=P.accent;g.lineWidth=2+2*focus;
    const inset=__motionStep(20-8*focus);g.strokeRect(SAFE.x+inset,SAFE.y+SAFE.h-250+inset,SAFE.w-2*inset,150-2*inset);
  }
  g.restore();
}

function __motionWrap(base,system,plate){
  return function(g,S){
    __motionCtx={system,plate,S};__motionTextCall=0;__motionLabelCall=0;__motionCoverCall=0;
    try{base(g,S);__motionOverlay(g,S,system,plate);}finally{__motionCtx=null;}
  };
}
`;

html=html.slice(0,start)+block+html.slice(end);
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,html);
console.log(`prepared C22 choreography-v2 motion template: ${output}`);
