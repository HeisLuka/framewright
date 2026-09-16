#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';

const manifestPath=path.resolve(process.argv[2]||'examples/book-ad-systems/generated-e14/manifest.json');
const routePath=path.resolve(process.argv[3]||'examples/book-ad-systems/generated-e13/route-report.json');
const batchPath=path.resolve(process.argv[4]||'artifacts/e15/batch.json');
const diversityPath=path.resolve(process.argv[5]||'artifacts/e15/diversity.json');
const outDir=path.resolve(process.argv[6]||'artifacts/e15/package');
const templatePath=path.resolve(process.env.TEMPLATE||'examples/book-ad-systems/index-e14.html');
const rendererPath=path.resolve(process.env.RENDERER||'.agents/skills/framewright/scripts/node-canvas-batch.mjs');
const NEAR_DUP_THRESHOLD=+(process.env.NEAR_DUP_THRESHOLD||0.015);
const VARIANT_ORDER=['hook-first','cover-first','title-first','hook-title'];

function stable(v){if(Array.isArray(v))return v.map(stable);if(v&&typeof v==='object'){const o={};for(const k of Object.keys(v).sort())o[k]=stable(v[k]);return o;}return v;}
function canonical(v){return JSON.stringify(stable(v));}
function shaText(v){return crypto.createHash('sha256').update(typeof v==='string'?v:canonical(v)).digest('hex');}
function shaFile(file){const h=crypto.createHash('sha256');h.update(fs.readFileSync(file));return h.digest('hex');}
function sanitize(v){return String(v).toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,48)||'creative';}
function resolvePayloadFile(rel){return path.isAbsolute(rel)?rel:path.resolve(path.dirname(manifestPath),rel);}
function resolveCover(payload){const src=payload.cover_url;if(!src||/^[a-z]+:/i.test(src))return null;return path.isAbsolute(src)?src:path.resolve(path.dirname(templatePath),src);}
function run(args,opts={}){const r=spawnSync(args[0],args.slice(1),{encoding:opts.encoding??null,maxBuffer:32*1024*1024});if(r.status!==0)throw new Error(`${args[0]} failed: ${String(r.stderr).slice(-3000)}`);return r;}
function ffmpegVersion(){const r=run(['ffmpeg','-version'],{encoding:'utf8'});return String(r.stdout).split(/\r?\n/)[0].trim();}
function visualFingerprint(video){
  const r=run(['ffmpeg','-hide_banner','-loglevel','error','-i',video,'-t','12','-vf','fps=1,scale=8:8:flags=area,format=gray','-f','rawvideo','-pix_fmt','gray','-']);
  const buf=r.stdout,frameBytes=64,frames=Math.floor(buf.length/frameBytes),hashes=[];
  for(let f=0;f<frames;f++){
    const off=f*frameBytes;let mean=0;for(let i=0;i<frameBytes;i++)mean+=buf[off+i];mean/=frameBytes;
    let bits=0n;for(let i=0;i<frameBytes;i++)if(buf[off+i]>=mean)bits|=1n<<BigInt(i);
    hashes.push(bits.toString(16).padStart(16,'0'));
  }
  return {algorithm:'sequence-ahash8x8-1fps-v1',frames,value:hashes.join('')};
}
const POP=[0,1,1,2,1,2,2,3,1,2,2,3,2,3,3,4];
function fpDistance(a,b){const A=a.value,B=b.value,n=Math.min(A.length,B.length);if(!n)return 1;let d=0;for(let i=0;i<n;i++)d+=POP[parseInt(A[i],16)^parseInt(B[i],16)];return d/(n*4);}

