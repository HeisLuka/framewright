#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const input=path.resolve(process.argv[2]||'examples/book-ad-systems/index-e18-for-r46.html');
const output=path.resolve(process.argv[3]||'examples/book-ad-systems/index-e18-r46-fit-cache.html');
let html=fs.readFileSync(input,'utf8');
const marker='function textBlock(g,text,o={}){';
if(!html.includes(marker))throw new Error('R46 fit-cache injection marker missing');
if(html.includes('R46_DETERMINISTIC_FIT_CACHE'))throw new Error('R46 fit-cache already present');
const injection=String.raw`
// R46_DETERMINISTIC_FIT_CACHE
// fitBlock is pure for pinned font metrics + text + the fit-affecting options below.
// Cache only the resolved layout; on a hit restore the exact final font state left
// by the original fitter so downstream measureText/drawing semantics stay unchanged.
const __r46FitBlock=fitBlock,__r46FitCache=new Map();
let __r46FitHits=0,__r46FitMisses=0;
function __r46FitKey(text,o={}){
  const maxH=o.maxH??Infinity;
  return [String(text),o.maxW??900,Number.isFinite(maxH)?maxH:'inf',o.maxLines??99,o.size??88,o.min??24,o.weight??700,o.lineHeight??1.02].join('\u001f');
}
fitBlock=function(g,text,o={}){
  const key=__r46FitKey(text,o),cached=__r46FitCache.get(key);
  if(cached){
    __r46FitHits++;
    font(g,cached.size,o.weight||700);
    return{...cached,lines:[...cached.lines]};
  }
  __r46FitMisses++;
  const b=__r46FitBlock(g,text,o),saved={...b,lines:[...b.lines]};
  __r46FitCache.set(key,saved);
  return b;
};
window.__R46_FIT_CACHE_STATS=()=>({entries:__r46FitCache.size,hits:__r46FitHits,misses:__r46FitMisses});
`;
html=html.replace(marker,injection+'\n'+marker);
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,html);
console.log(JSON.stringify({input,output,patch:'R46_DETERMINISTIC_FIT_CACHE'},null,2));
