#!/usr/bin/env node
import crypto from 'node:crypto';
import {
  C27_ANGLE_TYPES,
  C27_CTA_TREATMENTS,
  C27_DURATION_PROFILES,
  C27_REVEAL_TIMINGS,
  planNarrative,
  resolveCopySource,
  stableStringify
} from './c27-narrative-plan.mjs';

export const C27_EVIDENCE_SCHEMA='framewright-c27-book-evidence-v1';
export const C27_PORTFOLIO_SCHEMA='framewright-c27-creative-portfolio-v1';
export const C27_EVIDENCE_KINDS=['premise','conflict','character','world','identity','emotion','thesis','question','quote','recommendation_context','payoff'];

function sha256(text){return crypto.createHash('sha256').update(text).digest('hex');}
function requiredString(value,label){if(typeof value!=='string'||!value.trim())throw new Error(`${label} is required`);return value;}
function unique(values){return [...new Set(values)];}

export function assertBookEvidence(evidence,book){
  if(!evidence||typeof evidence!=='object')throw new Error('book evidence is required');
  if(evidence.schema!==C27_EVIDENCE_SCHEMA)throw new Error('wrong BookEvidence schema');
  const expectedBookId=String(book?.book_id||book?.id||'');
  if(!expectedBookId)throw new Error('book.book_id or book.id is required');
  if(String(evidence.book_id)!==expectedBookId)throw new Error('BookEvidence book_id mismatch');
  if(!Array.isArray(evidence.items)||!evidence.items.length)throw new Error('BookEvidence items are required');
  const ids=new Set();
  for(const item of evidence.items){
    requiredString(item?.id,'evidence item id');
    if(ids.has(item.id))throw new Error(`duplicate evidence id: ${item.id}`);
    ids.add(item.id);
    if(!C27_EVIDENCE_KINDS.includes(item.kind))throw new Error(`unsupported evidence kind: ${item.kind}`);
    if(!item.source)throw new Error(`evidence ${item.id} missing source`);
    resolveCopySource(item.source,book);
    const spoiler=Number(item.spoiler_level??0);
    if(!Number.isInteger(spoiler)||spoiler<0||spoiler>3)throw new Error(`evidence ${item.id} spoiler_level must be integer 0..3`);
    if(item.role_tags!==undefined){
      if(!Array.isArray(item.role_tags)||item.role_tags.some(x=>typeof x!=='string'||!x))throw new Error(`evidence ${item.id} role_tags must be string[]`);
    }
  }
  return true;
}

export function makeBookEvidence({book,items}){
  const evidence={schema:C27_EVIDENCE_SCHEMA,book_id:String(book?.book_id||book?.id||''),items:structuredClone(items||[])};
  assertBookEvidence(evidence,book);
  return evidence;
}

function evidenceMap(evidence){return new Map(evidence.items.map(item=>[item.id,item]));}
function sourceFor(map,id,label){
  requiredString(id,label);
  const item=map.get(id);
  if(!item)throw new Error(`${label} references unknown evidence: ${id}`);
  return item.source;
}

function normalizeMatrix(values,allowed,label,fallback){
  const xs=values===undefined?fallback:(Array.isArray(values)?values:[values]);
  if(!xs.length)throw new Error(`${label} must not be empty`);
  for(const value of xs)if(!allowed.includes(value))throw new Error(`unsupported ${label}: ${value}`);
  return unique(xs);
}

