#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const input=path.resolve(process.argv[2]||'examples/book-ad-systems/index-e12.html');
const output=path.resolve(process.argv[3]||'examples/book-ad-systems/index-e17.html');
let html=fs.readFileSync(input,'utf8');

const constants=`const FPS=30,LW=1080,LH=1920,CX=LW/2;\nconst WIDTH=+(Q.get('w')||1080),SEED=+(Q.get('s')||7);\nconst SAFE={x:76,y:288,w:928,h:1248};`;
const responsiveConstants=`const FPS=30;\nconst DELIVERY_PROFILE=String((window.FRAMEWRIGHT_PAYLOAD&&window.FRAMEWRIGHT_PAYLOAD.delivery_profile)||Q.get('profile')||'vertical').toLowerCase();\nconst PROFILE=['vertical','square','landscape'].includes(DELIVERY_PROFILE)?DELIVERY_PROFILE:'vertical';\nconst DIMS=PROFILE==='square'?{w:1080,h:1080}:PROFILE==='landscape'?{w:1920,h:1080}:{w:1080,h:1920};\nconst LW=DIMS.w,LH=DIMS.h,CX=LW/2;\nconst WIDTH=+(Q.get('w')||DIMS.w),SEED=+(Q.get('s')||7);\nconst SAFE=PROFILE==='vertical'?{x:76,y:288,w:928,h:1248}:PROFILE==='square'?{x:64,y:62,w:952,h:956}:{x:110,y:70,w:1700,h:940};`;
if(!html.includes(constants))throw new Error('E11 constants marker not found');
html=html.replace(constants,responsiveConstants);

const systemMarker=`const SYSTEM={\n  swiss:[__motionWrap(swissHook,'swiss','hook'),__motionWrap(swissBook,'swiss','book'),__motionWrap(swissCta,'swiss','cta')],\n  newspaper:[__motionWrap(newspaperHook,'newspaper','hook'),__motionWrap(newspaperBook,'newspaper','book'),__motionWrap(newspaperCta,'newspaper','cta')],\n  paper:[__motionWrap(paperHook,'paper','hook'),__motionWrap(paperBook,'paper','book'),__motionWrap(paperCta,'paper','cta')]\n};`;
if(!html.includes(systemMarker))throw new Error('E12 SYSTEM marker not found');

