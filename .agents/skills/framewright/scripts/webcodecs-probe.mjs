#!/usr/bin/env node
// Probe WebCodecs encoder support in the same headless Chromium used by Framewright.
// Uses localhost because WebCodecs is a secure-context API.
//   node webcodecs-probe.mjs [out=webcodecs-probe.json]
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { performance } from 'node:perf_hooks';

const out=path.resolve(process.argv[2]||'webcodecs-probe.json');
const server=http.createServer((req,res)=>{
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
  res.end('<!doctype html><meta charset="utf-8"><canvas id="c" width="320" height="568"></canvas>');
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const address=server.address();
const pageUrl=`http://127.0.0.1:${address.port}/`;

const args=['--allow-file-access-from-files'];
if(process.env.CI)args.push('--no-sandbox','--disable-setuid-sandbox');
const t0=performance.now();
const browser=await puppeteer.launch({headless:true,protocolTimeout:120000,args});
const launchMs=performance.now()-t0;
const page=await browser.newPage();
await page.goto(pageUrl,{waitUntil:'load'});
const probe=await page.evaluate(async()=>{
  const result={
    href:location.href,
    origin:location.origin,
    isSecureContext:self.isSecureContext,
    videoEncoder:typeof VideoEncoder!=='undefined',
    videoFrame:typeof VideoFrame!=='undefined',
    configs:[],
    smoke:null
  };
  if(!result.videoEncoder||!result.videoFrame)return result;
  const candidates=[
    {name:'h264-baseline',config:{codec:'avc1.42001f',width:320,height:568,bitrate:700000,framerate:30,avc:{format:'annexb'}}},
    {name:'h264-main',config:{codec:'avc1.4d001f',width:320,height:568,bitrate:700000,framerate:30,avc:{format:'annexb'}}},
    {name:'vp9',config:{codec:'vp09.00.10.08',width:320,height:568,bitrate:700000,framerate:30}},
    {name:'av1',config:{codec:'av01.0.04M.08',width:320,height:568,bitrate:700000,framerate:30}}
  ];
  for(const c of candidates){
    try{
      const s=await VideoEncoder.isConfigSupported(c.config);
      result.configs.push({name:c.name,supported:Boolean(s.supported),config:s.config||c.config});
    }catch(e){result.configs.push({name:c.name,supported:false,error:String(e)});}
  }
  const selected=result.configs.find(x=>x.supported&&x.name.startsWith('h264'))||result.configs.find(x=>x.supported);
  if(!selected)return result;
  const config=candidates.find(x=>x.name===selected.name).config;
  const canvas=document.getElementById('c'),g=canvas.getContext('2d');
  const chunks=[];let decoderConfig=null,error=null;
  const enc=new VideoEncoder({
    output(chunk,meta){
      chunks.push({type:chunk.type,timestamp:chunk.timestamp,duration:chunk.duration,bytes:chunk.byteLength});
      if(meta?.decoderConfig&&!decoderConfig)decoderConfig={codec:meta.decoderConfig.codec,descriptionBytes:meta.decoderConfig.description?.byteLength||0};
    },
    error(e){error=String(e);}
  });
  const started=performance.now();
  enc.configure(config);
  for(let i=0;i<30;i++){
    g.fillStyle=`hsl(${i*12} 70% 55%)`;g.fillRect(0,0,320,568);
    g.fillStyle='#111';g.font='700 42px Arial';g.fillText(`f ${i}`,38,90+i*3);
    const vf=new VideoFrame(canvas,{timestamp:Math.round(i*1_000_000/30),duration:Math.round(1_000_000/30)});
    enc.encode(vf,{keyFrame:i===0});vf.close();
  }
  await enc.flush();enc.close();
  result.smoke={
    codec:selected.name,
    config,
    wallMs:performance.now()-started,
    chunks:chunks.length,
    totalBytes:chunks.reduce((a,x)=>a+x.bytes,0),
    keyChunks:chunks.filter(x=>x.type==='key').length,
    firstChunks:chunks.slice(0,5),
    decoderConfig,
    error
  };
  return result;
});
await browser.close();
await new Promise(resolve=>server.close(resolve));
const report={
  schema:'framewright-webcodecs-probe-v2',
  createdAt:new Date().toISOString(),
  host:{platform:process.platform,arch:process.arch,node:process.version,cpus:os.cpus().length,cpuModel:os.cpus()[0]?.model||null},
  chromeLaunchMs:+launchMs.toFixed(3),
  probe
};
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