export function buildCreativePortfolio({book,evidence,angles}){
  assertBookEvidence(evidence,book);
  if(!Array.isArray(angles)||!angles.length)throw new Error('angles are required');
  const map=evidenceMap(evidence),concepts=[];
  const conceptIds=new Set();
  for(const angle of angles){
    requiredString(angle?.id,'angle.id');
    if(!C27_ANGLE_TYPES.includes(angle.type))throw new Error(`unsupported angle type: ${angle.type}`);
    if(!Array.isArray(angle.variants)||!angle.variants.length)throw new Error(`angle ${angle.id} variants are required`);
    for(const variant of angle.variants){
      requiredString(variant?.id,`angle ${angle.id} variant.id`);
      const conceptId=`${angle.id}:${variant.id}`;
      if(conceptIds.has(conceptId))throw new Error(`duplicate creative concept id: ${conceptId}`);
      conceptIds.add(conceptId);
      const evidenceIds=[variant.hook_evidence_id,variant.tension_evidence_id,variant.payoff_evidence_id].filter(Boolean);
      if(new Set(evidenceIds).size!==evidenceIds.length)throw new Error(`creative concept ${conceptId} reuses evidence across semantic roles`);
      const hook=sourceFor(map,variant.hook_evidence_id,`${conceptId} hook_evidence_id`);
      const tension=variant.tension_evidence_id?sourceFor(map,variant.tension_evidence_id,`${conceptId} tension_evidence_id`):null;
      const payoff=variant.payoff_evidence_id?sourceFor(map,variant.payoff_evidence_id,`${conceptId} payoff_evidence_id`):null;
      concepts.push({
        concept_id:conceptId,
        angle_id:angle.id,
        angle_type:angle.type,
        angle_label:angle.label||angle.id,
        hook_candidate_id:variant.id,
        evidence_ids:evidenceIds,
        spoiler_level:Math.max(...evidenceIds.map(id=>Number(map.get(id).spoiler_level??0)),0),
        planner_angle:{
          id:conceptId,
          type:angle.type,
          label:angle.label||angle.id,
          source:{kind:'book_evidence',evidence_ids:evidenceIds,hook_candidate_id:variant.id},
          hook,
          ...(tension?{tension}:{}),
          ...(payoff?{payoff}:{})
        }
      });
    }
  }
  const portfolio={
    schema:C27_PORTFOLIO_SCHEMA,
    book_id:String(book.book_id||book.id),
    evidence_schema:evidence.schema,
    concepts
  };
  portfolio.portfolio_id=`c27p_${sha256(stableStringify(portfolio))}`;
  return portfolio;
}

export function compilePortfolioPlans({
  book,evidence,angles,
  duration_seconds=[9],reveal_timing=['mid'],cta_treatment=['soft_reveal'],fps=30,seed=0,
  max_spoiler_level=3
}){
  const portfolio=buildCreativePortfolio({book,evidence,angles});
  const durations=normalizeMatrix(duration_seconds,C27_DURATION_PROFILES,'duration_seconds',[9]);
  const reveals=normalizeMatrix(reveal_timing,C27_REVEAL_TIMINGS,'reveal_timing',['mid']);
  const ctas=normalizeMatrix(cta_treatment,C27_CTA_TREATMENTS,'cta_treatment',['soft_reveal']);
  if(!Number.isInteger(max_spoiler_level)||max_spoiler_level<0||max_spoiler_level>3)throw new Error('max_spoiler_level must be integer 0..3');
  const selected=portfolio.concepts.filter(x=>x.spoiler_level<=max_spoiler_level);
  const plans=[];
  for(const concept of selected){
    for(const seconds of durations){
      const allowedReveals=seconds===3?['mid']:reveals;
      const allowedCtas=seconds===3?['none']:seconds===5?ctas.filter(x=>['none','soft_reveal'].includes(x)):ctas;
      if(!allowedCtas.length)continue;
      for(const reveal of allowedReveals)for(const cta of allowedCtas){
        if(seconds>=7&&!concept.planner_angle.tension)continue;
        const plan=planNarrative({
          book,
          angle:concept.planner_angle,
          duration_seconds:seconds,
          fps,
          reveal_timing:reveal,
          cta_treatment:cta,
          seed
        });
        plans.push({
          concept_id:concept.concept_id,
          hook_candidate_id:concept.hook_candidate_id,
          evidence_ids:concept.evidence_ids,
          spoiler_level:concept.spoiler_level,
          narrative_plan:plan
        });
      }
    }
  }
  return {portfolio,plans};
}