const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const routes=JSON.parse(fs.readFileSync(routePath,'utf8'));
const batch=JSON.parse(fs.readFileSync(batchPath,'utf8'));
const diversity=JSON.parse(fs.readFileSync(diversityPath,'utf8'));
const batchById=new Map(batch.results.map(x=>[x.id,x]));
const routeByBook=new Map(routes.books.map(x=>[x.bookId,x]));
const diversityByBook=new Map(diversity.books.map(x=>[x.bookId,x]));
const fontPaths=['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'];
const environment={platform:process.platform,arch:process.arch,node:process.version,nodeAbi:process.versions.modules,napi:process.versions.napi,canvas:'@napi-rs/canvas@1.0.9',ffmpeg:ffmpegVersion(),fonts:fontPaths.map(file=>({file:path.basename(file),sha256:fs.existsSync(file)?shaFile(file):null}))};
const templateSha256=shaFile(templatePath),rendererSha256=shaFile(rendererPath);
const renderProfile={id:'framewright-standard-1080x1920-x264-v1',width:batch.width,height:batch.height,fps:30,frames:360,preset:batch.preset,crf:batch.crf,pixelFormat:'yuv420p'};
const renderEnvironmentHash=shaText({environment,rendererSha256,renderProfile});

const candidates=[];
for(const entry of manifest.items){
  const payloadFile=resolvePayloadFile(entry.payloadFile),payload=JSON.parse(fs.readFileSync(payloadFile,'utf8'));
  const batchRow=batchById.get(entry.id);if(!batchRow)throw new Error(`missing rendered output for ${entry.id}`);
  const video=path.resolve(batchRow.output);if(!fs.existsSync(video))throw new Error(`missing video ${video}`);
  const cover=resolveCover(payload),coverSha256=cover&&fs.existsSync(cover)?shaFile(cover):null;
  if(!coverSha256)throw new Error(`${entry.id}: cover asset must be staged locally so creative identity is content-addressed`);
  // Storage location is not creative semantics. The staged cover bytes are represented by coverSha256 below.
  const payloadSemantic={...payload};delete payloadSemantic.route_reason;delete payloadSemantic.creative_rank;delete payloadSemantic.cover_url;
  const payloadSha256=shaText(payloadSemantic);
  const creativeSpec={schema:'framewright-creative-spec-v1',bookId:entry.bookId,visualSystem:entry.style,variant:entry.variant,seed:entry.seed,motionDensity:payload.motion_density||'active',payloadSha256,coverSha256,templateSha256};
  const creativeSpecSha256=shaText(creativeSpec),creativeId=`fwc1-${sanitize(entry.bookId)}-${creativeSpecSha256.slice(0,16)}`;
  const renderSpec={schema:'framewright-render-spec-v1',creativeSpecSha256,renderEnvironmentHash,renderProfile};
  const renderSpecSha256=shaText(renderSpec),renderId=`fwr1-${renderSpecSha256.slice(0,20)}`;
  const route=routeByBook.get(entry.bookId);if(!route)throw new Error(`missing route report for ${entry.bookId}`);
  const primary=route.ranked[0];if(primary.system!==entry.style)throw new Error(`${entry.bookId}: E14 style ${entry.style} != E13 primary ${primary.system}`);
  candidates.push({
    creativeId,renderId,bookId:entry.bookId,visualSystem:entry.style,variant:entry.variant,seed:entry.seed,
    identity:{creativeSpecSha256,payloadSha256,coverSha256,templateSha256,renderSpecSha256,rendererSha256,renderEnvironmentHash},
    route:{schema:routes.schema,meta:route.meta,primaryScore:primary.score,reasons:primary.reasons},
    output:{source:path.relative(process.cwd(),video),bytes:fs.statSync(video).size,sha256:shaFile(video),visualFingerprint:visualFingerprint(video)}
  });
}

function variantIndex(v){const i=VARIANT_ORDER.indexOf(v);return i<0?999:i;}
function visualDistance(book,a,b){const row=diversityByBook.get(book);if(!row)throw new Error(`missing diversity row ${book}`);if(a===b)return 0;const p=row.pairs.find(x=>(x.a===a&&x.b===b)||(x.a===b&&x.b===a));if(!p)throw new Error(`missing diversity pair ${book} ${a}/${b}`);return p.mean;}

