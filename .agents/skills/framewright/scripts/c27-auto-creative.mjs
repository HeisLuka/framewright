#!/usr/bin/env node
import crypto from 'node:crypto';
import {splitSentences,resolveCopySource,stableStringify} from './c27-narrative-plan.mjs';
import {makeBookEvidence,buildCreativePortfolio,compilePortfolioPlans} from './c27-creative-portfolio.mjs';

export const C27_SOURCE_PACK_SCHEMA='framewright-c27-creative-source-pack-v1';
export const C27_SOURCE_KINDS=['publisher_synopsis','publisher_description','book_excerpt','editorial_verified','author_notes'];
const ANGLE_PRIORITY=['premise','conflict','question','identity','emotion','world','character','thesis','quote','recommendation_context'];

function sha256(text){return crypto.createHash('sha256').update(text).digest('hex');}
function requiredString(value,label){if(typeof value!=='string'||!value.trim())throw new Error(`${label} is required`);return value;}
function normalizeText(text){return String(text||'').toLowerCase().replace(/\s+/g,' ').trim();}
function clampArray(xs,n){return xs.slice(0,Math.max(0,n));}

export function assertCreativeSourcePack(pack,book){
  if(!pack||typeof pack!=='object')throw new Error('creative source pack is required');
  if(pack.schema!==C27_SOURCE_PACK_SCHEMA)throw new Error('wrong CreativeSourcePack schema');
  const bookId=String(book?.book_id||book?.id||'');
  if(!bookId)throw new Error('book.book_id or book.id is required');
  if(String(pack.book_id)!==bookId)throw new Error('CreativeSourcePack book_id mismatch');
  if(!Array.isArray(pack.blocks)||!pack.blocks.length)throw new Error('CreativeSourcePack blocks are required');
  const ids=new Set();
  for(const block of pack.blocks){
    requiredString(block?.id,'source block id');
    if(ids.has(block.id))throw new Error(`duplicate source block id: ${block.id}`);
    ids.add(block.id);
    if(!C27_SOURCE_KINDS.includes(block.kind))throw new Error(`unsupported source block kind: ${block.kind}`);
    requiredString(block.text,`source block ${block.id} text`);
    requiredString(block.verification_id,`source block ${block.id} verification_id`);
    const spoiler=Number(block.spoiler_level);
    if(!Number.isInteger(spoiler)||spoiler<0||spoiler>3)throw new Error(`source block ${block.id} spoiler_level must be integer 0..3`);
  }
  return true;
}

export function makeCreativeSourcePack({book,blocks}){
  const pack={schema:C27_SOURCE_PACK_SCHEMA,book_id:String(book?.book_id||book?.id||''),blocks:structuredClone(blocks||[])};
  assertCreativeSourcePack(pack,book);
  pack.source_pack_id=`c27s_${sha256(stableStringify(pack))}`;
  return pack;
}

function containsAny(text,parts){
  const s=normalizeText(text);
  return parts.some(x=>s.includes(x));
}

export function classifyEvidenceKind(text,sourceKind='publisher_synopsis'){
  const s=normalizeText(text);
  if(/[?？]$/.test(s)||containsAny(s,['what if','what happens','why ','how ','что если','почему ','как ']))return 'question';
  if(containsAny(s,[' but ',' must ',' before ',' unless ',' against ',' until ',' without ',' never ',' forbidden',' warning',' danger',' threat',' survive',' escape',' secret',' no record','но ','должен','должна','должны','прежде чем','пока не','без ','никогда','запрещ','предупреж','опас','угроз','выж','сбеж','тайн']))return 'conflict';
  if(containsAny(s,[' love',' fear',' grief',' guilt',' hope',' lonely',' anger',' regret','люб','страх','горе','вина','надежд','одиноч','злост','сожал']))return 'emotion';
  if(containsAny(s,[' identity',' his name',' her name',' their name',' himself',' herself',' who he is',' who she is',' become ',' memory',' remember','имя ','себя','кто он','кто она','станов','памят','помн']))return 'identity';
  if(containsAny(s,[' world',' city',' kingdom',' empire',' planet',' district',' village',' school',' station',' colony','мир','город','королев','импер','планет','район','деревн','школ','станц','колони']))return 'world';
  if(containsAny(s,[' detective',' doctor',' teacher',' mother',' father',' writer',' soldier',' scientist','детектив','врач','учител','мать','отец','писател','солдат','учен']))return 'character';
  if(sourceKind==='editorial_verified'||sourceKind==='author_notes')return 'thesis';
  return 'premise';
}

function leaksBookIdentity(text,book){
  const s=normalizeText(text);
  const identities=[book?.title,book?.author].map(normalizeText).filter(x=>x.length>=3);
  return identities.some(x=>s.includes(x));
}

function sourceBlockSentence(block,text,index){
  return {
    kind:'human_verified',
    text,
    verification_id:block.verification_id,
    source_pack_block_id:block.id,
    source_kind:block.kind,
    sentence_index:index,
    source_sha256:sha256(text)
  };
}

function roleTagsFor({text,spoilerLevel,book}){
  if(leaksBookIdentity(text,book))return [];
  const tags=['tension'];
  if(spoilerLevel<=1&&text.length<=240)tags.unshift('hook');
  return tags;
}

