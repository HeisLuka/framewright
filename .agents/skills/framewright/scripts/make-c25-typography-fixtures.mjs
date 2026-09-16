#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const outDir=path.resolve(process.argv[2]||'examples/book-ad-systems/generated-c25');
const srcDir=path.resolve('examples/book-ad-systems/generated-e13-c25');
const r=spawnSync(process.execPath,[path.resolve('.agents/skills/framewright/scripts/make-e13-routed-fixtures.mjs'),srcDir],{stdio:'inherit'});
if(r.status!==0)throw new Error(`E13 routed fixtures exited ${r.status}`);
fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});
const src=JSON.parse(fs.readFileSync(path.join(srcDir,'manifest.json'),'utf8')).items.filter(x=>x.rank===1);
if(src.length!==10)throw new Error(`expected 10 primary fixtures, got ${src.length}`);
const STRESS=[
 {language:'ru-short',title:'Ночь',hook:'Город помнит.'},
 {language:'ru-long',title:'Архив последнего поезда, который никогда не приходит вовремя',hook:'Когда привычный маршрут внезапно исчезает с карты, одна старая запись становится единственной подсказкой и заставляет героя пересмотреть всё, что он считал правдой.'},
 {language:'en-long',title:'The Unreasonably Long Catalogue of Things We Chose Not to Forget',hook:'A quiet archive opens after midnight, and one ordinary index card changes the meaning of every memory stored inside.'},
 {language:'es-medium',title:'La ciudad después de la lluvia',hook:'Una carta olvidada convierte una noche corriente en una búsqueda que nadie esperaba comenzar.'},
 {language:'fr-medium',title:'Les heures silencieuses',hook:'Une note retrouvée dans un livre ancien suffit à déplacer toute l’histoire.'},
 {language:'de-long',title:'Das Archiv der Dinge, die wir beinahe vergessen hätten',hook:'Eine unscheinbare Liste verbindet drei Nächte, zwei verlorene Adressen und eine Entscheidung, die viel zu lange aufgeschoben wurde.'},
 {language:'pl-medium',title:'Mapa cichych miejsc',hook:'Jedna notatka prowadzi przez miasto, którego ulice pamiętają więcej niż jego mieszkańcy.'},
 {language:'tr-medium',title:'Gece arşivinin son kaydı',hook:'Unutulmuş bir kayıt, sıradan görünen yolculuğun bütün anlamını değiştirir.'},
 {language:'mixed',title:'ROOM 17 / ДЕЛО №42 / 03:17',hook:'Три времени, два адреса, один вопрос — what happened before 03:17?'},
 {language:'ru-medium',title:'Карта тихих улиц',hook:'Одна заметка связывает знакомый двор, старую фотографию и ночь, которую никто не хотел вспоминать.'}
];
const SYSTEMS=['baseline','display-led','editorial','compact-dense'];
const manifest={schema:'framewright-c25-typography-fixtures-v1',books:10,systems:SYSTEMS,items:[]};
for(let i=0;i<src.length;i++){
 const source=src[i],base=JSON.parse(fs.readFileSync(path.join(srcDir,source.payloadFile),'utf8')),stress=STRESS[i],n=String(i+1).padStart(2,'0');
 for(const typography of SYSTEMS){
  const payload={...base,book_id:`c25-${n}`,title:stress.title,hook:stress.hook,creative_variant:'hook-first',opening_grammar:'hook-led',art_direction_mode:'cover',cover_composition_mode:'fixed',typography_system:typography,delivery_profile:'vertical'};
  const payloadFile=`payload-${n}-${typography}-${source.style}.json`;fs.writeFileSync(path.join(outDir,payloadFile),JSON.stringify(payload,null,2));
  manifest.items.push({id:`c25-${n}-${typography}-${source.style}`,bookId:`c25-${n}`,language:stress.language,typography,style:source.style,profile:'vertical',width:1080,height:1920,seed:source.seed,payloadFile});
 }
}
fs.writeFileSync(path.join(outDir,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(`C25 generated ${manifest.items.length} videos: ${manifest.books} stress fixtures x ${SYSTEMS.length} typography systems`);
