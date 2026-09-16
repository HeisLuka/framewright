#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const input=path.resolve(process.argv[2]||'examples/book-ad-systems/index-c27-i05.html');
const output=path.resolve(process.argv[3]||'examples/book-ad-systems/index-i05-static-text.html');
let html=fs.readFileSync(input,'utf8');
const marker='function post(src,dst){';
if(!html.includes(marker))throw new Error('I05 static-text insertion marker missing');

const injection=String.raw`
// I05 StaticTextPlanBundle v1: a target-bound lowering of text measurement/search.
// It is intentionally generic: no Swiss/Newspaper/Paper node list lives here.
// The bundle externalizes block/label/track resolution, but consumption is legal only
// where exact raster parity has been demonstrated. Blocks stay on the proven C25
// fitBlock cache, labels consume a resolved fitSingleSize plan, and tracked glyphs stay
// on the baseline dynamic-advance path until a future glyph-run lowering proves parity.
const I05_STATIC_TEXT_PLAN_VERSION='i05-static-text-plan-v1';
const __i05TextBlock=textBlock,__i05Label=label,__i05Track=track,__i05FitSingleSize=fitSingleSize;
const __i05BlockPlans=new Map(),__i05LabelPlans=new Map(),__i05TrackPlans=new Map(),__i05FitSinglePlans=new Map();
const __i05Stats={blockHits:0,blockMisses:0,labelHits:0,labelMisses:0,trackHits:0,trackMisses:0,fitSingleHits:0,fitSingleMisses:0};

function __i05Clone(v){return JSON.parse(JSON.stringify(v));}
function __i05Key(parts){return JSON.stringify(parts);}
function __i05CaptureActive(){return typeof __c25Capture!=='undefined'&&__c25Capture===true;}
function __i05AfterC25(o={}){return typeof __c25Opts==='function'?__c25Opts(o):{...o};}
function __i05BlockOpts(o={}){const safe=typeof __c26SafeTextOptions==='function'?__c26SafeTextOptions({...o}):{...o};return __i05AfterC25(safe);}
function __i05LabelOpts(x,o={}){const safe=typeof __c26SafeTextOptions==='function'?__c26SafeTextOptions({...o,x}):{...o,x};delete safe.x;return __i05AfterC25(safe);}
function __i05TrackOpts(o={}){return __i05AfterC25({...o});}
function __i05TrackSpacing(spacing){const k=typeof __c25Policy!=='undefined'&&Number.isFinite(__c25Policy.track)?__c25Policy.track:1;return spacing*k;}
function __i05FreezePlan(plan){if(Array.isArray(plan.lines))Object.freeze(plan.lines);if(Array.isArray(plan.steps))Object.freeze(plan.steps);return Object.freeze(plan);}
function __i05BlockKey(text,n){return __i05Key(['block',String(text),n.maxW??900,Number.isFinite(n.maxH)?n.maxH:'inf',n.maxLines??99,n.size??88,n.min??24,n.weight??700,n.lineHeight??1.02]);}
function __i05LabelKey(text,n){return __i05Key(['label',String(text),n.maxW??null,n.size??28,n.min??16,n.weight??700]);}
function __i05TrackKey(text,spacing,n){return __i05Key(['track',String(text),n.size??24,n.weight??700,spacing]);}
function __i05FitSingleKey(text,maxW,start,min,weight){return __i05Key(['fitSingle',String(text),maxW,start,min,weight]);}

fitSingleSize=function(g,text,maxW,start=92,min=18,weight=700){const key=__i05FitSingleKey(text,maxW,start,min,weight),cached=__i05FitSinglePlans.get(key);if(cached){__i05Stats.fitSingleHits++;font(g,cached.size,weight);return cached.size;}__i05Stats.fitSingleMisses++;const size=__i05FitSingleSize(g,text,maxW,start,min,weight);__i05FitSinglePlans.set(key,Object.freeze({key,text:String(text),maxW,start,min,weight,size}));return size;};
textBlock=function(g,text,o={}){if(__i05CaptureActive())return __i05TextBlock(g,text,o);const n=__i05BlockOpts(o),key=__i05BlockKey(text,n),cached=__i05BlockPlans.get(key);if(cached)__i05Stats.blockHits++;else __i05Stats.blockMisses++;const b=__i05TextBlock(g,text,o);if(!cached)__i05BlockPlans.set(key,__i05FreezePlan({kind:'block',key,text:String(text),request:{maxW:n.maxW??900,maxH:Number.isFinite(n.maxH)?n.maxH:null,maxLines:n.maxLines??99,size:n.size??88,min:n.min??24,weight:n.weight??700,lineHeight:n.lineHeight??1.02},size:b.size,lines:[...b.lines],lh:b.lh,height:b.height,overflow:!!b.overflow,consumedBy:'c25-fit-cache'}));return b;};
label=function(g,text,x,y,o={}){if(__i05CaptureActive())return __i05Label(g,text,x,y,o);const n=__i05LabelOpts(x,o),key=__i05LabelKey(text,n),cached=__i05LabelPlans.get(key);if(cached)__i05Stats.labelHits++;else __i05Stats.labelMisses++;const size=__i05Label(g,text,x,y,o);if(!cached)__i05LabelPlans.set(key,__i05FreezePlan({kind:'label',key,text:String(text),request:{maxW:n.maxW??null,size:n.size??28,min:n.min??16,weight:n.weight??700},size,consumedBy:n.maxW?'i05-fitSingleSize-plan':'none-fixed-size'}));return size;};
track=function(g,text,x,y,spacing,o={}){if(__i05CaptureActive())return __i05Track(g,text,x,y,spacing,o);const n=__i05TrackOpts(o),sp=__i05TrackSpacing(spacing),key=__i05TrackKey(text,sp,n),cached=__i05TrackPlans.get(key);if(cached)__i05Stats.trackHits++;else __i05Stats.trackMisses++;const width=__i05Track(g,text,x,y,spacing,o);if(!cached){const steps=[];for(const ch of String(text))steps.push(g.measureText(ch).width+sp);__i05TrackPlans.set(key,__i05FreezePlan({kind:'track',key,text:String(text),request:{size:n.size??24,weight:n.weight??700,spacing:sp},steps,width,consumedBy:'baseline-dynamic-advance'}));}return width;};
function __i05PlanRows(){return[...__i05BlockPlans.values(),...__i05LabelPlans.values(),...__i05TrackPlans.values()].sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0).map(__i05Clone);}
window.__I05_STATIC_TEXT_PLAN=()=>({schema:'framewright-i05-static-text-plan-bundle-v1',version:I05_STATIC_TEXT_PLAN_VERSION,environment:{width:LW,height:LH,fps:FPS,fontFamily:'DejaVu Sans',typographySystem:typeof ACTIVE_TYPOGRAPHY_SYSTEM!=='undefined'?ACTIVE_TYPOGRAPHY_SYSTEM:'baseline',platformProfile:typeof C26_PLATFORM_PROFILE!=='undefined'?C26_PLATFORM_PROFILE:'generic'},consumption:{block:'c25-fit-cache',label:'i05-fitSingleSize-plan',track:'baseline-dynamic-advance'},plans:__i05PlanRows(),fitSinglePlans:[...__i05FitSinglePlans.values()].sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0).map(__i05Clone),stats:{...__i05Stats,entries:__i05BlockPlans.size+__i05LabelPlans.size+__i05TrackPlans.size,blockEntries:__i05BlockPlans.size,labelEntries:__i05LabelPlans.size,trackEntries:__i05TrackPlans.size,fitSingleEntries:__i05FitSinglePlans.size}});
`;

html=html.replace(marker,injection+'\n'+marker);
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,html);
console.log(`prepared I05 static text plan template: ${output}`);
