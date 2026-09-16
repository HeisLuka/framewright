#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const policyPath=process.argv[2]||'examples/book-ad-systems/platform-ui-profiles.v1.json';
const outPath=process.argv[3]||'artifacts/i05/compiler-ownership.json';
const policy=JSON.parse(fs.readFileSync(policyPath,'utf8'));

function stable(v){
  if(Array.isArray(v))return v.map(stable);
  if(v&&typeof v==='object'){
    const out={};
    for(const k of Object.keys(v).sort())out[k]=stable(v[k]);
    return out;
  }
  return v;
}
function canonicalJson(v){return JSON.stringify(stable(v));}
function sha(v){return createHash('sha256').update(typeof v==='string'?v:canonicalJson(v)).digest('hex');}
function id(prefix,v){return `${prefix}_${sha(v)}`;}
function assert(cond,msg){if(!cond)throw new Error(msg);}

const CONTENT_KEYS=['book_id','title','author','hook','cta','eyebrow','brand','cover_url','accent','background','ink'];
const SELECTOR_KEYS=['visual_system','creative_variant','opening_grammar','motion_density','typography_system','pacing_mode','art_direction_mode','cover_composition_mode','platform_profile','delivery_profile'];
function canonicalContent(raw){
  const out={};
  for(const k of CONTENT_KEYS){
    if(raw[k]!==undefined)out[k]=raw[k];
  }
  return out;
}
function selectorLeakage(raw){return SELECTOR_KEYS.filter(k=>raw[k]!==undefined);}

function textStats(text){
  const s=String(text||'').trim();
  const words=s?s.split(' ').filter(Boolean).length:0;
  const chars=Array.from(s).filter(ch=>ch.trim()!=='').length;
  return{words,chars};
}
function durationBand(score){if(score<=40)return 3;if(score<=100)return 5;if(score<=130)return 7;if(score<=210)return 9;if(score<=285)return 12;return 15;}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function allocate(target,bounds,desired,keys){
  const frames={hook:0,book:0,cta:0};
  const rawTotal=keys.reduce((s,k)=>s+Math.max(.001,desired[k]),0);
  const targetShare={};
  for(const k of keys){
    const [lo,hi]=bounds[k];
    targetShare[k]=target*Math.max(.001,desired[k])/rawTotal;
    frames[k]=Math.round(clamp(targetShare[k],lo,hi));
  }
  let sum=keys.reduce((s,k)=>s+frames[k],0),guard=0;
  while(sum!==target&&guard++<2000){
    if(sum<target){
      let best=null,bestScore=-Infinity;
      for(const k of keys){
        const hi=bounds[k][1];
        if(frames[k]>=hi)continue;
        const score=targetShare[k]-frames[k];
        if(score>bestScore){bestScore=score;best=k;}
      }
      if(!best)break;
      frames[best]++;sum++;
    }else{
      let best=null,bestScore=-Infinity;
      for(const k of keys){
        const lo=bounds[k][0];
        if(frames[k]<=lo)continue;
        const score=frames[k]-targetShare[k];
        if(score>bestScore){bestScore=score;best=k;}
      }
      if(!best)break;
      frames[best]--;sum--;
    }
  }
  assert(sum===target,`allocator missed target ${sum} != ${target}`);
  return frames;
}
function c24Timeline(content){
  const hook=textStats(content.hook),title=textStats(content.title),author=textStats(content.author),cta=textStats(content.cta);
  const score=hook.chars+.65*title.chars+.20*author.chars+.35*cta.chars+2.5*(hook.words+title.words);
  const desired={
    hook:30+.48*hook.chars+1.8*hook.words,
    book:55+.34*(title.chars+author.chars)+1.2*(title.words+author.words)+.10*hook.chars,
    cta:36+.24*cta.chars+1.3*cta.words+.08*title.chars,
  };
  const seconds=durationBand(score),target=seconds*30;
  if(seconds===3)return{version:'c24-organic-duration-v1',score:+score.toFixed(2),duration_ms:3000,grammar:'teaser-hook',frames:{hook:90,book:0,cta:0}};
  const boundsByProfile={
    5:{hook:[54,78],book:[72,96],cta:[0,0]},
    7:{hook:[60,90],book:[90,120],cta:[30,60]},
    9:{hook:[72,105],book:[105,150],cta:[45,75]},
    12:{hook:[90,126],book:[150,198],cta:[72,120]},
    15:{hook:[105,150],book:[195,255],cta:[90,135]},
  };
  const grammar=seconds===5?'hook-book':'full';
  const keys=seconds===5?['hook','book']:['hook','book','cta'];
  const frames=allocate(target,boundsByProfile[seconds],desired,keys);
  return{version:'c24-organic-duration-v1',score:+score.toFixed(2),duration_ms:seconds*1000,grammar,frames};
}

