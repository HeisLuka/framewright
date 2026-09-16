#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const outDir=path.resolve(process.argv[2]||'examples/book-ad-systems/generated-c26');
const tmp=path.resolve('examples/book-ad-systems/generated-c26-covers');
const coverGen=path.resolve('.agents/skills/framewright/scripts/make-c20-fixtures.mjs');
const r=spawnSync(process.execPath,[coverGen,tmp],{stdio:'inherit'});if(r.status!==0)throw new Error(`C20 cover generator exited ${r.status}`);
fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});

const styles=['swiss','newspaper','paper'];
const copies={
  short:{title:'The Night Index',author:'Mara Vale',hook:'Every midnight, one name disappears from the station board.',cta:'Open the book',expectedDuration:5},
  long:{title:'The Cartographer Who Remembered Every Street Except the One That Led Home',author:'Alex Mercer',hook:'When an old map begins redrawing the city overnight, a disgraced cartographer follows the new streets and discovers that every shortcut erases a memory he cannot replace.',cta:'Start reading',expectedDuration:15}
};
const platforms=['generic','youtube_shorts','instagram_reels','tiktok'];
const manifest={schema:'framewright-c26-platform-safe-fixtures-v1',platforms,styles,copies:Object.keys(copies),items:[]};
let coverNo=0;
for(const style of styles){
  for(const [copyId,copy] of Object.entries(copies)){
    const src=`cover-${String(++coverNo).padStart(2,'0')}.png`,cover=`${style}-${copyId}.png`;fs.copyFileSync(path.join(tmp,src),path.join(outDir,cover));
    for(const platform of platforms){
      const bookId=`${style}-${copyId}`,payload={book_id:bookId,title:copy.title,author:copy.author,hook:copy.hook,cta:copy.cta,eyebrow:'NEWBOO READING',brand:'NEWBOO',cover_url:`./generated-c26/${cover}`,visual_system:style,creative_variant:'hook-first',delivery_profile:'vertical',art_direction_mode:'cover',cover_composition_mode:'adaptive',opening_grammar:'hook-led',motion_density:'choreography-v2',typography_system:'baseline',pacing_mode:'duration-adaptive',platform_profile:platform,accent:'#cf3f4f',background:'#f1eee8',ink:'#111111'};
      const payloadFile=`payload-${style}-${copyId}-${platform}.json`;fs.writeFileSync(path.join(outDir,payloadFile),JSON.stringify(payload,null,2));
      manifest.items.push({id:`${style}-${copyId}-${platform}`,bookId,copyProfile:copyId,style,platform,variant:'hook-first',profile:'vertical',width:1080,height:1920,seed:71+coverNo,expectedDuration:copy.expectedDuration,payloadFile});
    }
  }
}
fs.writeFileSync(path.join(outDir,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(`C26 generated ${manifest.items.length} renders: ${styles.length} styles x ${Object.keys(copies).length} copy loads x ${platforms.length} UI profiles`);
