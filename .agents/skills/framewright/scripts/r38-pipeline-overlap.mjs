#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import puppeteer from 'puppeteer';

const root = process.cwd();
const htmlPath = path.resolve(process.env.HTML || 'examples/book-ad-systems/index-e18-for-r38.html');
const manifestPath = path.resolve(process.env.MANIFEST || 'examples/book-ad-systems/generated-r38/manifest.json');
const outDir = path.resolve(process.env.OUT_DIR || 'artifacts/r38');
const audioPath = path.resolve(process.env.AUDIO || path.join(outDir, 'track.m4a'));
const reportPath = path.resolve(process.env.REPORT || path.join(outDir, 'report.json'));
const bitrate = Number(process.env.BITRATE || 3_000_000);
const queueLimit = Math.max(1, Math.min(32, Math.trunc(Number(process.env.WEBCODECS_QUEUE || 8))));
const concurrency = 2;
const tailLimit = concurrency;

await fsp.mkdir(outDir, { recursive: true });
for (const file of [htmlPath, manifestPath, audioPath]) if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
const entries = manifest.items || [];
if (entries.length !== 36) throw new Error(`expected 36 C18 fixtures, got ${entries.length}`);
for (const entry of entries) entry.payload = JSON.parse(await fsp.readFile(path.resolve(path.dirname(manifestPath), entry.payloadFile), 'utf8'));
const html = await fsp.readFile(htmlPath, 'utf8');
const uploads = new Map();

function contentType(filename) {
  return ({ '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp' })[path.extname(filename).toLowerCase()] || 'application/octet-stream';
}
const uploadPrefix = '/__r38_h264/';
const scenePath = '/examples/book-ad-systems/__r38_scene.html';
const server = http.createServer((req,res) => {
  const u = new URL(req.url || '/', 'http://127.0.0.1');
  if (req.method === 'POST' && u.pathname.startsWith(uploadPrefix)) {
    const id = decodeURIComponent(u.pathname.slice(uploadPrefix.length)); const chunks=[];
    req.on('data', d => chunks.push(d)); req.on('end', () => { uploads.set(id, Buffer.concat(chunks)); res.writeHead(204); res.end(); }); return;
  }
  if (u.pathname === scenePath) {
    const idx = Number(u.searchParams.get('fixture')); const entry = entries[idx];
    if (!entry) { res.writeHead(404); res.end(); return; }
    const injected = html.replace('<script>', `<script>window.FRAMEWRIGHT_PAYLOAD=${JSON.stringify(entry.payload)};<\/script>\n<script>`);
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}); res.end(injected); return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  const rel = decodeURIComponent(u.pathname).replace(/^\/+/, ''); const filename = path.resolve(root, rel || '.');
  if (filename !== root && !filename.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.stat(filename, (error, stat) => { if (error || !stat.isFile()) { res.writeHead(404); res.end(); return; } res.writeHead(200, {'Content-Type':contentType(filename),'Cache-Control':'no-store'}); if (req.method === 'HEAD') res.end(); else fs.createReadStream(filename).pipe(res); });
});
await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
const origin = `http://127.0.0.1:${server.address().port}`;

function run(command,args) { return new Promise((resolve,reject) => { const child=spawn(command,args,{cwd:root,stdio:['ignore','pipe','pipe']}); let stdout='',stderr=''; child.stdout.on('data',d=>stdout+=d); child.stderr.on('data',d=>stderr+=d); child.once('error',reject); child.once('close',(code,signal)=>code===0?resolve({stdout,stderr}):reject(new Error(`${command} exited ${code ?? signal}\n${stderr.slice(-4000)}`))); }); }
function cpuUsec() { try { return Number(fs.readFileSync('/sys/fs/cgroup/cpu.stat','utf8').match(/^usage_usec\s+(\d+)/m)?.[1] || 0); } catch { return 0; } }
function processTreeRss() {
  try {
    const nodes=new Map();
    for (const name of fs.readdirSync('/proc')) { if (!/^\d+$/.test(name)) continue; try { const status=fs.readFileSync(`/proc/${name}/status`,'utf8'); const ppid=Number(status.match(/^PPid:\s+(\d+)/m)?.[1] || -1); const rss=Number(status.match(/^VmRSS:\s+(\d+)\s+kB/m)?.[1] || 0)*1024; nodes.set(Number(name),{ppid,rss}); } catch {} }
    const wanted=new Set([process.pid]); let changed=true;
    while (changed) { changed=false; for (const [pid,node] of nodes) if (!wanted.has(pid) && wanted.has(node.ppid)) { wanted.add(pid); changed=true; } }
    let total=0; for (const pid of wanted) total += nodes.get(pid)?.rss || 0; return total;
  } catch { return 0; }
}
function sha256File(filename) { return new Promise((resolve,reject) => { const h=crypto.createHash('sha256'); const s=fs.createReadStream(filename); s.on('data',d=>h.update(d)); s.once('error',reject); s.once('end',()=>resolve(h.digest('hex'))); }); }
function quantile(values,p) { const xs=values.filter(Number.isFinite).sort((a,b)=>a-b); if (!xs.length) return 0; return xs[Math.min(xs.length-1,Math.floor((xs.length-1)*p))]; }
function mean(values) { const xs=values.filter(Number.isFinite); return xs.reduce((a,b)=>a+b,0)/Math.max(1,xs.length); }

