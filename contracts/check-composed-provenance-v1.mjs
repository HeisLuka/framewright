#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileComposedCreativeProposal as compileLegacyComposed } from './compositional-copy-v1.mjs';
import { compileComposedCreativeProposal } from './compile-composed-creative-proposal-v1.mjs';

const readJson=(relative)=>JSON.parse(readFileSync(new URL(relative,import.meta.url),'utf8'));
const pack=readJson('./examples/context-pack-v1.example.json');
const language=readJson('./examples/copy-language-v1.example.json');
const proposal=readJson('./examples/composed-creative-proposal-v1.example.json');

function semanticProjection(program){
  return {
    proposal_id:program.proposal_id,
    source_context:program.source_context,
    copy_language:program.copy_language,
    account_id:program.account_id,
    book_id:program.book_id,
    copy_programs:program.copy_programs,
    narrative_plan:{
      book_id:program.narrative_plan.book_id,
      angle:program.narrative_plan.angle,
      duration_seconds:program.narrative_plan.duration_seconds,
      fps:program.narrative_plan.fps,
      total_frames:program.narrative_plan.total_frames,
      reveal_timing:program.narrative_plan.reveal_timing,
      cta_treatment:program.narrative_plan.cta_treatment,
      seed:program.narrative_plan.seed,
      checkpoints:program.narrative_plan.checkpoints,
      roles:program.narrative_plan.roles.map(role=>({
        role:role.role,start_frame:role.start_frame,end_frame:role.end_frame,frames:role.frames,
        atoms:role.atoms.map(atom=>atom.text),
      })),
    },
    presentation:program.presentation,
    assets:program.assets,
  };
}

const legacy=compileLegacyComposed(pack,language,proposal);
const canonical=compileComposedCreativeProposal(pack,language,proposal);
assert.deepEqual(semanticProjection(canonical),semanticProjection(legacy),'provenance correction must not change materialized copy, timing, presentation, or assets');
assert.notEqual(canonical.narrative_plan.narrative_plan_id,legacy.narrative_plan.narrative_plan_id,'NarrativePlan identity must capture provenance correction');
assert.notEqual(canonical.c31_bridge.program_id,legacy.c31_bridge.program_id,'bridge program identity must capture provenance correction');
assert.notEqual(canonical.program_id,legacy.program_id,'composed program identity must capture provenance correction');

const sources=canonical.narrative_plan.roles.flatMap(role=>role.atoms.map(atom=>({role:role.role,text:atom.text,source:atom.source})));
const contextAtoms=sources.filter(x=>x.source?.kind==='context_atom');
const humanVerified=sources.filter(x=>x.source?.kind==='human_verified');
assert.equal(contextAtoms.length,3,'hook/tension/payoff derived composition must retain context_atom provenance');
assert.equal(humanVerified.length,0,'server-composed copy must not be mislabeled human_verified');
const byRole=new Map(canonical.copy_programs.map(x=>[x.role,x]));
for(const item of contextAtoms){
  const copyRole=item.role==='desire_payoff'?'payoff':item.role;
  const copyProgram=byRole.get(copyRole);
  assert.ok(copyProgram,`missing copy program for ${item.role}`);
  assert.equal(item.text,copyProgram.text);
  assert.deepEqual(item.source.source_fact_ids,copyProgram.source_fact_ids);
  assert.equal(item.source.context_pack_id,canonical.c31_bridge.context_pack_id);
  assert.equal(item.source.context_hash,canonical.c31_bridge.context_hash);
}

const replay=compileComposedCreativeProposal(structuredClone(pack),structuredClone(language),structuredClone(proposal));
assert.equal(replay.program_id,canonical.program_id);
assert.equal(replay.narrative_plan.narrative_plan_id,canonical.narrative_plan.narrative_plan_id);

console.log(JSON.stringify({
  status:'PASS',
  proposal_id:canonical.proposal_id,
  legacy_program_id:legacy.program_id,
  canonical_program_id:canonical.program_id,
  legacy_narrative_plan_id:legacy.narrative_plan.narrative_plan_id,
  canonical_narrative_plan_id:canonical.narrative_plan.narrative_plan_id,
  context_atom_sources:contextAtoms.length,
  human_verified_sources:humanVerified.length,
  semantic_projection_equal:true,
},null,2));
