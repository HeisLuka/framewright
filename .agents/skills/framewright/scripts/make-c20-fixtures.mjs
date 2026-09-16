#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const outDir=path.resolve(process.argv[2]||'examples/book-ad-systems/generated-c20');
fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});
const styles=['swiss','newspaper','paper'];
const basePalettes=[
  ['#08131f','#164e63','#f59e0b','#e2e8f0'],
  ['#1f1028','#7e22ce','#f0abfc','#f8fafc'],
  ['#10130f','#365314','#84cc16','#fefce8'],
  ['#240b0b','#991b1b','#f97316','#fff7ed'],
  ['#061b1b','#0f766e','#2dd4bf','#ecfeff'],
  ['#141414','#525252','#d4d4d4','#fafafa'],
  ['#f4efe6','#d6b98c','#6b4f2f','#fffaf0'],
  ['#eef2ff','#a5b4fc','#4338ca','#ffffff'],
  ['#0a0a0a','#202020','#f5f5f5','#dc2626'],
  ['#fff8dc','#fde68a','#92400e','#ffffff'],
  ['#071a33','#1d4ed8','#fb7185','#e0f2fe'],
  ['#1b1325','#be185d','#facc15','#fdf2f8']
];
const titles=['Ночной архив','Последняя карта','Соль и стекло','Город без полудня','Станция на краю','Тихая комната','Paper Moon','Blue Static','Black Signal','Письма сентября','Orbit Seven','После дождя'];
const hooks=['Одна деталь меняет всё, что герой считал правдой.','Книга начинается с вопроса, на который никто не хочет отвечать.','Знакомое место оказывается устроено совсем не так, как казалось.'];
const generic={accent:'#cf3f4f',background:'#f1eee8',ink:'#111111'};

const crcTable=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);t[n]=c>>>0;}return t;})();
function crc32(buf){let c=0xffffffff;for(const b of buf)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
function chunk(type,data=Buffer.alloc(0)){const tb=Buffer.from(type,'ascii'),len=Buffer.alloc(4),crc=Buffer.alloc(4);len.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([tb,data])));return Buffer.concat([len,tb,data,crc]);}
function rgb(h){h=h.slice(1);return[parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];}
function mix(a,b,t){return a.map((v,i)=>Math.round(v+(b[i]-v)*t));}
function makeCover(file,palette,index,variant){
  const W=600,H=900,[c0,c1,c2,c3]=palette.map(rgb),raw=Buffer.alloc((W*3+1)*H);let seed=(index+1)*2654435761+variant*2246822519;
  const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const mode=index%6;
  for(let y=0;y<H;y++){
    const row=y*(W*3+1);raw[row]=0;
    for(let x=0;x<W;x++){
      let c=c0;
      if(mode===0){const band=Math.floor(x/90)%3;c=band===0?c0:band===1?c1:c3;if(y>610)c=mix(c,c2,.22);}
      else if(mode===1){const dx=x-(180+variant*80),dy=y-(220+variant*95),r=Math.hypot(dx,dy);c=r<145?c2:r<275?c1:c0;}
      else if(mode===2){c=((x+y*2+variant*61)%240)<90?c0:c1;if((x*3-y+index*17)%191<15)c=c2;}
      else if(mode===3){const grad=(x/W*.55+y/H*.45);c=mix(c0,c1,grad);if(y>520&&y<555)c=c2;}
      else if(mode===4){c=c0;const gx=Math.floor(x/75),gy=Math.floor(y/75);if((gx+gy+variant)%5===0)c=c2;else if((gx*3+gy)%7===0)c=c1;}
      else {const n=rand();c=n<.55?c0:n<.78?c1:n<.92?c2:c3;}
      if(x<18||x>W-19||y<18||y>H-19)c=c2;
      if(y>700&&y<720&&x>70&&x<W-70)c=c3;
      const p=row+1+x*3;raw[p]=c[0];raw[p+1]=c[1];raw[p+2]=c[2];
    }
  }
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W,0);ihdr.writeUInt32BE(H,4);ihdr[8]=8;ihdr[9]=2;
  fs.writeFileSync(file,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw,{level:6})),chunk('IEND')]));
}

const manifest={schema:'framewright-c20-fixtures-v1',fixtureCount:36,items:[]};
let seq=0;
for(let p=0;p<basePalettes.length;p++)for(let v=0;v<3;v++){
  const n=String(++seq).padStart(2,'0'),bookId=`cover-${n}`,style=styles[(seq-1)%3],cover=`cover-${n}.png`,seed=200+seq;
  makeCover(path.join(outDir,cover),basePalettes[p],p,v);
  const common={book_id:bookId,title:`${titles[p]}${v===0?'':v===1?' — второе издание':' / special'}`,author:['Мария Ветрова','Noah Bell','Алексей Северин'][v],hook:hooks[(p+v)%hooks.length],cta:['Открыть книгу','Читать сейчас','Read now'][v],eyebrow:['НОВАЯ ИСТОРИЯ','РЕКОМЕНДАЦИЯ','FEATURED'][v],brand:'NEWBOO',cover_url:`./generated-c20/${cover}`,visual_system:style,creative_variant:'hook-first',delivery_profile:'vertical',...generic};
  for(const mode of ['generic','cover']){
    const payload={...common,art_direction_mode:mode},payloadFile=`payload-${n}-${mode}.json`;fs.writeFileSync(path.join(outDir,payloadFile),JSON.stringify(payload,null,2));
    manifest.items.push({id:`${bookId}-${mode}`,bookId,mode,style,variant:'hook-first',profile:'vertical',width:1080,height:1920,seed,payloadFile});
  }
}
fs.writeFileSync(path.join(outDir,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(`generated ${manifest.fixtureCount} covers / ${manifest.items.length} paired renders in ${outDir}`);