function urlFor(idx) { const e=entries[idx], u=new URL(scenePath,origin); u.searchParams.set('fixture',idx); u.searchParams.set('f','0'); u.searchParams.set('w',String(e.width)); u.searchParams.set('h',String(e.height)); u.searchParams.set('s',String(e.seed)); u.searchParams.set('profile',e.profile); return u.href; }
async function navigate(page,idx) { const t0=performance.now(); await page.goto(urlFor(idx),{waitUntil:'load',timeout:120000}); await page.waitForFunction('window.__ready===true',{timeout:120000}); return performance.now()-t0; }
async function fingerprint(page,entry) { return page.evaluate(({width,seed}) => { const c=document.getElementById('c'); const total=Number(window.RISO.total); const frames=[0,Math.floor(total*.62),total-1]; const s=document.createElement('canvas'); s.width=48;s.height=48; const x=s.getContext('2d',{willReadFrequently:true}); const out=[]; for(const f of frames){ window.renderFrame(f,width,seed,c); x.clearRect(0,0,48,48); x.drawImage(c,0,0,48,48); const d=x.getImageData(0,0,48,48).data; let h=2166136261>>>0; for(let i=0;i<d.length;i++) h=Math.imul(h^d[i],16777619)>>>0; out.push(`${f}:${h.toString(16).padStart(8,'0')}`); } return out.join('|'); },{width:entry.width,seed:entry.seed}); }

async function encode(page,id,entry) {
  uploads.delete(id);
  const encoded = await page.evaluate(async ({id,width,seed,bitrate,queueLimit,uploadPrefix}) => {
    const c=document.getElementById('c'), runtime=window.RISO, total=Number(runtime.total), fps=Number(runtime.fps||30);
    window.renderFrame(0,width,seed,c);
    const cfg={codec:'avc1.420028',width:c.width,height:c.height,bitrate,framerate:fps,latencyMode:'realtime',avc:{format:'annexb'}};
    const support=await VideoEncoder.isConfigSupported(cfg); if(!support.supported) throw new Error('unsupported WebCodecs config');
    const chunks=[]; let bytes=0,drawMs=0,maxQueue=0;
    const encoder=new VideoEncoder({output(chunk){const b=new Uint8Array(chunk.byteLength);chunk.copyTo(b);chunks.push(b);bytes+=b.length;},error(e){throw e;}}); encoder.configure(cfg); const t0=performance.now();
    for(let f=0;f<total;f++){const d0=performance.now();window.renderFrame(f,width,seed,c);drawMs+=performance.now()-d0;const vf=new VideoFrame(c,{timestamp:Math.trunc(f*1e6/fps)});encoder.encode(vf,{keyFrame:f===0||f%Math.max(1,Math.round(fps*2))===0});vf.close();maxQueue=Math.max(maxQueue,encoder.encodeQueueSize);while(encoder.encodeQueueSize>queueLimit)await new Promise(ok=>encoder.addEventListener('dequeue',ok,{once:true}));}
    await encoder.flush(); const encodeMs=performance.now()-t0; encoder.close(); const body=new Uint8Array(bytes); let off=0; for(const b of chunks){body.set(b,off);off+=b.length;} const u0=performance.now(); const resp=await fetch(`${uploadPrefix}${encodeURIComponent(id)}`,{method:'POST',body}); if(!resp.ok) throw new Error(`upload ${resp.status}`); return {total,fps,encodeMs,drawMs,uploadMs:performance.now()-u0,bytes,maxQueue};
  },{id,width:entry.width,seed:entry.seed,bitrate,queueLimit,uploadPrefix});
  const h264=uploads.get(id); uploads.delete(id); if(!h264?.length) throw new Error(`missing H264 ${id}`); return {...encoded,h264};
}

