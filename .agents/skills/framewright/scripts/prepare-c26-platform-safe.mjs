#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const input=path.resolve(process.argv[2]||'examples/book-ad-systems/index-c25.html');
const output=path.resolve(process.argv[3]||'examples/book-ad-systems/index-c26.html');
const policyPath=path.resolve(process.argv[4]||'examples/book-ad-systems/platform-ui-profiles.v1.json');
let html=fs.readFileSync(input,'utf8');
const policy=JSON.parse(fs.readFileSync(policyPath,'utf8'));
if(!policy?.profiles?.generic)throw new Error('C26 platform policy missing generic profile');

const safeMarker="const SAFE=PROFILE==='vertical'?{x:76,y:288,w:928,h:1248}:PROFILE==='square'?{x:64,y:62,w:952,h:956}:{x:110,y:70,w:1700,h:940};";
if(!html.includes(safeMarker))throw new Error('C26 responsive SAFE marker missing');
const profilesJson=JSON.stringify(policy.profiles);
const safeReplacement=`const C26_PLATFORM_UI_VERSION=${JSON.stringify(policy.version)};\nconst C26_PLATFORM_UI_PROFILES=${profilesJson};\nconst __c26Requested=String((window.FRAMEWRIGHT_PAYLOAD&&window.FRAMEWRIGHT_PAYLOAD.platform_profile)||'generic').toLowerCase();\nconst C26_PLATFORM_PROFILE=Object.prototype.hasOwnProperty.call(C26_PLATFORM_UI_PROFILES,__c26Requested)?__c26Requested:'generic';\nconst C26_PLATFORM_UI=C26_PLATFORM_UI_PROFILES[C26_PLATFORM_PROFILE];\nconst SAFE=PROFILE==='vertical'?{...C26_PLATFORM_UI.safeRect}:PROFILE==='square'?{x:64,y:62,w:952,h:956}:{x:110,y:70,w:1700,h:940};`;
html=html.replace(safeMarker,safeReplacement);

const payloadMarker="const P=normalizePayload(window.FRAMEWRIGHT_PAYLOAD||DEFAULT_PAYLOAD);";
if(!html.includes(payloadMarker))throw new Error('C26 payload marker missing');
html=html.replace(payloadMarker,payloadMarker+"\nP.platform_profile=C26_PLATFORM_PROFILE;P.platform_ui={version:C26_PLATFORM_UI_VERSION,safeRect:{...SAFE},occlusionZones:(C26_PLATFORM_UI.occlusionZones||[]).map(z=>({...z}))};");

const debugMarker='function safeDebug(g){';
if(!html.includes(debugMarker))throw new Error('C26 safeDebug marker missing');
const instrumentation=String.raw`
const __c26DrawCover=drawCover;
let __c26Capture=false,__c26CoverEvents=[];
function __c26RotatedCoverBox(x,y,w,h,r=0){
  const c=Math.abs(Math.cos(r)),s=Math.abs(Math.sin(r)),bw=w*c+h*s,bh=w*s+h*c;
  return{x:Math.round(x+(w-bw)/2),y:Math.round(y+(h-bh)/2),w:Math.round(bw),h:Math.round(bh)};
}
drawCover=function(g,x,y,w,h,o={}){
  if(__c26Capture)__c26CoverEvents.push({kind:'cover',role:'cover',box:__c26RotatedCoverBox(x,y,w,h,o.r||0)});
  return __c26DrawCover(g,x,y,w,h,o);
};
window.__C26_BEGIN_CAPTURE=()=>{__c26CoverEvents=[];__c26Capture=true;if(window.__C25_BEGIN_CAPTURE)window.__C25_BEGIN_CAPTURE();};
window.__C26_END_CAPTURE=()=>{
  __c26Capture=false;
  const text=window.__C25_END_CAPTURE?window.__C25_END_CAPTURE():[];
  return{version:C26_PLATFORM_UI_VERSION,profile:C26_PLATFORM_PROFILE,safeRect:{...SAFE},occlusionZones:(C26_PLATFORM_UI.occlusionZones||[]).map(z=>({...z})),events:[...text,...__c26CoverEvents.map(e=>({...e,box:{...e.box}}))]};
};
window.__C26_PLATFORM_UI=()=>({version:C26_PLATFORM_UI_VERSION,profile:C26_PLATFORM_PROFILE,safeRect:{...SAFE},occlusionZones:(C26_PLATFORM_UI.occlusionZones||[]).map(z=>({...z}))});
function __c26SafeDebug(g){
  if(!Q.has('platformsafe'))return;
  g.save();
  for(const z of C26_PLATFORM_UI.occlusionZones||[]){g.fillStyle='rgba(255,45,45,.14)';g.fillRect(z.x,z.y,z.w,z.h);g.strokeStyle='rgba(255,45,45,.72)';g.lineWidth=3;g.strokeRect(z.x,z.y,z.w,z.h);}
  g.strokeStyle='rgba(44,220,92,.95)';g.lineWidth=5;g.setLineDash([20,12]);g.strokeRect(SAFE.x,SAFE.y,SAFE.w,SAFE.h);g.setLineDash([]);
  g.restore();
}
`;
html=html.replace(debugMarker,instrumentation+'\n'+debugMarker);
const renderMarker='safeDebug(g);g.setTransform(1,0,0,1,0,0);post(cv,target);return S;';
if(!html.includes(renderMarker))throw new Error('C26 render debug marker missing');
html=html.replace(renderMarker,'safeDebug(g);__c26SafeDebug(g);g.setTransform(1,0,0,1,0,0);post(cv,target);return S;');

fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,html);
console.log(`prepared C26 platform-safe semantic template: ${output} (${policy.version})`);
