#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const outDir = path.resolve(process.argv[2] || 'examples/book-ad-v0/generated-e08');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const items = [
  {id:'night-archive', title:'Архив ночного города', author:'Алексей Морозов', hook:'Если бы память можно было вернуть — какую ночь ты бы выбрал?', cta:'Открыть книгу', eyebrow:'НОВАЯ ИСТОРИЯ', brand:'BOOK DROP', accent:'#ff4b2b', background:'#f2eadf', ink:'#111111'},
  {id:'salt', title:'Соль', author:'Ирина Ветрова', hook:'На острове исчезает пресная вода, а вместе с ней — старые договорённости.', cta:'Начать читать', eyebrow:'КОРОТКИЙ РОМАН', brand:'NEWBOO', accent:'#1d73e8', background:'#f1f3ec', ink:'#111111'},
  {id:'winter-map', title:"The Cartographer's Last Winter", author:'Mara Bell', hook:'One unfinished map. One frozen city. Three days before every border changes.', cta:'Read now', eyebrow:'NEW FICTION', brand:'BOOK DROP', accent:'#d43f66', background:'#f4efe7', ink:'#161616'},
  {id:'river-station', title:'Станция у реки, которой нет на картах', author:'Николай Северин', hook:'Поезд останавливается здесь только один раз в году — и никто не знает, кто составляет расписание.', cta:'Открыть историю', eyebrow:'МИСТИЧЕСКАЯ ПРОЗА', brand:'NEWBOO', accent:'#006d77', background:'#f2eee3', ink:'#121212'},
  {id:'city-seven', title:'Город № 7', author:'Анна Ли', hook:'Каждое утро жители получают новый набор правил. Сегодня в списке впервые появилось её имя.', cta:'Читать', eyebrow:'АНТИУТОПИЯ', brand:'BOOK DROP', accent:'#ef8354', background:'#f4eadf', ink:'#101010'},
  {id:'letters', title:'Письма, которые мы не отправили', author:'Екатерина Александровна Волкова', hook:'Десять лет переписки лежали в коробке без адресов. Один конверт всё-таки дошёл.', cta:'Открыть книгу', eyebrow:'СЕМЕЙНАЯ ДРАМА', brand:'NEWBOO', accent:'#b56576', background:'#f6eee8', ink:'#171717'},
  {id:'observatory', title:'Обсерватория на краю света', author:'Роман Ким', hook:'Сигнал повторяется каждые восемь часов. Он приходит не из космоса, а из закрытого корпуса под телескопом.', cta:'Начать', eyebrow:'НАУЧНАЯ ФАНТАСТИКА', brand:'BOOK DROP', accent:'#6d597a', background:'#efece6', ink:'#101010'},
  {id:'long-title', title:'Невероятно тихая история о человеке, который однажды решил не возвращаться домой прежней дорогой', author:'Павел Орлов', hook:'Обычный маршрут занимает двадцать минут. Новый — меняет всю оставшуюся жизнь.', cta:'Читать фрагмент', eyebrow:'СОВРЕМЕННАЯ ПРОЗА', brand:'NEWBOO', accent:'#2a9d8f', background:'#f0ede4', ink:'#111111'},
  {id:'quotes', title:'«После дождя» — записки из дома напротив', author:'Софья Рейн', hook:'Она видит в окне одну и ту же сцену, но каждый вечер в ней меняется одна деталь.', cta:'Открыть', eyebrow:'НОВИНКА', brand:'BOOK DROP', accent:'#e76f51', background:'#f7efe4', ink:'#111111'},
  {id:'zero-hour', title:'00:17', author:'Денис Холодов', hook:'В 00:17 весь район остаётся без электричества ровно на шесть минут. В седьмую ночь свет не возвращается.', cta:'Читать сейчас', eyebrow:'ТРИЛЛЕР', brand:'NEWBOO', accent:'#264653', background:'#ece8df', ink:'#111111'}
];

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n=0;n<256;n++) { let c=n; for(let k=0;k<8;k++) c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1); t[n]=c>>>0; }
  return t;
})();
function crc32(buf){let c=0xffffffff;for(const b of buf)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
function chunk(type,data=Buffer.alloc(0)){
  const typeBuf=Buffer.from(type,'ascii'), len=Buffer.alloc(4), crc=Buffer.alloc(4);
  len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf,data])));
  return Buffer.concat([len,typeBuf,data,crc]);
}
function hex(h){h=h.replace('#','');return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];}
function makeCover(file, spec, index){
  const W=600,H=900, bg=hex(spec.ink), ac=hex(spec.accent), paper=hex(spec.background);
  const raw=Buffer.alloc((W*3+1)*H);
  for(let y=0;y<H;y++){
    const row=y*(W*3+1); raw[row]=0;
    for(let x=0;x<W;x++){
      let c=bg;
      if(x<42 || y<28 || y>H-29) c=ac;
      const dx=x-(420-(index%3)*35), dy=y-(190+(index%4)*35);
      if(dx*dx+dy*dy < (95+(index%2)*22)**2) c=ac;
      if((x+y+index*37)%173<5) c=paper;
      if(y>610 && y<625 && x>85 && x<520) c=ac;
      const p=row+1+x*3; raw[p]=c[0]; raw[p+1]=c[1]; raw[p+2]=c[2];
    }
  }
  const ihdr=Buffer.alloc(13); ihdr.writeUInt32BE(W,0); ihdr.writeUInt32BE(H,4); ihdr[8]=8; ihdr[9]=2;
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw,{level:6})),chunk('IEND')]);
  fs.writeFileSync(file,png);
}

const manifest={schema:'framewright-e08-batch-v1',createdAt:new Date().toISOString(),items:[]};
items.forEach((item,i)=>{
  const n=String(i+1).padStart(2,'0');
  const cover=`cover-${n}.png`; makeCover(path.join(outDir,cover),item,i);
  const payload={book_id:item.id,title:item.title,author:item.author,hook:item.hook,cta:item.cta,eyebrow:item.eyebrow,brand:item.brand,cover_url:`./generated-e08/${cover}`,accent:item.accent,background:item.background,ink:item.ink};
  const payloadFile=`payload-${n}.json`; fs.writeFileSync(path.join(outDir,payloadFile),JSON.stringify(payload,null,2));
  manifest.items.push({id:item.id,seed:7+i,payloadFile});
});
fs.writeFileSync(path.join(outDir,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(`generated ${manifest.items.length} raster covers + payloads in ${outDir}`);