const responsiveSystem=String.raw`
const VERTICAL_SYSTEM={
  swiss:[__motionWrap(swissHook,'swiss','hook'),__motionWrap(swissBook,'swiss','book'),__motionWrap(swissCta,'swiss','cta')],
  newspaper:[__motionWrap(newspaperHook,'newspaper','hook'),__motionWrap(newspaperBook,'newspaper','book'),__motionWrap(newspaperCta,'newspaper','cta')],
  paper:[__motionWrap(paperHook,'paper','hook'),__motionWrap(paperBook,'paper','book'),__motionWrap(paperCta,'paper','cta')]
};
function __profileBg(g,S,style,plate){
  if(style==='swiss')swissBg(g,S.seed,plate);else if(style==='newspaper')newspaperBg(g,S.seed,plate);else paperBg(g,S.seed,plate);
}
function __profileHeader(g,style){
  if(style==='swiss'){
    label(g,P.brand,SAFE.x,SAFE.y+30,{size:25,maxW:SAFE.w,weight:800});
    g.fillStyle=P.accent;g.fillRect(SAFE.x,SAFE.y+48,Math.min(180,SAFE.w*.16),7);
  }else if(style==='newspaper'){
    newsMast(g);
  }else{
    tape(g,SAFE.x,SAFE.y+4,Math.min(360,SAFE.w*.28),64,-.025,P.accent,.86);
    label(g,P.brand.toUpperCase(),SAFE.x+20,SAFE.y+48,{size:22,min:15,maxW:Math.min(320,SAFE.w*.25),weight:800,color:'#fff'});
  }
}
function __profilePage(g,n){pageNum(g,n,PROFILE==='square'?'center':'left');}
function __responsiveHook(g,S,style){
  __profileBg(g,S,style,'hook');__profileHeader(g,style);
  const a=easeOut(span(S.t,0,.24)),out=1-easeIO(span(S.t,.84,1));g.save();g.globalAlpha=a*out;
  if(PROFILE==='square'){
    const top=SAFE.y+(style==='newspaper'?170:150);
    if(style==='paper'){tape(g,SAFE.x+SAFE.w-300,SAFE.y+105,270,52,.035,P.ink,.09);}
    if(style==='newspaper'){label(g,'“',SAFE.x,top+105,{size:130,weight:800,color:P.accent});}
    else {g.fillStyle=P.accent;g.fillRect(SAFE.x,top-18,110,8);}
    textBlock(g,P.hook,{x:SAFE.x+(style==='newspaper'?30:0),y:top+190,maxW:SAFE.w-(style==='newspaper'?60:0),maxH:520,size:82,min:30,maxLines:8,lineHeight:.96,weight:800});
    label(g,P.eyebrow,SAFE.x,SAFE.y+SAFE.h-105,{size:21,min:14,maxW:SAFE.w*.6,weight:800,color:P.accent});
  }else{
    const coverW=390,coverH=585,coverX=SAFE.x+SAFE.w-coverW-20,coverY=SAFE.y+145;
    const textW=SAFE.w-coverW-130;
    if(style==='newspaper')label(g,'“',SAFE.x,SAFE.y+285,{size:140,weight:800,color:P.accent});
    else if(style==='paper')tape(g,SAFE.x,SAFE.y+135,300,58,-.035,P.accent,.76);
    else {g.fillStyle=P.accent;g.fillRect(SAFE.x,SAFE.y+150,14,520);}
    textBlock(g,P.hook,{x:SAFE.x+(style==='swiss'?42:0),y:SAFE.y+330,maxW:textW-(style==='swiss'?42:0),maxH:470,size:88,min:32,maxLines:7,lineHeight:.95,weight:800});
    label(g,P.eyebrow,SAFE.x+(style==='swiss'?42:0),SAFE.y+760,{size:22,min:15,maxW:textW,weight:800,color:P.accent});
    drawCover(g,coverX,coverY,coverW,coverH,{r:style==='paper'?-0.045:style==='swiss'?-0.015:0,alpha:1,shadow:style!=='newspaper',shadowColor:style==='paper'?P.accent:undefined,offset:style==='paper'?8:0});
  }
  g.restore();__profilePage(g,1);
}
function __responsiveBook(g,S,style){
  __profileBg(g,S,style,'book');__profileHeader(g,style);const a=easeOut(span(S.t,0,.22));g.save();g.globalAlpha=a;
  if(PROFILE==='square'){
    const coverW=330,coverH=495,coverX=SAFE.x+20,coverY=SAFE.y+185,tx=SAFE.x+400,tw=SAFE.w-420;
    drawCover(g,coverX,coverY,coverW,coverH,{r:style==='paper'?-0.055:style==='swiss'?-0.018:0,alpha:1,shadow:style!=='newspaper',shadowColor:style==='paper'?P.accent:undefined,offset:style==='paper'?8:0});
    label(g,P.eyebrow,tx,SAFE.y+190,{size:20,min:14,maxW:tw,weight:800,color:P.accent});
    const t=textBlock(g,P.title,{x:tx,y:SAFE.y+285,maxW:tw,maxH:300,size:60,min:22,maxLines:7,lineHeight:.93,weight:800});
    label(g,P.author,tx,SAFE.y+320+t.height,{size:24,min:15,maxW:tw,weight:500});
    g.fillStyle=P.ink;g.fillRect(tx,SAFE.y+670,tw,2);
    textBlock(g,P.hook,{x:tx,y:SAFE.y+720,maxW:tw,maxH:190,size:26,min:17,maxLines:7,lineHeight:1.08,weight:500});
  }else{
    const coverW=400,coverH=600,coverX=SAFE.x+35,coverY=SAFE.y+160,tx=SAFE.x+535,tw=SAFE.w-555;
    drawCover(g,coverX,coverY,coverW,coverH,{r:style==='paper'?-0.05:style==='swiss'?-0.015:0,alpha:1,shadow:style!=='newspaper',shadowColor:style==='paper'?P.accent:undefined,offset:style==='paper'?8:0});
    label(g,P.eyebrow,tx,SAFE.y+175,{size:22,min:15,maxW:tw,weight:800,color:P.accent});
    const t=textBlock(g,P.title,{x:tx,y:SAFE.y+285,maxW:tw,maxH:300,size:72,min:25,maxLines:6,lineHeight:.92,weight:800});
    label(g,P.author,tx,SAFE.y+330+t.height,{size:27,min:16,maxW:tw,weight:500});
    g.fillStyle=P.ink;g.fillRect(tx,SAFE.y+625,Math.min(tw,720),2);
    textBlock(g,P.hook,{x:tx,y:SAFE.y+690,maxW:Math.min(tw,850),maxH:190,size:30,min:18,maxLines:6,lineHeight:1.08,weight:500});
  }
  g.restore();__profilePage(g,2);
}
function __responsiveCta(g,S,style){
  __profileBg(g,S,style,'cta');__profileHeader(g,style);const a=easeOut(span(S.t,0,.24));g.save();g.globalAlpha=a;
  if(PROFILE==='square'){
    const coverW=260,coverH=390,coverX=SAFE.x+40,coverY=SAFE.y+190,tx=SAFE.x+350,tw=SAFE.w-390;
    drawCover(g,coverX,coverY,coverW,coverH,{r:style==='paper'?0.035:0,alpha:1,shadow:style!=='newspaper',shadowColor:style==='paper'?P.accent:undefined,offset:style==='paper'?7:0});
    const t=textBlock(g,P.title,{x:tx,y:SAFE.y+250,maxW:tw,maxH:230,size:58,min:23,maxLines:5,lineHeight:.93,weight:800});
    label(g,P.author,tx,SAFE.y+290+t.height,{size:24,min:15,maxW:tw,weight:500});
    const by=SAFE.y+700,bw=SAFE.w-80;g.fillStyle=style==='paper'?P.ink:P.accent;roundRect(g,SAFE.x+40,by,bw,105,52);g.fill();
    label(g,P.cta.toUpperCase(),CX,by+68,{size:34,min:20,maxW:bw-100,weight:800,color:'#fff',align:'center'});
  }else{
    const coverW=300,coverH=450,coverX=SAFE.x+80,coverY=SAFE.y+190,tx=SAFE.x+520,tw=SAFE.w-570;
    drawCover(g,coverX,coverY,coverW,coverH,{r:style==='paper'?0.035:0,alpha:1,shadow:style!=='newspaper',shadowColor:style==='paper'?P.accent:undefined,offset:style==='paper'?8:0});
    const t=textBlock(g,P.title,{x:tx,y:SAFE.y+250,maxW:tw,maxH:240,size:68,min:25,maxLines:5,lineHeight:.93,weight:800});
    label(g,P.author,tx,SAFE.y+295+t.height,{size:27,min:16,maxW:tw,weight:500});
    const bw=Math.min(760,tw),by=SAFE.y+650;g.fillStyle=style==='paper'?P.ink:P.accent;roundRect(g,tx,by,bw,112,56);g.fill();
    label(g,P.cta.toUpperCase(),tx+bw/2,by+72,{size:36,min:21,maxW:bw-100,weight:800,color:'#fff',align:'center'});
  }
  g.restore();__profilePage(g,3);
}
function __responsiveSet(style){return[
  __motionWrap((g,S)=>__responsiveHook(g,S,style),style,'hook'),
  __motionWrap((g,S)=>__responsiveBook(g,S,style),style,'book'),
  __motionWrap((g,S)=>__responsiveCta(g,S,style),style,'cta')
];}
const SYSTEM=PROFILE==='vertical'?VERTICAL_SYSTEM:{swiss:__responsiveSet('swiss'),newspaper:__responsiveSet('newspaper'),paper:__responsiveSet('paper')};`;
html=html.replace(systemMarker,responsiveSystem);

const renderAspect="const W=Math.max(2,Math.round(width)),H=Math.round(W*16/9/2)*2";
if(!html.includes(renderAspect))throw new Error('render aspect marker not found');
html=html.replace(renderAspect,"const W=Math.max(2,Math.round(width)),H=Math.round(W*LH/LW/2)*2");
html=html.replaceAll('Math.round(cellW*16/9)','Math.round(cellW*LH/LW)').replaceAll('Math.round(cellW*2*16/9)','Math.round(cellW*2*LH/LW)');

fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,html);
console.log(`prepared E17 responsive semantic template: ${output}`);
