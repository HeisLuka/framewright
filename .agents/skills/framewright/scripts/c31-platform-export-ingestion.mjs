#!/usr/bin/env node
import crypto from 'node:crypto';
import { C30_EVIDENCE_SCHEMA, stableStringify } from './c30-campaign-learning.mjs';

export const C31_ADAPTER_SCHEMA='framewright-c31-export-adapter-v1';
export const C31_JOIN_SCHEMA='framewright-c31-publication-join-v1';
export const C31_RECEIPT_SCHEMA='framewright-c31-export-ingestion-receipt-v1';

function object(value,label){if(value===null||typeof value!=='object'||Array.isArray(value))throw new Error(`${label} must be an object`);return value;}
function text(value,label){if(typeof value!=='string'||!value.trim())throw new Error(`${label} must be a non-empty string`);return value.trim();}
function sha256(value){return crypto.createHash('sha256').update(value).digest('hex');}
function count(value,label){
  const n=typeof value==='number'?value:Number(String(value).trim());
  if(!Number.isSafeInteger(n)||n<0)throw new Error(`${label} must be a non-negative integer count`);
  return n;
}
function isoWindow(start,end,label){
  const a=Date.parse(text(start,`${label}.window_start`)),b=Date.parse(text(end,`${label}.window_end`));
  if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a)throw new Error(`${label}: invalid observation window`);
  return [new Date(a).toISOString(),new Date(b).toISOString()];
}
function rawBuffer(raw){
  if(Buffer.isBuffer(raw))return raw;
  if(typeof raw==='string')return Buffer.from(raw,'utf8');
  if(raw instanceof Uint8Array)return Buffer.from(raw);
  throw new Error('raw_bytes must be Buffer, Uint8Array, or string');
}

export function validateExportAdapter(adapter){
  object(adapter,'adapter');
  if(adapter.schema!==C31_ADAPTER_SCHEMA)throw new Error(`wrong adapter schema: ${adapter.schema}`);
  const fields=object(adapter.fields,'adapter.fields');
  const normalized={
    schema:C31_ADAPTER_SCHEMA,
    adapter_id:text(adapter.adapter_id,'adapter.adapter_id'),
    adapter_version:text(adapter.adapter_version,'adapter.adapter_version'),
    platform:text(adapter.platform,'adapter.platform'),
    source_schema:text(adapter.source_schema,'adapter.source_schema'),
    row_key_field:text(fields.row_key,'adapter.fields.row_key'),
    campaign_field:text(fields.campaign_id,'adapter.fields.campaign_id'),
    placement_field:text(fields.placement_id,'adapter.fields.placement_id'),
    creative_key_field:text(fields.creative_key,'adapter.fields.creative_key'),
    window_start_field:text(fields.window_start,'adapter.fields.window_start'),
    window_end_field:text(fields.window_end,'adapter.fields.window_end'),
    metrics:{}
  };
  object(adapter.metrics,'adapter.metrics');
  const metricNames=Object.keys(adapter.metrics).sort();
  if(!metricNames.length)throw new Error('adapter.metrics must be non-empty');
  for(const metricName of metricNames){
    const metric=object(adapter.metrics[metricName],`adapter.metrics.${metricName}`);
    normalized.metrics[metricName]={
      numerator_field:text(metric.numerator_field,`${metricName}.numerator_field`),
      denominator_field:text(metric.denominator_field,`${metricName}.denominator_field`),
      denominator_kind:text(metric.denominator_kind,`${metricName}.denominator_kind`)
    };
  }
  return normalized;
}

export function validatePublicationJoin(join,platform){
  object(join,'publication_join');
  if(join.schema!==C31_JOIN_SCHEMA)throw new Error(`wrong publication join schema: ${join.schema}`);
  if(text(join.platform,'publication_join.platform')!==platform)throw new Error('publication join platform mismatch');
  if(!Array.isArray(join.bindings)||!join.bindings.length)throw new Error('publication_join.bindings must be non-empty');
  const index=new Map();
  for(const [i,bindingRaw] of join.bindings.entries()){
    const binding=object(bindingRaw,`binding[${i}]`);
    const normalized={
      campaign_id:text(binding.campaign_id,`binding[${i}].campaign_id`),
      placement_id:text(binding.placement_id,`binding[${i}].placement_id`),
      source_creative_key:text(binding.source_creative_key,`binding[${i}].source_creative_key`),
      creative_id:text(binding.creative_id,`binding[${i}].creative_id`),
      render_spec_id:text(binding.render_spec_id,`binding[${i}].render_spec_id`)
    };
    const key=[normalized.campaign_id,normalized.placement_id,normalized.source_creative_key].join('\u001f');
    if(index.has(key))throw new Error(`ambiguous publication binding for ${normalized.campaign_id}/${normalized.placement_id}/${normalized.source_creative_key}`);
    index.set(key,normalized);
  }
  return index;
}

function readField(row,name,label){
  if(!Object.prototype.hasOwnProperty.call(row,name))throw new Error(`${label}: missing source field ${name}`);
  return row[name];
}

