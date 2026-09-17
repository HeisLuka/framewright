import assert from 'node:assert/strict';
import {
  OBSERVATION_IR_SCHEMA,
  canonicalizeObservationIR,
  decompileObservation,
  inferMotionGrammarCandidates,
  validateObservationIR,
} from './inverse-creative-compiler-v1.mjs';

function fixture(overrides={}){
  return canonicalizeObservationIR({
    schema:OBSERVATION_IR_SCHEMA,
    source_sha256:'deadbeef',
    media:{width:1080,height:1920,fps:30,duration_seconds:5},
    cut_times_seconds:[1.2,3.4],
    motion_energy:[
      {t:0.0,value:0.02},{t:0.5,value:0.11},{t:1.0,value:0.48},{t:1.5,value:0.82},
      {t:2.0,value:0.33},{t:2.5,value:0.17},{t:3.0,value:0.66},{t:3.5,value:0.94},
      {t:4.0,value:0.41},{t:4.5,value:0.09},
    ],
    coverage:{temporal:1,motion:0.9,layout:0,typography:0,appearance:0.3,assets:0},
    residuals:['layout:not_observed'],
    ...overrides,
  });
}

const observation=fixture();
assert.equal(validateObservationIR(observation).valid,true);
assert.match(observation.observation_id,/^nbobs1_/);

const second=fixture({cut_times_seconds:[3.4,1.2]});
assert.equal(second.observation_id,observation.observation_id,'canonicalization must sort temporal observations');

const candidates=inferMotionGrammarCandidates(observation,{limit:3});
assert.ok(candidates.length>0,'motion candidates required when motion evidence exists');
assert.ok(candidates.length<=3);
assert.ok(candidates.every(item=>item.axis==='motion_grammar'));
assert.ok(candidates.every(item=>item.confidence>=0&&item.confidence<=1));
for(let i=1;i<candidates.length;i++)assert.ok(candidates[i-1].confidence>=candidates[i].confidence,'candidates must be confidence ordered');

const result=decompileObservation(observation);
assert.equal(result.recovered.delivery.aspect,'vertical');
assert.deepEqual(result.recovered.temporal.cut_times_seconds,[1.2,3.4]);
assert.ok(result.unresolved.some(item=>item.axis==='structural_layout'));
assert.ok(result.unresolved.some(item=>item.axis==='typography'));
assert.match(result.result_id,/^nbinv1_/);

const noMotion=fixture({motion_energy:[],coverage:{temporal:1,motion:0,layout:0,typography:0,appearance:0,assets:0}});
assert.deepEqual(inferMotionGrammarCandidates(noMotion),[]);
const noMotionResult=decompileObservation(noMotion);
assert.ok(noMotionResult.unresolved.some(item=>item.axis==='motion_grammar'));

const square=fixture({media:{width:1080,height:1080,fps:30,duration_seconds:5}});
assert.equal(decompileObservation(square).recovered.delivery.aspect,'square');

console.log(JSON.stringify({ok:true,observation_id:observation.observation_id,top_motion_candidate:candidates[0]?.value||null,candidate_count:candidates.length},null,2));
