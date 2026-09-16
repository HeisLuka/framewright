#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const rawDir=path.resolve(process.argv[2]||'artifacts/r49/raw');
const outDir=path.resolve(process.argv[3]||'artifacts/r49');
const rawReportPath=path.join(rawDir,'report.json');
if(!fs.existsSync(rawReportPath))throw new Error(`missing raw R47 report: ${rawReportPath}`);
fs.mkdirSync(path.join(outDir,'contacts'),{recursive:true});
const raw=JSON.parse(fs.readFileSync(rawReportPath,'utf8'));
if(raw.schema!=='nightwill-r47-catalog-bitrate-floor-v1')throw new Error(`unexpected source schema ${raw.schema}`);

// Frozen semantic ROI geometry copied exactly from the canonical R47/R31-derived scout.
const ROI={
  hook:{frame:45,rect:{x:76,y:620,w:928,h:700}},
  book_cover:{frame:165,rect:{x:120,y:450,w:430,h:650}},
  book_title:{frame:165,rect:{x:570,y:540,w:434,h:470}},
  book_hook:{frame:195,rect:{x:490,y:1120,w:514,h:320}},
  cta_cover:{frame:285,rect:{x:350,y:500,w:380,h:560}},
  cta_title:{frame:300,rect:{x:60,y:1080,w:960,h:300}},
  cta_button:{frame:330,rect:{x:160,y:1340,w:760,h:220}}
};
const expectedBooks=['river-station','letters','city-seven','observatory','long-title','night-archive'];
const expectedBitrates=[3000000,3500000];
const historicalFixtureExactPass={
  'river-station':{3000000:true,3500000:false},
  'letters':{3000000:false,3500000:false},
  'city-seven':{3000000:false,3500000:false},
  'observatory':{3000000:true,3500000:true},
  'long-title':{3000000:false,3500000:false},
  'night-archive':{3000000:false,3500000:false}
};
const ssign=v=>v>0?1:v<0?-1:0;
const round=(v,n=6)=>Number(v.toFixed(n));

function run(cmd,args){
  const p=spawnSync(cmd,args,{encoding:'utf8',maxBuffer:20*1024*1024});
  if(p.error)throw p.error;
  if(p.status!==0)throw new Error(`${cmd} exited ${p.status}\n${String(p.stderr).slice(-5000)}`);
}
function makeContact(book,roiName){
  const {x,y,w,h}=ROI[roiName].rect;
  const bookDir=path.join(rawDir,book);
  const inputs=[
    path.join(bookDir,'refs',`${roiName}.png`),
    path.join(bookDir,'decoded',`x264-crf22-${roiName}.png`),
    path.join(bookDir,'decoded',`wc-3.00m-${roiName}.png`),
    path.join(bookDir,'decoded',`wc-3.50m-${roiName}.png`)
  ];
  for(const f of inputs)if(!fs.existsSync(f))throw new Error(`missing calibration image ${f}`);
  const targetDir=path.join(outDir,'contacts',book);fs.mkdirSync(targetDir,{recursive:true});
  const target=path.join(targetDir,`${roiName}.png`);
  const filter=inputs.map((_,i)=>`[${i}:v]crop=${w}:${h}:${x}:${y},format=rgb24[p${i}]`).join(';')+`;[p0][p1][p2][p3]hstack=inputs=4[out]`;
  const args=[];for(const f of inputs)args.push('-i',f);
  args.push('-filter_complex',filter,'-map','[out]','-frames:v','1','-y',target);
  run('ffmpeg',['-hide_banner','-loglevel','error',...args]);
  return path.relative(outDir,target).split(path.sep).join('/');
}

const comparisons=[];
const visualManifest=[];
const replay=[];
for(const book of expectedBooks){
  const fixture=raw.fixtures.find(x=>x.bookId===book);
  if(!fixture)throw new Error(`missing fixture ${book}`);
  const x264=fixture.rows.find(x=>x.kind==='x264');
  if(!x264)throw new Error(`${book}: missing x264 reference`);
  for(const bitrate of expectedBitrates){
    const wc=fixture.rows.find(x=>x.kind==='webcodecs'&&x.bitrate===bitrate);
    if(!wc)throw new Error(`${book}: missing WebCodecs ${bitrate}`);
    replay.push({book,bitrate,current_exact_ssim_pass:Boolean(wc.passVsX264),historical_exact_ssim_pass:historicalFixtureExactPass[book][bitrate],same:Boolean(wc.passVsX264)===historicalFixtureExactPass[book][bitrate]});
    for(const roi of Object.keys(ROI)){
      const xm=x264.metrics?.[roi],wm=wc.metrics?.[roi];
      if(!xm||!wm)throw new Error(`${book}/${bitrate}/${roi}: missing metrics`);
      const dSsim=wm.ssim-xm.ssim,dPsnr=wm.psnr-xm.psnr;
      comparisons.push({
        book,style:fixture.style,bitrate,roi,
        x264:{ssim:xm.ssim,psnr:xm.psnr},
        webcodecs:{ssim:wm.ssim,psnr:wm.psnr},
        delta:{ssim:round(dSsim),psnr_db:round(dPsnr,3)},
        exact_r31_ssim_pass:dSsim>=0,
        psnr_direction_pass:dPsnr>=0,
        metric_direction_disagreement:ssign(dSsim)!==0&&ssign(dPsnr)!==0&&ssign(dSsim)!==ssign(dPsnr),
        preexisting_r43_equivalence_band:dSsim>=-0.005&&dPsnr>=-1
      });
    }
  }
  for(const roi of Object.keys(ROI)){
    visualManifest.push({book,style:fixture.style,roi,frame:ROI[roi].frame,rect:ROI[roi].rect,contact:makeContact(book,roi),panel_order:['lossless_canvas','x264_crf22','webcodecs_3.00m','webcodecs_3.50m']});
  }
}

