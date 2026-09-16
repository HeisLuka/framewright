#!/usr/bin/env node

export const C37_DESIGN_SCHEMA='framewright-c37-doe-screening-design-v1';

const ANGLES=['premise','conflict','identity'];
const REVEALS=['early','mid','late'];
const HOOKS=[1,2];

function stableCandidateId(c){return `${c.angle}-h${c.hook_index}-${c.reveal}`;}
function candidateSort(a,b){return ANGLES.indexOf(a.angle)-ANGLES.indexOf(b.angle)||a.hook_index-b.hook_index||REVEALS.indexOf(a.reveal)-REVEALS.indexOf(b.reveal);}

export function buildC29FactorSpace(){
  const rows=[];
  for(const angle of ANGLES)for(const hook_index of HOOKS)for(const reveal of REVEALS)rows.push({id:`${angle}-h${hook_index}-${reveal}`,angle,hook_index,reveal,concept_id:`${angle}-h${hook_index}`});
  return rows;
}

export function c29NestedMainEffectsRow(candidate){
  const c=candidate;
  return [
    1,
    c.angle==='conflict'?1:0,
    c.angle==='identity'?1:0,
    c.angle==='premise'&&c.hook_index===2?1:0,
    c.angle==='conflict'&&c.hook_index===2?1:0,
    c.angle==='identity'&&c.hook_index===2?1:0,
    c.reveal==='mid'?1:0,
    c.reveal==='late'?1:0
  ];
}

export function withinAngleHookRevealRow(candidate){
  return [1,candidate.hook_index===2?1:0,candidate.reveal==='mid'?1:0,candidate.reveal==='late'?1:0];
}

export function matrixRank(matrix,epsilon=1e-10){
  if(!Array.isArray(matrix)||!matrix.length)return 0;
  const a=matrix.map(row=>row.map(Number));
  const rows=a.length,cols=a[0].length;
  let rank=0;
  for(let col=0;col<cols&&rank<rows;col++){
    let pivot=rank;
    for(let r=rank+1;r<rows;r++)if(Math.abs(a[r][col])>Math.abs(a[pivot][col]))pivot=r;
    if(Math.abs(a[pivot][col])<=epsilon)continue;
    [a[rank],a[pivot]]=[a[pivot],a[rank]];
    const p=a[rank][col];
    for(let c=col;c<cols;c++)a[rank][c]/=p;
    for(let r=0;r<rows;r++){
      if(r===rank)continue;
      const f=a[r][col];
      if(Math.abs(f)<=epsilon)continue;
      for(let c=col;c<cols;c++)a[r][c]-=f*a[rank][c];
    }
    rank++;
  }
  return rank;
}

function determinantNumber(matrix){
  const n=matrix.length;if(!n||matrix.some(row=>row.length!==n))throw new Error('determinant requires square matrix');
  const a=matrix.map(row=>row.map(Number));
  let det=1;
  for(let col=0;col<n;col++){
    let pivot=col;
    for(let r=col+1;r<n;r++)if(Math.abs(a[r][col])>Math.abs(a[pivot][col]))pivot=r;
    if(Math.abs(a[pivot][col])<1e-12)return 0;
    if(pivot!==col){[a[pivot],a[col]]=[a[col],a[pivot]];det*=-1;}
    const p=a[col][col];det*=p;
    for(let r=col+1;r<n;r++){
      const f=a[r][col]/p;
      for(let c=col+1;c<n;c++)a[r][c]-=f*a[col][c];
    }
  }
  return det;
}

function determinantBareiss(matrix){
  const n=matrix.length;if(!n||matrix.some(row=>row.length!==n))throw new Error('determinant requires square matrix');
  const a=matrix.map(row=>row.map(value=>BigInt(value)));
  let sign=1n,prev=1n;
  for(let k=0;k<n-1;k++){
    let pivot=k;
    while(pivot<n&&a[pivot][k]===0n)pivot++;
    if(pivot===n)return 0n;
    if(pivot!==k){[a[pivot],a[k]]=[a[k],a[pivot]];sign*=-1n;}
    const pivotValue=a[k][k];
    for(let i=k+1;i<n;i++)for(let j=k+1;j<n;j++)a[i][j]=(a[i][j]*pivotValue-a[i][k]*a[k][j])/prev;
    prev=pivotValue;
    for(let i=k+1;i<n;i++)a[i][k]=0n;
  }
  return sign*a[n-1][n-1];
}

function* combinations(items,k,start=0,prefix=[]){
  if(prefix.length===k){yield prefix;return;}
  const need=k-prefix.length;
  for(let i=start;i<=items.length-need;i++)yield* combinations(items,k,i+1,[...prefix,items[i]]);
}

