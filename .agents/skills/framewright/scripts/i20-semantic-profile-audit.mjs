#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import puppeteer from 'puppeteer';

const htmlPath=path.resolve(process.argv[2]||'examples/book-ad-systems/index-c27-i20.html');
const requestPath=path.resolve(process.argv[3]||'.bench/i20/request.json');
const reportPath=path.resolve(process.argv[4]||'.bench/i20/semantic-audit.json');
const TOL=12;
if(!fs.existsSync(htmlPath)||!fs.existsSync(requestPath))throw new Error('I20 semantic audit requires HTML + request');
const request=JSON.parse(fs.readFileSync(requestPath,'utf8'));
const profileById=new Map(request.delivery_profiles.map(x=>[x.id,x]));
const root=path.dirname(htmlPath),htmlName=path.basename(htmlPath);
const mime={'.html':'text/html; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
const server=http.createServer((req,res)=>{
  try{
    const u=new URL(req.url,'http://localhost');
    const rel=u.pathname==='/'?htmlName:decodeURIComponent(u.pathname.replace(/^\//,''));
    const file=path.resolve(root,rel);
    if(!(file===root||file.startsWith(root+path.sep))||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end('not found');return;}
    res.writeHead(200,{'content-type':mime[path.extname(file).toLowerCase()]||'application/octet-stream','cache-control':'no-store'});fs.createReadStream(file).pipe(res);
  }catch(error){res.writeHead(500);res.end(String(error));}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await puppeteer.launch({headless:true,protocolTimeout:600000,args:process.env.CI?['--no-sandbox','--disable-setuid-sandbox']:[]});
const shapeFor=profile=>profile.width===1080&&profile.height===1920?'vertical':profile.width===1080&&profile.height===1080?'square':profile.width===1920&&profile.height===1080?'landscape':null;
const inside=(box,s)=>box.x>=s.x-TOL&&box.y>=s.y-TOL&&box.x+box.w<=s.x+s.w+TOL&&box.y+box.h<=s.y+s.h+TOL;
const rows=[],errors=[];
try{
  for(const selected of request.selected){
    const source=JSON.parse(fs.readFileSync(path.resolve(selected.execution.payload),'utf8'));
    for(const profileId of selected.requested_delivery_profile_ids){
      const profile=profileById.get(profileId);
      const shape=shapeFor(profile);
      if(!shape)throw new Error(`unsupported audit geometry ${profile?.width}x${profile?.height}`);
      const payload={...source,delivery_profile:shape,delivery_width:profile.width,delivery_height:profile.height,...(profile.platform_ui_profile?{platform_profile:profile.platform_ui_profile}:{})};
      const page=await browser.newPage();
      await page.evaluateOnNewDocument(value=>{window.FRAMEWRIGHT_PAYLOAD=value;},payload);
      const url=`${origin}/${encodeURIComponent(htmlName)}?f=0&w=${profile.width}&s=${selected.creative.seed}`;
      await page.goto(url,{waitUntil:'load',timeout:120000});
      await page.waitForFunction('window.__ready===true',{timeout:120000});
      const result=await page.evaluate(({width,height,tolerance})=>{
        const cv=document.getElementById('c');
        window.RISO.frame(0,width,window.FRAMEWRIGHT_PAYLOAD?.seed||7);
        const ui=window.__C26_PLATFORM_UI?.();
        if(!ui)throw new Error('C26 profile API missing');
        const violations=[];let sampled=0,eventCount=0,start=0;
        const insideBox=(box,s)=>box.x>=s.x-tolerance&&box.y>=s.y-tolerance&&box.x+box.w<=s.x+s.w+tolerance&&box.y+box.h<=s.y+s.h+tolerance;
        for(const plate of window.RISO.plates){
          for(const frac of [.18,.50,.82]){
            const f=start+Math.min(plate.len-1,Math.max(0,Math.round((plate.len-1)*frac)));
            window.__C26_BEGIN_CAPTURE();window.RISO.frame(f,width,window.FRAMEWRIGHT_PAYLOAD?.seed||7);const cap=window.__C26_END_CAPTURE();sampled++;
            for(const event of cap.events||[]){eventCount++;if(!insideBox(event.box,ui.safeRect))violations.push({frame:f,plate:plate.name,kind:event.kind,role:event.role||null,box:event.box});}
          }
          start+=plate.len;
        }
        return{canvas:{width:cv.width,height:cv.height},ui,sampled,eventCount,violations};
      },{width:profile.width,height:profile.height,tolerance:TOL});
      await page.close();
      if(result.canvas.width!==profile.width||result.canvas.height!==profile.height)errors.push(`${selected.selection_id}/${profileId}: canvas ${result.canvas.width}x${result.canvas.height}`);
      if(result.violations.length)errors.push(`${selected.selection_id}/${profileId}: ${result.violations.length} safe-zone violations`);
      if(!inside({x:result.ui.safeRect.x,y:result.ui.safeRect.y,w:result.ui.safeRect.w,h:result.ui.safeRect.h},{x:0,y:0,w:profile.width,h:profile.height}))errors.push(`${selected.selection_id}/${profileId}: safeRect outside canvas`);
      rows.push({selection_id:selected.selection_id,visual_system:selected.creative.visual_system.id,profile_id:profileId,shape,width:profile.width,height:profile.height,platform_profile:profile.platform_ui_profile||'generic',safeRect:result.ui.safeRect,sampledFrames:result.sampled,eventCount:result.eventCount,violationCount:result.violations.length,violations:result.violations.slice(0,20)});
    }
  }
}finally{
  await browser.close();await new Promise(resolve=>server.close(resolve));
}
const report={schema:'newboo-i20-semantic-profile-audit-v1',tolerancePx:TOL,count:rows.length,totalViolations:rows.reduce((sum,row)=>sum+row.violationCount,0),errors,rows};
await fsp.mkdir(path.dirname(reportPath),{recursive:true});await fsp.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
if(rows.length!==9)throw new Error(`expected 9 semantic matrix rows, got ${rows.length}`);
if(errors.length)throw new Error(`I20 semantic profile audit failed:\n${errors.join('\n')}`);
console.log(JSON.stringify({count:rows.length,totalViolations:report.totalViolations,shapes:[...new Set(rows.map(x=>x.shape))],visualSystems:[...new Set(rows.map(x=>x.visual_system))]},null,2));
