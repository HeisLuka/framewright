import {
  compileCreativeProposal as compileLegacyCreativeProposal,
  computeProgramId,
} from './creative-proposal-v1.mjs';
import {
  assertNarrativePlan,
  computeNarrativePlanId,
} from '../.agents/skills/framewright/scripts/c27-narrative-plan.mjs';

function atomIndex(pack){
  const out=new Map();
  for(const book of pack?.books||[])for(const atom of book?.creative_atoms||[])out.set(atom.atom_id,atom);
  return out;
}

function parseLegacyContextVerification(source,pack){
  if(source?.kind!=='human_verified'||typeof source.verification_id!=='string')return null;
  const prefix=`context:${pack.context_hash}:atom:`;
  if(!source.verification_id.startsWith(prefix))return null;
  const atomId=source.verification_id.slice(prefix.length);
  return atomId||null;
}

function contextAtomSource(pack,atom){
  return {
    kind:'context_atom',
    text:atom.text,
    context_pack_id:pack.context_pack_id,
    context_hash:pack.context_hash,
    atom_id:atom.atom_id,
    source_fact_ids:[...atom.source_fact_ids],
  };
}

export function compileCreativeProposal(pack,proposal){
  const program=compileLegacyCreativeProposal(pack,proposal);
  const atoms=atomIndex(pack);
  let converted=0;
  for(const role of program.narrative_plan.roles||[]){
    for(const renderedAtom of role.atoms||[]){
      const atomId=parseLegacyContextVerification(renderedAtom.source,pack);
      if(!atomId)continue;
      const atom=atoms.get(atomId);
      if(!atom)throw new Error(`compiled context atom ${atomId} is missing from ContextPack`);
      if(renderedAtom.text!==atom.text)throw new Error(`compiled context atom ${atomId} text drift`);
      renderedAtom.source=contextAtomSource(pack,atom);
      converted+=1;
    }
  }
  if(converted===0)throw new Error('accepted CreativeProposal compiled no ContextPack atoms');
  program.narrative_plan.narrative_plan_id=computeNarrativePlanId(program.narrative_plan);
  assertNarrativePlan(program.narrative_plan);
  program.program_id=computeProgramId(program);
  return program;
}
