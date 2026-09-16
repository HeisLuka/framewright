#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  C37_DESIGN_SCHEMA,
  buildC29FactorSpace,
  c29NestedMainEffectsRow,
  withinAngleHookRevealRow,
  matrixRank,
  maxRankForRunCount,
  findBestExactRunDesign,
  buildC37ScreeningDesign
} from './c37-doe-identifiability.mjs';

const outDir=path.resolve(process.argv[2]||'artifacts/c37');
fs.mkdirSync(outDir,{recursive:true});
const stable=value=>JSON.stringify(value,Object.keys(value||{}).sort());
const ids=rows=>rows.map(x=>x.id);
const countBy=(rows,key)=>rows.reduce((m,row)=>(m.set(row[key],(m.get(row[key])||0)+1),m),new Map());

const space=buildC29FactorSpace();
if(space.length!==18)throw new Error(`expected C29 18-cell space, got ${space.length}`);
if(new Set(space.map(x=>x.id)).size!==18)throw new Error('C29 factor-space IDs are not unique');
const globalRank=matrixRank(space.map(c29NestedMainEffectsRow));
if(globalRank!==8)throw new Error(`full C29 nested main-effects model rank should be 8, got ${globalRank}`);

const lowBudget=[3,4,5].map(run_count=>maxRankForRunCount({candidates:space,row_fn:c29NestedMainEffectsRow,run_count}));
for(const row of lowBudget){
  if(row.max_rank>row.run_count)throw new Error(`impossible rank result for ${row.run_count} runs`);
  if(row.identifiable)throw new Error(`${row.run_count}-run design unexpectedly identifies 8-parameter model`);
}

const design=buildC37ScreeningDesign();
if(design.schema!==C37_DESIGN_SCHEMA)throw new Error('wrong C37 design schema');
const global=design.global_main_effects.design;
if(global.candidates.length!==8||global.rank!==8||global.abs_design_determinant<=0||global.information_determinant<=0)throw new Error('global 8-run design is not full-rank');
const rerun=findBestExactRunDesign({candidates:[...space].reverse(),row_fn:c29NestedMainEffectsRow,run_count:8,balance_mode:'c29_nested'});
if(JSON.stringify(global)!==JSON.stringify(rerun))throw new Error('C37 global design changed under candidate-order reversal');

const globalAngles=countBy(global.candidates,'angle'),globalReveals=countBy(global.candidates,'reveal');
const concepts=new Set(global.candidates.map(x=>x.concept_id));
if(globalAngles.size!==3||globalReveals.size!==3)throw new Error('global design dropped an angle or reveal level');
if(concepts.size!==6)throw new Error(`global design must cover all six angle/hook concepts, got ${concepts.size}`);
for(const angle of ['premise','conflict','identity']){
  const hooks=new Set(global.candidates.filter(x=>x.angle===angle).map(x=>x.hook_index));
  if(hooks.size!==2)throw new Error(`global design cannot estimate nested hook effect for ${angle}`);
}

const local=design.staged_budget_option.design;
if(local.candidates.length!==4||local.rank!==4||local.abs_design_determinant<=0)throw new Error('within-angle 4-run design is not full-rank');
if(local.candidates.some(x=>x.angle!=='premise'))throw new Error('local design escaped fixed angle');
if(new Set(local.candidates.map(x=>x.hook_index)).size!==2||new Set(local.candidates.map(x=>x.reveal)).size!==3)throw new Error('local 4-run design lacks hook/reveal coverage');
const localSpace=space.filter(x=>x.angle==='premise');
const localRerun=findBestExactRunDesign({candidates:[...localSpace].reverse(),row_fn:withinAngleHookRevealRow,run_count:4,balance_mode:'within_angle'});
if(JSON.stringify(local)!==JSON.stringify(localRerun))throw new Error('local design changed under candidate-order reversal');