async function finalize(id,encoded) {
  const h264Path=path.join(outDir,`${id}.h264`), mp4Path=path.join(outDir,`${id}.mp4`), expectedDuration=encoded.total/encoded.fps; let muxMs=0,validateMs=0,hashMs=0;
  try {
    await fsp.writeFile(h264Path,encoded.h264); const m0=performance.now();
    await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-fflags','+genpts','-r',String(encoded.fps),'-i',h264Path,'-i',audioPath,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','copy','-t',String(expectedDuration),'-movflags','+faststart',mp4Path]); muxMs=performance.now()-m0;
    const v0=performance.now(); const {stdout}=await run('ffprobe',['-v','error','-count_frames','-show_entries','stream=codec_type,nb_read_frames,width,height','-show_entries','format=duration','-of','json',mp4Path]); validateMs=performance.now()-v0; const probe=JSON.parse(stdout); const video=probe.streams?.find(x=>x.codec_type==='video'), audio=probe.streams?.find(x=>x.codec_type==='audio'); const frames=Number(video?.nb_read_frames||0), duration=Number(probe.format?.duration||0); const valid=Boolean(video&&audio)&&frames===encoded.total&&Math.abs(duration-expectedDuration)<=0.15;
    const h0=performance.now(); const artifactSha256=await sha256File(mp4Path); hashMs=performance.now()-h0; const mp4Bytes=fs.statSync(mp4Path).size;
    return {valid,frames,duration,muxMs,validateMs,hashMs,mp4Bytes,artifactSha256};
  } finally { await fsp.rm(h264Path,{force:true}).catch(()=>{}); await fsp.rm(mp4Path,{force:true}).catch(()=>{}); }
}