export function ingestPlatformExport({raw_bytes,export_meta,rows,adapter,publication_join}){
  const raw=rawBuffer(raw_bytes);
  if(!raw.length)throw new Error('raw export must not be empty');
  object(export_meta,'export_meta');
  const platform=text(export_meta.platform,'export_meta.platform');
  const exportId=text(export_meta.export_id,'export_meta.export_id');
  const sourceSchema=text(export_meta.source_schema,'export_meta.source_schema');
  const declaredRawSha=text(export_meta.raw_sha256,'export_meta.raw_sha256').toLowerCase();
  const computedRawSha=sha256(raw);
  if(declaredRawSha!==computedRawSha)throw new Error(`raw export sha256 mismatch: declared ${declaredRawSha}, computed ${computedRawSha}`);
  const a=validateExportAdapter(adapter);
  if(a.platform!==platform)throw new Error(`adapter platform mismatch: ${a.platform} vs ${platform}`);
  if(a.source_schema!==sourceSchema)throw new Error(`adapter source_schema mismatch: ${a.source_schema} vs ${sourceSchema}`);
  const joinIndex=validatePublicationJoin(publication_join,platform);
  if(!Array.isArray(rows)||!rows.length)throw new Error('rows must be a non-empty array');

  const seenRows=new Set(),observations=[];
  for(const [i,rowRaw] of rows.entries()){
    const row=object(rowRaw,`rows[${i}]`);
    const rowKey=text(readField(row,a.row_key_field,`rows[${i}]`),`rows[${i}].row_key`);
    if(seenRows.has(rowKey))throw new Error(`duplicate source row key ${rowKey}`);
    seenRows.add(rowKey);
    const campaignId=text(readField(row,a.campaign_field,`row ${rowKey}`),`row ${rowKey}.campaign_id`);
    const placementId=text(readField(row,a.placement_field,`row ${rowKey}`),`row ${rowKey}.placement_id`);
    const sourceCreativeKey=text(readField(row,a.creative_key_field,`row ${rowKey}`),`row ${rowKey}.creative_key`);
    const bindingKey=[campaignId,placementId,sourceCreativeKey].join('\u001f');
    const binding=joinIndex.get(bindingKey);
    if(!binding)throw new Error(`unbound platform row ${campaignId}/${placementId}/${sourceCreativeKey}`);
    const [windowStart,windowEnd]=isoWindow(
      readField(row,a.window_start_field,`row ${rowKey}`),
      readField(row,a.window_end_field,`row ${rowKey}`),
      `row ${rowKey}`
    );
    const metrics={};
    for(const metricName of Object.keys(a.metrics).sort()){
      const spec=a.metrics[metricName];
      const numerator=count(readField(row,spec.numerator_field,`row ${rowKey}`),`row ${rowKey}.${metricName}.numerator`);
      const denominator=count(readField(row,spec.denominator_field,`row ${rowKey}`),`row ${rowKey}.${metricName}.denominator`);
      if(numerator>denominator)throw new Error(`row ${rowKey}.${metricName}: numerator exceeds denominator`);
      metrics[metricName]={numerator,denominator,denominator_kind:spec.denominator_kind};
    }
    const identityBody={platform,export_id:exportId,source_schema:sourceSchema,raw_sha256:computedRawSha,row_key:rowKey,campaign_id:campaignId,placement_id:placementId,source_creative_key:sourceCreativeKey,creative_id:binding.creative_id,render_spec_id:binding.render_spec_id,window_start:windowStart,window_end:windowEnd,metrics};
    observations.push({
      observation_id:`c31o1_${sha256(stableStringify(identityBody))}`,
      source:{platform,export_id:exportId},
      campaign_id:campaignId,
      placement_id:placementId,
      creative_id:binding.creative_id,
      render_spec_id:binding.render_spec_id,
      window_start:windowStart,
      window_end:windowEnd,
      metrics,
      _source_row_key:rowKey
    });
  }
  observations.sort((x,y)=>x._source_row_key.localeCompare(y._source_row_key));
  const observationIds=observations.map(x=>x.observation_id);
  for(const x of observations)delete x._source_row_key;
  const evidenceBatchBody={platform,export_id:exportId,source_schema:sourceSchema,raw_sha256:computedRawSha,adapter_id:a.adapter_id,adapter_version:a.adapter_version,observation_ids:observationIds};
  const evidence={
    schema:C30_EVIDENCE_SCHEMA,
    evidence_batch_id:`c31e1_${sha256(stableStringify(evidenceBatchBody))}`,
    observations
  };
  const receiptBody={
    schema:C31_RECEIPT_SCHEMA,
    platform,
    export_id:exportId,
    source_schema:sourceSchema,
    raw_sha256:computedRawSha,
    adapter_id:a.adapter_id,
    adapter_version:a.adapter_version,
    row_count:rows.length,
    observation_ids:observationIds,
    evidence_batch_id:evidence.evidence_batch_id
  };
  return {evidence,receipt:{...receiptBody,ingestion_id:`c31i1_${sha256(stableStringify(receiptBody))}`}};
}
