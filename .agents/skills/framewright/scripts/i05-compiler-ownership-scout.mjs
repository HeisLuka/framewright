#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const policyPath=process.argv[2]||'examples/book-ad-systems/platform-ui-profiles.v1.json';
const outPath=process.argv[3]||'artifacts/i05/compiler-ownership.json';
const policy=JSON.parse(fs.readFileSync(policyPath,'utf8'));

function stable(v){if(Array.isArray(v))return v.map(stable);if(v&&typeof v==='object'){const o={};for(const k of Object.keys(v).sort())o[k]=stable(v[k]);return o;}return v;}
function canonicalJson(v){return JSON.stringify(stable(v));}
function sha(v){return createHash('sha256').update(typeof v==='string'?v:canonicalJson(v)).digest('hex');}
function id(prefix,v){return `${prefix}_${sha(v)}`;}
function assert(cond,msg){if(!cond)throw new Error(msg);}

const CONTENT_KEYS=['book_id','title','author','hook','cta','eyebrow','brand','cover_url','accent','background','ink'];
const SELECTOR_KEYS=['visual_system','creative_variant','opening_grammar','motion_density','typography_system','pacing_mode','art_direction_mode','cover_composition_mode','platform_profile','delivery_profile'];
function canonicalContent(raw){const out={};for(const k of CONTENT_KEYS)if(raw[k]!==undefined)out[k]=raw[k];return out;}
function selectorLeakage(raw){return SELECTOR_KEYS.filter(k=>raw[k]!==undefined);}

// C27 owns narrative semantics. I05 consumes the resulting identity + exact timeline;
// it deliberately does not reimplement the C27 planner.
function narrativePlanFixture(raw,copyId){
  const duration_seconds=copyId==='short'?5:15;
  const roles=copyId==='short'
    ? [{role:'hook',start_frame:0,end_frame:74,frames:74},{role:'book_reveal',start_frame:74,end_frame:150,frames:76}]
    : [{role:'hook',start_frame:0,end_frame:150,frames:150},{role:'tension',start_frame:150,end_frame:248,frames:98},{role:'book_reveal',start_frame:248,end_frame:347,frames:99},{role:'desire_payoff',start_frame:347,end_frame:450,frames:103}];
  const plan={schema:'framewright-c27-narrative-plan-v1',policy_version:'c27-narrative-v1',book_id:raw.book_id,duration_seconds,fps:30,total_frames:duration_seconds*30,reveal_timing:'mid',cta_treatment:copyId==='short'?'soft_reveal':'direct',roles};
  plan.narrative_plan_id=`c27_${sha(plan)}`;
  return plan;
}

function creativeMechanisms(style){return{visual_system:{id:style,version:'v1'},structural_variant:{id:'hook-first',version:'e14-v1'},opening_grammar:{id:'hook-led',version:'c21-v1'},typography_system:{id:'baseline',version:'c25-v1'},motion:{id:'choreography-v2',version:'c22-v1'},art_direction:{id:'cover',version:'c20-v1'},cover_composition:{id:'adaptive',version:'c23-grid-saliency-v2'}};}
function compileCreativeRealization(raw,style,narrativePlan){const content=canonicalContent(raw);const plan={schema:'framewright-creative-realization-plan-v0',payload_sha256:sha(content),book_id:content.book_id,narrative_plan_id:narrativePlan.narrative_plan_id,duration_ms:narrativePlan.duration_seconds*1000,total_frames:narrativePlan.total_frames,mechanisms:creativeMechanisms(style)};plan.creative_realization_id=id('fwcr0',plan);return{content,plan};}
function deliveryProfile(platform){const p=policy.profiles[platform];assert(p,`unknown platform ${platform}`);return{id:'vertical-1080x1920-v1',width:1080,height:1920,fps:30,safe_area_profile:`${policy.version}:${platform}`,safe_rect:p.safeRect};}
const RUNTIME={id:'reference-runtime',renderer:'napi-canvas',encoder:'x264-crf22'};
function compileScene(creative,platform,runtime=RUNTIME){const delivery=deliveryProfile(platform);const scene={schema:'framewright-compiled-scene-v0',creative_realization_id:creative.creative_realization_id,duration_ms:creative.duration_ms,total_frames:creative.total_frames,delivery,runtime};scene.compiled_scene_id=id('fwsc0',scene);return scene;}
function audioPrecondition(scene,{source_duration_ms=12000,extension_policy=null}={}){if(scene.duration_ms<=source_duration_ms)return{status:'pass',reason:'source-long-enough'};if(extension_policy)return{status:'pass',reason:`extension:${extension_policy}`};return{status:'blocked',reason:`source ${source_duration_ms}ms shorter than render ${scene.duration_ms}ms and no extension policy`};}