const suppressed=[],books=[];
for(const bookId of [...new Set(manifest.items.map(x=>x.bookId))]){
  const all=candidates.filter(x=>x.bookId===bookId).sort((a,b)=>variantIndex(a.variant)-variantIndex(b.variant));
  const survivors=[];
  for(const c of all){
    let dup=null;
    for(const kept of survivors){
      if(c.identity.creativeSpecSha256===kept.identity.creativeSpecSha256)dup={kind:'exact-spec',of:kept.creativeId,distance:0};
      else if(c.output.sha256===kept.output.sha256)dup={kind:'exact-output',of:kept.creativeId,distance:0};
      else {const d=fpDistance(c.output.visualFingerprint,kept.output.visualFingerprint);if(d<=NEAR_DUP_THRESHOLD)dup={kind:'near-visual',of:kept.creativeId,distance:+d.toFixed(6)};}
      if(dup)break;
    }
    if(dup){suppressed.push({creativeId:c.creativeId,bookId,variant:c.variant,...dup});c.dedupe={status:'suppressed',...dup};}
    else {c.dedupe={status:'kept'};survivors.push(c);}
  }
  if(survivors.length<3)throw new Error(`${bookId}: only ${survivors.length} candidates survived dedupe`);
  const selected=[];
  const anchor=survivors.find(x=>x.variant==='hook-first')||survivors[0];
  selected.push({candidate:anchor,reason:'anchor-hook-first',selectionDistance:null});
  while(selected.length<3){
    const chosenIds=new Set(selected.map(x=>x.candidate.creativeId));
    const pool=survivors.filter(x=>!chosenIds.has(x.creativeId));
    pool.sort((a,b)=>{
      const da=Math.min(...selected.map(s=>visualDistance(bookId,a.variant,s.candidate.variant)));
      const db=Math.min(...selected.map(s=>visualDistance(bookId,b.variant,s.candidate.variant)));
      return db-da||variantIndex(a.variant)-variantIndex(b.variant);
    });
    const c=pool[0],d=Math.min(...selected.map(s=>visualDistance(bookId,c.variant,s.candidate.variant)));
    selected.push({candidate:c,reason:'greedy-maximin-diversity',selectionDistance:+d.toFixed(6)});
  }
  const selectedIds=new Set(selected.map(x=>x.candidate.creativeId));
  const reserve=survivors.filter(x=>!selectedIds.has(x.creativeId));
  const route=routeByBook.get(bookId),div=diversityByBook.get(bookId);
  books.push({bookId,route:{primarySystem:route.ranked[0].system,score:route.ranked[0].score,reasons:route.ranked[0].reasons,meta:route.meta},candidateCount:all.length,survivorCount:survivors.length,selected:selected.map((x,i)=>({creativeId:x.candidate.creativeId,rank:i+1,variant:x.candidate.variant,reason:x.reason,selectionDistance:x.selectionDistance})),reserve:reserve.map(x=>({creativeId:x.creativeId,variant:x.variant})),diversity:{meanPairwiseDiff:div.meanPairwiseDiff,minPairwiseDiff:div.minPairwiseDiff}});
}

const selectedIds=new Set(books.flatMap(b=>b.selected.map(x=>x.creativeId)));
for(const c of candidates)c.selection=selectedIds.has(c.creativeId)?{status:'selected'}:{status:c.dedupe.status==='suppressed'?'suppressed':'reserve'};

