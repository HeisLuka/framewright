#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const requestPath=path.resolve(process.argv[2]||'artifacts/i09/input/request.json');
const outPath=path.resolve(process.argv[3]||'artifacts/i09/c19-preflight.json');
const mod=await import('./c19-delivery-package-v1.mjs');
const compile=mod.compileDeliveryPackage||mod.makeDeliveryPackage||mod.buildDeliveryPackage;
if(typeof compile!=='function')throw new Error(`C19 compiler export not found; exports=${Object.keys(mod).sort().join(',')}`);
const request=JSON.parse(fs.readFileSync(requestPath,'utf8'));
let pkg;
try{
  pkg=compile(request);
}catch(error){
  const diagnostic={
    schema:'newboo-i09-c19-preflight-error-v1',
    request_path:requestPath,
    request_schema:request?.schema??null,
    request_keys:Object.keys(request||{}).sort(),
    selected_count:Array.isArray(request?.selected)?request.selected.length:null,
    selected_first_keys:Array.isArray(request?.selected)&&request.selected[0]?Object.keys(request.selected[0]).sort():null,
    delivery_profile_first_keys:Array.isArray(request?.delivery_profiles)&&request.delivery_profiles[0]?Object.keys(request.delivery_profiles[0]).sort():null,
    compiler_export:compile.name||'anonymous',
    error_name:error?.name||null,
    error_message:error?.message||String(error),
    error_stack:error?.stack||null,
  };
  fs.mkdirSync(path.dirname(outPath),{recursive:true});
  fs.writeFileSync(outPath,JSON.stringify(diagnostic,null,2)+'\n');
  console.error(JSON.stringify(diagnostic,null,2));
  process.exitCode=2;
}else{
  const diagnostic={
    schema:'newboo-i09-c19-preflight-v1',
    status:'PASS',
    compiler_export:compile.name||'anonymous',
    package_schema:pkg?.schema??null,
    creative_count:Array.isArray(pkg?.creatives)?pkg.creatives.length:null,
    render_spec_count:Array.isArray(pkg?.render_specs)?pkg.render_specs.length:null,
    execution_count:pkg?.executions&&typeof pkg.executions==='object'?Object.keys(pkg.executions).length:null,
    package:pkg,
  };
  fs.mkdirSync(path.dirname(outPath),{recursive:true});
  fs.writeFileSync(outPath,JSON.stringify(diagnostic,null,2)+'\n');
  console.log(JSON.stringify({...diagnostic,package:undefined},null,2));
}
