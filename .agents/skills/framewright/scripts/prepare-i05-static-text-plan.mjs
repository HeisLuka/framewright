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
// Placement, color, alpha and motion remain frame-time concerns; line breaking,
// fitted font size and tracked glyph advances become immutable job-local plans.
const I05_STATIC_TEXT_PLAN_VERSION='i05-static-text-plan-v1';
const __i05TextBlock=textBlock,__i05Label=label,__i05Track=track;
const __i05BlockPlans=new Map(),__i05LabelPlans=new Map(),__i05TrackPlans=new Map();
const __i05Stats={blockHits:0,blockMisses:0,labelHits:0,labelMisses:0,trackHits:0,trackMisses:0};

function __i05Clone(v){return JSON.parse(JSON.stringify(v));}
function __i05Key(parts){return JSON.stringify(parts);}
function __i05CaptureActive(){return typeof __c25Capture!=='undefined'&&__c25Capture===true;}
function __i05AfterC25(o={}){return typeof __c25Opts==='function'?__c25Opts(o):{...o};}
function __i05BlockOpts(o={}){
  const safe=typeof __c26SafeTextOptions==='function'?__c26SafeTextOptions({...o}):{...o};
  return __i05AfterC25(safe);
}
function __i05LabelOpts(x,o={}){
  const safe=typeof __c26SafeTextOptions==='function'?__c26SafeTextOptions({...o,x}):{...o,x};
  delete safe.x;
  return __i05AfterC25(safe);
}
function __i05TrackOpts(o={}){return __i05AfterC25({...o});}
function __i05TrackSpacing(spacing){
  const k=typeof __c25Policy!=='undefined'&&Number.isFinite(__c25Policy.track)?__c25Policy.track:1;
  return spacing*k;
}
function __i05FreezePlan(plan){
  if(Array.isArray(plan.lines))Object.freeze(plan.lines);
  if(Array.isArray(plan.steps))Object.freeze(plan.steps);
  return Object.freeze(plan);
}
function __i05BlockKey(text,n){return __i05Key(['block',String(text),n.maxW??900,Number.isFinite(n.maxH)?n.maxH:'inf',n.maxLines??99,n.size??88,n.min??24,n.weight??700,n.lineHeight??1.02]);}
function __i05LabelKey(text,n){return __i05Key(['label',String(text),n.maxW??null,n.size??28,n.min??16,n.weight??700]);}
function __i05TrackKey(text,spacing,n){return __i05Key(['track',String(text),n.size??24,n.weight??700,spacing]);}

textBlock=function(g,text,o={}){
  // QA capture must keep traversing the inherited C25/C26 instrumentation exactly.
  if(__i05CaptureActive())return __i05TextBlock(g,text,o);
  const n=__i05BlockOpts(o),key=__i05BlockKey(text,n),cached=__i05BlockPlans.get(key);
  if(cached){
    __i05Stats.blockHits++;
    // Do not round-trip Canvas font state through g.font. Re-enter through the
    // same canonical setter as the baseline; native canvas font getters are not
    // a portable serialization format for raster-equivalent replay.
    font(g,cached.size,n.weight||700);
    g.fillStyle=n.color||P.ink;g.textAlign=n.align||'left';
    let y=n.y||0,x=n.x||0;if(n.centerBlock)y-=((cached.lines.length-1)*cached.lh)/2;
    for(const line of cached.lines){g.fillText(line,x,y);y+=cached.lh;}
    return{size:cached.size,lines:[...cached.lines],lh:cached.lh,height:cached.height,overflow:cached.overflow};
  }
  __i05Stats.blockMisses++;
  const b=__i05TextBlock(g,text,o);
  __i05BlockPlans.set(key,__i05FreezePlan({kind:'block',key,text:String(text),request:{maxW:n.maxW??900,maxH:Number.isFinite(n.maxH)?n.maxH:null,maxLines:n.maxLines??99,size:n.size??88,min:n.min??24,weight:n.weight??700,lineHeight:n.lineHeight??1.02},size:b.size,lines:[...b.lines],lh:b.lh,height:b.height,overflow:!!b.overflow}));
  return b;
};

label=function(g,text,x,y,o={}){
  if(__i05CaptureActive())return __i05Label(g,text,x,y,o);
  const n=__i05LabelOpts(x,o),key=__i05LabelKey(text,n),cached=__i05LabelPlans.get(key);
  if(cached){
    __i05Stats.labelHits++;
    font(g,cached.size,n.weight||700);
    g.fillStyle=n.color||P.ink;g.textAlign=n.align||'left';g.fillText(String(text),x,y);return cached.size;
  }
  __i05Stats.labelMisses++;
  const size=__i05Label(g,text,x,y,o);
  __i05LabelPlans.set(key,__i05FreezePlan({kind:'label',key,text:String(text),request:{maxW:n.maxW??null,size:n.size??28,min:n.min??16,weight:n.weight??700},size}));
  return size;
};

track=function(g,text,x,y,spacing,o={}){
  if(__i05CaptureActive())return __i05Track(g,text,x,y,spacing,o);
  const n=__i05TrackOpts(o),sp=__i05TrackSpacing(spacing),key=__i05TrackKey(text,sp,n),cached=__i05TrackPlans.get(key);
  if(cached){
    __i05Stats.trackHits++;
    font(g,n.size||24,n.weight||700);
    g.fillStyle=n.color||P.ink;g.textAlign='left';let px=x,i=0;
    for(const ch of String(text)){g.fillText(ch,px,y);px+=cached.steps[i++];}
    return cached.width;
  }
  __i05Stats.trackMisses++;
  const width=__i05Track(g,text,x,y,spacing,o),steps=[];
  // One-time advance capture. Subsequent frames replay exact measured advances
  // while still entering font state through the baseline font() helper.
  for(const ch of String(text))steps.push(g.measureText(ch).width+sp);
  __i05TrackPlans.set(key,__i05FreezePlan({kind:'track',key,text:String(text),request:{size:n.size??24,weight:n.weight??700,spacing:sp},steps,width}));
  return width;
};

function __i05PlanRows(){return[...__i05BlockPlans.values(),...__i05LabelPlans.values(),...__i05TrackPlans.values()].sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0).map(__i05Clone);}
window.__I05_STATIC_TEXT_PLAN=()=>({
  schema:'framewright-i05-static-text-plan-bundle-v1',
  version:I05_STATIC_TEXT_PLAN_VERSION,
  environment:{width:LW,height:LH,fps:FPS,fontFamily:'DejaVu Sans',typographySystem:typeof ACTIVE_TYPOGRAPHY_SYSTEM!=='undefined'?ACTIVE_TYPOGRAPHY_SYSTEM:'baseline',platformProfile:typeof C26_PLATFORM_PROFILE!=='undefined'?C26_PLATFORM_PROFILE:'generic'},
  plans:__i05PlanRows(),
  stats:{...__i05Stats,entries:__i05BlockPlans.size+__i05LabelPlans.size+__i05TrackPlans.size,blockEntries:__i05BlockPlans.size,labelEntries:__i05LabelPlans.size,trackEntries:__i05TrackPlans.size}
});
`;

html=html.replace(marker,injection+'\n'+marker);
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,html);
console.log(`prepared I05 static text plan template: ${output}`);
