#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT=process.cwd();
const browserDir=path.resolve(process.env.BROWSER_SAMPLES||'.bench/i02/browser-samples');
const nodeDir=path.resolve(process.env.NODE_SAMPLES||'.bench/i02/node-samples');
const browserlessReport=path.resolve(process.env.BROWSERLESS_REPORT||'.bench/i02/browserless.json');
const chromiumReceipt=path.resolve(process.env.CHROMIUM_RECEIPT||'.bench/i02/chromium/receipts');
const chromiumVideoDir=path.resolve(process.env.CHROMIUM_VIDEO_DIR||'.bench/i02/chromium/video');
const browserlessVideo=path.resolve(process.env.BROWSERLESS_VIDEO||'.bench/i02/browserless.mp4');
const out=path.resolve(process.env.REPORT||'.bench/i02/final-report.json');
const samples=String(process.env.SAMPLE_FRAMES||'0,89,90,239,240,359').split(',').map(Number).filter(Number.isFinite);
const minSsim=Number(process.env.MIN_SAMPLE_SSIM||0.97), minPsnr=Number(process.env.MIN_SAMPLE_PSNR||30);

function run(command,args){return new Promise((resolve,reject)=>{const c=spawn(command,args,{cwd:ROOT,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';c.stdout.on('data',d=>stdout+=d);c.stderr.on('data',d=>stderr+=d);c.once('error',reject);c.once('close',code=>code===0?resolve({stdout,stderr}):reject(new Error(`${command} exited ${code}\n${stderr.slice(-4000)}`)));});}
async function metric(kind,a,b){const filter=kind==='ssim'?'[0:v][1:v]ssim':'[0:v][1:v]psnr';const {stderr}=await run('ffmpeg',['-hide_banner','-loglevel','info','-i',a,'-i',b,'-lavfi',filter,'-f','null','-']);if(kind==='ssim'){const m=[...stderr.matchAll(/All:([0-9.]+)/g)].at(-1);return m?Number(m[1]):null;}const m=[...stderr.matchAll(/average:([0-9.]+)/g)].at(-1);return m?Number(m[1]):null;}
async function probe(file){const {stdout}=await run('ffprobe',['-v','error','-count_frames','-show_entries','format=duration,size:stream=index,codec_type,codec_name,profile,width,height,avg_frame_rate,nb_read_frames,color_range,color_space,color_transfer,color_primaries','-of','json',file]);return JSON.parse(stdout);}
const parity=[];
for(const f of samples){const name=`${String(f).padStart(3,'0')}.png`;const browser=path.join(browserDir,name),node=path.join(nodeDir,name);if(!fs.existsSync(browser)||!fs.existsSync(node))throw new Error(`missing sample ${name}`);parity.push({frame:f,ssim:await metric('ssim',browser,node),psnr:await metric('psnr',browser,node)});}
const parityPass=parity.every(x=>x.ssim!=null&&x.psnr!=null&&x.ssim>=minSsim&&x.psnr>=minPsnr);
const receiptFiles=fs.readdirSync(chromiumReceipt).filter(x=>x.endsWith('.json'));if(receiptFiles.length!==1)throw new Error(`expected one Chromium receipt, got ${receiptFiles.length}`);
const receipt=JSON.parse(fs.readFileSync(path.join(chromiumReceipt,receiptFiles[0]),'utf8'));
const chromiumFiles=fs.readdirSync(chromiumVideoDir).filter(x=>x.endsWith('.mp4'));if(chromiumFiles.length!==1)throw new Error(`expected one Chromium video, got ${chromiumFiles.length}`);
const chromiumVideo=path.join(chromiumVideoDir,chromiumFiles[0]);
const browserless=JSON.parse(fs.readFileSync(browserlessReport,'utf8'));
const decodedAgreement={ssim:await metric('ssim',chromiumVideo,browserlessVideo),psnr:await metric('psnr',chromiumVideo,browserlessVideo)};
const report={
 schema:'i02-final-backend-comparison-v1',
 workload:{width:1080,height:1920,fps:30,frames:360,duration_ms:12000,bitrate_bps:3000000,audio:false},
 sample_parity:{thresholds:{min_ssim:minSsim,min_psnr_db:minPsnr},pass:parityPass,frames:parity},
 chromium:{render_spec_id:receipt.render_spec_id,artifact_sha256:receipt.output.sha256,bytes:receipt.output.bytes,inner_total_run_ms:receipt.metrics?.inner_total_run_ms??null,probe:await probe(chromiumVideo)},
 browserless:{...browserless,probe:await probe(browserlessVideo)},
 decoded_video_agreement:decodedAgreement,
 interpretation: parityPass
   ? 'Sample parity gate passed. Same-run cold wall/resource measurements are interpretable as backend diagnostics, but production selection must also respect the canonical warm Chromium c2 evidence.'
   : 'Sample parity gate failed. Backend timing/economics are not apples-to-apples enough for a backend freeze; do not promote browserless from this run.',
};
await fsp.mkdir(path.dirname(out),{recursive:true});await fsp.writeFile(out,`${JSON.stringify(report,null,2)}\n`);console.log(JSON.stringify(report,null,2));
if(!parityPass) process.exitCode=2;
