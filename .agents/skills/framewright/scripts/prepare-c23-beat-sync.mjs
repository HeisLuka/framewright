#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const input=path.resolve(process.argv[2]||'examples/book-ad-systems/index-c22.html');
const output=path.resolve(process.argv[3]||'examples/book-ad-systems/index-c23.html');
let html=fs.readFileSync(input,'utf8');
const marker="function __c22Focus(plate){return plate==='hook'?.52:plate==='book'?.58:.40;}";
if(!html.includes(marker))throw new Error('C23 requires canonical C22 focus helper');
const replacement=String.raw`const MOTION_TIMING_PROFILE=String((window.FRAMEWRIGHT_PAYLOAD&&window.FRAMEWRIGHT_PAYLOAD.motion_timing_profile)||'free-v2').toLowerCase();
const MOTION_ONSETS=Array.isArray(window.FRAMEWRIGHT_PAYLOAD&&window.FRAMEWRIGHT_PAYLOAD.motion_onsets)?window.FRAMEWRIGHT_PAYLOAD.motion_onsets.map(Number).filter(Number.isFinite):[];
function __c23PlateTiming(plate){return plate==='hook'?[0,3]:plate==='book'?[3,5]:[8,4];}
function __c23NearestOnset(target,start,end,maxShift=.32){let best=target,d=Infinity;for(const t of MOTION_ONSETS){if(t<start||t>end)continue;const x=Math.abs(t-target);if(x<d){d=x;best=t;}}return d<=maxShift?best:target;}
function __c22Focus(plate){
  const base=plate==='hook'?.52:plate==='book'?.58:.40;
  if(MOTION_TIMING_PROFILE!=='beat-aligned-v1'||!MOTION_ONSETS.length)return base;
  const [start,dur]=__c23PlateTiming(plate),target=start+base*dur;
  const aligned=__c23NearestOnset(target,start+.25,start+dur-.25,.32);
  return clamp((aligned-start)/dur);
}`;
html=html.replace(marker,replacement);
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,html);
console.log(`prepared C23 beat-aligned timing template: ${output}`);