export function extractBookEvidence({book,source_pack,include_payload_hook=true,max_sentences_per_block=12}){
  assertCreativeSourcePack(source_pack,book);
  if(!Number.isInteger(max_sentences_per_block)||max_sentences_per_block<1)throw new Error('max_sentences_per_block must be a positive integer');
  const items=[];
  const seenText=new Set();
  const add=({id,kind,source,spoiler_level,role_tags})=>{
    const text=resolveCopySource(source,book),key=normalizeText(text);
    if(!key||seenText.has(key))return false;
    seenText.add(key);
    items.push({id,kind,source,spoiler_level,role_tags});
    return true;
  };

  if(include_payload_hook&&String(book?.hook||'').trim()){
    const sentences=splitSentences(book.hook);
    sentences.forEach((text,index)=>add({
      id:`payload-hook-s${index}`,
      kind:classifyEvidenceKind(text,'publisher_description'),
      source:{kind:'book_payload_field',field:'hook',selector:{kind:'sentence',index}},
      spoiler_level:0,
      role_tags:roleTagsFor({text,spoilerLevel:0,book})
    }));
  }

  for(const block of source_pack.blocks){
    const sentences=clampArray(splitSentences(block.text),max_sentences_per_block);
    for(let index=0;index<sentences.length;index++){
      const text=sentences[index];
      add({
        id:`${block.id}-s${index}`,
        kind:classifyEvidenceKind(text,block.kind),
        source:sourceBlockSentence(block,text,index),
        spoiler_level:block.spoiler_level,
        role_tags:roleTagsFor({text,spoilerLevel:block.spoiler_level,book})
      });
    }
  }

  if(!items.length)throw new Error('no distinct evidence sentences extracted');
  return makeBookEvidence({book,items});
}

function evidenceText(item,book){return resolveCopySource(item.source,book);}
function angleTypeForEvidence(item){return ANGLE_PRIORITY.includes(item.kind)?item.kind:'premise';}

function chooseTension({hookItem,allItems,book,maxSpoilerLevel}){
  const pool=allItems.filter(item=>
    item.id!==hookItem.id&&
    item.spoiler_level<=maxSpoilerLevel&&
    item.role_tags?.includes('tension')&&
    normalizeText(evidenceText(item,book))!==normalizeText(evidenceText(hookItem,book))
  );
  if(!pool.length)return null;
  const preferred=hookItem.kind==='conflict'
    ? ['premise','question','identity','emotion','world','character','thesis','conflict']
    : ['conflict','premise','question','identity','emotion','world','character','thesis'];
  return pool.slice().sort((a,b)=>{
    const ai=preferred.indexOf(a.kind),bi=preferred.indexOf(b.kind);
    const ap=ai<0?99:ai,bp=bi<0?99:bi;
    return ap-bp||a.spoiler_level-b.spoiler_level||a.id.localeCompare(b.id);
  })[0];
}

export function buildAutoAngles({book,evidence,max_spoiler_level=1,max_angle_types=6,max_hooks_per_angle=2}){
  if(!Number.isInteger(max_spoiler_level)||max_spoiler_level<0||max_spoiler_level>3)throw new Error('max_spoiler_level must be integer 0..3');
  if(!Number.isInteger(max_angle_types)||max_angle_types<1)throw new Error('max_angle_types must be a positive integer');
  if(!Number.isInteger(max_hooks_per_angle)||max_hooks_per_angle<1)throw new Error('max_hooks_per_angle must be a positive integer');
  const hookItems=evidence.items.filter(item=>item.spoiler_level<=max_spoiler_level&&item.role_tags?.includes('hook'));
  if(!hookItems.length)throw new Error('no hook-safe evidence available for automatic angles');

  const groups=new Map();
  for(const item of hookItems){
    const type=angleTypeForEvidence(item);
    if(!groups.has(type))groups.set(type,[]);
    groups.get(type).push(item);
  }
  const orderedTypes=[...ANGLE_PRIORITY.filter(x=>groups.has(x)),...Array.from(groups.keys()).filter(x=>!ANGLE_PRIORITY.includes(x)).sort()];
  const angles=[];
  for(const type of orderedTypes.slice(0,max_angle_types)){
    const variants=[];
    const candidates=groups.get(type).slice().sort((a,b)=>a.spoiler_level-b.spoiler_level||a.id.localeCompare(b.id));
    for(const hookItem of candidates.slice(0,max_hooks_per_angle)){
      const tension=chooseTension({hookItem,allItems:evidence.items,book,maxSpoilerLevel:max_spoiler_level});
      variants.push({
        id:`${type}-${hookItem.id}`,
        hook_evidence_id:hookItem.id,
        ...(tension?{tension_evidence_id:tension.id}:{})
      });
    }
    if(variants.length)angles.push({id:`auto-${type}`,type,label:`Auto ${type}`,source:{kind:'deterministic_evidence_classifier'},variants});
  }
  return angles;
}

export function buildAutoCreativeInputs({book,source_pack,include_payload_hook=true,max_spoiler_level=1,max_angle_types=6,max_hooks_per_angle=2,max_sentences_per_block=12}){
  const evidence=extractBookEvidence({book,source_pack,include_payload_hook,max_sentences_per_block});
  const angles=buildAutoAngles({book,evidence,max_spoiler_level,max_angle_types,max_hooks_per_angle});
  const portfolio=buildCreativePortfolio({book,evidence,angles});
  return {source_pack,evidence,angles,portfolio};
}

export function compileAutoCreativePlans(input){
  const built=buildAutoCreativeInputs(input);
  const compiled=compilePortfolioPlans({
    book:input.book,
    evidence:built.evidence,
    angles:built.angles,
    duration_seconds:input.duration_seconds,
    reveal_timing:input.reveal_timing,
    cta_treatment:input.cta_treatment,
    fps:input.fps,
    seed:input.seed,
    max_spoiler_level:input.max_spoiler_level??1
  });
  return {...built,plans:compiled.plans};
}