const gates={
  c29_space_is_18:space.length===18,
  honest_nested_main_effects_rank_is_8:globalRank===8,
  three_runs_underidentified:lowBudget[0].max_rank<=3&&!lowBudget[0].identifiable,
  four_runs_underidentified_globally:lowBudget[1].max_rank<=4&&!lowBudget[1].identifiable,
  five_runs_underidentified:lowBudget[2].max_rank<=5&&!lowBudget[2].identifiable,
  eight_run_global_design_full_rank:global.rank===8,
  eight_run_design_covers_all_six_nested_hook_concepts:concepts.size===6,
  eight_run_design_covers_all_angle_and_reveal_levels:globalAngles.size===3&&globalReveals.size===3,
  global_design_order_invariant:JSON.stringify(global)===JSON.stringify(rerun),
  four_run_within_angle_design_full_rank:local.rank===4,
  local_design_order_invariant:JSON.stringify(local)===JSON.stringify(localRerun),
  no_interaction_claim:design.interaction_boundary.includes('does not identify'),
  no_randomized_viewer_claim:design.publication_boundary.includes('does not claim randomized viewer exposure')
};
if(!Object.values(gates).every(Boolean))throw new Error(`C37 gate failed: ${JSON.stringify(gates)}`);

const report={
  schema:'framewright-c37-doe-identifiability-audit-v1',
  boundary:'design-matrix identifiability only; no campaign outcomes, CTR/CPA effects, or causal claims',
  correction:'C29 hook candidates are nested within angle mechanisms; treating h1/h2 as one common crossed factor would undercount model degrees of freedom',
  gates,
  global_model:{
    formula:'angle + hook(angle) + reveal',
    parameter_count:8,
    full_space_rank:globalRank,
    strict_3_to_5:maxRankSummary(lowBudget),
    selected_ids:ids(global.candidates),
    selected_matrix:global.candidates.map(c29NestedMainEffectsRow),
    abs_design_determinant:global.abs_design_determinant,
    information_determinant:global.information_determinant,
    balance_penalty:global.balance_penalty,
    examined_subsets:global.examined,
    full_rank_subsets:global.full_rank_subsets
  },
  staged_option:{
    formula:'hook + reveal | fixed angle=premise',
    parameter_count:4,
    selected_ids:ids(local.candidates),
    selected_matrix:local.candidates.map(withinAngleHookRevealRow),
    abs_design_determinant:local.abs_design_determinant,
    information_determinant:local.information_determinant,
    balance_penalty:local.balance_penalty
  },
  decision:{
    original_3_to_5_global_claim:'REJECTED_AS_UNDERIDENTIFIED',
    global_main_effects_minimum_unique_creatives:8,
    strict_3_to_5_salvage:'hold angle fixed and test hook + reveal in a 4-run local screen, or reduce model degrees of freedom explicitly',
    interaction_policy:'not estimated by the 8-run screen',
    live_execution_requirement:'assign selected creatives to explicit blocked publication opportunities; platform viewer exposure remains uncontrolled'
  }
};
function maxRankSummary(rows){return rows.map(x=>({runs:x.run_count,max_rank:x.max_rank,required_rank:x.model_columns,identifiable:x.identifiable}));}
fs.writeFileSync(path.join(outDir,'report.json'),JSON.stringify(report,null,2)+'\n');
fs.writeFileSync(path.join(outDir,'design.json'),JSON.stringify(design,null,2)+'\n');
const summary=`# C37 DOE identifiability scout\n\n`+
`C29 candidate space: **18** (`3 angle × 2 nested hooks × 3 reveal timings`). Honest global main-effects model: **8 parameters** (`angle + hook(angle) + reveal`).\n\n`+
`Result: **3–5 unique creatives cannot identify all C29 main effects.** The exact search found a deterministic full-rank **8-run** global screening design. A strict small-budget alternative exists only after narrowing scope: with angle fixed, **4 runs** can identify hook + reveal main effects.\n\n`+
`Selected global design: ${ids(global.candidates).map(x=>'`'+x+'`').join(', ')}.\n\n`+
`Boundary: this is design-matrix evidence only. The 8-run design does not estimate interactions and does not claim randomized viewer exposure, CTR/CPA lift, or causal effects. Live organic execution must use explicit blocked publication opportunities and real platform exports.\n`;
fs.writeFileSync(path.join(outDir,'summary.md'),summary);
console.log(summary);
console.log(JSON.stringify({gates,global_selected:ids(global.candidates),global_abs_det:global.abs_design_determinant,local_selected:ids(local.candidates),low_budget:maxRankSummary(lowBudget)},null,2));
