#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const input=path.resolve(process.argv[2]||'examples/book-ad-systems/index-c22-final.html');
const output=path.resolve(process.argv[3]||'examples/book-ad-systems/index-c23.html');
let html=fs.readFileSync(input,'utf8');

const safeMarker='function safeDebug(g){';
if(!html.includes(safeMarker))throw new Error('C23 drawCover marker missing');
const drawWrap=String.raw`
const COVER_COMPOSITION_MODE=String((window.FRAMEWRIGHT_PAYLOAD&&window.FRAMEWRIGHT_PAYLOAD.cover_composition_mode)||'fixed').toLowerCase();
function __c23CoverAnalysis(){
  if(!COVER)return{source:'fallback',reason:'cover-unavailable'};
  try{
    const W=72,H=108,GX=6,GY=9,cv=cvs('c23-comp',W,H),g=cv.getContext('2d');g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,W,H);g.drawImage(COVER,0,0,W,H);
    const d=g.getImageData(0,0,W,H).data,L=new Float32Array(W*H);
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4,r=d[i],gg=d[i+1],b=d[i+2];L[y*W+x]=.2126*r+.7152*gg+.0722*b;}
    const cells=[];let total=0,cx=0,cy=0,maxScore=0;
    for(let gy=0;gy<GY;gy++)for(let gx=0;gx<GX;gx++){
      const x0=Math.floor(gx*W/GX),x1=Math.floor((gx+1)*W/GX),y0=Math.floor(gy*H/GY),y1=Math.floor((gy+1)*H/GY);
      let n=0,sum=0,sum2=0,edge=0,tests=0,bins=new Uint16Array(8);
      for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const v=L[y*W+x];n++;sum+=v;sum2+=v*v;bins[Math.min(7,Math.floor(v/32))]++;if(x+1<x1){tests++;edge+=Math.abs(v-L[y*W+x+1])>22?1:0;}if(y+1<y1){tests++;edge+=Math.abs(v-L[(y+1)*W+x])>22?1:0;}}
      const mean=sum/Math.max(1,n),variance=Math.max(0,sum2/Math.max(1,n)-mean*mean)/(255*255),edgeDensity=edge/Math.max(1,tests);let ent=0;for(const q of bins){if(!q)continue;const p=q/n;ent-=p*Math.log2(p);}ent/=3;
      const centerPenalty=.72+.28*(1-Math.min(1,Math.hypot((gx+.5)/GX-.5,(gy+.5)/GY-.5)/.7));const score=(edgeDensity*.50+Math.sqrt(variance)*.28+ent*.22)*centerPenalty;
      cells.push({gx,gy,mean:+mean.toFixed(2),variance:+variance.toFixed(5),edgeDensity:+edgeDensity.toFixed(4),entropy:+ent.toFixed(4),score:+score.toFixed(5)});
      total+=score;cx+=score*(gx+.5)/GX;cy+=score*(gy+.5)/GY;maxScore=Math.max(maxScore,score);
    }
    const focusX=total?cx/total:.5,focusY=total?cy/total:.5,confidence=total?maxScore/(total/cells.length):0;
    const textSide=confidence>=1.35?(focusX>.54?'left':focusX<.46?'right':'right'):'right';
    const zoom=1+clamp((confidence-1.35)*.035,0,.06),zoomRetention=1/(zoom*zoom);
    return{source:'cover',mode:'grid-saliency-v2',focusX:+focusX.toFixed(4),focusY:+focusY.toFixed(4),confidence:+confidence.toFixed(3),textSide,zoom:+zoom.toFixed(4),zoomRetention:+zoomRetention.toFixed(4),cells};
  }catch(e){return{source:'fallback',reason:String(e&&e.message||e)};}
}
function applyCoverComposition(){
  if(COVER_COMPOSITION_MODE!=='adaptive'&&COVER_COMPOSITION_MODE!=='cover-adaptive'){P.cover_composition={mode:'fixed-v1',source:'fixed',focusX:.5,focusY:.5,confidence:0,textSide:'right',zoom:1,zoomRetention:1};return;}
  P.cover_composition=__c23CoverAnalysis();
}
const __c23DrawCoverBase=drawCover;
drawCover=function(g,x,y,w,h,o={}){
  const c=P.cover_composition;if(!c||c.source!=='cover'||COVER_COMPOSITION_MODE==='fixed')return __c23DrawCoverBase(g,x,y,w,h,o);
  const r=o.r||0,alpha=o.alpha??1,shadow=o.shadow??true,offset=o.offset||0;g.save();g.globalAlpha=alpha;g.translate(x+w/2,y+h/2);g.rotate(r);g.translate(-w/2,-h/2);
  if(shadow){g.fillStyle=o.shadowColor||'rgba(17,17,17,.24)';g.fillRect(20+offset,26+offset,w,h);}g.fillStyle='#222';g.fillRect(0,0,w,h);
  if(COVER){
    const ir=COVER.width/COVER.height,br=w/h,z=clamp(c.zoom||1,1,1.06);let sw=COVER.width,sh=COVER.height;
    if(ir>br)sw=COVER.height*br;else sh=COVER.width/br;sw/=z;sh/=z;
    const fx=clamp(c.focusX||.5,.15,.85)*COVER.width,fy=clamp(c.focusY||.5,.15,.85)*COVER.height,sx=clamp(fx-sw/2,0,COVER.width-sw),sy=clamp(fy-sh/2,0,COVER.height-sh);
    g.drawImage(COVER,sx,sy,sw,sh,0,0,w,h);
  }else return __c23DrawCoverBase(g,x,y,w,h,o);
  g.strokeStyle='rgba(17,17,17,.4)';g.lineWidth=3;g.strokeRect(0,0,w,h);g.restore();
};
`;
html=html.replace(safeMarker,drawWrap+'\n'+safeMarker);

