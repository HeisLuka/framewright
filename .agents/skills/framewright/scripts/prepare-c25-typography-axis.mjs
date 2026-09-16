#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const input=path.resolve(process.argv[2]||'examples/book-ad-systems/index-c23.html');
const output=path.resolve(process.argv[3]||'examples/book-ad-systems/index-c25.html');
let html=fs.readFileSync(input,'utf8');
const marker='function roundRect(g,x,y,w,h,r){';
if(!html.includes(marker))throw new Error('C25 typography injection marker missing');

const injection=String.raw`
const TYPOGRAPHY_SYSTEM=String((window.FRAMEWRIGHT_PAYLOAD&&window.FRAMEWRIGHT_PAYLOAD.typography_system)||'baseline').toLowerCase();
const TYPOGRAPHY_SYSTEMS=new Set(['baseline','display-led','editorial','compact-dense']);
const ACTIVE_TYPOGRAPHY_SYSTEM=TYPOGRAPHY_SYSTEMS.has(TYPOGRAPHY_SYSTEM)?TYPOGRAPHY_SYSTEM:'baseline';
const TYPOGRAPHY_POLICY={
  baseline:{displayScale:1,bodyScale:1,labelScale:1,displayWeight:1,bodyWeight:1,labelWeight:1,measure:1,line:0,track:1},
  'display-led':{displayScale:1.34,bodyScale:.86,labelScale:.76,displayWeight:1.16,bodyWeight:.90,labelWeight:1.05,measure:.78,line:-.10,track:.58},
  editorial:{displayScale:.79,bodyScale:1.12,labelScale:1.14,displayWeight:.82,bodyWeight:.94,labelWeight:.86,measure:.86,line:.10,track:1.48},
  'compact-dense':{displayScale:.69,bodyScale:.80,labelScale:.78,displayWeight:1.02,bodyWeight:.88,labelWeight:1.00,measure:1,line:-.08,track:.42}
};
const __c25Policy=TYPOGRAPHY_POLICY[ACTIVE_TYPOGRAPHY_SYSTEM];
function __c25Role(o={}){const s=o.size||0,w=o.weight||700;if(s>=60||w>=800&&s>=38)return'display';if(s<=30)return'label';return'body';}
function __c25Weight(weight,role){const k=role==='display'?__c25Policy.displayWeight:role==='label'?__c25Policy.labelWeight:__c25Policy.bodyWeight;return Math.max(400,Math.min(800,Math.round((weight||700)*k/100)*100));}
function __c25Opts(o={}){
  if(ACTIVE_TYPOGRAPHY_SYSTEM==='baseline')return o;
  const role=__c25Role(o),scale=role==='display'?__c25Policy.displayScale:role==='label'?__c25Policy.labelScale:__c25Policy.bodyScale,n={...o};
  if(o.size)n.size=Math.round(o.size*scale);
  if(o.min)n.min=Math.max(13,Math.round(o.min*Math.min(1,scale)));
  if(o.weight)n.weight=__c25Weight(o.weight,role);
  if(o.maxW&&role!=='label')n.maxW=Math.max(120,Math.round(o.maxW*__c25Policy.measure));
  if(o.lineHeight)n.lineHeight=Math.max(.80,Math.min(1.26,o.lineHeight+__c25Policy.line));
  return n;
}
let __c25Capture=false,__c25Events=[];
function __c25AlignedBox(x,y,w,h,align){let left=x;if(align==='center')left=x-w/2;else if(align==='right')left=x-w;return{x:Math.round(left-8),y:Math.round(y-8),w:Math.round(w+16),h:Math.round(h+16)};}
function __c25Record(e){if(__c25Capture)__c25Events.push(e);}
const __c25TextBlock=textBlock,__c25Label=label,__c25Track=track;
textBlock=function(g,text,o={}){
  const role=__c25Role(o),n=__c25Opts(o),b=__c25TextBlock(g,text,n),lines=b.lines.length,baseY=(n.y||0)-(n.centerBlock?((lines-1)*b.lh)/2:0),boxW=Math.max(1,n.maxW||Math.max(1,...b.lines.map(line=>g.measureText(line).width))),boxH=Math.max(b.size,b.height+b.size*.25),box=__c25AlignedBox(n.x||0,baseY-b.size,boxW,boxH,n.align||'left');
  __c25Record({kind:'textBlock',role,sourceSize:o.size||null,requestedSize:n.size||null,finalSize:b.size,weight:n.weight||700,lines,maxW:n.maxW||null,lineHeight:n.lineHeight||null,box});
  return b;
};
label=function(g,text,x,y,o={}){
  const role=__c25Role(o),n=__c25Opts(o),size=__c25Label(g,text,x,y,n),measured=Math.max(1,g.measureText(String(text)).width),box=__c25AlignedBox(x,y-size,measured,size*1.3,n.align||'left');
  __c25Record({kind:'label',role,sourceSize:o.size||null,requestedSize:n.size||null,finalSize:size,weight:n.weight||700,lines:1,maxW:n.maxW||null,lineHeight:null,box});
  return size;
};
track=function(g,text,x,y,spacing,o={}){
  const role=__c25Role(o),n=__c25Opts(o),sp=spacing*__c25Policy.track,width=__c25Track(g,text,x,y,sp,n),size=n.size||24,box=__c25AlignedBox(x,y-size,width,size*1.3,'left');
  __c25Record({kind:'track',role,sourceSize:o.size||null,requestedSize:n.size||null,finalSize:size,weight:n.weight||700,lines:1,maxW:null,lineHeight:null,tracking:+sp.toFixed(3),box});
  return width;
};
window.__C25_BEGIN_CAPTURE=()=>{__c25Events=[];__c25Capture=true;};
window.__C25_END_CAPTURE=()=>{__c25Capture=false;return __c25Events.map(e=>({...e,box:{...e.box}}));};
window.__C25_TYPOGRAPHY=()=>({system:ACTIVE_TYPOGRAPHY_SYSTEM,policy:{...__c25Policy}});
`;
html=html.replace(marker,injection+'\n'+marker);
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,html);
console.log(`prepared C25 typography-axis template: ${output}`);
