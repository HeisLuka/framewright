#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const [,,inputArg,outputArg]=process.argv;
if(!inputArg||!outputArg){
  console.error('usage: prepare-r44-static-layer-cache.mjs <input.html> <output.html>');
  process.exit(2);
}
const input=path.resolve(inputArg), output=path.resolve(outputArg);
const html=await fs.readFile(input,'utf8');
const marker='function pageNum(g,n,align=';
const at=html.indexOf(marker);
if(at<0) throw new Error('R44 insertion marker not found');
if(html.includes('R44_STATIC_LAYER_CACHE')) throw new Error('input already contains R44 cache patch');

const patch=String.raw`
// R44_STATIC_LAYER_CACHE: scout-only background raster cache.
// Cache at the exact physical raster size implied by the current canvas transform,
// then blit in device pixels so the candidate does not introduce a resampling step.
const R44_BG_CACHE=new Map();
const R44_BG_STATS={hits:0,misses:0,bytes:0};
function r44CachedBackground(name,draw,g,seed,plate){
  const m=g.getTransform(), sx=m.a||1, sy=m.d||sx;
  const w=Math.max(2,Math.round(LW*sx)), h=Math.max(2,Math.round(LH*sy));
  const key=[name,seed,plate,w,h,P.background,P.ink,P.accent].join('|');
  let cv=R44_BG_CACHE.get(key);
  if(!cv){
    cv=document.createElement('canvas'); cv.width=w; cv.height=h;
    const cg=cv.getContext('2d');
    cg.setTransform(sx,0,0,sy,0,0); cg.imageSmoothingEnabled=true;
    draw(cg,seed,plate);
    R44_BG_CACHE.set(key,cv); R44_BG_STATS.misses++; R44_BG_STATS.bytes+=w*h*4;
  }else R44_BG_STATS.hits++;
  g.save(); g.setTransform(1,0,0,1,0,0); g.drawImage(cv,0,0); g.restore();
}
const r44SwissBg=swissBg, r44NewspaperBg=newspaperBg, r44PaperBg=paperBg;
swissBg=(g,seed,plate)=>r44CachedBackground('swiss',r44SwissBg,g,seed,plate);
newspaperBg=(g,seed,plate)=>r44CachedBackground('newspaper',r44NewspaperBg,g,seed,plate);
paperBg=(g,seed,plate)=>r44CachedBackground('paper',r44PaperBg,g,seed,plate);
window.__r44LayerStats=R44_BG_STATS;
`;

await fs.mkdir(path.dirname(output),{recursive:true});
await fs.writeFile(output,html.slice(0,at)+patch+'\n'+html.slice(at));
console.log(JSON.stringify({input,output,patch:'R44_STATIC_LAYER_CACHE'},null,2));
