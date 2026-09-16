#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const input=path.resolve(process.argv[2]||'artifacts/e16/adaptation.json');
const out=path.resolve(process.argv[3]||'artifacts/e16/verdict.json');
const r=JSON.parse(fs.readFileSync(input,'utf8'));
const minRetention=0.80,minUtilization=0.55;
const verdicts=[];
for(const format of ['square','landscape'])for(const strategy of ['contain','cover']){
  const xs=r.results.filter(x=>x.format===format&&x.strategy===strategy);if(xs.length!==3)throw new Error(`${format}/${strategy}: expected 3 outputs, got ${xs.length}`);
  for(const x of xs){if(x.probe.width!==x.target.width||x.probe.height!==x.target.height)throw new Error(`${x.output}: bad dimensions`);if(Math.abs(x.probe.duration-12)>0.1)throw new Error(`${x.output}: bad duration ${x.probe.duration}`);}
  const retention=Math.min(...xs.map(x=>x.sourceRetention)),utilization=Math.min(...xs.map(x=>x.contentAreaUtilization));
  verdicts.push({format,strategy,sourceRetention:retention,contentAreaUtilization:utilization,passesRetention:retention>=minRetention,passesUtilization:utilization>=minUtilization,acceptable:retention>=minRetention&&utilization>=minUtilization});
}
const acceptable=verdicts.filter(x=>x.acceptable).map(x=>`${x.format}/${x.strategy}`);
const result={schema:'framewright-e16-format-verdict-v1',thresholds:{minSourceRetention:minRetention,minContentAreaUtilization:minUtilization},verdicts,acceptable,conclusion:{squareHasRasterSafeOption:verdicts.some(x=>x.format==='square'&&x.acceptable),landscapeHasRasterSafeOption:verdicts.some(x=>x.format==='landscape'&&x.acceptable),semanticReflowRequiredForLandscape:!verdicts.some(x=>x.format==='landscape'&&x.acceptable)}};
if(!result.conclusion.squareHasRasterSafeOption)throw new Error('expected square contain to clear the geometric baseline');
if(!result.conclusion.semanticReflowRequiredForLandscape)throw new Error('landscape unexpectedly cleared raster-only guardrails; review thresholds/adapter');
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
