#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const input=path.resolve(process.argv[2]||'examples/book-ad-systems/index-e17-e14.html');
const output=path.resolve(process.argv[3]||'examples/book-ad-systems/index-e18.html');
let html=fs.readFileSync(input,'utf8');
const start=html.indexOf('function __variantTitle(g,S){');
const end=html.indexOf("\n\nif(ACTIVE_VARIANT==='cover-first')",start);
if(start<0||end<0)throw new Error('E14 title-plate function marker not found');
const original=html.slice(start,end).replace('function __variantTitle(g,S){','function __variantTitleVertical(g,S){');
const responsive=String.raw`
${original}
function __variantTitle(g,S){
  if(PROFILE==='vertical')return __variantTitleVertical(g,S);
  const a=easeOut(span(S.t,0,.22)),out=1-easeIO(span(S.t,.84,1));
  g.save();g.globalAlpha=a*out;__profileBg(g,S,P.visual_system,'title');__profileHeader(g,P.visual_system);
  if(PROFILE==='square'){
    const coverW=300,coverH=450,coverX=SAFE.x+20,coverY=SAFE.y+190,tx=SAFE.x+375,tw=SAFE.w-395;
    if(P.visual_system==='paper')tape(g,SAFE.x+SAFE.w-280,SAFE.y+110,250,48,.03,P.accent,.24);
    drawCover(g,coverX,coverY,coverW,coverH,{r:P.visual_system==='paper'?-0.05:P.visual_system==='swiss'?-0.018:0,alpha:1,shadow:P.visual_system!=='newspaper',shadowColor:P.visual_system==='paper'?P.accent:undefined,offset:P.visual_system==='paper'?7:0});
    label(g,'FEATURED BOOK',tx,SAFE.y+190,{size:19,min:13,maxW:tw,weight:800,color:P.accent});
    const t=textBlock(g,P.title,{x:tx,y:SAFE.y+285,maxW:tw,maxH:330,size:62,min:22,maxLines:8,lineHeight:.93,weight:800});
    label(g,P.author,tx,SAFE.y+325+t.height,{size:24,min:15,maxW:tw,weight:500});
    g.fillStyle=P.ink;g.fillRect(tx,SAFE.y+690,tw,2);
    textBlock(g,P.hook,{x:tx,y:SAFE.y+735,maxW:tw,maxH:175,size:25,min:16,maxLines:6,lineHeight:1.07,weight:500});
  }else{
    const coverW=330,coverH=495,coverX=SAFE.x+60,coverY=SAFE.y+170,tx=SAFE.x+500,tw=SAFE.w-540;
    if(P.visual_system==='paper')tape(g,SAFE.x+SAFE.w-360,SAFE.y+100,330,52,.03,P.accent,.24);
    drawCover(g,coverX,coverY,coverW,coverH,{r:P.visual_system==='paper'?-0.045:P.visual_system==='swiss'?-0.015:0,alpha:1,shadow:P.visual_system!=='newspaper',shadowColor:P.visual_system==='paper'?P.accent:undefined,offset:P.visual_system==='paper'?8:0});
    label(g,'FEATURED BOOK',tx,SAFE.y+175,{size:21,min:14,maxW:tw,weight:800,color:P.accent});
    const t=textBlock(g,P.title,{x:tx,y:SAFE.y+285,maxW:tw,maxH:300,size:72,min:24,maxLines:6,lineHeight:.92,weight:800});
    label(g,P.author,tx,SAFE.y+330+t.height,{size:27,min:16,maxW:tw,weight:500});
    g.fillStyle=P.ink;g.fillRect(tx,SAFE.y+610,Math.min(tw,760),2);
    textBlock(g,P.hook,{x:tx,y:SAFE.y+670,maxW:Math.min(tw,900),maxH:180,size:29,min:17,maxLines:6,lineHeight:1.07,weight:500});
  }
  g.globalAlpha=1;__profilePage(g,__variantPageNumber);g.restore();
}`;
html=html.slice(0,start)+responsive+html.slice(end);
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,html);
console.log(`prepared E18 responsive structural variants: ${output}`);