function creativeMechanisms(style){
  return{
    visual_system:{id:style,version:'v1'},
    structural_variant:{id:'hook-first',version:'e14-v1'},
    opening_grammar:{id:'hook-led',version:'c21-v1'},
    typography_system:{id:'baseline',version:'c25-v1'},
    motion:{id:'choreography-v2',version:'c22-v1'},
    art_direction:{id:'cover',version:'c20-v1'},
    cover_composition:{id:'adaptive',version:'c23-grid-saliency-v2'},
    pacing:{id:'duration-adaptive',version:'c24-organic-duration-v1'},
  };
}
function compileCreative(raw,style){
  const content=canonicalContent(raw);
  const payload_sha256=sha(content);
  const timeline=c24Timeline(content);
  const plan={schema:'framewright-creative-plan-v0',payload_sha256,book_id:content.book_id,mechanisms:creativeMechanisms(style),timeline};
  plan.creative_plan_id=id('fwcp0',plan);
  return{content,plan};
}
function deliveryProfile(platform){
  const p=policy.profiles[platform];
  assert(p,`unknown platform ${platform}`);
  return{id:'vertical-1080x1920-v1',width:1080,height:1920,fps:30,safe_area_profile:`${policy.version}:${platform}`,safe_rect:p.safeRect};
}
const RUNTIME={id:'reference-runtime',renderer:'napi-canvas',encoder:'x264-crf22'};
function compileScene(creativePlan,platform,runtime=RUNTIME){
  const delivery=deliveryProfile(platform);
  const scene={schema:'framewright-compiled-scene-v0',creative_plan_id:creativePlan.creative_plan_id,duration_ms:creativePlan.timeline.duration_ms,delivery,runtime};
  scene.compiled_scene_id=id('fwsc0',scene);
  return scene;
}
function audioPrecondition(scene,{source_duration_ms=12000,extension_policy=null}={}){
  if(scene.duration_ms<=source_duration_ms)return{status:'pass',reason:'source-long-enough'};
  if(extension_policy)return{status:'pass',reason:`extension:${extension_policy}`};
  return{status:'blocked',reason:`source ${source_duration_ms}ms shorter than render ${scene.duration_ms}ms and no extension policy`};
}

const copies={
  short:{title:'The Night Index',author:'Mara Vale',hook:'Every midnight, one name disappears from the station board.',cta:'Open the book'},
  long:{title:'The Cartographer Who Remembered Every Street Except the One That Led Home',author:'Alex Mercer',hook:'When an old map begins redrawing the city overnight, a disgraced cartographer follows the new streets and discovers that every shortcut erases a memory he cannot replace.',cta:'Start reading'},
};
const styles=['swiss','newspaper','paper'];
const platforms=['generic','youtube_shorts','instagram_reels','tiktok'];
const wrappers=[];
for(const style of styles){
  for(const [copyId,copy] of Object.entries(copies)){
    for(const platform of platforms){
      wrappers.push({
        book_id:`${style}-${copyId}`,...copy,eyebrow:'NEWBOO READING',brand:'NEWBOO',cover_url:`./${style}-${copyId}.png`,accent:'#cf3f4f',background:'#f1eee8',ink:'#111111',
        visual_system:style,creative_variant:'hook-first',opening_grammar:'hook-led',motion_density:'choreography-v2',typography_system:'baseline',pacing_mode:'duration-adaptive',art_direction_mode:'cover',cover_composition_mode:'adaptive',platform_profile:platform,delivery_profile:'vertical',
      });
    }
  }
}

const naiveWrapperHashes=new Set(wrappers.map(sha));
const canonicalPayloadHashes=new Set(wrappers.map(x=>sha(canonicalContent(x))));
const creativeRows=[];
const sceneRows=[];
const bySemanticKey=new Map();
for(const raw of wrappers){
  const style=raw.visual_system,platform=raw.platform_profile;
  const semanticKey=`${raw.book_id}|${style}`;
  let creative=bySemanticKey.get(semanticKey);
  if(!creative){
    creative=compileCreative(raw,style).plan;
    bySemanticKey.set(semanticKey,creative);
    creativeRows.push(creative);
  }else{
    const again=compileCreative(raw,style).plan;
    assert(again.creative_plan_id===creative.creative_plan_id,`${semanticKey}: platform leaked into creative identity`);
  }
  const scene=compileScene(creative,platform);
  sceneRows.push({...scene,platform,audio:audioPrecondition(scene)});
}

