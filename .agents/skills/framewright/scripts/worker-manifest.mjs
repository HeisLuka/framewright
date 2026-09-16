#!/usr/bin/env node
// Emit the software/font/runtime fingerprint of a render worker.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import puppeteer from 'puppeteer';
import puppeteerPkg from 'puppeteer/package.json' with { type: 'json' };

const out=path.resolve(process.argv[2]||'worker-manifest.json');
const run=(cmd,args=[])=>{const r=spawnSync(cmd,args,{encoding:'utf8'});return{status:r.status,stdout:(r.stdout||'').trim(),stderr:(r.stderr||'').trim()};};
const sha=file=>{try{return createHash('sha256').update(fs.readFileSync(file)).digest('hex');}catch{return null;}};
const chrome=puppeteer.executablePath();
const files=['package.json','package-lock.json','examples/book-ad-v0/index.html','examples/book-ad-v0/payload.schema.json'].map(f=>({path:f,sha256:sha(path.resolve(f))}));
const manifest={
  schema:'framewright-worker-manifest-v1',createdAt:new Date().toISOString(),
  host:{platform:process.platform,arch:process.arch,kernel:os.release(),node:process.version,cpus:os.cpus().length,cpuModel:os.cpus()[0]?.model||null,totalMemoryBytes:os.totalmem()},
  locale:{LANG:process.env.LANG||null,LC_ALL:process.env.LC_ALL||null,TZ:process.env.TZ||null},
  puppeteer:{version:puppeteerPkg.version,executablePath:chrome,chromeVersion:run(chrome,['--version']).stdout},
  ffmpeg:{version:run('ffmpeg',['-version']).stdout.split('\n')[0]||null},
  fontconfig:{version:run('fc-match',['--version']).stdout||run('fc-match',['--version']).stderr,dejaVuSans:run('fc-match',['DejaVu Sans']).stdout,liberationSans:run('fc-match',['Liberation Sans']).stdout},
  osRelease:fs.existsSync('/etc/os-release')?fs.readFileSync('/etc/os-release','utf8').trim():null,
  files
};
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(manifest,null,2));console.log(JSON.stringify(manifest,null,2));
