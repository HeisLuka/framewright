#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inferCreativeHypothesis, scoreInverseHypothesis } from '../../../../contracts/inverse-creative-compiler-v1.mjs';

function fail(message){throw new Error(message);}
function parseArgs(argv){
  const out={observation:null,scene_program:null,out:null};
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];
    if(arg==='--observation')out.observation=argv[++i];
    else if(arg==='--scene-program')out.scene_program=argv[++i];
    else if(arg==='--out')out.out=argv[++i];
    else fail(`unknown or positional argument ${arg}`);
  }
  if(!out.observation||!out.scene_program)fail('usage: node ic01-roundtrip-benchmark.mjs --observation observation.json --scene-program scene-program.json [--out benchmark.json]');
  return out;
}
const args=parseArgs(process.argv.slice(2));
const observation=JSON.parse(readFileSync(resolve(args.observation),'utf8'));
const sceneProgram=JSON.parse(readFileSync(resolve(args.scene_program),'utf8'));
const hypothesis=inferCreativeHypothesis(observation);
const benchmark=scoreInverseHypothesis({hypothesis,scene_program:sceneProgram});
const result={observation_id:observation.observation_id||null,hypothesis,benchmark};
const output=`${JSON.stringify(result,null,2)}\n`;
if(args.out)writeFileSync(resolve(args.out),output,'utf8');else process.stdout.write(output);
