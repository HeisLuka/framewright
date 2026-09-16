#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {computeAudioSpecId,assertAudioSpecId} from '../../../../contracts/audio-identity-v1.mjs';

const sourcePath=path.resolve(process.argv[2]||'artifacts/c19/audio-source.wav');
const outPath=path.resolve(process.argv[3]||'artifacts/c19/audio-spec.json');
if(!fs.existsSync(sourcePath))throw new Error(`missing audio source ${sourcePath}`);
const source_sha256=createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
const spec={
 schema:'framewright-audio-spec-v1',
 audio_spec_id:'',
 version:1,
 source_sha256,
 timing:{trim_start_ms:0,duration_ms:12000,final_mux_duration_ms:12000},
 mix:{gain_db:0,fades:null},
 codec:{name:'aac',bitrate_bps:192000,container:'m4a',policy:'aac-lc-ffmpeg-192k-v2-explicit-duration'}
};
spec.audio_spec_id=computeAudioSpecId(spec);assertAudioSpecId(spec);
fs.mkdirSync(path.dirname(outPath),{recursive:true});
fs.writeFileSync(outPath,JSON.stringify(spec,null,2)+'\n');
console.log(JSON.stringify({audio_spec_id:spec.audio_spec_id,source_sha256,duration_ms:spec.timing.duration_ms,outPath},null,2));