const exactSpecGroups=Object.values(Object.groupBy?Object.groupBy(candidates,x=>x.identity.creativeSpecSha256):candidates.reduce((m,x)=>((m[x.identity.creativeSpecSha256]??=[]).push(x),m),{})).filter(xs=>xs.length>1).map(xs=>xs.map(x=>x.creativeId));
const exactOutputGroups=Object.values(Object.groupBy?Object.groupBy(candidates,x=>x.output.sha256):candidates.reduce((m,x)=>((m[x.output.sha256]??=[]).push(x),m),{})).filter(xs=>xs.length>1).map(xs=>xs.map(x=>x.creativeId));
const identityContract={creativeId:'semantic creative spec hash; independent of encoder implementation and asset storage path',renderId:'creative spec + renderer/environment/profile hash; environment includes platform and architecture',outputSha256:'exact MP4 bytes'};
const packageBase={
  schema:'framewright-campaign-package-v1',
  identityContract,
  template:{path:path.relative(process.cwd(),templatePath),sha256:templateSha256,contract:'book-ad-systems-e14-v2'},
  renderer:{path:path.relative(process.cwd(),rendererPath),sha256:rendererSha256,environment,renderEnvironmentHash,profile:renderProfile},
  selectionPolicy:{id:'hook-anchor-greedy-maximin-v1',targetPerBook:3,nearDuplicateFingerprint:'sequence-ahash8x8-1fps-v1',nearDuplicateThreshold:NEAR_DUP_THRESHOLD,notes:'synthetic diversity selects a bounded test set; it does not predict campaign performance'},
  sourceSchemas:{variants:manifest.schema,routes:routes.schema,diversity:diversity.schema,batch:batch.schema},
  counts:{books:books.length,candidates:candidates.length,selected:selectedIds.size,reserve:candidates.filter(x=>x.selection.status==='reserve').length,suppressed:suppressed.length},
  books,
  creatives:candidates.sort((a,b)=>a.bookId.localeCompare(b.bookId)||variantIndex(a.variant)-variantIndex(b.variant)),
  dedupe:{exactSpecGroups,exactOutputGroups,suppressed}
};

fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(path.join(outDir,'selected'),{recursive:true});
const catalogPath=path.join(outDir,'candidate-catalog.json'),manifestOut=path.join(outDir,'campaign-manifest.json'),dedupePath=path.join(outDir,'dedupe-report.json');
fs.writeFileSync(catalogPath,JSON.stringify(packageBase,null,2)+'\n');
const selectedCreatives=packageBase.creatives.filter(x=>x.selection.status==='selected').map(c=>{const book=books.find(b=>b.bookId===c.bookId),sel=book.selected.find(x=>x.creativeId===c.creativeId);const ext='.mp4',file=`${c.creativeId}--${c.renderId}${ext}`;fs.copyFileSync(path.resolve(c.output.source),path.join(outDir,'selected',file));return {...c,selection:{...sel,status:'selected'},output:{...c.output,file:`selected/${file}`}};});
const campaignManifest={schema:'framewright-selected-campaign-manifest-v1',packageContract:packageBase.schema,identityContract:packageBase.identityContract,sourceSchemas:packageBase.sourceSchemas,selectionPolicy:packageBase.selectionPolicy,template:packageBase.template,renderer:packageBase.renderer,counts:{books:books.length,creatives:selectedCreatives.length},books:books.map(b=>({...b,reserve:undefined})),creatives:selectedCreatives};
fs.writeFileSync(manifestOut,JSON.stringify(campaignManifest,null,2)+'\n');
fs.writeFileSync(dedupePath,JSON.stringify({schema:'framewright-dedupe-report-v1',threshold:NEAR_DUP_THRESHOLD,exactSpecGroups,exactOutputGroups,suppressed},null,2)+'\n');
const packageHash=shaFile(manifestOut);fs.writeFileSync(path.join(outDir,'campaign-manifest.sha256'),`${packageHash}  campaign-manifest.json\n`);
console.log(JSON.stringify({schema:campaignManifest.schema,books:books.length,candidates:candidates.length,selected:selectedCreatives.length,reserve:packageBase.counts.reserve,suppressed:suppressed.length,platform:environment.platform,arch:environment.arch,packageSha256:packageHash,selectedVariants:Object.fromEntries(books.map(b=>[b.bookId,b.selected.map(x=>x.variant)]))},null,2));
