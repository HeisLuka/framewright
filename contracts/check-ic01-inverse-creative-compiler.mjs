import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  VIDEO_OBSERVATION_SCHEMA,
  INVERSE_CREATIVE_HYPOTHESIS_SCHEMA,
  buildInverseVocabulary,
  inferCreativeHypothesis,
  materializeVideoObservation,
  scoreInverseHypothesis,
  validateVideoObservation,
} from './inverse-creative-compiler-v1.mjs';

function grid(values){return values.map(row=>row.map(Number));}
function run(command,args,options={}){
  const result=spawnSync(command,args,{encoding:'utf8',maxBuffer:64*1024*1024,...options});
  if(result.error)throw result.error;
  assert.equal(result.status,0,`${command} failed: ${String(result.stderr||'').trim()}`);
  return result;
}

const observation=materializeVideoObservation({
  source:{width:1080,height:1920,fps:30,duration_seconds:9,frame_count:270,codec_name:'h264',pix_fmt:'yuv420p'},
  sampling:{sample_fps:6,sampled_frames:54,analysis_width:64,analysis_height:64},
  cut_candidates:[],
  motion:{
    mean_abs_diff:0.05,p95_abs_diff:0.10,burstiness:0.25,
    directional_bias:{horizontal:0.95,vertical:0.05},
    feature_centroid_delta:{dx:4.2,dy:0.1,mean_abs_dx:7.8,mean_abs_dy:0.4},
    activity_grid:grid([[0.03,0.05,0.05,0.03],[0.04,0.12,0.13,0.05],[0.04,0.12,0.13,0.05],[0.03,0.04,0.04,0.03]]),
  },
  appearance:{
    edge_grid:grid([[0.04,0.05,0.05,0.04],[0.05,0.16,0.16,0.05],[0.05,0.14,0.14,0.05],[0.02,0.025,0.025,0.02]]),
    mean_edge_energy:0.1,luma:{mean:0.52,stddev:0.16},dominant_colors:[{hex:'#101010',fraction:0.45}],
  },
});
assert.equal(observation.schema,VIDEO_OBSERVATION_SCHEMA);
assert.match(observation.observation_id,/^nbobs1_[a-f0-9]{64}$/);
assert.equal(validateVideoObservation(observation).valid,true);
const replay=materializeVideoObservation({...observation,observation_id:undefined});
assert.equal(replay.observation_id,observation.observation_id,'observation identity must replay');

const vocabulary=buildInverseVocabulary();
assert.equal(vocabulary.structural_layout.length,6);
assert.equal(vocabulary.motion_grammar.length,6);
assert.equal(vocabulary.graphic_devices.length,9);
const hypothesis=inferCreativeHypothesis(observation);
assert.equal(hypothesis.schema,INVERSE_CREATIVE_HYPOTHESIS_SCHEMA);
assert.equal(hypothesis.delivery.aspect,'vertical');
assert.equal(hypothesis.axes.motion_grammar[0].id,'motion_directional_slide_v2');
assert.ok(hypothesis.explainability.unresolved_axes.includes('typography'),'v1 must preserve typography ambiguity');
assert.ok(hypothesis.explainability.unresolved_axes.includes('graphic_devices'),'v1 must preserve device ambiguity');
assert.deepEqual(inferCreativeHypothesis(observation),hypothesis,'inference must replay byte-for-byte');

const sceneProgram={
  scene_program_id:'nbscenev1_fixture',delivery:{aspect:'vertical'},visual_system:'swiss',
  resolved_layout:{family_id:'layout_centered_cinematic_v2'},
  typography_fits:[{system_id:'type_display_led_v2'}],
  motion_recipe:{family_id:'motion_directional_slide_v2'},
  cover_staging:{family_id:'stage_hero_cover_v2'},
  graphic_devices:[{device_id:'device_rule_pair_v2'}],
};
const benchmark=scoreInverseHypothesis({hypothesis,scene_program:sceneProgram});
assert.equal(benchmark.delivery_aspect_match,true);
assert.equal(benchmark.axes.motion_grammar.top1,true);
assert.equal(benchmark.comparable_axes,6);
const bad=structuredClone(observation);bad.motion.directional_bias.horizontal=2;
assert.equal(validateVideoObservation(bad).valid,false);

const ffmpeg=spawnSync('ffmpeg',['-version'],{encoding:'utf8'});
const ffprobe=spawnSync('ffprobe',['-version'],{encoding:'utf8'});
assert.equal(ffmpeg.status,0,'ffmpeg is required for IC01 observer acceptance');
assert.equal(ffprobe.status,0,'ffprobe is required for IC01 observer acceptance');
const root=fileURLToPath(new URL('../',import.meta.url));
const work=mkdtempSync(join(tmpdir(),'ic01-'));
const video=join(work,'synthetic.mp4');
const observedJson=join(work,'observation.json');
run('ffmpeg',[
  '-v','error','-y',
  '-f','lavfi','-i','color=c=white:s=360x640:r=30:d=1',
  '-f','lavfi','-i','testsrc2=s=360x640:r=30:d=1',
  '-f','lavfi','-i','color=c=black:s=360x640:r=30:d=1',
  '-filter_complex','[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]',
  '-map','[v]','-c:v','libx264','-pix_fmt','yuv420p',video,
]);
const observer=join(root,'.agents','skills','framewright','scripts','ic01-observe-video.mjs');
run(process.execPath,[observer,video,'--out',observedJson,'--sample-fps','6']);
const physicalObservation=JSON.parse(readFileSync(observedJson,'utf8'));
assert.equal(validateVideoObservation(physicalObservation).valid,true);
assert.equal(physicalObservation.source.width,360);
assert.equal(physicalObservation.source.height,640);
assert.equal(physicalObservation.source.frame_count,90);
assert.equal(physicalObservation.cut_candidates.length,2,'synthetic hard cuts must be observed');
assert.ok(Math.abs(physicalObservation.cut_candidates[0].time_seconds-1)<=0.18,'first cut should resolve near 1s');
assert.ok(Math.abs(physicalObservation.cut_candidates[1].time_seconds-2)<=0.18,'second cut should resolve near 2s');
assert.ok(physicalObservation.appearance.dominant_colors.length>=2,'palette extraction should emit dominant colors');
const physicalHypothesis=inferCreativeHypothesis(physicalObservation);
assert.equal(physicalHypothesis.delivery.aspect,'vertical');
assert.equal(physicalHypothesis.axes.structural_layout.length,6);
assert.equal(physicalHypothesis.axes.motion_grammar.length,6);

console.log(JSON.stringify({
  ok:true,
  synthetic_observation_id:observation.observation_id,
  synthetic_hypothesis_id:hypothesis.hypothesis_id,
  physical_observation_id:physicalObservation.observation_id,
  physical_cut_times:physicalObservation.cut_candidates.map(item=>item.time_seconds),
  physical_top_motion:physicalHypothesis.axes.motion_grammar[0],
  unresolved_axes:physicalHypothesis.explainability.unresolved_axes,
},null,2));
