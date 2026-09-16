#!/usr/bin/env node
// Generate E07 style-class fixtures from the canonical Book Ad v0 template.
// The underlying scene/layout stays identical; only deterministic post styling changes.
import fs from 'node:fs';
import path from 'node:path';

const [,, outArg='.lab-e07-styles'] = process.argv;
const source = path.resolve(process.env.HTML || 'examples/book-ad-v0/index.html');
const outDir = path.resolve(outArg);
if (!fs.existsSync(source)) throw new Error(`missing source template: ${source}`);
fs.rmSync(outDir,{recursive:true,force:true}); fs.mkdirSync(outDir,{recursive:true});
const base = fs.readFileSync(source,'utf8');
const marker = "const MAIN=document.getElementById('c');";
const readyMarker = "  window.__ready=true;\n}\nboot()";
if (!base.includes(marker) || !base.includes(readyMarker)) throw new Error('book-ad template markers changed');

const hook = style => `
// --- E07 generated style hook: ${style} ---
const FW_STYLE=${JSON.stringify(style)};
const FW_STYLE_CACHE={};
function fwHash3(a,b,c){let h=2166136261>>>0;for(const s0 of [a,b,c]){const s=String(s0)+'|';for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}}h^=h>>>13;h=Math.imul(h,0x5bd1e995);h^=h>>>15;return h>>>0;}
function fwRng(seed){let x=seed>>>0;return()=>{x=(Math.imul(x,1664525)+1013904223)>>>0;return x/4294967296;};}
function fwMedium(canvas,n,seed){
  const g=canvas.getContext('2d');
  const key=canvas.width+'x'+canvas.height+'@'+seed;
  let tile=FW_STYLE_CACHE[key];
  if(!tile){
    tile=document.createElement('canvas');tile.width=128;tile.height=128;
    const t=tile.getContext('2d'),R=fwRng(fwHash3(seed,'paper',key));
    t.clearRect(0,0,128,128);
    for(let i=0;i<850;i++){
      const a=.018+R()*.045,v=Math.floor(30+R()*170);
      t.fillStyle='rgba('+v+','+v+','+v+','+a.toFixed(4)+')';
      const r=.4+R()*1.3;t.fillRect(R()*128,R()*128,r,r);
    }
    t.strokeStyle='rgba(40,35,30,.025)';t.lineWidth=.7;
    for(let i=0;i<18;i++){const y=R()*128;t.beginPath();t.moveTo(0,y);t.lineTo(128,y+(R()-.5)*3);t.stroke();}
    FW_STYLE_CACHE[key]=tile;
  }
  g.save();
  g.globalCompositeOperation='multiply';g.globalAlpha=.42;
  g.translate((n*1.7)%128,(n*.9)%128);g.fillStyle=g.createPattern(tile,'repeat');g.fillRect(-128,-128,canvas.width+256,canvas.height+256);
  g.restore();
  g.save();g.globalAlpha=.045;g.fillStyle='#7b2d18';
  for(let y=(n%9);y<canvas.height;y+=18)g.fillRect(0,y,canvas.width,1);
  g.restore();
}
function fwHeavy(canvas,n,seed){
  const g=canvas.getContext('2d',{willReadFrequently:true}),W=canvas.width,H=canvas.height;
  const im=g.getImageData(0,0,W,H),d=im.data;
  const sx=2/W,sy=2/H,base=fwHash3(seed,n,'heavy');
  for(let y=0;y<H;y++){
    const ny=y*sy-1,rowGain=(1-.16*ny*ny)*((y&3)===0?.88:1);
    let h=(base^Math.imul(y+1,2246822519))>>>0;
    for(let x=0,i=(y*W)*4;x<W;x++,i+=4){
      const nx=x*sx-1,vig=Math.max(.64,rowGain*(1-.16*nx*nx));
      h=(Math.imul(h^x,1664525)+1013904223)>>>0;
      const noise=((h>>>24)-128)*.16;
      d[i]=Math.max(0,Math.min(255,d[i]*vig+noise+3));
      d[i+1]=Math.max(0,Math.min(255,d[i+1]*vig+noise));
      d[i+2]=Math.max(0,Math.min(255,d[i+2]*vig+noise-3));
    }
  }
  g.putImageData(im,0,0);
  g.save();g.globalCompositeOperation='screen';g.globalAlpha=.035;g.fillStyle='#ffcf9c';g.fillRect(0,0,W,H);g.restore();
}
function installStyle(){
  if(FW_STYLE==='cheap')return;
  window.RISO.style=FW_STYLE;
  window.RISO.frame=function(n,width,seed){
    renderFrame(n,width??WIDTH,seed??SEED,MAIN);
    if(FW_STYLE==='medium')fwMedium(MAIN,n|0,seed??SEED);
    else if(FW_STYLE==='heavy')fwHeavy(MAIN,n|0,seed??SEED);
    return MAIN.toDataURL('image/png');
  };
}
// --- end E07 style hook ---
`;

for (const style of ['cheap','medium','heavy']) {
  let html=base.replace(marker, hook(style)+'\n'+marker);
  html=html.replace(readyMarker, "  installStyle();\n  window.__ready=true;\n}\nboot()");
  fs.writeFileSync(path.join(outDir,`${style}.html`),html);
}
// Keep the relative cover URL valid from the generated directory.
for(const name of ['cover-demo.svg','payload.example.json']){
  const src=path.resolve(path.dirname(source),name); if(fs.existsSync(src))fs.copyFileSync(src,path.join(outDir,name));
}
console.log(JSON.stringify({source,outDir,styles:['cheap','medium','heavy']},null,2));
