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
  baseline:{displayScale:1,bodyScale:1,labelScale:1,displayWeight:1,bodyWeight:1,labelWeight:1,measure:1,line:.0},
  'display-led':{displayScale:1.10,bodyScale:.94,labelScale:.90,displayWeight:1.10,bodyWeight:1,labelWeight:1.05,measure:.91,line:-.055},
  editorial:{displayScale:.96,bodyScale:1.03,labelScale:1.06,displayWeight:.92,bodyWeight:.94,labelWeight:.92,measure:.96,line:.055},
  'compact-dense':{displayScale:.90,bodyScale:.91,labelScale:.92,displayWeight:1.03,bodyWeight:.92,labelWeight:1,measure:1,line:-.02}
};
const __c25Policy=TYPOGRAPHY_POLICY[ACTIVE_TYPOGRAPHY_SYSTEM];
function __c25Role(o={}){const s=o.size||0,w=o.weight||700;if(s>=60||w>=800&&s>=38)return'display';if(s<=30)return'label';return'body';}
function __c25Weight(weight,role){const k=role==='display'?__c25Policy.displayWeight:role==='label'?__c25Policy.labelWeight:__c25Policy.bodyWeight;return Math.max(400,Math.min(800,Math.round((weight||700)*k/100)*100));}
function __c25Opts(o={}){
  if(ACTIVE_TYPOGRAPHY_SYSTEM==='baseline')return o;
  const role=__c25Role(o),scale=role==='display'?__c25Policy.displayScale:role==='label'?__c25Policy.labelScale:__c25Policy.bodyScale,n={...o};
  if(o.size)n.size=Math.round(o.size*scale);if(o.min)n.min=Math.max(14,Math.round(o.min*Math.min(1,scale)));
  if(o.weight)n.weight=__c25Weight(o.weight,role);
  if(o.maxW&&role!=='label')n.maxW=Math.max(120,Math.round(o.maxW*__c25Policy.measure));
  if(o.lineHeight)n.lineHeight=Math.max(.84,Math.min(1.22,o.lineHeight+__c25Policy.line));
  return n;
}
const __c25TextBlock=textBlock,__c25Label=label,__c25Track=track;
textBlock=function(g,text,o={}){return __c25TextBlock(g,text,__c25Opts(o));};
label=function(g,text,x,y,o={}){return __c25Label(g,text,x,y,__c25Opts(o));};
track=function(g,text,x,y,spacing,o={}){const n=__c25Opts(o),sp=ACTIVE_TYPOGRAPHY_SYSTEM==='editorial'?spacing*1.25:ACTIVE_TYPOGRAPHY_SYSTEM==='compact-dense'?spacing*.72:spacing;return __c25Track(g,text,x,y,sp,n);};
window.__C25_TYPOGRAPHY=()=>({system:ACTIVE_TYPOGRAPHY_SYSTEM,policy:{...__c25Policy}});
`;
html=html.replace(marker,injection+'\n'+marker);
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,html);
console.log(`prepared C25 typography-axis template: ${output}`);