async function main() {
  let browser;
  try {
    browser=await puppeteer.launch({headless:true,protocolTimeout:600000,args:['--no-sandbox','--disable-setuid-sandbox']});
    const pages=[await browser.newPage(),await browser.newPage()];
    const refs=new Map();
    for(let i=0;i<entries.length;i++){await navigate(pages[0],i);refs.set(i,await fingerprint(pages[0],entries[i]));}
    for(let i=0;i<2;i++){await navigate(pages[i],i);const e=await encode(pages[i],`warm-${i}`,entries[i]);const f=await finalize(`warm-${i}`,e);if(!f.valid)throw new Error('warmup artifact invalid');}

    const sequence=['serial','overlap','overlap','serial']; const cycles=[];
    for(let cycleIndex=0;cycleIndex<sequence.length;cycleIndex++){
      const mode=sequence[cycleIndex], rows=[], failures=[]; let next=0,maxInflight=0,maxInflightBytes=0,currentInflightBytes=0,peakRss=processTreeRss(); const tails=new Set(); const wall0=performance.now(),cpu0=cpuUsec();
      const trackTail=(promise,bytes) => { currentInflightBytes+=bytes; maxInflightBytes=Math.max(maxInflightBytes,currentInflightBytes); const wrapped=promise.finally(()=>{tails.delete(wrapped);currentInflightBytes-=bytes;}); tails.add(wrapped);maxInflight=Math.max(maxInflight,tails.size);return wrapped; };
      const worker=async(page,workerIndex)=>{
        for(;;){const idx=next++;if(idx>=entries.length)return;const entry=entries[idx],id=`c${cycleIndex}-${mode}-w${workerIndex}-j${idx}`,job0=performance.now();try{const loadMs=await navigate(page,idx);const fp=await fingerprint(page,entry);if(fp!==refs.get(idx))throw new Error(`state fingerprint mismatch fixture ${idx}`);const encoded=await encode(page,id,entry);const encodedDone=performance.now();const tail=trackTail((async()=>{const t0=performance.now();const fin=await finalize(id,encoded);const end=performance.now();if(!fin.valid)throw new Error(`invalid artifact fixture ${idx}`);const row={cycleIndex,mode,idx,workerIndex,loadMs:+loadMs.toFixed(2),encodeMs:+encoded.encodeMs.toFixed(2),drawMs:+encoded.drawMs.toFixed(2),uploadMs:+encoded.uploadMs.toFixed(2),muxMs:+fin.muxMs.toFixed(2),validateMs:+fin.validateMs.toFixed(2),hashMs:+fin.hashMs.toFixed(2),tailMs:+(end-t0).toFixed(2),encodePhaseWallMs:+(encodedDone-job0).toFixed(2),completionWallMs:+(end-job0).toFixed(2),mp4Bytes:fin.mp4Bytes,maxQueue:encoded.maxQueue,artifactSha256:fin.artifactSha256,processTreeRssBytes:processTreeRss()};rows.push(row);peakRss=Math.max(peakRss,row.processTreeRssBytes);return row;})(),encoded.bytes);
          if(mode==='serial')await tail;else if(tails.size>=tailLimit)await Promise.race([...tails]);
        }catch(error){failures.push({idx,workerIndex,message:String(error?.stack||error)});}
      };
      await Promise.all(pages.map((p,i)=>worker(p,i))); await Promise.all([...tails]); const scenarioWallMs=performance.now()-wall0,cpuMs=(cpuUsec()-cpu0)/1000; if(failures.length)throw new Error(`${mode} cycle ${cycleIndex} failures: ${JSON.stringify(failures)}`); if(rows.length!==36)throw new Error(`${mode} cycle ${cycleIndex} expected 36 rows, got ${rows.length}`);
      cycles.push({cycleIndex,mode,jobs:rows.length,scenarioWallMs:+scenarioWallMs.toFixed(2),videosPerHour:+(rows.length*3600000/scenarioWallMs).toFixed(2),cpuMs:+cpuMs.toFixed(2),cpuMsPerVideo:+(cpuMs/rows.length).toFixed(2),p50CompletionWallMs:+quantile(rows.map(r=>r.completionWallMs),.5).toFixed(2),p95CompletionWallMs:+quantile(rows.map(r=>r.completionWallMs),.95).toFixed(2),p50TailMs:+quantile(rows.map(r=>r.tailMs),.5).toFixed(2),meanMuxMs:+mean(rows.map(r=>r.muxMs)).toFixed(2),meanValidateMs:+mean(rows.map(r=>r.validateMs)).toFixed(2),meanEncodeMs:+mean(rows.map(r=>r.encodeMs)).toFixed(2),peakProcessTreeRssBytes:peakRss,maxInflight,maxInflightBytes,rows});
      console.log(`${mode} cycle ${cycleIndex}: ${cycles.at(-1).videosPerHour} videos/h, p50 ${cycles.at(-1).p50CompletionWallMs} ms, max tails ${maxInflight}`);
    }
    const serial=cycles.filter(c=>c.mode==='serial'),overlap=cycles.filter(c=>c.mode==='overlap'); const agg=cs=>({videosPerHour:+mean(cs.map(c=>c.videosPerHour)).toFixed(2),cpuMsPerVideo:+mean(cs.map(c=>c.cpuMsPerVideo)).toFixed(2),p50CompletionWallMs:+mean(cs.map(c=>c.p50CompletionWallMs)).toFixed(2),p95CompletionWallMs:+mean(cs.map(c=>c.p95CompletionWallMs)).toFixed(2),p50TailMs:+mean(cs.map(c=>c.p50TailMs)).toFixed(2),peakProcessTreeRssBytes:Math.max(...cs.map(c=>c.peakProcessTreeRssBytes)),maxInflight:Math.max(...cs.map(c=>c.maxInflight)),maxInflightBytes:Math.max(...cs.map(c=>c.maxInflightBytes))}); const s=agg(serial),o=agg(overlap),throughputGain=o.videosPerHour/s.videosPerHour-1,cpuDelta=o.cpuMsPerVideo/s.cpuMsPerVideo-1; const pass=throughputGain>=.10 || (throughputGain>=-.01 && cpuDelta<=-.10);
    const report={schema:'framewright-r38-pipeline-overlap-v1',config:{concurrency,tailLimit,bitrate,queueLimit,sequence,fixtures:entries.length},cycles,aggregate:{serial:s,overlap:o},decision:{throughputGain:+throughputGain.toFixed(4),cpuPerVideoDelta:+cpuDelta.toFixed(4),deepPass:pass,policy:pass?'pipeline overlap earns production-shaped deep pass':'kill pipeline overlap; keep simpler serial tail'}}; await fsp.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
    const summary=`# R38 pipeline overlap scout\n\nSerial: **${s.videosPerHour} videos/h**, CPU **${s.cpuMsPerVideo} ms/video**, p50/p95 completion **${s.p50CompletionWallMs}/${s.p95CompletionWallMs} ms**.\n\nOverlap: **${o.videosPerHour} videos/h**, CPU **${o.cpuMsPerVideo} ms/video**, p50/p95 completion **${o.p50CompletionWallMs}/${o.p95CompletionWallMs} ms**.\n\nThroughput delta: **${(throughputGain*100).toFixed(2)}%**. CPU/video delta: **${(cpuDelta*100).toFixed(2)}%**. Max bounded tail concurrency: **${o.maxInflight}/${tailLimit}**.\n\nDecision: **${report.decision.policy}**.\n`; await fsp.writeFile(path.join(outDir,'summary.md'),summary); console.log(summary);
  } finally { if(browser)await browser.close(); await new Promise(resolve=>server.close(resolve)); }
}
await main();
