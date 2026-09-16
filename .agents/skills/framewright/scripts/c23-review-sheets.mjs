#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const batch=JSON.parse(fs.readFileSync(path.resolve(process.argv[2]||'artifacts/c23/batch.json'),'utf8')),outDir=path.resolve(process.argv[3]||'artifacts/c23/review');fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});
function run(args){const r=spawnSync('ffmpeg',args,{encoding:'utf8'});if(r.status!==0)throw new Error(r.stderr.slice(-2500));}
const books=[...new Set(batch.results.map(x=>x.bookId))];const map={schema:'framewright-c23-review-v1',books:{}};
for(const book of books){const fixed=batch.results.find(x=>x.bookId===book&&x.id.endsWith('-fixed')),adaptive=batch.results.find(x=>x.bookId===book&&x.id.endsWith('-adaptive'));if(!fixed||!adaptive)throw new Error(`missing pair ${book}`);const a=path.join(outDir,`${book}-fixed.png`),b=path.join(outDir,`${book}-adaptive.png`),sheet=path.join(outDir,`${book}-pair.png`);for(const [row,out] of [[fixed,a],[adaptive,b]])run(['-hide_banner','-loglevel','error','-y','-ss','5.2','-i',path.resolve(row.output),'-frames:v','1','-vf','scale=360:640:force_original_aspect_ratio=decrease,pad=360:640:(ow-iw)/2:(oh-ih)/2:color=0x202020',out]);run(['-hide_banner','-loglevel','error','-y','-i',a,'-i',b,'-filter_complex','[0:v][1:v]hstack=inputs=2[v]','-map','[v]','-frames:v','1',sheet]);map.books[book]=path.relative(process.cwd(),sheet);}
fs.writeFileSync(path.join(outDir,'map.json'),JSON.stringify(map,null,2));console.log(`built ${books.length} C23 paired book-plate sheets`);
