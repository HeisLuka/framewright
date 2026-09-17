#!/usr/bin/env node
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fuseInverseObservation,validateSemanticObservation} from '../../../../contracts/inverse-observation-fusion-v1.mjs';
function fail(message){console.error(message);process.exit(1);}
const args=process.argv.slice(2),options={};for(let i=0;i<args.length;i+=1){if(args[i]==='--observation')options.observation=args[++i];else if(args[i]==='--out')options.out=args[++i];else fail(`unknown arg ${args[i]}`);}if(!options.observation)fail('usage: i22-infer-semantic-observation.mjs --observation observation.json [--out result.json]');
const file=path.resolve(options.observation);if(!existsSync(file))fail(`missing observation ${file}`);const wrapper=JSON.parse(readFileSync(file,'utf8')),observation=wrapper.semantic_observation||wrapper;const report=validateSemanticObservation(observation);if(!report.valid)throw new Error(`invalid semantic observation: ${JSON.stringify(report.errors)}`);const result=fuseInverseObservation(observation);const output=JSON.stringify({schema:'i22-sealed-inference-v1',version:1,observation_id:observation.observation_id,source_sha256:wrapper.source_sha256||null,inverse_result:result},null,2)+'\n';if(options.out)writeFileSync(path.resolve(options.out),output);else process.stdout.write(output);
