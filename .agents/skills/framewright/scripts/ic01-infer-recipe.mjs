#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inferCreativeHypothesis } from '../../../../contracts/inverse-creative-compiler-v1.mjs';

function fail(message){throw new Error(message);}
function parseArgs(argv){
  const out={input:null,out:null};
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];
    if(arg==='--out')out.out=argv[++i];
    else if(arg.startsWith('--'))fail(`unknown option ${arg}`);
    else if(!out.input)out.input=arg;
    else fail(`unexpected argument ${arg}`);
  }
  if(!out.input)fail('usage: node ic01-infer-recipe.mjs <observation.json> [--out hypothesis.json]');
  return out;
}
const args=parseArgs(process.argv.slice(2));
const observation=JSON.parse(readFileSync(resolve(args.input),'utf8'));
const hypothesis=inferCreativeHypothesis(observation);
const output=`${JSON.stringify(hypothesis,null,2)}\n`;
if(args.out)writeFileSync(resolve(args.out),output,'utf8');else process.stdout.write(output);
