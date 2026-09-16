#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import puppeteer from 'puppeteer';

const root=process.cwd();
const htmlPath=path.resolve(process.env.HTML||'examples/book-ad-systems/index-e18-for-r45.html');
const manifestPath=path.resolve(process.env.MANIFEST||'examples/book-ad-systems/generated-r45/manifest.json');
const reportPath=path.resolve(process.env.REPORT||'artifacts/r45/report.json');
const iterations=Math.max(18,Math.min(180,Number(process.env.ITERATIONS||60)));
const profiles=['vertical','square','landscape'];
const wanted=['river-station','city-seven','long-title'];
for(const f of [htmlPath,manifestPath]) if(!fs.existsSync(f)) throw new Error(`missing ${f}`);
const manifest=JSON.parse(await fsp.readFile(manifestPath,'utf8'));
const manifestDir=path.dirname(manifestPath),html=await fsp.readFile(htmlPath,'utf8'),entries={};
for(const profile of profiles){
  entries[profile]=[];
  for(const bookId of wanted){
    const e=manifest.items.find(x=>x.bookId===bookId&&x.variant==='hook-first'&&x.profile===profile);
    if(!e) throw new Error(`missing ${profile}/${bookId}`);
    entries[profile].push({...e,payload:JSON.parse(await fsp.readFile(path.resolve(manifestDir,e.payloadFile),'utf8'))});
  }
}
const requestCounts=new Map();
const ctype=f=>({'.html':'text/html; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2'})[path.extname(f).toLowerCase()]||'application/octet-stream';
const server=http.createServer((req,res)=>{
  const u=new URL(req.url||'/','http://127.0.0.1');
  if(u.pathname==='/examples/book-ad-systems/__r45_scene.html'){
    const profile=u.searchParams.get('profile'),idx=Number(u.searchParams.get('fixture')),e=entries[profile]?.[idx],cacheable=u.searchParams.get('r45cache')==='1';
    if(!e){res.writeHead(404);res.end();return;}
    const payload={...e.payload,cover_url:e.payload.cover_url+(e.payload.cover_url.includes('?')?'&':'?')+`r45cache=${cacheable?'1':'0'}`};
    const injected=html.replace('<script>',`<script>window.FRAMEWRIGHT_PAYLOAD=${JSON.stringify(payload)};<\/script>\n<script>`);
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(injected);return;
  }
  const rel=decodeURIComponent(u.pathname).replace(/^\/+/,''),file=path.resolve(root,rel||'.');
  if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.stat(file,(err,st)=>{
    if(err||!st.isFile()){res.writeHead(404);res.end();return;}
    requestCounts.set(u.pathname,(requestCounts.get(u.pathname)||0)+1);
    const cacheable=u.searchParams.get('r45cache')==='1';
    res.writeHead(200,{'Content-Type':ctype(file),'Cache-Control':cacheable?'public, max-age=3600, immutable':'no-store'});fs.createReadStream(file).pipe(res);
  });
});
await new Promise((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',ok)});
const origin=`http://127.0.0.1:${server.address().port}`;
const q=xs=>{const a=[...xs].sort((x,y)=>x-y);return{mean:a.reduce((s,x)=>s+x,0)/Math.max(1,a.length),p50:a[Math.floor((a.length-1)*.5)]||0,p95:a[Math.floor((a.length-1)*.95)]||0};};
function order(kind,n){
  if(kind==='grouped') return Array.from({length:n},(_,i)=>Math.floor(i/Math.ceil(n/3))%3);
  const seq=[]; let x=0x12345678;
  while(seq.length<n){x=(Math.imul(x,1664525)+1013904223)>>>0;seq.push(x%3);} return seq;
}
function sceneUrl(profile,idx,cacheable){
  const e=entries[profile][idx],u=new URL('/examples/book-ad-systems/__r45_scene.html',origin);
  u.searchParams.set('profile',profile);u.searchParams.set('fixture',idx);u.searchParams.set('f','0');u.searchParams.set('w',String(e.width));u.searchParams.set('h',String(e.height));u.searchParams.set('s',String(e.seed));u.searchParams.set('r45cache',cacheable?'1':'0');
  return u.href;
}
function coverRequestDelta(before,after){
  let total=0; const paths={};
  for(const [p,n] of after){
    if(!/cover|generated-e08/i.test(p)) continue;
    const d=n-(before.get(p)||0); if(d>0){total+=d;paths[p]=d;}
  }
  return {total,paths};
}
async function runScenario(profile,cacheable,kind){
  const browser=await puppeteer.launch({headless:true,protocolTimeout:600000,args:['--no-sandbox','--disable-setuid-sandbox']}),page=await browser.newPage();
  const rows=[],seq=order(kind,iterations),before=new Map(requestCounts);
  try{
    for(let idx=0;idx<3;idx++){
      await page.goto(sceneUrl(profile,idx,cacheable),{waitUntil:'load',timeout:120000});await page.waitForFunction('window.__ready===true',{timeout:120000});
    }
    for(let j=0;j<seq.length;j++){
      const idx=seq[j],e=entries[profile][idx],t=performance.now();
      await page.goto(sceneUrl(profile,idx,cacheable),{waitUntil:'load',timeout:120000});await page.waitForFunction('window.__ready===true',{timeout:120000});
      const resources=await page.evaluate(()=>performance.getEntriesByType('resource').filter(x=>/cover|generated-e08/i.test(x.name)).map(x=>({name:x.name,initiatorType:x.initiatorType,transferSize:x.transferSize||0,encodedBodySize:x.encodedBodySize||0,decodedBodySize:x.decodedBodySize||0,duration:x.duration||0})));
      rows.push({j,idx,bookId:e.bookId,loadMs:performance.now()-t,resources});
    }
  }finally{await page.close().catch(()=>{});await browser.close();}
  const after=new Map(requestCounts),req=coverRequestDelta(before,after),loads=q(rows.map(x=>x.loadMs));
  const coverResources=rows.flatMap(x=>x.resources),dur=q(coverResources.map(x=>x.duration)),transfers=coverResources.map(x=>x.transferSize);
  return{profile,cacheable,order:kind,jobs:rows.length,loadMs:loads,resourceDurationMs:dur,coverRequests:req.total,coverRequestPaths:req.paths,coverResourceNames:[...new Set(coverResources.map(x=>x.name))],coverInitiatorTypes:[...new Set(coverResources.map(x=>x.initiatorType))],zeroTransferRate:transfers.filter(x=>x===0).length/Math.max(1,transfers.length),rows};
}
try{
  const results=[];
  for(const profile of profiles){
    for(const [cacheable,kind] of [[false,'random'],[true,'random'],[true,'grouped']]){
      console.log(`R45 ${profile} cacheable=${cacheable} ${kind}`);results.push(await runScenario(profile,cacheable,kind));
    }
  }
  const by=(p,c,o)=>results.find(x=>x.profile===p&&x.cacheable===c&&x.order===o),summary={};
  for(const p of profiles){
    const n=by(p,false,'random'),r=by(p,true,'random'),g=by(p,true,'grouped');
    summary[p]={noStoreMeanLoadMs:n.loadMs.mean,cacheableRandomMeanLoadMs:r.loadMs.mean,cacheableGroupedMeanLoadMs:g.loadMs.mean,httpCacheGain:r.loadMs.mean/n.loadMs.mean-1,groupingGain:g.loadMs.mean/r.loadMs.mean-1,groupingSavedMs:r.loadMs.mean-g.loadMs.mean,noStoreCoverRequests:n.coverRequests,cacheableRandomCoverRequests:r.coverRequests,cacheableGroupedCoverRequests:g.coverRequests,cacheableRandomZeroTransferRate:r.zeroTransferRate,cacheableGroupedZeroTransferRate:g.zeroTransferRate,coverResourceNames:r.coverResourceNames,coverInitiatorTypes:r.coverInitiatorTypes};
  }
  const mean=k=>profiles.reduce((s,p)=>s+summary[p][k],0)/profiles.length;
  const aggregate={noStoreMeanLoadMs:mean('noStoreMeanLoadMs'),cacheableRandomMeanLoadMs:mean('cacheableRandomMeanLoadMs'),cacheableGroupedMeanLoadMs:mean('cacheableGroupedMeanLoadMs'),httpCacheGain:mean('httpCacheGain'),groupingGain:mean('groupingGain'),groupingSavedMs:mean('groupingSavedMs')};
  aggregate.groupingUpperBoundVs2000msJob=aggregate.groupingSavedMs/2000;
  const report={schema:'nightwill-r45-asset-locality-scout-v2',method:'fresh browser per scenario; all three covers warmed once; then navigation-to-__ready timing under no-store random, cacheable random, and cacheable grouped order',iterationsPerScenario:iterations,results,summary,aggregate};
  await fsp.mkdir(path.dirname(reportPath),{recursive:true});await fsp.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({aggregate,summary},null,2));
}finally{await new Promise(ok=>server.close(ok));}
