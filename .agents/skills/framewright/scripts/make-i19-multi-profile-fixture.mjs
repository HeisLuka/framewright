#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const input=path.resolve(process.argv[2]||'.bench/i19/i03-input/campaign.json');
const output=path.resolve(process.argv[3]||'.bench/i19/input/campaign.json');
if(!fs.existsSync(input))throw new Error(`missing source campaign ${input}`);
const request=JSON.parse(fs.readFileSync(input,'utf8'));
if(request.schema!=='framewright-c19-campaign-request-v1')throw new Error(`unexpected campaign schema ${request.schema}`);
if(!Array.isArray(request.selected)||request.selected.length!==1)throw new Error('I19 fixture expects exactly one selected creative');

request.campaign_id='i19-multi-profile-physical-fixture';
request.delivery_profiles=[
  {
    id:'vertical-instagram-reels-v1',
    width:1080,height:1920,fps:30,
    safe_area_profile:'c26-ui-safe-v1-2026-09-17:instagram_reels',
    platform_ui_profile:'instagram_reels',
    platform_ui_version:'c26-ui-safe-v1-2026-09-17',
  },
  {
    id:'square-generic-v1',
    width:1080,height:1080,fps:30,
    safe_area_profile:'e17-square-v1',
  },
  {
    id:'landscape-generic-v1',
    width:1920,height:1080,fps:30,
    safe_area_profile:'e17-landscape-v1',
  },
];
request.selected[0].requested_delivery_profile_ids=request.delivery_profiles.map(x=>x.id);
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,JSON.stringify(request,null,2)+'\n');
console.log(JSON.stringify({campaign:output,creativePayloadSha256:request.selected[0].creative.payload_sha256,profiles:request.delivery_profiles.map(({id,width,height})=>({id,width,height}))},null,2));
