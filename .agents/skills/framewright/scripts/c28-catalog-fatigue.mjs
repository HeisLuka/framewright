#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const outPath=path.resolve(process.argv[2]||'artifacts/c28/semantic-report.json');
const systems=['swiss','newspaper','paper'];
const variants=['hook-first','cover-first','title-first','hook-title'];
const openings=['hook-led','cover-led','title-led','progressive-hook'];
const durations=[3,5,7,9,12,15];
const typography=['baseline','display-led','editorial','compact-dense'];
const platforms=['youtube_shorts','instagram_reels','tiktok'];
const books=36;
const candidatesPerBook=6;
const recentWindow=8;

function hash(s){let h=2166136261>>>0;for(const ch of String(s)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function pick(a,n){return a[((n%a.length)+a.length)%a.length];}
function bookConstraints(bookIndex){return{duration_s:pick(durations,bookIndex),platform_profile:pick(platforms,bookIndex),palette_family:`cover-${bookIndex%12}`,composition_policy:'c23-cover-derived'};}
function makeCandidate(bookIndex,k){const fixed=bookConstraints(bookIndex),base=hash(`book-${bookIndex}`),book_id=`book-${String(bookIndex+1).padStart(2,'0')}`;if(k===0)return{book_id,candidate:k,visual_system:pick(systems,bookIndex),creative_variant:'hook-first',opening_grammar:'hook-led',typography_system:'baseline',...fixed};const n=(base+k*2654435761)>>>0;return{book_id,candidate:k,visual_system:pick(systems,n),creative_variant:pick(variants,n>>>3),opening_grammar:pick(openings,n>>>6),typography_system:pick(typography,n>>>10),...fixed};}
function semanticKey(c){return[c.visual_system,c.creative_variant,c.opening_grammar,c.typography_system,c.duration_s].join('|');}
function overlap(a,b){if(!a||!b)return 0;let s=0;s+=a.visual_system===b.visual_system?2.0:0;s+=a.creative_variant===b.creative_variant?1.7:0;s+=a.opening_grammar===b.opening_grammar?2.2:0;s+=a.typography_system===b.typography_system?1.2:0;s+=a.duration_s===b.duration_s?0.8:0;return s;}
function recentPenalty(c,selected){const recent=selected.slice(-recentWindow);let p=0;for(let i=0;i<recent.length;i++)p+=overlap(c,recent[i])*(1+(i+1)/recent.length*.35);const last=recent.at(-1);if(last){if(c.visual_system===last.visual_system)p+=2.4;if(c.opening_grammar===last.opening_grammar)p+=2.8;if(c.creative_variant===last.creative_variant)p+=1.6;if(c.typography_system===last.typography_system)p+=1.0;}return p;}
function rerank(groups){const selected=[],decisions=[];for(const group of groups){const fixed=['duration_s','platform_profile','palette_family','composition_policy'];for(const f of fixed)if(group.some(c=>c[f]!==group[0][f]))throw new Error(`${group[0].book_id}: candidate changed fixed constraint ${f}`);const scored=group.map(c=>({c,score:recentPenalty(c,selected)})).sort((a,b)=>a.score-b.score||a.c.candidate-b.c.candidate);const win=scored[0];selected.push(win.c);decisions.push({book_id:win.c.book_id,selected_candidate:win.c.candidate,penalty:+win.score.toFixed(3),runner_up:scored[1]?.c.candidate??null,runner_up_penalty:scored[1]?+scored[1].score.toFixed(3):null,preserved:{duration_s:win.c.duration_s,platform_profile:win.c.platform_profile,palette_family:win.c.palette_family,composition_policy:win.c.composition_policy},reason:'choose among already-valid creative alternatives; minimize weighted recent catalog repetition; do not alter readability/platform/cover-derived constraints'});}return{selected,decisions};}
function streak(list,field){let max=0,cur=0,last=Symbol();for(const x of list){const v=x[field];if(v===last)cur++;else{last=v;cur=1;}max=Math.max(max,cur);}return max;}
function adjacentRepeats(list,field){let n=0;for(let i=1;i<list.length;i++)if(list[i][field]===list[i-1][field])n++;return n;}
function windowCollision(list){let total=0,pairs=0;for(let i=0;i<list.length;i++)for(let j=Math.max(0,i-recentWindow);j<i;j++){total+=overlap(list[i],list[j]);pairs++;}return pairs?total/pairs:0;}
function metrics(list){const keys=list.map(semanticKey);return{items:list.length,unique_semantic_signatures:new Set(keys).size,unique_signature_ratio:+(new Set(keys).size/list.length).toFixed(4),adjacent_repeats:{visual_system:adjacentRepeats(list,'visual_system'),creative_variant:adjacentRepeats(list,'creative_variant'),opening_grammar:adjacentRepeats(list,'opening_grammar'),typography_system:adjacentRepeats(list,'typography_system'),duration_s:adjacentRepeats(list,'duration_s')},max_streak:{visual_system:streak(list,'visual_system'),creative_variant:streak(list,'creative_variant'),opening_grammar:streak(list,'opening_grammar'),typography_system:streak(list,'typography_system'),duration_s:streak(list,'duration_s')},mean_recent_window_overlap:+windowCollision(list).toFixed(4)};}

const groups=Array.from({length:books},(_,i)=>Array.from({length:candidatesPerBook},(_,k)=>makeCandidate(i,k)));
const naive=groups.map(g=>g[0]),aware=rerank(groups);const before=metrics(naive),after=metrics(aware.selected);
const gates={same_item_count:before.items===after.items,unique_not_worse:after.unique_signature_ratio>=before.unique_signature_ratio,overlap_improves:after.mean_recent_window_overlap<before.mean_recent_window_overlap,opening_adjacent_repeats_improve:after.adjacent_repeats.opening_grammar<before.adjacent_repeats.opening_grammar,variant_adjacent_repeats_improve:after.adjacent_repeats.creative_variant<before.adjacent_repeats.creative_variant,fixed_constraints_preserved:true,deterministic:true};
for(let i=0;i<books;i++)for(const f of ['duration_s','platform_profile','palette_family','composition_policy'])if(naive[i][f]!==aware.selected[i][f])gates.fixed_constraints_preserved=false;
const report={schema:'c28-catalog-fatigue-v2',scope:'semantic-only baseline; preserved because its visual validation failed in canonical run 35150707502',books,candidates_per_book:candidatesPerBook,recent_window:recentWindow,rerankable_axes:['visual_system','creative_variant','opening_grammar','typography_system'],fixed_axes:['duration_s','platform_profile','palette_family','composition_policy'],weights:{visual_system:2,creative_variant:1.7,opening_grammar:2.2,typography_system:1.2,duration_s_observed_only:.8},before,after,delta:{unique_signature_ratio:+(after.unique_signature_ratio-before.unique_signature_ratio).toFixed(4),mean_recent_window_overlap:+(after.mean_recent_window_overlap-before.mean_recent_window_overlap).toFixed(4)},gates,groups,decisions:aware.decisions,naive,selected:aware.selected};
const replay=rerank(groups);gates.deterministic=JSON.stringify(replay.selected)===JSON.stringify(aware.selected)&&JSON.stringify(replay.decisions)===JSON.stringify(aware.decisions);
fs.mkdirSync(path.dirname(outPath),{recursive:true});fs.writeFileSync(outPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({before,after,delta:report.delta,gates},null,2));if(!Object.values(gates).every(Boolean))process.exitCode=1;
