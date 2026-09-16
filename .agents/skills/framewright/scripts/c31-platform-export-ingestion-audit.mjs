#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { canonicalizeEvidence, stableStringify } from './c30-campaign-learning.mjs';
import { C31_ADAPTER_SCHEMA, C31_JOIN_SCHEMA, C31_RECEIPT_SCHEMA, ingestPlatformExport } from './c31-platform-export-ingestion.mjs';

const outDir=path.resolve(process.argv[2]||'artifacts/c31');
fs.mkdirSync(outDir,{recursive:true});
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const mustThrow=(label,fn,needle)=>{
  let message='';
  try{fn();}catch(error){message=String(error?.message||error);}
  if(!message)throw new Error(`${label}: expected rejection`);
  if(needle&&!message.includes(needle))throw new Error(`${label}: wrong rejection: ${message}`);
  return message;
};

const raw='row_key,campaign,placement,video,start,end,views,hold3,completed,shares\nrow-b,camp-1,shorts-feed,video-b,2026-09-01T00:00:00Z,2026-09-08T00:00:00Z,800,360,160,24\nrow-a,camp-1,shorts-feed,video-a,2026-09-01T00:00:00Z,2026-09-08T00:00:00Z,1000,520,260,45\n';
const exportMeta={platform:'fixture-shorts',export_id:'export-2026w36',source_schema:'fixture-shorts-csv-v1',raw_sha256:sha(raw)};
const adapter={
  schema:C31_ADAPTER_SCHEMA,
  adapter_id:'fixture-shorts-counts',
  adapter_version:'1',
  platform:'fixture-shorts',
  source_schema:'fixture-shorts-csv-v1',
  fields:{row_key:'row_key',campaign_id:'campaign',placement_id:'placement',creative_key:'video',window_start:'start',window_end:'end'},
  metrics:{
    completion:{numerator_field:'completed',denominator_field:'views',denominator_kind:'views'},
    hold_3s:{numerator_field:'hold3',denominator_field:'views',denominator_kind:'views'},
    share:{numerator_field:'shares',denominator_field:'views',denominator_kind:'views'}
  }
};
const publicationJoin={
  schema:C31_JOIN_SCHEMA,
  platform:'fixture-shorts',
  bindings:[
    {campaign_id:'camp-1',placement_id:'shorts-feed',source_creative_key:'video-a',creative_id:'creative-a',render_spec_id:'render-a'},
    {campaign_id:'camp-1',placement_id:'shorts-feed',source_creative_key:'video-b',creative_id:'creative-b',render_spec_id:'render-b'}
  ]
};
const rows=[
  {row_key:'row-b',campaign:'camp-1',placement:'shorts-feed',video:'video-b',start:'2026-09-01T00:00:00Z',end:'2026-09-08T00:00:00Z',views:'800',hold3:'360',completed:'160',shares:'24',creative_id:'evil-direct-id'},
  {row_key:'row-a',campaign:'camp-1',placement:'shorts-feed',video:'video-a',start:'2026-09-01T00:00:00Z',end:'2026-09-08T00:00:00Z',views:'1000',hold3:'520',completed:'260',shares:'45',render_spec_id:'evil-direct-render'}
];
const args={raw_bytes:raw,export_meta:exportMeta,rows,adapter,publication_join:publicationJoin};
const first=ingestPlatformExport(args);
const reordered=ingestPlatformExport({...args,rows:[...rows].reverse()});
if(first.receipt.schema!==C31_RECEIPT_SCHEMA)throw new Error('wrong receipt schema');
if(stableStringify(first)!==stableStringify(reordered))throw new Error('parsed row order changed canonical ingestion output');
if(first.evidence.observations[0].creative_id!=='creative-a'||first.evidence.observations[0].render_spec_id!=='render-a')throw new Error('canonical identity did not come from publication join');
if(first.evidence.observations.some(x=>x.creative_id?.startsWith('evil')||x.render_spec_id?.startsWith('evil')))throw new Error('source export was allowed to inject canonical identity');
const portfolio={portfolio_id:'portfolio-c31-audit',candidates:[{creative_id:'creative-a',render_spec_id:'render-a'},{creative_id:'creative-b',render_spec_id:'render-b'}]};
canonicalizeEvidence({portfolio,evidence:first.evidence});

const rejected={};
rejected.raw_tamper=mustThrow('raw tamper',()=>ingestPlatformExport({...args,raw_bytes:raw+'tamper'}),'raw export sha256 mismatch');
rejected.unknown_binding=mustThrow('unknown binding',()=>ingestPlatformExport({...args,rows:[{...rows[0],video:'unknown'}]}),'unbound platform row');
rejected.duplicate_row=mustThrow('duplicate row',()=>ingestPlatformExport({...args,rows:[rows[0],{...rows[0]}]}),'duplicate source row key');
rejected.ambiguous_join=mustThrow('ambiguous join',()=>ingestPlatformExport({...args,publication_join:{...publicationJoin,bindings:[...publicationJoin.bindings,{...publicationJoin.bindings[0],creative_id:'other'}]}}),'ambiguous publication binding');
const badAdapter=JSON.parse(JSON.stringify(adapter));
delete badAdapter.metrics.hold_3s.denominator_kind;
rejected.missing_denominator_semantics=mustThrow('missing denominator semantics',()=>ingestPlatformExport({...args,adapter:badAdapter}),'denominator_kind');
rejected.rate_not_count=mustThrow('rate instead of count',()=>ingestPlatformExport({...args,rows:[{...rows[0],hold3:'0.45'}]}),'non-negative integer count');
rejected.numerator_gt_denominator=mustThrow('numerator > denominator',()=>ingestPlatformExport({...args,rows:[{...rows[0],hold3:'801'}]}),'numerator exceeds denominator');

const gates={
  deterministic_replay:stableStringify(first)===stableStringify(reordered),
  c30_contract_accepts:true,
  raw_hash_bound:first.receipt.raw_sha256===exportMeta.raw_sha256,
  canonical_identity_from_join:first.evidence.observations.every(x=>['creative-a','creative-b'].includes(x.creative_id)&&['render-a','render-b'].includes(x.render_spec_id)),
  explicit_denominator_semantics:first.evidence.observations.every(x=>Object.values(x.metrics).every(m=>m.denominator_kind==='views')),
  all_negative_cases_rejected:Object.keys(rejected).length===7
};
if(!Object.values(gates).every(Boolean))throw new Error(`C31 audit gate failed: ${JSON.stringify(gates)}`);
const report={
  schema:'framewright-c31-platform-export-ingestion-audit-v1',
  boundary:'synthetic source-shaped fixture; no live platform performance evidence claimed',
  gates,
  receipt:first.receipt,
  evidence:first.evidence,
  rejected
};
fs.writeFileSync(path.join(outDir,'report.json'),JSON.stringify(report,null,2)+'\n');
const summary=`# C31 platform export ingestion audit\n\n`+
`Synthetic source-shaped rows: **${rows.length}**. Canonical C30 observations: **${first.evidence.observations.length}**.\n\n`+
`PASS: raw export SHA binding, explicit adapter/schema/version, publication-manifest identity join, row-order deterministic replay, C30 evidence validation, denominator semantics, and seven negative rejection cases.\n\n`+
`Boundary: this proves ingestion mechanics only. The repository still contains no real platform export, so it makes **no live retention / sharing / CTA / downstream-open claim**.\n`;
fs.writeFileSync(path.join(outDir,'summary.md'),summary);
console.log(summary);
console.log(JSON.stringify({gates,ingestion_id:first.receipt.ingestion_id,evidence_batch_id:first.evidence.evidence_batch_id},null,2));
