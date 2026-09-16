#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const input=path.resolve(process.argv[2]||'examples/book-ad-systems/index-e18.html');
const output=path.resolve(process.argv[3]||'examples/book-ad-systems/index-c20.html');
let html=fs.readFileSync(input,'utf8');

const coverMarker='let COVER=null;';
if(!html.includes(coverMarker))throw new Error('C20 cover marker not found');
const artHelpers=String.raw`
const ART_DIRECTION_MODE=String((window.FRAMEWRIGHT_PAYLOAD&&window.FRAMEWRIGHT_PAYLOAD.art_direction_mode)||Q.get('art')||'generic').toLowerCase();
function __hexRgb(h){h=String(h||'#000000').replace('#','');return[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)||0);}
function __rgbHex(rgb){return'#'+rgb.map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');}
function __mixRgb(a,b,t){return a.map((v,i)=>lerp(v,b[i],t));}
function __srgb(v){v/=255;return v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4);}
function __luma(rgb){return .2126*__srgb(rgb[0])+.7152*__srgb(rgb[1])+.0722*__srgb(rgb[2]);}
function __contrast(a,b){const A=__luma(a),B=__luma(b),hi=Math.max(A,B),lo=Math.min(A,B);return(hi+.05)/(lo+.05);}
function __sat(rgb){const [r,g,b]=rgb.map(v=>v/255),mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn,l=(mx+mn)/2;return d===0?0:d/(1-Math.abs(2*l-1));}
function __dist(a,b){return Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2])/441.673;}
function __sampleCover(){
  if(!COVER)return{ok:false,reason:'cover-unavailable'};
  try{
    const w=48,h=72,cv=cvs('c20-palette',w,h),g=cv.getContext('2d');g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,w,h);g.drawImage(COVER,0,0,w,h);
    const d=g.getImageData(0,0,w,h).data,bins=new Map(),lum=new Float32Array(w*h);let n=0,mean=0,edges=0,edgeTests=0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=(y*w+x)*4;if(d[i+3]<192)continue;const r=d[i],gg=d[i+1],b=d[i+2],key=((r>>5)<<6)|((gg>>5)<<3)|(b>>5);let q=bins.get(key);if(!q){q={n:0,r:0,g:0,b:0};bins.set(key,q);}q.n++;q.r+=r;q.g+=gg;q.b+=b;n++;const L=__luma([r,gg,b]);lum[y*w+x]=L;mean+=L;
    }
    if(n<64||bins.size<1)return{ok:false,reason:'insufficient-cover-pixels'};mean/=n;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x,L=lum[i];if(x+1<w){edgeTests++;if(Math.abs(L-lum[i+1])>.12)edges++;}if(y+1<h){edgeTests++;if(Math.abs(L-lum[i+w])>.12)edges++;}}
    const colors=[...bins.values()].map(q=>({count:q.n,rgb:[q.r/q.n,q.g/q.n,q.b/q.n]})).sort((a,b)=>b.count-a.count);
    const entropyRaw=colors.reduce((s,c)=>{const p=c.count/n;return s-p*Math.log2(p);},0),entropy=colors.length>1?entropyRaw/Math.log2(colors.length):0;
    return{ok:true,colors,n,entropy:clamp(entropy),edgeDensity:edgeTests?edges/edgeTests:0,meanLuma:mean};
  }catch(e){return{ok:false,reason:'cover-sampling-error:'+String(e&&e.message||e)};}
}
function __pickArtDirection(sample){
  const top=sample.colors.slice(0,Math.min(24,sample.colors.length)),dominant=top[0].rgb;
  let secondary=top[1]?.rgb||dominant,secScore=-1;
  for(const c of top.slice(1)){const frequency=c.count/sample.n;if(frequency<.008)continue;const score=__dist(c.rgb,dominant)*(.7+Math.min(.3,frequency*3));if(score>secScore){secScore=score;secondary=c.rgb;}}
  let ink=[17,17,17],darkScore=Infinity;for(const c of top){const L=__luma(c.rgb);if(L<darkScore){darkScore=L;ink=c.rgb;}}
  let accent=secondary,accentScore=-1;for(const c of top){const frequency=c.count/sample.n,s=__sat(c.rgb),distance=__dist(c.rgb,dominant);const score=s*.62+distance*.28+Math.min(.1,frequency*.8);if(score>accentScore){accentScore=score;accent=c.rgb;}}
  let bg=__mixRgb(__mixRgb(dominant,secondary,.18),[255,255,255],.84);
  for(let i=0;i<8&&(__luma(bg)<.70||__contrast(ink,bg)<7);i++)bg=__mixRgb(bg,[255,255,255],.12);
  for(let i=0;i<8&&__contrast(ink,bg)<7;i++)ink=__mixRgb(ink,[0,0,0],.18);
  let safeAccent=accent;for(let i=0;i<12&&(__contrast(safeAccent,bg)<3||__contrast(safeAccent,[255,255,255])<4.5);i++)safeAccent=__mixRgb(safeAccent,[0,0,0],.09);
  if(__contrast(safeAccent,bg)<3||__contrast(safeAccent,[255,255,255])<4.5)safeAccent=__mixRgb(ink,accent,.36);
  const background=__rgbHex(bg),inkHex=__rgbHex(ink),accentHex=__rgbHex(safeAccent),secondaryHex=__rgbHex(secondary),dominantHex=__rgbHex(dominant),surface=__rgbHex(__mixRgb(secondary,bg,.82));
  const warnings=[];if(__sat(accent)<.12)warnings.push('low-chroma-cover');if(sample.colors.length<4)warnings.push('degenerate-palette');if(sample.meanLuma<.10)warnings.push('very-dark-cover');if(sample.meanLuma>.90)warnings.push('very-light-cover');
  const geometry=sample.entropy<.42?'bold':sample.edgeDensity>.22?'structured':'quiet';
  return{mode:'cover-adaptive-v1',source:'cover',dominant:dominantHex,secondary:secondaryHex,accent:accentHex,background,ink:inkHex,surface,geometry,warnings,metrics:{entropy:+sample.entropy.toFixed(4),edgeDensity:+sample.edgeDensity.toFixed(4),meanLuma:+sample.meanLuma.toFixed(4),paletteBins:sample.colors.length,inkBackgroundContrast:+__contrast(ink,bg).toFixed(3),accentBackgroundContrast:+__contrast(safeAccent,bg).toFixed(3),whiteAccentContrast:+__contrast(safeAccent,[255,255,255]).toFixed(3)}};
}
function applyCoverArtDirection(){
  if(ART_DIRECTION_MODE!=='cover'&&ART_DIRECTION_MODE!=='adaptive'&&ART_DIRECTION_MODE!=='cover-adaptive'){
    P.art_direction={mode:'generic-v1',source:'payload',accent:P.accent,background:P.background,ink:P.ink};return;
  }
  const sample=__sampleCover();if(!sample.ok){P.art_direction={mode:'cover-adaptive-v1',source:'fallback',failureReason:sample.reason,accent:P.accent,background:P.background,ink:P.ink};return;}
  const ad=__pickArtDirection(sample);P.accent=ad.accent;P.background=ad.background;P.ink=ad.ink;P.art_direction=ad;
}
function __artMotif(g,style,seed,plate){
  const ad=P.art_direction;if(!ad||ad.source!=='cover')return;const R=rng(hash(seed,plate,'c20-art',style,ad.geometry));g.save();
  if(style==='swiss'){
    g.globalAlpha=ad.geometry==='bold'?.105:ad.geometry==='structured'?.075:.05;g.fillStyle=ad.surface;const side=ad.metrics.meanLuma<.45?0:LW*.78;g.fillRect(side,0,LW*.22,LH);g.strokeStyle=P.accent;g.lineWidth=4;g.beginPath();g.moveTo(SAFE.x,SAFE.y-34);g.lineTo(SAFE.x+SAFE.w*(.35+.35*R()),SAFE.y-34);g.stroke();
  }else if(style==='newspaper'){
    g.globalAlpha=ad.geometry==='bold'?.11:.065;g.fillStyle=ad.surface;g.fillRect(0,LH*.76,LW,LH*.24);g.fillStyle=P.accent;g.fillRect(0,0,ad.geometry==='quiet'?10:18,LH);
  }else{
    g.globalAlpha=ad.geometry==='bold'?.11:.07;for(let i=0;i<(ad.geometry==='quiet'?2:4);i++){const w=130+R()*260,h=70+R()*190,x=R()*(LW-w),y=R()*(LH-h);g.fillStyle=i%2?ad.surface:P.accent;g.fillRect(x,y,w,h);}
  }
  g.restore();
}
`;
html=html.replace(coverMarker,artHelpers+'\n'+coverMarker);

const pageMarker='function pageNum(g,n,align=\'left\')';
if(!html.includes(pageMarker))throw new Error('C20 page marker not found');
const bgWrappers=String.raw`
const __c20SwissBg=swissBg,__c20NewspaperBg=newspaperBg,__c20PaperBg=paperBg;
swissBg=function(g,seed,plate){__c20SwissBg(g,seed,plate);__artMotif(g,'swiss',seed,plate);};
newspaperBg=function(g,seed,plate){__c20NewspaperBg(g,seed,plate);__artMotif(g,'newspaper',seed,plate);};
paperBg=function(g,seed,plate){__c20PaperBg(g,seed,plate);__artMotif(g,'paper',seed,plate);};
`;
html=html.replace(pageMarker,bgWrappers+'\n'+pageMarker);

const bootMarker='async function boot(){COVER=await loadCover(P.cover_url);';
if(!html.includes(bootMarker))throw new Error('C20 boot marker not found');
html=html.replace(bootMarker,'async function boot(){COVER=await loadCover(P.cover_url);applyCoverArtDirection();');

fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,html);
console.log(`prepared C20 cover-adaptive template: ${output}`);
