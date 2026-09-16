import {
  COMPOSED_PROGRAM_SCHEMA,
  ComposedCreativeProposalValidationError,
  computeComposedProgramId,
  validateComposedCreativeProposal,
} from './compositional-copy-v1.mjs';
import { compileCreativeProposal } from './compile-creative-proposal-v1.mjs';

export function compileComposedCreativeProposal(pack,language,proposal){
  const report=validateComposedCreativeProposal(pack,language,proposal);
  if(!report.valid)throw new ComposedCreativeProposalValidationError(report);

  const canonicalBridge=compileCreativeProposal(report.bridge.derived_pack,report.bridge.internal_proposal);
  const program={
    schema:COMPOSED_PROGRAM_SCHEMA,
    proposal_id:report.proposal_id,
    source_context:{
      context_pack_id:pack.context_pack_id,
      context_hash:pack.context_hash,
    },
    copy_language:{
      copy_language_id:language.copy_language_id,
      copy_language_hash:language.copy_language_hash,
    },
    account_id:proposal.account_id,
    book_id:proposal.book_id,
    copy_programs:report.copy_programs,
    c31_bridge:{
      context_pack_id:report.bridge.derived_pack.context_pack_id,
      context_hash:report.bridge.derived_pack.context_hash,
      proposal_id:report.bridge.internal_proposal.proposal_id,
      program_id:canonicalBridge.program_id,
    },
    narrative_plan:canonicalBridge.narrative_plan,
    presentation:canonicalBridge.presentation,
    assets:canonicalBridge.assets,
  };
  program.program_id=computeComposedProgramId(program);
  return program;
}