function countBy(items,keyFn){const map=new Map();for(const item of items){const key=keyFn(item);map.set(key,(map.get(key)||0)+1);}return map;}
function sumSquares(map){let out=0;for(const value of map.values())out+=value*value;return out;}
function balancePenalty(subset,mode){
  if(mode==='c29_nested'){
    const angle=countBy(subset,x=>x.angle),reveal=countBy(subset,x=>x.reveal),concept=countBy(subset,x=>x.concept_id);
    for(const x of ANGLES)if(!angle.has(x))angle.set(x,0);
    for(const x of REVEALS)if(!reveal.has(x))reveal.set(x,0);
    for(const a of ANGLES)for(const h of HOOKS){const key=`${a}-h${h}`;if(!concept.has(key))concept.set(key,0);}
    return sumSquares(angle)+sumSquares(reveal)+sumSquares(concept);
  }
  const hook=countBy(subset,x=>x.hook_index),reveal=countBy(subset,x=>x.reveal);
  for(const h of HOOKS)if(!hook.has(h))hook.set(h,0);
  for(const r of REVEALS)if(!reveal.has(r))reveal.set(r,0);
  return sumSquares(hook)+sumSquares(reveal);
}

function canonicalSubsetKey(subset){return [...subset].sort(candidateSort).map(stableCandidateId).join('|');}

export function findBestExactRunDesign({candidates,row_fn,run_count,balance_mode}){
  const sorted=[...candidates].sort(candidateSort);
  const columns=row_fn(sorted[0]).length;
  if(run_count!==columns)throw new Error(`exact-run D-opt scout requires run_count == model columns (${columns})`);
  let best=null,examined=0,fullRank=0;
  for(const subset of combinations(sorted,run_count)){
    examined++;
    const matrix=subset.map(row_fn),rank=matrixRank(matrix);
    if(rank!==columns)continue;
    fullRank++;
    const absDet=Math.abs(Math.round(determinantNumber(matrix)));
    const penalty=balancePenalty(subset,balance_mode),key=canonicalSubsetKey(subset);
    if(!best||absDet>best.absDet||(absDet===best.absDet&&(penalty<best.penalty||(penalty===best.penalty&&key<best.key))))best={subset:[...subset].sort(candidateSort),rank,absDet,penalty,key};
  }
  if(!best)throw new Error(`no full-rank ${run_count}-run design found`);
  const exactDet=determinantBareiss(best.subset.map(row_fn));
  if(Number(exactDet<0n?-exactDet:exactDet)!==best.absDet)throw new Error('numeric/exact determinant disagreement');
  return {examined,full_rank_subsets:fullRank,rank:best.rank,abs_design_determinant:best.absDet,information_determinant:best.absDet*best.absDet,balance_penalty:best.penalty,candidates:best.subset};
}

export function maxRankForRunCount({candidates,row_fn,run_count}){
  const sorted=[...candidates].sort(candidateSort);let maxRank=0,examined=0;
  for(const subset of combinations(sorted,run_count)){
    examined++;const rank=matrixRank(subset.map(row_fn));if(rank>maxRank)maxRank=rank;
    if(maxRank===Math.min(run_count,row_fn(sorted[0]).length))break;
  }
  return {run_count,model_columns:row_fn(sorted[0]).length,max_rank:maxRank,examined_until_bound:examined,identifiable:maxRank===row_fn(sorted[0]).length};
}

export function buildC37ScreeningDesign(){
  const space=buildC29FactorSpace();
  const globalModel={
    name:'angle + hook(angle) + reveal',
    columns:['intercept','angle_conflict','angle_identity','premise_hook2','conflict_hook2','identity_hook2','reveal_mid','reveal_late'],
    parameter_count:8,
    nesting:'hook candidate is nested inside angle; hook1/hook2 labels are not a common treatment across angle mechanisms'
  };
  const globalDesign=findBestExactRunDesign({candidates:space,row_fn:c29NestedMainEffectsRow,run_count:8,balance_mode:'c29_nested'});
  const localSpace=space.filter(x=>x.angle==='premise');
  const localModel={name:'hook + reveal within one fixed angle',columns:['intercept','hook2','reveal_mid','reveal_late'],parameter_count:4};
  const localDesign=findBestExactRunDesign({candidates:localSpace,row_fn:withinAngleHookRevealRow,run_count:4,balance_mode:'within_angle'});
  return {
    schema:C37_DESIGN_SCHEMA,
    candidate_space:'C29 angle mechanism x nested hook candidate x reveal timing',
    candidate_count:space.length,
    global_main_effects:{model:globalModel,minimum_runs_for_rank:8,design:globalDesign},
    strict_3_to_5_budget:{verdict:'underidentified_for_all_C29_main_effects',reason:'the honest nested main-effects model has 8 independent parameters, so 3-5 observations cannot have rank 8'},
    staged_budget_option:{verdict:'4_runs_can_identify_hook_plus_reveal_within_one_fixed_angle',model:localModel,design:localDesign},
    interaction_boundary:'the 8-run global design is a main-effects screening design only; it does not identify creative-axis interactions',
    publication_boundary:'live organic testing must assign selected creatives to explicit publication opportunities/blocks; this design does not claim randomized viewer exposure'
  };
}
