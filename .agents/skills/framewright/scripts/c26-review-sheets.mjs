#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const batch=JSON.parse(fs.readFileSync(path.resolve(process.argv[2]||'artifacts/c26/batch.json'),'utf8'));
const manifest=JSON.parse(fs.readFileSync(path.resolve(process.argv[3]||'examples/book-ad-systems/generated-c26/manifest.json'),'utf8'));
const policy=JSON.parse(fs.readFileSync(path.resolve(process.argv[4]||'examples/book-ad-systems/platform-ui-profiles.v1.json'),'utf8'));
const outDir=path.resolve(process.argv[5]||'artifacts/c26/review');fs.rmSync(outDir,{recursive:true,force:true});fs.mkdirSync(outDir,{recursive:true});
function run(args){const r=spawnSync('ffmpeg',args,{encoding:'utf8'});if(r.status!==0)throw new Error(r.stderr.slice(-4000));}
function overlayFilter(profile){const p=policy.profiles[profile],parts=[];for(const z of p.occlusionZones||[])parts.push(`drawbox=x=${z.x}:y=${z.y}:w=${z.w}:h=${z.h}:color=red@0.13:t=fill`,`drawbox=x=${z.x}:y=${z.y}:w=${z.w}:h=${z.h}:color=red@0.70:t=3`);const s=p.safeRect;parts.push(`drawbox=x=${s.x}:y=${s.y}:w=${s.w}:h=${s.h}:color=lime@0.92:t=5`,`drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text=${profile}:x=18:y=18:fontsize=34:fontcolor=white:box=1:boxcolor=black@0.62`,`scale=216:384`);return parts.join(',');}
const rowById=new Map(batch.results.map(x=>[x.id,x])),itemById=new Map(manifest.items.map(x=>[x.id,x])),groups=[...new Set(manifest.items.map(x=>x.bookId))],fractions=[.18,.50,.82],map={schema:'framewright-c26-platform-safe-review-v1',policyVersion:policy.version,fractions,groups:{}};
for(const bookId of groups){const rows=[];map.groups[bookId]={};for(const platform of manifest.platforms){const item=manifest.items.find(x=>x.bookId===bookId&&x.platform===platform),row=item&&rowById.get(item.id);if(!item||!row)throw new Error(`missing ${bookId}/${platform}`);const duration=item.expectedDuration,cells=[];for(let i=0;i<fractions.length;i++){const t=Math.max(.03,Math.min(duration-.05,duration*fractions[i])),f=path.join(outDir,`${bookId}-${platform}-${i}.png`);run(['-hide_banner','-loglevel','error','-y','-ss',t.toFixed(3),'-i',path.resolve(row.output),'-frames:v','1','-vf',overlayFilter(platform),f]);cells.push(f);}const strip=path.join(outDir,`${bookId}-${platform}.png`),inputs=cells.flatMap(f=>['-i',f]);run(['-hide_banner','-loglevel','error','-y',...inputs,'-filter_complex',cells.map((_,i)=>`[${i}:v]`).join('')+`hstack=inputs=${cells.length}[v]`,'-map','[v]','-frames:v','1',strip]);rows.push(strip);map.groups[bookId][platform]={durationSeconds:duration,strip:path.relative(process.cwd(),strip)};}
  const sheet=path.join(outDir,`${bookId}-platforms.png`),inputs=rows.flatMap(f=>['-i',f]);run(['-hide_banner','-loglevel','error','-y',...inputs,'-filter_complex',rows.map((_,i)=>`[${i}:v]`).join('')+`vstack=inputs=${rows.length}[v]`,'-map','[v]','-frames:v','1',sheet]);map.groups[bookId].sheet=path.relative(process.cwd(),sheet);
}
fs.writeFileSync(path.join(outDir,'map.json'),JSON.stringify(map,null,2));console.log(`built ${groups.length} C26 platform overlay review sheets (${manifest.platforms.length} profile rows each)`);
