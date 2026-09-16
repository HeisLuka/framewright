#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const outDir=path.resolve(process.argv[2]||'examples/book-ad-systems/generated-c24');
const tmp=path.resolve('examples/book-ad-systems/generated-c24-covers');
const gen=path.resolve('.agents/skills/framewright/scripts/make-c20-fixtures.mjs');
const r=spawnSync(process.execPath,[gen,tmp],{stdio:'inherit'});if(r.status!==0)throw new Error(`C20 cover generator exited ${r.status}`);
fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});

const profiles=[
  {id:'short-en',title:'Glass Salt',author:'Mara Vale',hook:'A city forgets.',cta:'Read now'},
  {id:'medium-en',title:'The Last Map of Winter',author:'Mara Vale',hook:'A forgotten station appears on a map, and one traveler knows why it vanished.',cta:'Open the book'},
  {id:'long-en',title:'The Cartographer Who Remembered Every Street Except the One That Led Home',author:'Alex Mercer',hook:'When an old map begins redrawing the city overnight, a disgraced cartographer follows the new streets and discovers that every shortcut erases a memory he cannot replace.',cta:'Start reading'},
  {id:'medium-ru',title:'Станция после полуночи',author:'Мария Ветрова',hook:'На старой схеме метро появляется станция, которой никто не помнит, кроме одного пассажира.',cta:'Открыть книгу'},
  {id:'long-ru',title:'Последний архив города, который каждую ночь забывает собственные улицы',author:'Алексей Северин',hook:'Каждое утро город просыпается с новой картой, а молодой архивист пытается сохранить названия улиц, дома и чужие воспоминания до того, как они исчезнут окончательно.',cta:'Начать читать'}
];
const styles=['swiss','newspaper','paper'],modes=['fixed','adaptive'];
const manifest={schema:'framewright-c24-pacing-fixtures-v1',profiles:profiles.map(x=>x.id),styles,modes,items:[]};let coverIndex=1;
for(const style of styles){
  for(const p of profiles){
    const srcName=`cover-${String(coverIndex).padStart(2,'0')}.png`,dstName=`${style}-${p.id}.png`;fs.copyFileSync(path.join(tmp,srcName),path.join(outDir,dstName));coverIndex++;
    for(const mode of modes){
      const payload={book_id:`${style}-${p.id}`,title:p.title,author:p.author,hook:p.hook,cta:p.cta,eyebrow:'NEWBOO READING',brand:'NEWBOO',cover_url:`./generated-c24/${dstName}`,visual_system:style,creative_variant:'hook-first',opening_grammar:'hook-led',motion_density:'choreography-v2',art_direction_mode:'cover',cover_composition_mode:'adaptive',delivery_profile:'vertical',pacing_mode:mode};
      const payloadFile=`payload-${style}-${p.id}-${mode}.json`;fs.writeFileSync(path.join(outDir,payloadFile),JSON.stringify(payload,null,2));
      manifest.items.push({id:`${style}-${p.id}-${mode}`,bookId:`${style}-${p.id}`,copyProfile:p.id,mode,style,variant:'hook-first',openingGrammar:'hook-led',profile:'vertical',width:1080,height:1920,seed:17+profiles.indexOf(p),payloadFile});
    }
  }
}
fs.writeFileSync(path.join(outDir,'manifest.json'),JSON.stringify(manifest,null,2));console.log(`C24 generated ${manifest.items.length} renders: ${styles.length} styles x ${profiles.length} copy profiles x ${modes.length} pacing modes`);
