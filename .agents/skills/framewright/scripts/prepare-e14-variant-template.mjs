#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const input=path.resolve(process.argv[2]||'examples/book-ad-systems/index-e12.html');
const output=path.resolve(process.argv[3]||'examples/book-ad-systems/index-e14.html');
let html=fs.readFileSync(input,'utf8');

const oldProgress="function __motionProgress(S){const last=S.plate==='hook'?89:S.plate==='book'?149:119;return clamp(S.i/last);}";
if(!html.includes(oldProgress))throw new Error('E12 motion-progress marker not found');
html=html.replace(oldProgress,"function __motionProgress(S){return clamp(S.t);}");

const fixedSchedule="plate('hook',90,(g,S)=>SYSTEM[P.visual_system][0](g,S));plate('book',150,(g,S)=>SYSTEM[P.visual_system][1](g,S));plate('cta',120,(g,S)=>SYSTEM[P.visual_system][2](g,S));";
if(!html.includes(fixedSchedule))throw new Error('fixed three-plate schedule marker not found');

const variantSchedule=String.raw`
const CREATIVE_VARIANT=String((window.FRAMEWRIGHT_PAYLOAD&&window.FRAMEWRIGHT_PAYLOAD.creative_variant)||'hook-first').toLowerCase();
const CREATIVE_VARIANTS=new Set(['hook-first','cover-first','title-first','hook-title']);
const ACTIVE_VARIANT=CREATIVE_VARIANTS.has(CREATIVE_VARIANT)?CREATIVE_VARIANT:'hook-first';
let __variantPageNumber=1;
const __pageNumBase=pageNum;
pageNum=function(g,n,align='left'){return __pageNumBase(g,__variantPageNumber,align);};

function __variantSemantic(name,len,index,sourceLen,pageNumber){
  plate(name,len,(g,S)=>{
    __variantPageNumber=pageNumber;
    const mapped={...S,i:Math.round(clamp(S.t)*(sourceLen-1)),t:clamp(S.t),plate:name};
    SYSTEM[P.visual_system][index](g,mapped);
  });
}
function __variantTitlePlate(len,pageNumber){
  plate('title',len,(g,S)=>{
    __variantPageNumber=pageNumber;
    __motionCtx={system:P.visual_system,plate:'title',S};__motionTextCall=0;__motionLabelCall=0;
    try{__variantTitle(g,S);__motionOverlay(g,S,P.visual_system,'title');}finally{__motionCtx=null;}
  });
}
function __variantTitle(g,S){
  const a=easeOut(span(S.t,0,.22)),out=1-easeIO(span(S.t,.84,1));
  g.save();g.globalAlpha=a*out;
  if(P.visual_system==='swiss'){
    swissBg(g,S.seed,'title');
    label(g,P.brand,SAFE.x,SAFE.y+48,{size:27,maxW:SAFE.w,weight:800});
    g.fillStyle=P.accent;g.fillRect(SAFE.x,SAFE.y+78,150,8);
    drawCover(g,SAFE.x+30,SAFE.y+190,315,472,{r:-.018,alpha:1});
    const tx=SAFE.x+405,tw=SAFE.w-405;
    label(g,P.eyebrow,tx,SAFE.y+225,{size:22,min:15,maxW:tw,weight:800,color:P.accent});
    const t=textBlock(g,P.title,{x:tx,y:SAFE.y+330,maxW:tw,maxH:430,size:78,min:25,maxLines:8,lineHeight:.93,weight:800});
    label(g,P.author,tx,SAFE.y+370+t.height,{size:27,min:16,maxW:tw,weight:500});
    g.fillStyle=P.ink;g.fillRect(tx,SAFE.y+905,tw,2);
  }else if(P.visual_system==='newspaper'){
    newspaperBg(g,S.seed,'title');newsMast(g);
    label(g,'FEATURED BOOK',SAFE.x,SAFE.y+175,{size:20,maxW:SAFE.w,weight:800,color:P.accent});
    const t=textBlock(g,P.title,{x:SAFE.x,y:SAFE.y+300,maxW:SAFE.w,maxH:440,size:88,min:28,maxLines:7,lineHeight:.96,weight:800});
    label(g,P.author,SAFE.x,SAFE.y+345+t.height,{size:28,min:17,maxW:SAFE.w,weight:500});
    g.fillStyle=P.ink;g.fillRect(SAFE.x,SAFE.y+820,SAFE.w,3);
    drawCover(g,SAFE.x,SAFE.y+875,235,352,{r:0,alpha:1,shadow:false});
    textBlock(g,P.hook,{x:SAFE.x+300,y:SAFE.y+925,maxW:SAFE.w-300,maxH:245,size:31,min:18,maxLines:7,lineHeight:1.08,weight:500});
  }else{
    paperBg(g,S.seed,'title');
    tape(g,SAFE.x+70,SAFE.y+128,260,74,-.055,'#f3df9a',.92);
    label(g,P.eyebrow,SAFE.x+96,SAFE.y+180,{size:22,min:15,maxW:360,weight:800});
    drawCover(g,SAFE.x+28,SAFE.y+285,350,525,{r:-.055,alpha:1,shadowColor:'rgba(17,17,17,.18)'});
    const tx=SAFE.x+430,tw=SAFE.w-430;
    const t=textBlock(g,P.title,{x:tx,y:SAFE.y+360,maxW:tw,maxH:470,size:74,min:24,maxLines:9,lineHeight:.94,weight:800});
    label(g,P.author,tx,SAFE.y+405+t.height,{size:27,min:16,maxW:tw,weight:500});
    tape(g,tx-18,SAFE.y+925,Math.max(160,tw*.78),58,.035,P.accent,.28);
    label(g,P.brand,tx,SAFE.y+965,{size:23,min:15,maxW:tw,weight:800});
  }
  g.globalAlpha=1;pageNum(g,__variantPageNumber,P.visual_system==='newspaper'?'left':'center');g.restore();
}

if(ACTIVE_VARIANT==='cover-first'){
  __variantSemantic('book',150,1,150,1);
  __variantSemantic('hook',90,0,90,2);
  __variantSemantic('cta',120,2,120,3);
}else if(ACTIVE_VARIANT==='title-first'){
  __variantTitlePlate(90,1);
  __variantSemantic('book',150,1,150,2);
  __variantSemantic('cta',120,2,120,3);
}else if(ACTIVE_VARIANT==='hook-title'){
  __variantSemantic('hook',90,0,90,1);
  __variantTitlePlate(150,2);
  __variantSemantic('cta',120,2,120,3);
}else{
  __variantSemantic('hook',90,0,90,1);
  __variantSemantic('book',150,1,150,2);
  __variantSemantic('cta',120,2,120,3);
}`;

html=html.replace(fixedSchedule,variantSchedule);
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,html);
console.log(`prepared E14 structural-variant template: ${output}`);