const creativeIds=new Set(creativeRows.map(x=>x.creative_plan_id));
const sceneIds=new Set(sceneRows.map(x=>x.compiled_scene_id));
assert(wrappers.length===24,`expected 24 wrappers, got ${wrappers.length}`);
assert(naiveWrapperHashes.size===24,`expected 24 naive wrapper hashes, got ${naiveWrapperHashes.size}`);
assert(canonicalPayloadHashes.size===6,`expected 6 canonical payload hashes, got ${canonicalPayloadHashes.size}`);
assert(creativeIds.size===6,`expected 6 creative plans, got ${creativeIds.size}`);
assert(sceneIds.size===24,`expected 24 compiled scenes, got ${sceneIds.size}`);

for(const row of creativeRows){
  const frames=Object.values(row.timeline.frames).reduce((a,b)=>a+b,0);
  assert(frames===row.timeline.duration_ms/1000*30,`${row.book_id}: frame total mismatch`);
}
const shortRows=creativeRows.filter(x=>x.book_id.endsWith('-short'));
const longRows=creativeRows.filter(x=>x.book_id.endsWith('-long'));
assert(shortRows.every(x=>x.timeline.duration_ms===5000),'short copies did not resolve to 5s');
assert(longRows.every(x=>x.timeline.duration_ms===15000),'long copies did not resolve to 15s');
assert(shortRows.every(x=>x.timeline.frames.hook===74&&x.timeline.frames.book===76&&x.timeline.frames.cta===0),'short frame allocation drift');
assert(longRows.every(x=>x.timeline.frames.hook===150&&x.timeline.frames.book===197&&x.timeline.frames.cta===103),'long frame allocation drift');

const sample=creativeRows[0];
const typeVariant=structuredClone(sample);
typeVariant.mechanisms.typography_system={id:'editorial',version:'c25-v1'};
delete typeVariant.creative_plan_id;
typeVariant.creative_plan_id=id('fwcp0',typeVariant);
assert(typeVariant.creative_plan_id!==sample.creative_plan_id,'typography change did not change creative identity');
const generic=compileScene(sample,'generic');
const tiktok=compileScene(sample,'tiktok');
assert(generic.creative_plan_id===tiktok.creative_plan_id,'platform changed creative identity');
assert(generic.compiled_scene_id!==tiktok.compiled_scene_id,'platform did not change scene identity');
const runtimeVariant=compileScene(sample,'generic',{...RUNTIME,encoder:'webcodecs-3m'});
assert(runtimeVariant.creative_plan_id===generic.creative_plan_id,'runtime changed creative identity');
assert(runtimeVariant.compiled_scene_id!==generic.compiled_scene_id,'runtime did not change scene identity');
assert(!('duration_ms' in generic.delivery),'duration leaked into delivery profile');

const audioBlocked=sceneRows.filter(x=>x.audio.status==='blocked');
assert(audioBlocked.length===12,`expected 12 blocked 15s audio realizations, got ${audioBlocked.length}`);

const report={
  schema:'framewright-i05-compiler-ownership-scout-v0',
  policy_version:policy.version,
  counts:{wrappers:wrappers.length,naive_wrapper_hashes:naiveWrapperHashes.size,canonical_content_hashes:canonicalPayloadHashes.size,creative_plans:creativeIds.size,compiled_scenes:sceneIds.size,audio_blocked:audioBlocked.length},
  invariants:{
    platform_stable_creative_identity:true,
    platform_changes_scene_identity:true,
    runtime_changes_scene_not_creative:true,
    creative_mechanism_changes_creative:true,
    delivery_has_no_duration:true,
    content_hash_strips_selectors:true,
    short_duration_ms:shortRows[0].timeline.duration_ms,
    long_duration_ms:longRows[0].timeline.duration_ms,
    short_frames:shortRows[0].timeline.frames,
    long_frames:longRows[0].timeline.frames,
  },
  selector_keys:SELECTOR_KEYS,
  sample_selector_leakage:selectorLeakage(wrappers[0]),
  creative_plans:creativeRows,
  compiled_scenes:sceneRows,
};
fs.mkdirSync(path.dirname(path.resolve(outPath)),{recursive:true});
fs.writeFileSync(outPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.counts,null,2));
