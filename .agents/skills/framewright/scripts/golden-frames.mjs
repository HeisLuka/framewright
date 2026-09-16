#!/usr/bin/env node
// Render selected deterministic frames for reproducibility checks.
// HTML=... PAYLOAD=... node golden-frames.mjs [out-dir=golden] [frames=0,45,90,180,240,359] [width=1080] [seed=7]
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const [,,outArg='golden',framesArg='0,45,90,180,240,359',widthS='1080',seedS='7']=process.argv;
const out=path.resolve(outArg),frames=framesArg.split(',').map(Number).filter(Number.isFinite),width=+widthS,seed=+seedS;
const html=path.resolve(process.env.HTML||'index.html'),payloadPath=process.env.PAYLOAD?path.resolve(process.env.PAYLOAD):null;
if(!fs.existsSync(html)){console.error(`no such HTML: ${html}`);process.exit(2);}
let payload=null;if(payloadPath){payload=JSON.parse(fs.readFileSync(payloadPath,'utf8'));}
fs.mkdirSync(out,{recursive:true});
const args=['--allow-file-access-from-files'];if(process.env.CI||process.env.CONTAINER)args.push('--no-sandbox','--disable-setuid-sandbox');
const browser=await puppeteer.launch({headless:true,protocolTimeout:120000,args});
const page=await browser.newPage();if(payload!==null)await page.evaluateOnNewDocument(v=>{window.FRAMEWRIGHT_PAYLOAD=v;},payload);
const url='file://'+html+`?f=0&w=320&s=${seed}`;await page.goto(url,{waitUntil:'load',timeout:120000});await page.waitForFunction('window.__ready===true',{timeout:120000});
const bootError=await page.evaluate(()=>window.__bootError||null);if(bootError)throw new Error(bootError);
const rows=[];
for(const frame of frames){
  const data=await page.evaluate((n,w,s)=>window.RISO.frame(n,w,s),frame,width,seed),buf=Buffer.from(data.split(',')[1],'base64'),name=`f${String(frame).padStart(5,'0')}.png`,file=path.join(out,name);fs.writeFileSync(file,buf);rows.push({frame,file:name,bytes:buf.length,sha256:createHash('sha256').update(buf).digest('hex')});
}
await browser.close();const manifest={schema:'framewright-golden-frames-v1',html,payloadPath,width,seed,frames:rows};fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify(manifest,null,2));
