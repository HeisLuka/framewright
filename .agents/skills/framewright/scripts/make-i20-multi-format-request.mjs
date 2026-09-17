#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const campaignPath=path.resolve(process.argv[2]||'.bench/i20/input/campaign.json');
const executionMapPath=path.resolve(process.argv[3]||'.bench/i20/i03-input/execution-map.json');
const output=path.resolve(process.argv[4]||'.bench/i20/request.json');
const payloadDir=path.resolve(process.argv[5]||'.bench/i20/payloads');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
if(!fs.existsSync(campaignPath)||!fs.existsSync(executionMapPath))throw new Error('campaign + execution map are required');
const campaign=JSON.parse(fs.readFileSync(campaignPath,'utf8'));
const executionMap=JSON.parse(fs.readFileSync(executionMapPath,'utf8'));
if(campaign.selected?.length!==1)throw new Error('I20 source campaign must contain one selected creative');
const base=campaign.selected[0];
const baseExec=executionMap.selections?.[base.selection_id];
if(!baseExec)throw new Error(`missing execution map for ${base.selection_id}`);
const sourcePayload=JSON.parse(fs.readFileSync(path.resolve(baseExec.payload),'utf8'));
fs.mkdirSync(payloadDir,{recursive:true});

const requested=['vertical-instagram-reels-v1','square-generic-v1','landscape-generic-v1'];
const unrequested={
  id:'vertical-youtube-shorts-unrequested-v1',width:1080,height:1920,fps:30,
  safe_area_profile:'c26-ui-safe-v1-2026-09-17:youtube_shorts',
  platform_ui_profile:'youtube_shorts',platform_ui_version:'c26-ui-safe-v1-2026-09-17',
};
const systems=['swiss','newspaper','paper'];
const selected=systems.map((system,index)=>{
  const payload={...sourcePayload,visual_system:system};
  const payloadBytes=Buffer.from(JSON.stringify(payload,null,2)+'\n');
  const payloadPath=path.join(payloadDir,`${system}.json`);
  fs.writeFileSync(payloadPath,payloadBytes);
  const payloadSha=sha(payloadBytes);
  const selectionId=`i20-${system}`;
  return {
    ...structuredClone(base),
    selection_id:selectionId,
    creative:{
      ...structuredClone(base.creative),
      payload_sha256:payloadSha,
      visual_system:{...structuredClone(base.creative.visual_system),id:system},
      seed:Number(base.creative.seed)+index,
    },
    render_assets:(base.render_assets||[]).map(asset=>asset.role==='scene_payload'?{...asset,sha256:payloadSha}:asset),
    requested_delivery_profile_ids:[...requested],
    execution:{
      html:path.resolve(baseExec.html),
      payload:payloadPath,
      audio:baseExec.audio?path.resolve(baseExec.audio):null,
      template_id:base.creative.template.id,
      template_version:base.creative.template.version,
    },
  };
});
const request={
  ...campaign,
  campaign_id:'i20-multi-format-e2e-matrix',
  delivery_profiles:[...campaign.delivery_profiles.map(x=>structuredClone(x)),unrequested],
  selected,
  reserves:[...(campaign.reserves||[]),{reserve_id:'i20-reserve-not-rendered',reason:'explicit-reserve-proof'}],
};
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,JSON.stringify(request,null,2)+'\n');
console.log(JSON.stringify({request:output,selected:systems,requested,unrequested:unrequested.id,reserves:request.reserves.map(x=>x.reserve_id),payloadSha256:Object.fromEntries(selected.map(x=>[x.creative.visual_system.id,x.creative.payload_sha256]))},null,2));
