import fs from 'node:fs';

function rssBytes(pid){
  try{
    const s=fs.readFileSync(`/proc/${pid}/status`,'utf8');
    const m=/^VmRSS:\s+(\d+)\s+kB$/m.exec(s);
    return m?Number(m[1])*1024:0;
  }catch{return 0;}
}
function children(pid){
  try{
    const s=fs.readFileSync(`/proc/${pid}/task/${pid}/children`,'utf8').trim();
    return s?s.split(/\s+/).map(Number).filter(Number.isFinite):[];
  }catch{return [];}
}
export function processTreeRssBytes(rootPid=process.pid){
  if(process.platform!=='linux')return process.memoryUsage().rss;
  const seen=new Set(),stack=[rootPid];let total=0;
  while(stack.length){
    const pid=stack.pop();if(!pid||seen.has(pid))continue;seen.add(pid);total+=rssBytes(pid);
    for(const c of children(pid))stack.push(c);
  }
  return total;
}
export function startRssSampler(intervalMs=250){
  let peak=0,samples=0,sum=0,closed=false;
  const sample=()=>{if(closed)return;const v=processTreeRssBytes(process.pid);peak=Math.max(peak,v);sum+=v;samples++;};
  sample();const timer=setInterval(sample,intervalMs);timer.unref?.();
  return{
    stop(){closed=true;clearInterval(timer);sample();return{peakRssBytes:peak,meanRssBytes:samples?Math.round(sum/samples):0,samples};}
  };
}
export function percentile(values,p){
  if(!values.length)return 0;const s=[...values].sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.floor((s.length-1)*p))];
}
export function durationStats(values){
  if(!values.length)return{count:0,meanMs:0,p50Ms:0,p95Ms:0,minMs:0,maxMs:0};
  const sum=values.reduce((a,b)=>a+b,0),s=[...values].sort((a,b)=>a-b);
  return{count:values.length,meanMs:+(sum/values.length).toFixed(3),p50Ms:+percentile(values,.5).toFixed(3),p95Ms:+percentile(values,.95).toFixed(3),minMs:+s[0].toFixed(3),maxMs:+s.at(-1).toFixed(3)};
}