if(comparisons.length!==expectedBooks.length*expectedBitrates.length*Object.keys(ROI).length)throw new Error('incomplete metric matrix');
if(visualManifest.length!==expectedBooks.length*Object.keys(ROI).length)throw new Error('incomplete visual matrix');
const exactFailures=comparisons.filter(x=>!x.exact_r31_ssim_pass);
const psnrFailures=comparisons.filter(x=>!x.psnr_direction_pass);
const directionDisagreements=comparisons.filter(x=>x.metric_direction_disagreement);
const equivalenceBandFailures=comparisons.filter(x=>!x.preexisting_r43_equivalence_band);
const exactFailButBandEquivalent=comparisons.filter(x=>!x.exact_r31_ssim_pass&&x.preexisting_r43_equivalence_band);
const exactPassButBandFail=comparisons.filter(x=>x.exact_r31_ssim_pass&&!x.preexisting_r43_equivalence_band);
const replayMismatches=replay.filter(x=>!x.same);
const rank=[...comparisons].sort((a,b)=>Math.max(Math.abs(b.delta.ssim)/0.005,Math.abs(b.delta.psnr_db)/1)-Math.max(Math.abs(a.delta.ssim)/0.005,Math.abs(a.delta.psnr_db)/1)).slice(0,20);
const report={
  schema:'nightwill-r49-codec-oracle-calibration-v1',
  source:{schema:raw.schema,bitrate_subset:expectedBitrates,reference:'same-raster x264 CRF22',r31_rule:'WebCodecs passes an ROI only when SSIM >= the corresponding x264 ROI SSIM against the lossless Canvas frame'},
  diagnostic_only:{preexisting_r43_equivalence_band:{ssim_delta_min:-0.005,psnr_delta_db_min:-1,policy_note:'reported only as an already-existing equivalence band; R49 does not promote it into the R31 codec gate'}},
  counts:{fixtures:expectedBooks.length,rois:Object.keys(ROI).length,webcodecs_policies:expectedBitrates.length,comparisons:comparisons.length,visual_contacts:visualManifest.length,exact_r31_ssim_failures:exactFailures.length,psnr_direction_failures:psnrFailures.length,metric_direction_disagreements:directionDisagreements.length,r43_band_failures:equivalenceBandFailures.length,exact_fail_but_r43_band_equivalent:exactFailButBandEquivalent.length,exact_pass_but_r43_band_fail:exactPassButBandFail.length,replay_mismatches:replayMismatches.length},
  replay,
  comparisons,
  diagnostic_rank:rank,
  decision:{status:'ORACLE_CALIBRATION_REQUIRED',policy_change:false,reason:'R49 is evidence-only. Exact R31 SSIM, PSNR direction, an already-existing equivalence band, and lossless visual contacts are reported side-by-side; no post-hoc metric or threshold becomes policy in this pass.'}
};
fs.writeFileSync(path.join(outDir,'report.json'),JSON.stringify(report,null,2)+'\n');
fs.writeFileSync(path.join(outDir,'visual-manifest.json'),JSON.stringify({schema:'nightwill-r49-visual-manifest-v1',items:visualManifest},null,2)+'\n');
const conflictLines=directionDisagreements.slice(0,16).map(x=>`| ${x.book} | ${(x.bitrate/1e6).toFixed(1)}M | ${x.roi} | ${x.delta.ssim>=0?'+':''}${x.delta.ssim.toFixed(6)} | ${x.delta.psnr_db>=0?'+':''}${x.delta.psnr_db.toFixed(3)} dB |`).join('\n');
const summary=`# R49 codec oracle calibration\n\n`+
`Evidence matrix: **${comparisons.length}** codec/ROI comparisons and **${visualManifest.length}** four-panel lossless contacts (Canvas | x264 CRF22 | WebCodecs 3.0M | WebCodecs 3.5M).\n\n`+
`Exact R31 SSIM failures: **${exactFailures.length}**. PSNR-direction failures: **${psnrFailures.length}**. SSIM/PSNR direction disagreements: **${directionDisagreements.length}**. Exact-R31 failures that still sit inside the already-existing R43 (-0.005 SSIM / -1 dB) equivalence band: **${exactFailButBandEquivalent.length}**. Exact-R31 passes that fail that band: **${exactPassButBandFail.length}**.\n\n`+
`Historical R47 fixture-level exact-gate replay mismatches: **${replayMismatches.length}/${replay.length}**.\n\n`+
`| fixture | bitrate | ROI | dSSIM vs x264 | dPSNR vs x264 |\n|---|---:|---|---:|---:|\n${conflictLines||'| none | - | - | - | - |'}\n\n`+
`Decision: **ORACLE_CALIBRATION_REQUIRED**. This pass deliberately changes neither bitrate policy nor R31 thresholds. The visual contacts exist so metric disagreements can be inspected against the lossless Canvas source instead of choosing whichever scalar metric is convenient.\n`;
fs.writeFileSync(path.join(outDir,'summary.md'),summary);
console.log(summary);