const copies={short:{title:'The Night Index',author:'Mara Vale',hook:'Every midnight, one name disappears from the station board.',cta:'Open the book'},long:{title:'The Cartographer Who Remembered Every Street Except the One That Led Home',author:'Alex Mercer',hook:'When an old map begins redrawing the city overnight, a disgraced cartographer follows the new streets and discovers that every shortcut erases a memory he cannot replace.',cta:'Start reading'}};
const styles=['swiss','newspaper','paper'];
const platforms=['generic','youtube_shorts','instagram_reels','tiktok'];
const wrappers=[];
for(const style of styles)for(const [copyId,copy] of Object.entries(copies))for(const platform of platforms)wrappers.push({book_id:`${style}-${copyId}`,...copy,eyebrow:'NEWBOO READING',brand:'NEWBOO',cover_url:`./${style}-${copyId}.png`,accent:'#cf3f4f',background:'#f1eee8',ink:'#111111',visual_system:style,creative_variant:'hook-first',opening_grammar:'hook-led',motion_density:'choreography-v2',typography_system:'baseline',art_direction_mode:'cover',cover_composition_mode:'adaptive',platform_profile:platform,delivery_profile:'vertical',copyId});

const naiveWrapperHashes=new Set(wrappers.map(sha));
const canonicalPayloadHashes=new Set(wrappers.map(x=>sha(canonicalContent(x))));
const narrativeRows=[];const creativeRows=[];const sceneRows=[];const bySemanticKey=new Map();
for(const raw of wrappers){const semanticKey=`${raw.book_id}|${raw.visual_system}`;let creative=bySemanticKey.get(semanticKey);if(!creative){const narrative=narrativePlanFixture(raw,raw.copyId);narrativeRows.push(narrative);creative=compileCreativeRealization(raw,raw.visual_system,narrative).plan;bySemanticKey.set(semanticKey,creative);creativeRows.push(creative);}else{const narrative=narrativePlanFixture(raw,raw.copyId);const again=compileCreativeRealization(raw,raw.visual_system,narrative).plan;assert(again.creative_realization_id===creative.creative_realization_id,`${semanticKey}: platform leaked into creative identity`);}const scene=compileScene(creative,raw.platform_profile);sceneRows.push({...scene,platform:raw.platform_profile,audio:audioPrecondition(scene)});}

const narrativeIds=new Set(narrativeRows.map(x=>x.narrative_plan_id));
const creativeIds=new Set(creativeRows.map(x=>x.creative_realization_id));
const sceneIds=new Set(sceneRows.map(x=>x.compiled_scene_id));
assert(wrappers.length===24,'expected 24 wrappers');
assert(naiveWrapperHashes.size===24,'expected 24 naive wrapper hashes');
assert(canonicalPayloadHashes.size===6,'expected 6 canonical payload hashes');
assert(narrativeIds.size===6,'expected 6 narrative plans');
assert(creativeIds.size===6,'expected 6 creative realizations');
assert(sceneIds.size===24,'expected 24 compiled scenes');
for(const row of creativeRows)assert(row.total_frames===row.duration_ms/1000*30,`${row.book_id}: frame/duration mismatch`);

const sample=creativeRows[0];
const typographyVariant=structuredClone(sample);typographyVariant.mechanisms.typography_system={id:'editorial',version:'c25-v1'};delete typographyVariant.creative_realization_id;typographyVariant.creative_realization_id=id('fwcr0',typographyVariant);
assert(typographyVariant.creative_realization_id!==sample.creative_realization_id,'typography change did not change creative identity');
const generic=compileScene(sample,'generic'),tiktok=compileScene(sample,'tiktok');
assert(generic.creative_realization_id===tiktok.creative_realization_id,'platform changed creative identity');
assert(generic.compiled_scene_id!==tiktok.compiled_scene_id,'platform did not change scene identity');
const runtimeVariant=compileScene(sample,'generic',{...RUNTIME,encoder:'webcodecs-3m'});
assert(runtimeVariant.creative_realization_id===generic.creative_realization_id,'runtime changed creative identity');
assert(runtimeVariant.compiled_scene_id!==generic.compiled_scene_id,'runtime did not change scene identity');
assert(!('duration_ms' in generic.delivery),'duration leaked into delivery profile');
const audioBlocked=sceneRows.filter(x=>x.audio.status==='blocked');assert(audioBlocked.length===12,`expected 12 blocked long-audio realizations, got ${audioBlocked.length}`);

const report={schema:'framewright-i05-compiler-ownership-scout-v0',policy_version:policy.version,counts:{wrappers:24,naive_wrapper_hashes:naiveWrapperHashes.size,canonical_content_hashes:canonicalPayloadHashes.size,narrative_plans:narrativeIds.size,creative_realizations:creativeIds.size,compiled_scenes:sceneIds.size,audio_blocked:audioBlocked.length},invariants:{consumes_c27_narrative_boundary:true,platform_stable_creative_identity:true,platform_changes_scene_identity:true,runtime_changes_scene_not_creative:true,creative_mechanism_changes_creative:true,delivery_has_no_duration:true,content_hash_strips_selectors:true},selector_keys:SELECTOR_KEYS,sample_selector_leakage:selectorLeakage(wrappers[0]),narrative_plans:narrativeRows,creative_realizations:creativeRows,compiled_scenes:sceneRows};
fs.mkdirSync(path.dirname(path.resolve(outPath)),{recursive:true});fs.writeFileSync(outPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.counts,null,2));
