#!/usr/bin/env node
// Render a Framewright template with a JSON payload injected before page scripts execute.
// HTML=examples/book-ad-v0/index.html PAYLOAD=examples/book-ad-v0/payload.example.json node render-payload.mjs [dir=frames] [seed=7] [width=1080] [tabs=5]
// Env: START, END, RESUME
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const [,,dir='frames',seedS='7',widthS='1080',tabsS='5']=process.argv;
const seed=+seedS,width=+widthS,tabs=Math.max(1,+tabsS);
const html=path.resolve(process.env.HTML||'index.html');
const payloadPath=path.resolve(process.env.PAYLOAD||'payload.json');
if(!fs.existsSync(html)){console.error(`no such HTML: ${html}`);process.exit(1);}
if(!fs.existsSync(payloadPath)){console.error(`no such payload: ${payloadPath}`);process.exit(1);}
let payload;try{payload=JSON.parse(fs.readFileSync(payloadPath,'utf8'));}catch(e){console.error(`bad payload JSON: ${e.message}`);process.exit(1);}
fs.mkdirSync(dir,{recursive:true});
const url='file://'+html+`?f=0&w=320&s=${seed}`;
const browserArgs=['--allow-file-access-from-files'];
if(process.env.CI)browserArgs.push('--no-sandbox','--disable-setuid-sandbox');
const browser=await puppeteer.launch({headless:true,protocolTimeout:600000,args:browserArgs});
async function openPage(){
  const p=await browser.newPage();
  p.on('pageerror',e=>console.error('PAGE ERROR',e.message));
  await p.evaluateOnNewDocument(v=>{window.FRAMEWRIGHT_PAYLOAD=v;},payload);
  await p.goto(url,{waitUntil:'load',timeout:120000});
  await p.waitForFunction('window.__ready===true',{timeout:120000});
  const bootError=await p.evaluate(()=>window.__bootError||null);if(bootError)throw new Error(bootError);
  return p;
}
const p0=await openPage();
const meta=await p0.evaluate(()=>({total:window.RISO.total,fps:window.RISO.fps||30,plates:window.RISO.plates,payload:window.RISO.payload||null}));await p0.close();
const START=+(process.env.START||0),END=Math.min(meta.total,+(process.env.END||meta.total)),count=Math.max(0,END-START);
console.log(`frames ${meta.total} (${(meta.total/meta.fps).toFixed(1)} s), rendering ${START}..${END-1}, tabs ${tabs}, width ${width}, seed ${seed}`);
console.log(meta.plates.map(p=>`${p.name}:${p.len}`).join('  '));
let next=START,done=0,failed=0;const t0=performance.now();
async function worker(){
  const p=await openPage();
  while(true){
    const n=next++;if(n>=END)break;const out=path.join(dir,`f${String(n).padStart(5,'0')}.png`);
    if(process.env.RESUME&&fs.existsSync(out)){done++;continue;}
    try{const u=await p.evaluate((n,w,s)=>window.RISO.frame(n,w,s),n,width,seed);fs.writeFileSync(out,Buffer.from(u.split(',')[1],'base64'));}
    catch(e){failed++;console.error('frame',n,'failed:',e.message);}
    done++;if(done%60===0){const el=(performance.now()-t0)/1000;console.log(`${done}/${count} ${(el).toFixed(1)} s, ${(done/el).toFixed(1)} fps aggregate`);}
  }
  await p.close();
}
await Promise.all(Array.from({length:tabs},()=>worker()));await browser.close();
const elapsed=(performance.now()-t0)/1000;console.log(`done: ${done-failed} frames in ${elapsed.toFixed(2)} s (${elapsed?((done-failed)/elapsed).toFixed(2):'0'} fps)${failed?`, ${failed} failed`:''}`);
if(failed)process.exit(1);
