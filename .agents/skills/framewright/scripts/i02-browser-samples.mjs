#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import puppeteer from 'puppeteer';

const ROOT=process.cwd();
const htmlPath=path.resolve(process.env.HTML||'examples/book-ad-v0/index.html');
const payloadPath=path.resolve(process.env.PAYLOAD||'examples/book-ad-v0/payload.example.json');
const outDir=path.resolve(process.env.SAMPLES_DIR||'.bench/i02/browser-samples');
const width=Number(process.env.WIDTH||1080), seed=Number(process.env.SEED||7);
const samples=String(process.env.SAMPLE_FRAMES||'0,89,90,239,240,359').split(',').map(Number).filter(Number.isFinite);
const payload=JSON.parse(await fsp.readFile(payloadPath,'utf8'));

function contentType(filename){switch(path.extname(filename).toLowerCase()){case'.html':return'text/html; charset=utf-8';case'.json':return'application/json';case'.svg':return'image/svg+xml';case'.png':return'image/png';case'.jpg':case'.jpeg':return'image/jpeg';default:return'application/octet-stream';}}
const server=http.createServer((req,res)=>{
  const u=new URL(req.url||'/','http://127.0.0.1');
  const rel=decodeURIComponent(u.pathname).replace(/^\/+/, '');
  const filename=path.resolve(ROOT,rel||'.');
  if(filename!==ROOT&&!filename.startsWith(ROOT+path.sep)){res.writeHead(403);res.end();return;}
  fs.stat(filename,(err,st)=>{if(err||!st.isFile()){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':contentType(filename),'Cache-Control':'no-store'});fs.createReadStream(filename).pipe(res);});
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const origin=`http://127.0.0.1:${server.address().port}`;
await fsp.mkdir(outDir,{recursive:true});
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox']});
try{
  const page=await browser.newPage();
  await page.evaluateOnNewDocument(p=>{window.FRAMEWRIGHT_PAYLOAD=p;},payload);
  const rel=path.relative(ROOT,htmlPath).split(path.sep).map(encodeURIComponent).join('/');
  await page.goto(`${origin}/${rel}?w=${width}&s=${seed}`,{waitUntil:'load',timeout:60000});
  await page.waitForFunction(()=>window.__ready===true,{timeout:30000});
  const bootError=await page.evaluate(()=>window.__bootError||null); if(bootError) throw new Error(bootError);
  for(const frame of samples){
    const data=await page.evaluate(({frame,width,seed})=>{const c=document.getElementById('c');renderFrame(frame,width,seed,c);return c.toDataURL('image/png').split(',')[1];},{frame,width,seed});
    await fsp.writeFile(path.join(outDir,`${String(frame).padStart(3,'0')}.png`),Buffer.from(data,'base64'));
  }
  console.log(JSON.stringify({samples,width,seed,outDir},null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
