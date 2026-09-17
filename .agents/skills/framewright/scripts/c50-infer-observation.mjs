#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decompileObservation, validateObservationIR } from '../../../../contracts/inverse-creative-compiler-v1.mjs';

function parseArgs(){const args=process.argv.slice(2),out={};for(let i=0;i<args.length;i+=1){if(args[i]==='--observation')out.observation=args[++i];else if(args[i]==='--out')out.out=args[++i];else throw new Error(`unknown argument ${args[i]}`);}if(!out.observation)throw new Error('usage: c50-infer-observation.mjs --observation observation.json [--out result.json]');return out;}
const options=parseArgs();
const observation=JSON.parse(readFileSync(resolve(options.observation),'utf8'));
const report=validateObservationIR(observation);if(!report.valid)throw new Error(`invalid observation: ${JSON.stringify(report.errors)}`);
const result=decompileObservation(observation);
const json=`${JSON.stringify(result,null,2)}\n`;
if(options.out)writeFileSync(resolve(options.out),json);else process.stdout.write(json);
