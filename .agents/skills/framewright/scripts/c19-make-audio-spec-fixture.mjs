#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {computeAudioSpecId,assertAudioSpecId,assertCanonicalAudioArtifact} from '../../../../contracts/audio-identity-v1.mjs';

const sourcePath=path.resolve(process.argv[2]||'artifacts/c19/audio-source.wav');
const artifactPath=path.resolve(process.argv[3]||'artifacts/c19/canonical-audio.m4a');
const outPath=path.resolve(process.argv[4]||'artifacts/c19/audio-fixture.json');
for(const f of[sourcePath,artifactPath])if(!fs.existsSync(f))throw new Error(`missing audio input ${f}`);
const hash=(bytes)=>createHash('sha256').update(bytes).digest('hex');
const sourceBytes=fs.readFileSync(sourcePath),artifactBytes=fs.readFileSync(artifactPath);
const spec={
 schema:'framewright-audio-spec-v1',audio_spec_id:'',version:1,source_sha256:hash(sourceBytes),
 timing:{trim_start_ms:0,duration_ms:12000,final_mux_duration_ms:12000},
 mix:{gain_db:0,fades:null},
 codec:{name:'aac',bitrate_bps:192000,container:'m4a',policy:'aac-lc-ffmpeg-192k-v2-explicit-duration'}
};
spec.audio_spec_id=computeAudioSpecId(spec);assertAudioSpecId(spec);
const artifact={
 schema:'framewright-canonical-audio-v1',audio_spec_id:spec.audio_spec_id,sha256:hash(artifactBytes),bytes:artifactBytes.byteLength,media_type:'audio/mp4',
 provenance:{producer:'c19-benchmark-audio-fixture-v1',source_fixture:'r32-compatible-sine-110hz-48khz-12s-v1',encoder:'ffmpeg-aac-192k',policy:spec.codec.policy}
};
assertCanonicalAudioArtifact(spec,artifact,artifactBytes);
const out={schema:'framewright-c19-audio-fixture-v1',scope:'benchmark/control only; not campaign soundtrack selection',spec,artifact};
fs.mkdirSync(path.dirname(outPath),{recursive:true});fs.writeFileSync(outPath,JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({audio_spec_id:spec.audio_spec_id,source_sha256:spec.source_sha256,canonical_artifact_sha256:artifact.sha256,bytes:artifact.bytes,duration_ms:spec.timing.duration_ms,outPath},null,2));
