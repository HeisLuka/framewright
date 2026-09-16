#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {computeAudioSpecId, assertCanonicalAudioArtifact} from '../../../../contracts/audio-identity-v1.mjs';
import {canonicalJson} from '../../../../contracts/factory-identity-v1.mjs';

const fixtureDir=path.resolve(process.argv[2]||'artifacts/i03/c27-fixtures');
const c27Html=path.resolve(process.argv[3]||'examples/book-ad-systems/index-c27-i03.html');
const audioSource=path.resolve(process.argv[4]||'artifacts/i03/source.wav');
const audioArtifact=path.resolve(process.argv[5]||'artifacts/i03/canonical-audio.m4a');
const outDir=path.resolve(process.argv[6]||'artifacts/i03/input');
const shaBytes=bytes=>createHash('sha256').update(bytes).digest('hex');
const shaFile=file=>shaBytes(fs.readFileSync(file));
const shaCanonical=value=>shaBytes(canonicalJson(value));

for(const file of [c27Html,audioSource,audioArtifact,path.join(fixtureDir,'manifest.json')])if(!fs.existsSync(file))throw new Error(`missing I03 fixture input: ${file}`);
const manifest=JSON.parse(fs.readFileSync(path.join(fixtureDir,'manifest.json'),'utf8'));
const item=manifest.items.find(x=>x.bookId==='winter-map'&&x.angleId==='map-premise'&&x.revealTiming==='early')||manifest.items[0];
if(!item)throw new Error('no C27 fixture item');
const input=JSON.parse(fs.readFileSync(path.join(fixtureDir,item.inputFile),'utf8'));
const plan=JSON.parse(fs.readFileSync(path.join(fixtureDir,item.planFile),'utf8'));
const book={...input.book,cover_url:`../book-ad-v0/generated-e08/${path.basename(input.book.cover_url)}`};
const basePayload={
  ...book,
  visual_system:'swiss',
  creative_variant:'hook-first',
  delivery_profile:'vertical',
  art_direction_mode:'cover',
  cover_composition_mode:'adaptive',
  opening_grammar:'hook-led',
  motion_density:'choreography-v2',
  typography_system:'baseline',
  pacing_mode:'c27-narrative-v1',
  narrative_plan:plan,
};
const payloadSha256=shaCanonical(basePayload);
const templateSha256=shaFile(c27Html);
const coverPath=path.resolve('examples/book-ad-v0/generated-e08',path.basename(input.book.cover_url));
if(!fs.existsSync(coverPath))throw new Error(`missing cover ${coverPath}`);
const coverSha256=shaFile(coverPath);
const durationMs=plan.duration_seconds*1000;
const sourceSha256=shaFile(audioSource);
const audioSpec={
  schema:'framewright-audio-spec-v1',audio_spec_id:'',version:1,source_sha256:sourceSha256,
  timing:{trim_start_ms:0,duration_ms:durationMs,final_mux_duration_ms:durationMs},
  mix:{gain_db:0,fades:null},
  codec:{name:'aac',bitrate_bps:192000,container:'m4a',policy:'aac-lc-ffmpeg-192k-v2-explicit-duration'},
};
audioSpec.audio_spec_id=computeAudioSpecId(audioSpec);
const artifactBytes=fs.readFileSync(audioArtifact);
const canonicalAudio={
  schema:'framewright-canonical-audio-v1',audio_spec_id:audioSpec.audio_spec_id,
  sha256:shaBytes(artifactBytes),bytes:artifactBytes.byteLength,media_type:'audio/mp4',
  storage_uri:`artifact://i03/${path.basename(audioArtifact)}`,
  provenance:{encoder:'ffmpeg-github-runner',policy:audioSpec.codec.policy},
};
assertCanonicalAudioArtifact(audioSpec,canonicalAudio,artifactBytes);
const hookAtom=plan.roles.find(x=>x.role==='hook')?.atoms?.[0];
if(!hookAtom?.text)throw new Error('C27 plan has no hook atom');
const request={
  schema:'framewright-c19-campaign-request-v1',
  campaign_id:'i03-c27-e2e-fixture',
  compiler_policy_version:'c19-delivery-package-v1',
  runtime:{
    class:'FAST',scene_contract_version:'canvas-scene-v1',environment_id:'video-worker-chromium-v1',
    renderer:{id:'webcodecs-h264',version:'r35-standard-v1'},
    encoder:{video_codec:'avc1.420028',bitrate_bps:3000000,pixel_format:'yuv420p'},
    muxer:{id:'ffmpeg-stream-copy-aac',version:'6.1.1'},
  },
  delivery_profiles:[
    {id:'vertical-youtube-shorts-v1',width:1080,height:1920,fps:30,safe_area_profile:'c26-ui-safe-v1-2026-09-17:youtube_shorts',platform_ui_profile:'youtube_shorts',platform_ui_version:'c26-ui-safe-v1-2026-09-17'},
    {id:'vertical-instagram-reels-v1',width:1080,height:1920,fps:30,safe_area_profile:'c26-ui-safe-v1-2026-09-17:instagram_reels',platform_ui_profile:'instagram_reels',platform_ui_version:'c26-ui-safe-v1-2026-09-17'},
  ],
  selected:[{
    selection_id:'selected-winter-map',
    creative:{
      schema:'newboo-creative-spec-v1',book_id:book.book_id,payload_sha256:payloadSha256,
      template:{id:'book-ad-systems',version:'c27-narrative-v1',sha256:templateSha256},
      visual_system:{id:'swiss',version:'v1'},structural_variant:'hook-first',
      hook:{source:'payload_field',text:hookAtom.text,source_ref:`${plan.narrative_plan_id}:hook`},
      motion:{profile:'finite-choreography',version:'c22-v1'},
      art_direction:{mode:'cover-derived',algorithm:'c20-cover-adaptive-v1',source_cover_sha256:coverSha256,palette:{background:book.background,surface:'#FFFFFF',ink:book.ink,accent:book.accent,secondary:'#315A7D'}},
      seed:plan.seed,
      assets:[{role:'cover',sha256:coverSha256,media_type:'image/png',uri:`asset://generated-e08/${path.basename(input.book.cover_url)}`}],
    },
    timeline:{source:`c27:${plan.narrative_plan_id}`,policy_version:plan.policy_version,duration_ms:durationMs,frame_count:plan.total_frames},
    requested_delivery_profile_ids:['vertical-youtube-shorts-v1','vertical-instagram-reels-v1'],
    render_assets:[{role:'scene_payload',sha256:payloadSha256,media_type:'application/json',uri:'execution://selected-winter-map/base-payload'}],
    audio:{spec:audioSpec,artifact:canonicalAudio},
  }],
  reserves:[{reserve_id:'reserve-second-angle',reason:'bounded-selection-reserve'}],
};
fs.mkdirSync(outDir,{recursive:true});
const payloadFile=path.join(outDir,'selected-winter-map.payload.json');
const campaignFile=path.join(outDir,'campaign.json');
const executionFile=path.join(outDir,'execution-map.json');
fs.writeFileSync(payloadFile,JSON.stringify(basePayload,null,2)+'\n');
fs.writeFileSync(campaignFile,JSON.stringify(request,null,2)+'\n');
fs.writeFileSync(executionFile,JSON.stringify({
  schema:'framewright-i03-execution-map-v1',
  selections:{'selected-winter-map':{html:c27Html,payload:payloadFile,audio:audioArtifact,narrative_plan_id:plan.narrative_plan_id}},
},null,2)+'\n');
console.log(JSON.stringify({campaign:campaignFile,executionMap:executionFile,selection:'selected-winter-map',narrativePlanId:plan.narrative_plan_id,durationMs,frames:plan.total_frames,payloadSha256,templateSha256,audioSpecId:audioSpec.audio_spec_id,audioSha256:canonicalAudio.sha256,profiles:request.selected[0].requested_delivery_profile_ids},null,2));
