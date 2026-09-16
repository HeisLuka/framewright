#!/usr/bin/env node
// E09: deterministic, no-OCR QA for Book Ad v0.
// Instruments fillText in a generated copy of the template, then samples every
// plate plus cut-adjacent frames across normal/long/Latin payload fixtures.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const [,, outArg='artifacts/e09'] = process.argv;
const outDir=path.resolve(outArg);
const source=path.resolve(process.env.HTML||'examples/book-ad-v0/index.html');
const width=+(process.env.WIDTH||1080), seed=+(process.env.SEED||7);
const payloadArgs=process.env.PAYLOADS?.split(',').filter(Boolean) || [
  'examples/book-ad-v0/payload.example.json',
  'examples/book-ad-v0/payload.long.json',
  'examples/book-ad-v0/payload.latin.json'
];
if(!fs.existsSync(source)) throw new Error(`missing template: ${source}`);
fs.rmSync(outDir,{recursive:true,force:true}); fs.mkdirSync(outDir,{recursive:true});

const marker='const PLATES=[];';
const original=fs.readFileSync(source,'utf8');
if(!original.includes(marker)) throw new Error('Book Ad template marker changed');
const instrumentation=String.raw`
// ---- E09 QA instrumentation ----
window.__FW_QA_ACTIVE=false;
window.__FW_QA_SCALE=1;
window.__FW_QA_RECORDS=[];
(function(){
  const proto=CanvasRenderingContext2D.prototype;
  const fillText0=proto.fillText;
  function transformPoint(m,x,y){return{x:m.a*x+m.c*y+m.e,y:m.b*x+m.d*y+m.f};}
  proto.fillText=function(text,x,y,maxWidth){
    if(window.__FW_QA_ACTIVE){
      const s=String(text), mt=this.measureText(s), size=parseFloat(this.font)||16;
      const ascent=mt.actualBoundingBoxAscent||size*.8, descent=mt.actualBoundingBoxDescent||size*.2;
      let x0=x, x1=x+mt.width;
      if(this.textAlign==='center'){x0=x-mt.width/2;x1=x+mt.width/2;}
      else if(this.textAlign==='right'||this.textAlign==='end'){x0=x-mt.width;x1=x;}
      let y0=y-ascent,y1=y+descent;
      if(this.textBaseline==='top'||this.textBaseline==='hanging'){y0=y;y1=y+ascent+descent;}
      else if(this.textBaseline==='middle'){y0=y-(ascent+descent)/2;y1=y+(ascent+descent)/2;}
      else if(this.textBaseline==='bottom'||this.textBaseline==='ideographic'){y0=y-ascent-descent;y1=y;}
      const m=this.getTransform(), sc=window.__FW_QA_SCALE||1;
      const pts=[transformPoint(m,x0,y0),transformPoint(m,x1,y0),transformPoint(m,x0,y1),transformPoint(m,x1,y1)];
      const bx0=Math.min(...pts.map(p=>p.x))/sc, bx1=Math.max(...pts.map(p=>p.x))/sc;
      const by0=Math.min(...pts.map(p=>p.y))/sc, by1=Math.max(...pts.map(p=>p.y))/sc;
      const tol=3;
      const outside=bx0<SAFE.x-tol||bx1>SAFE.x+SAFE.w+tol||by0<SAFE.y-tol||by1>SAFE.y+SAFE.h+tol;
      window.__FW_QA_RECORDS.push({text:s,bbox:{x:+bx0.toFixed(2),y:+by0.toFixed(2),w:+(bx1-bx0).toFixed(2),h:+(by1-by0).toFixed(2)},font:this.font,align:this.textAlign,alpha:+this.globalAlpha.toFixed(4),outsideSafe:outside,ellipsized:s.includes('…')});
    }
    return maxWidth===undefined?fillText0.call(this,text,x,y):fillText0.call(this,text,x,y,maxWidth);
  };
})();
window.__FW_QA_RUN=function(frame,width,seed){
  window.__FW_QA_ACTIVE=true; window.__FW_QA_SCALE=width/LW; window.__FW_QA_RECORDS=[];
  try{
    const dataUrl=window.RISO.frame(frame,width,seed);
    const records=window.__FW_QA_RECORDS.map(x=>({...x}));
    return{dataUrl,records,safe:{...SAFE},payload:window.RISO.payload};
  } finally { window.__FW_QA_ACTIVE=false; }
};
// ---- end E09 QA instrumentation ----
`;
const generated=path.join(path.dirname(source),'.qa-book-ad.generated.html');
fs.writeFileSync(generated,original.replace(marker,instrumentation+'\n'+marker));

