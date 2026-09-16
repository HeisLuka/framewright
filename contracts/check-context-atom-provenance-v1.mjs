#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileCreativeProposal as compileLegacyCreativeProposal } from './creative-proposal-v1.mjs';
import { compileCreativeProposal } from './compile-creative-proposal-v1.mjs';
import { resolveCopySource } from '../.agents/skills/framewright/scripts/c27-narrative-plan.mjs';

const pack=JSON.parse(readFileSync(new URL('./examples/context-pack-v1.example.json',import.meta.url),'utf8'));
const proposal=JSON.parse(readFileSync(new URL('./examples/creative-proposal-v1.example.json',import.meta.url),'utf8'));
const legacy=compileLegacyCreativeProposal(pack,proposal);
const canonical=compileCreativeProposal(pack,proposal);

function semanticProjection(program){
  const plan=program.narrative_plan;
  return {
    book_id:plan.book_id,
    angle:{id:plan.angle.id,type:plan.angle.type,label:plan.angle.label,source:plan.angle.source},
    duration_seconds:plan.duration_seconds,
    fps:plan.fps,
    total_frames:plan.total_frames,
    reveal_timing:plan.reveal_timing,
    cta_treatment:plan.cta_treatment,
    seed:plan.seed,
    checkpoints:plan.checkpoints,
    roles:plan.roles.map(role=>({
      role:role.role,start_frame:role.start_frame,end_frame:role.end_frame,frames:role.frames,
      atoms:role.atoms.map(atom=>atom.text),
    })),
    presentation:program.presentation,
    assets:program.assets,
  };
}
assert.deepEqual(semanticProjection(canonical),semanticProjection(legacy),'provenance migration must not alter rendered text/timing/presentation/assets');
assert.notEqual(canonical.narrative_plan.narrative_plan_id,legacy.narrative_plan.narrative_plan_id,'provenance change must change NarrativePlan identity');
assert.notEqual(canonical.program_id,legacy.program_id,'provenance change must change accepted-program identity');

const book=pack.books.find(x=>x.book_id===proposal.book_id);
const selectedIds=[proposal.narrative.hook_atom_id,proposal.narrative.tension_atom_id,proposal.narrative.payoff_atom_id].filter(Boolean);
const expected=new Map(book.creative_atoms.filter(x=>selectedIds.includes(x.atom_id)).map(x=>[x.atom_id,x]));
const contextSources=canonical.narrative_plan.roles.flatMap(role=>role.atoms.map(atom=>atom.source)).filter(source=>source.kind==='context_atom');
assert.equal(contextSources.length,selectedIds.length,'every selected ContextPack atom must retain explicit context_atom provenance');
assert.equal(canonical.narrative_plan.roles.flatMap(role=>role.atoms).filter(atom=>atom.source.kind==='human_verified').length,0,'ContextPack atoms must not be mislabeled human_verified');
for(const source of contextSources){
  const atom=expected.get(source.atom_id);
  assert.ok(atom,`unexpected context atom ${source.atom_id}`);
  assert.equal(source.context_pack_id,pack.context_pack_id);
  assert.equal(source.context_hash,pack.context_hash);
  assert.equal(source.text,atom.text);
  assert.deepEqual(source.source_fact_ids,atom.source_fact_ids);
}

const replay=compileCreativeProposal(structuredClone(pack),structuredClone(proposal));
assert.equal(replay.narrative_plan.narrative_plan_id,canonical.narrative_plan.narrative_plan_id,'canonical context provenance must replay deterministically');
assert.equal(replay.program_id,canonical.program_id,'canonical accepted-program identity must replay deterministically');

assert.throws(()=>resolveCopySource({kind:'context_atom',text:'x',context_pack_id:'ctx',context_hash:'bad',atom_id:'a',source_fact_ids:['f']},{}),/context_hash/);
assert.throws(()=>resolveCopySource({kind:'context_atom',text:'x',context_pack_id:'ctx',context_hash:'a'.repeat(64),atom_id:'a',source_fact_ids:[]},{}),/source_fact_ids/);
assert.equal(resolveCopySource({kind:'context_atom',text:'Exact trusted atom',context_pack_id:'ctx',context_hash:'a'.repeat(64),atom_id:'a',source_fact_ids:['f1']},{}),'Exact trusted atom');

console.log(JSON.stringify({
  status:'PASS',
  selected_context_atoms:selectedIds.length,
  context_sources:contextSources.length,
  legacy_narrative_plan_id:legacy.narrative_plan.narrative_plan_id,
  canonical_narrative_plan_id:canonical.narrative_plan.narrative_plan_id,
  legacy_program_id:legacy.program_id,
  canonical_program_id:canonical.program_id,
  semantic_projection_equal:true,
},null,2));
