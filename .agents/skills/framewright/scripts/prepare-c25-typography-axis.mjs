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
const __c25TextBlock=textBlock,__c25Label=label,__c25Track=track;
textBlock=function(g,text,o={}){return __c25TextBlock(g,text,__c25Opts(o));};
label=function(g,text,x,y,o={}){return __c25Label(g,text,x,y,__c25Opts(o));};
track=function(g,text,x,y,spacing,o={}){const n=__c25Opts(o);return __c25Track(g,text,x,y,spacing*__c25Policy.track,n);};
window.__C25_TYPOGRAPHY=()=>({system:ACTIVE_TYPOGRAPHY_SYSTEM,policy:{...__c25Policy}});
`;
html=html.replace(marker,injection+'\n'+marker);
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,html);
console.log(`prepared C25 typography-axis template: ${output}`);
