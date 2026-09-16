#!/usr/bin/env node
import {planNarrative,assertNarrativePlan,resolveCopySource,stableStringify} from './c27-narrative-plan.mjs';

const books=[
  {book_id:'a',title:'Map Winter',author:'Mara Bell',hook:'One unfinished map. One frozen city. Three days before every border changes.',cta:'Read now'},
  {book_id:'b',title:'City Seven',author:'Anna Li',hook:'Every morning brings new rules. Today her name appears on the list.',cta:'Read now'},
  {book_id:'c',title:'Letters',author:'E. Volkova',hook:'Ten years of letters stayed unopened. One envelope finally arrived.',cta:'Read now'},
  {book_id:'d',title:'Observatory',author:'Roman Kim',hook:'The signal repeats every eight hours. It comes from below the telescope.',cta:'Read now'},
  {book_id:'e',title:'The Long Way Home',author:'Pavel Orlov',hook:'The ordinary route takes twenty minutes. The new one changes everything.',cta:'Read now'},
  {book_id:'f',title:'00:17',author:'Denis K.',hook:'The district loses power for six minutes. On the seventh night it never returns.',cta:'Read now'}
];
const sentence=i=>({kind:'book_payload_field',field:'hook',selector:{kind:'sentence',index:i}});
const title=()=>({kind:'book_payload_field',field:'title',selector:{kind:'full'}});
let plans=0,copyAtoms=0;const matrix=[];
for(let bi=0;bi<books.length;bi++){
  const book=books[bi],sentenceCount=book.hook.split('.').filter(Boolean).length;
  const angleA={id:'a',type:'premise',hook:sentence(0),tension:sentence(1),...(sentenceCount>=3?{payoff:sentence(2)}:{})};
  const angleB={id:'b',type:'conflict',hook:sentence(sentenceCount>=3?2:1),tension:sentence(0),...(sentenceCount>=3?{payoff:sentence(1)}:{})};
  for(const angle of [angleA,angleB])for(const reveal_timing of ['early','mid','late']){
    const input={book,angle,duration_seconds:9,fps:30,reveal_timing,cta_treatment:'soft_reveal',seed:bi+1};
    const p=planNarrative(input);assertNarrativePlan(p);const replay=planNarrative(input);
    if(stableStringify(p)!==stableStringify(replay))throw new Error('deterministic replay drift');
    for(const r of p.roles)for(const atom of r.atoms)if(atom.source.kind==='book_payload_field'){
      if(resolveCopySource(atom.source,book)!==atom.text)throw new Error('copy provenance drift');copyAtoms++;
    }
    matrix.push({book:book.book_id,angle:angle.id,timing:reveal_timing,reveal:p.checkpoints.reveal});plans++;
  }
}
for(const key of new Set(matrix.map(x=>`${x.book}:${x.angle}`))){
  const xs=matrix.filter(x=>`${x.book}:${x.angle}`===key),m=Object.fromEntries(xs.map(x=>[x.timing,x.reveal]));
  if(!(m.early<m.mid&&m.mid<m.late))throw new Error(`reveal order failed: ${key}`);
}
const representative={book:books[0],angle:{id:'a',type:'premise',hook:sentence(0),tension:sentence(1),payoff:sentence(2)}};
for(const seconds of [3,5,7,9,12,15]){
  const cta=seconds===3?'none':seconds===5?'soft_reveal':'direct';
  assertNarrativePlan(planNarrative({...representative,duration_seconds:seconds,fps:30,reveal_timing:'mid',cta_treatment:cta,seed:seconds}));
}
let identityLeakRejected=false;
try{
  planNarrative({book:books[1],angle:{id:'leak',type:'premise',hook:sentence(0),tension:sentence(1),payoff:title()},duration_seconds:9,fps:30,reveal_timing:'late',cta_treatment:'none'});
}catch(e){identityLeakRejected=/identity leaked/.test(String(e.message));}
if(!identityLeakRejected)throw new Error('pre-reveal book identity leak was not rejected');
console.log(JSON.stringify({ok:true,plans,copyAtoms,durationProfiles:6,revealOrderGroups:12,identityLeakRejected},null,2));