const marker="const CREATIVE_VARIANT=String((window.FRAMEWRIGHT_PAYLOAD&&window.FRAMEWRIGHT_PAYLOAD.creative_variant)||'hook-first').toLowerCase();";
if(!html.includes(marker))throw new Error('C23 semantic marker missing');
const layout=String.raw`
function __c23SwappedBook(style,g,S){
  const c=P.cover_composition;if(!c||c.source!=='cover'||c.textSide!=='left')return false;
  const e=easeOut(span(S.i,0,24)),coverW=395,coverH=592,coverX=SAFE.x+SAFE.w-coverW-28,textX=SAFE.x,textW=SAFE.w-coverW-95;
  if(style==='swiss'){
    swissBg(g,S.seed,'book');label(g,P.brand,SAFE.x,SAFE.y+44,{size:27,maxW:SAFE.w,weight:800});g.fillStyle=P.accent;g.fillRect(SAFE.x,SAFE.y+72,90,7);drawCover(g,SAFE.x+SAFE.w-430+lerp(80,0,e),SAFE.y+155,430,645,{r:.025,alpha:e});
    g.globalAlpha=easeOut(span(S.i,16,40));label(g,P.eyebrow,textX,SAFE.y+175,{size:22,min:15,maxW:textW,weight:800,color:P.accent});const t=textBlock(g,P.title,{x:textX,y:SAFE.y+270,maxW:textW,maxH:330,size:72,min:25,maxLines:7,lineHeight:.92,weight:800});label(g,P.author,textX,SAFE.y+300+t.height,{size:28,min:17,maxW:textW,weight:500});g.fillStyle=P.ink;g.fillRect(textX,SAFE.y+760,textW,2);textBlock(g,P.hook,{x:textX,y:SAFE.y+820,maxW:textW,maxH:220,size:33,min:19,maxLines:7,lineHeight:1.08,weight:500});g.globalAlpha=1;pageNum(g,2);return true;
  }
  if(style==='newspaper'){
    newspaperBg(g,S.seed,'book');newsMast(g);const cw=330,ch=495,cx=SAFE.x+SAFE.w-cw-20;drawCover(g,cx,SAFE.y+165+lerp(35,0,e),cw,ch,{r:0,alpha:e,shadow:false});g.strokeStyle=P.ink;g.lineWidth=2;g.strokeRect(cx-10,SAFE.y+155,cw+20,ch+20);label(g,'COVER / 01',cx,SAFE.y+700,{size:18,weight:500});const tw=SAFE.w-410;g.globalAlpha=easeOut(span(S.i,14,38));label(g,P.eyebrow,SAFE.x,SAFE.y+190,{size:20,min:14,maxW:tw,weight:800,color:P.accent});const t=textBlock(g,P.title,{x:SAFE.x,y:SAFE.y+285,maxW:tw,maxH:350,size:64,min:24,maxLines:8,lineHeight:1,weight:800});label(g,P.author.toUpperCase(),SAFE.x,SAFE.y+320+t.height,{size:22,min:14,maxW:tw,weight:600});g.globalAlpha=1;g.fillStyle=P.ink;g.fillRect(SAFE.x,SAFE.y+790,SAFE.w,3);label(g,'EXCERPT',SAFE.x,SAFE.y+840,{size:18,weight:800,color:P.accent});textBlock(g,P.hook,{x:SAFE.x,y:SAFE.y+910,maxW:SAFE.w,maxH:260,size:34,min:20,maxLines:7,lineHeight:1.18,weight:500});pageNum(g,2);return true;
  }
  paperBg(g,S.seed,'book');g.save();g.globalAlpha=.18;g.fillStyle=P.accent;g.beginPath();g.arc(coverX+210,SAFE.y+455,295,0,Math.PI*2);g.fill();g.restore();drawCover(g,coverX+lerp(80,0,e),SAFE.y+190,395,592,{r:.065,alpha:e,shadowColor:P.accent,offset:10});const tw=SAFE.w-510;g.globalAlpha=easeOut(span(S.i,15,42));label(g,P.eyebrow,SAFE.x,SAFE.y+195,{size:21,min:14,maxW:tw,weight:800,color:P.accent});paperTitle(g,P.title,SAFE.x,SAFE.y+310,tw,{size:66,min:23,maxLines:8,maxH:370,lineHeight:.93});const tb=fitBlock(g,P.title,{maxW:tw,maxH:370,size:66,min:23,maxLines:8,lineHeight:.93,weight:800});label(g,P.author,SAFE.x,SAFE.y+350+tb.height,{size:25,min:16,maxW:tw,weight:600});g.globalAlpha=1;tape(g,SAFE.x,SAFE.y+820,tw+20,7,.012,P.ink,1);textBlock(g,P.hook,{x:SAFE.x,y:SAFE.y+900,maxW:tw+20,maxH:240,size:31,min:19,maxLines:8,lineHeight:1.12,weight:500});pageNum(g,2);return true;
}
for(const style of ['swiss','newspaper','paper']){const base=SYSTEM[style][1];SYSTEM[style][1]=(g,S)=>{if(!__c23SwappedBook(style,g,S))base(g,S);};}
window.__C23_COVER_COMPOSITION=()=>P.cover_composition;
`;
html=html.replace(marker,layout+'\n'+marker);
const boot='applyCoverArtDirection();';if(!html.includes(boot))throw new Error('C23 boot marker missing');html=html.replace(boot,boot+'applyCoverComposition();');
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,html);console.log(`prepared C23 cover-composition template: ${output}`);