function sampleFrames(plates){
  const frames=new Set(), ranges=[]; let start=0;
  for(const p of plates){
    const end=start+p.len-1;
    const locals=[0,1,2,Math.round((p.len-1)*.25),Math.round((p.len-1)*.5),Math.round((p.len-1)*.75),Math.max(0,p.len-3),Math.max(0,p.len-2),p.len-1];
    for(const local of locals)frames.add(start+local);
    ranges.push({name:p.name,start,end}); start+=p.len;
  }
  for(const r of ranges.slice(1))for(let d=-3;d<=3;d++)if(r.start+d>=0&&r.start+d<start)frames.add(r.start+d);
  return{frames:[...frames].sort((a,b)=>a-b),ranges,total:start};
}
function plateAt(ranges,f){return ranges.find(r=>f>=r.start&&f<=r.end)?.name||'unknown';}

const browserArgs=['--allow-file-access-from-files'];
if(process.env.CI||process.env.FRAMEWRIGHT_NO_SANDBOX)browserArgs.push('--no-sandbox','--disable-setuid-sandbox');
const browser=await puppeteer.launch({headless:true,protocolTimeout:600000,args:browserArgs});
const payloadReports=[]; let totalFailures=0;
try{
  for(const payloadArg of payloadArgs){
    const payloadPath=path.resolve(payloadArg); const payload=JSON.parse(fs.readFileSync(payloadPath,'utf8'));
    const name=path.basename(payloadPath,'.json').replace(/^payload\./,'')||'payload';
    const page=await browser.newPage();
    page.on('pageerror',e=>console.error('PAGE ERROR',name,e.message));
    await page.evaluateOnNewDocument(v=>{window.FRAMEWRIGHT_PAYLOAD=v;},payload);
    await page.goto('file://'+generated+`?f=0&w=320&s=${seed}`,{waitUntil:'load',timeout:120000});
    await page.waitForFunction('window.__ready===true',{timeout:120000});
    const bootError=await page.evaluate(()=>window.__bootError||null); if(bootError)throw new Error(`${name}: ${bootError}`);
    const meta=await page.evaluate(()=>({total:window.RISO.total,fps:window.RISO.fps,plates:window.RISO.plates}));
    const plan=sampleFrames(meta.plates); const frameReports=[], imageDir=path.join(outDir,name); fs.mkdirSync(imageDir,{recursive:true});
    for(const frame of plan.frames){
      const result=await page.evaluate((f,w,s)=>window.__FW_QA_RUN(f,w,s),frame,width,seed);
      const failures=result.records.filter(r=>r.outsideSafe||r.ellipsized);
      if(failures.length) totalFailures+=failures.length;
      const png=Buffer.from(result.dataUrl.split(',')[1],'base64');
      fs.writeFileSync(path.join(imageDir,`f${String(frame).padStart(5,'0')}.png`),png);
      frameReports.push({frame,plate:plateAt(plan.ranges,frame),textCount:result.records.length,failures,records:result.records});
    }
    const failingFrames=frameReports.filter(x=>x.failures.length);
    payloadReports.push({name,payloadPath,framesChecked:frameReports.length,plates:plan.ranges,failures:failingFrames.reduce((a,x)=>a+x.failures.length,0),failingFrames,frames:frameReports});
    await page.close();
  }
} finally { await browser.close(); fs.rmSync(generated,{force:true}); }

const report={schema:'framewright-book-ad-qa-v1',createdAt:new Date().toISOString(),config:{source,width,seed,payloads:payloadArgs},status:totalFailures?'fail':'pass',totalFailures,payloads:payloadReports};
fs.writeFileSync(path.join(outDir,'qa-report.json'),JSON.stringify(report,null,2));
let md=`# E09 Book Ad QA\n\nStatus: **${report.status.toUpperCase()}**. Width ${width}, seed ${seed}.\n\n| payload | sampled frames | text failures | failing frames |\n|---|---:|---:|---:|\n`;
for(const p of payloadReports)md+=`| ${p.name} | ${p.framesChecked} | ${p.failures} | ${p.failingFrames.map(x=>x.frame).join(', ')||'—'} |\n`;
md+='\nFailure means a helper-rendered text bounding box crosses the template SAFE region or the final rendered line contains an ellipsis. Frames are selected from every plate and ±3 around plate cuts.\n';
fs.writeFileSync(path.join(outDir,'summary.md'),md); console.log(md);
if(totalFailures)process.exit(2);
