#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import puppeteer from 'puppeteer';

const root=process.cwd();
const basePath=path.resolve(process.env.BASELINE_HTML||'examples/book-ad-systems/index-e18-for-r44.html');
const cachedPath=path.resolve(process.env.CACHED_HTML||'examples/book-ad-systems/index-e18-r44-cached.html');
const manifestPath=path.resolve(process.env.MANIFEST||'examples/book-ad-systems/generated-r44/manifest.json');
const reportPath=path.resolve(process.env.REPORT||'artifacts/r44/parity.json');
const profiles=['vertical','square','landscape'], wanted=['river-station','city-seven','long-title'];
const [baseHtml,cachedHtml,manifest]=await Promise.all([fsp.readFile(basePath,'utf8'),fsp.readFile(cachedPath,'utf8'),fsp.readFile(manifestPath,'utf8').then(JSON.parse)]);
const manifestDir=path.dirname(manifestPath), fixtures={};
for(const profile of profiles){
  fixtures[profile]=[];
  for(const bookId of wanted){
    const e=manifest.items.find(x=>x.bookId===bookId&&x.variant==='hook-first'&&x.profile===profile);
    if(!e) throw new Error(`missing fixture ${profile}/${bookId}`);
    fixtures[profile].push({...e,payload:JSON.parse(await fsp.readFile(path.resolve(manifestDir,e.payloadFile),'utf8'))});
  }
}
const ctype=f=>({'.html':'text/html; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'})[path.extname(f).toLowerCase()]||'application/octet-stream';
const server=http.createServer((req,res)=>{
  const u=new URL(req.url||'/','http://127.0.0.1');
  const m=u.pathname.match(/^\/examples\/book-ad-systems\/__r44_(base|cached)\.html$/);
  if(m){
    const profile=u.searchParams.get('profile'),idx=Number(u.searchParams.get('fixture')),e=fixtures[profile]?.[idx];
    if(!e){res.writeHead(404);res.end();return;}
    const src=m[1]==='base'?baseHtml:cachedHtml;
    const injected=src.replace('<script>',`<script>window.FRAMEWRIGHT_PAYLOAD=${JSON.stringify(e.payload)};<\/script>\n<script>`);
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(injected);return;
  }
  const rel=decodeURIComponent(u.pathname).replace(/^\/+/,''),file=path.resolve(root,rel||'.');
  if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.stat(file,(err,st)=>{if(err||!st.isFile()){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':ctype(file),'Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);});
});
await new Promise((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',ok)});
const origin=`http://127.0.0.1:${server.address().port}`;
const hash=s=>crypto.createHash('sha256').update(Buffer.from(s.split(',')[1],'base64')).digest('hex');
function url(kind,profile,idx,e){const u=new URL(`/examples/book-ad-systems/__r44_${kind}.html`,origin);u.searchParams.set('profile',profile);u.searchParams.set('fixture',idx);u.searchParams.set('f','0');u.searchParams.set('w',String(e.width));u.searchParams.set('h',String(e.height));u.searchParams.set('s',String(e.seed));return u.href;}
async function sample(page,kind,profile,idx,e){await page.goto(url(kind,profile,idx,e),{waitUntil:'load',timeout:120000});await page.waitForFunction('window.__ready===true',{timeout:120000});return page.evaluate(seed=>{const c=document.getElementById('c'),r=window.RISO,total=r.total,frames=[0,1,17,45,89,90,111,165,239,240,285,total-1],out=[];for(const f of frames){window.renderFrame(f,c.width,seed,c);out.push({frame:f,png:c.toDataURL('image/png')});}return out;},e.seed);}
const browser=await puppeteer.launch({headless:true,protocolTimeout:600000,args:['--no-sandbox','--disable-setuid-sandbox']});
const rows=[];
try{
  const page=await browser.newPage();
  for(const profile of profiles) for(let idx=0;idx<fixtures[profile].length;idx++){
    const e=fixtures[profile][idx];
    const [a,b]=[await sample(page,'base',profile,idx,e),await sample(page,'cached',profile,idx,e)];
    for(let i=0;i<a.length;i++) rows.push({profile,bookId:e.bookId,frame:a[i].frame,baselineSha256:hash(a[i].png),cachedSha256:hash(b[i].png),equal:hash(a[i].png)===hash(b[i].png)});
  }
  await page.close();
}finally{await browser.close();await new Promise(ok=>server.close(ok));}
const failures=rows.filter(x=>!x.equal),report={schema:'nightwill-r44-static-layer-parity-v1',samples:rows.length,failures,pass:failures.length===0,rows};
await fsp.mkdir(path.dirname(reportPath),{recursive:true});await fsp.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({samples:report.samples,failures:failures.length,pass:report.pass},null,2));
if(failures.length) process.exitCode=1;
