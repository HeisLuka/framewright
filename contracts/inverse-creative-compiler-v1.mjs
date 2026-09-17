import { sha256Canonical } from './factory-identity-v1.mjs';
import { buildCanonicalTemplateVariabilityRegistry, buildDefaultTemplateAutoPolicy } from './template-variant-composer-v1.mjs';

export const VIDEO_OBSERVATION_SCHEMA='newboo-video-observation-v1';
export const INVERSE_CREATIVE_HYPOTHESIS_SCHEMA='newboo-inverse-creative-hypothesis-v1';
export const INVERSE_BENCHMARK_SCHEMA='newboo-inverse-creative-benchmark-v1';
const AXES=['structural_layout','visual_system','typography','motion_grammar','asset_staging','graphic_devices'];

function isObject(value){return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function clamp01(value){return Math.max(0,Math.min(1,Number.isFinite(value)?value:0));}
function round(value,digits=6){const m=10**digits;return Math.round((Number(value)||0)*m)/m;}
function sortedUnique(values){return [...new Set(values)].sort();}
function add(errors,code,path,message){errors.push({code,path,message});}
function sortErrors(errors){return errors.sort((a,b)=>a.path.localeCompare(b.path)||a.code.localeCompare(b.code)||a.message.localeCompare(b.message));}
function canonicalCandidate(candidate){return {id:String(candidate.id),score:round(clamp01(candidate.score)),evidence:sortedUnique(candidate.evidence||[])};}
function rankCandidates(candidates){return candidates.map(canonicalCandidate).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));}
function safeRatio(a,b){return b>0?a/b:0;}

export function inferDeliveryAspect(width,height){
  if(!(Number.isFinite(width)&&width>0&&Number.isFinite(height)&&height>0))return 'unknown';
  const ratio=width/height;
  if(Math.abs(ratio-1)<=0.08)return 'square';
  if(ratio<0.8)return 'vertical';
  if(ratio>1.25)return 'landscape';
  return 'unknown';
}

export function validateVideoObservation(observation){
  const errors=[];
  if(!isObject(observation))return {valid:false,errors:[{code:'TYPE_OBJECT_REQUIRED',path:'',message:'observation must be an object'}]};
  if(observation.schema!==VIDEO_OBSERVATION_SCHEMA)add(errors,'SCHEMA_MISMATCH','/schema',`expected ${VIDEO_OBSERVATION_SCHEMA}`);
  if(observation.version!==1)add(errors,'VERSION_UNSUPPORTED','/version','version must be 1');
  const source=observation.source;
  if(!isObject(source))add(errors,'SOURCE_REQUIRED','/source','source metadata required');
  else{
    for(const key of ['width','height','fps','duration_seconds','frame_count'])if(!(Number.isFinite(source[key])&&source[key]>0))add(errors,'SOURCE_VALUE_INVALID',`/source/${key}`,`${key} must be positive`);
  }
  const sampling=observation.sampling;
  if(!isObject(sampling))add(errors,'SAMPLING_REQUIRED','/sampling','sampling metadata required');
  else{
    if(!(Number.isFinite(sampling.sample_fps)&&sampling.sample_fps>0))add(errors,'SAMPLE_FPS_INVALID','/sampling/sample_fps','sample_fps must be positive');
    if(!(Number.isInteger(sampling.sampled_frames)&&sampling.sampled_frames>0))add(errors,'SAMPLED_FRAMES_INVALID','/sampling/sampled_frames','sampled_frames must be positive integer');
  }
  const motion=observation.motion;
  if(!isObject(motion))add(errors,'MOTION_REQUIRED','/motion','motion observations required');
  else{
    for(const key of ['mean_abs_diff','p95_abs_diff','burstiness'])if(!(Number.isFinite(motion[key])&&motion[key]>=0))add(errors,'MOTION_VALUE_INVALID',`/motion/${key}`,`${key} must be non-negative`);
    if(!isObject(motion.directional_bias))add(errors,'DIRECTIONAL_BIAS_REQUIRED','/motion/directional_bias','directional bias required');
    else for(const key of ['horizontal','vertical'])if(!(Number.isFinite(motion.directional_bias[key])&&motion.directional_bias[key]>=0&&motion.directional_bias[key]<=1))add(errors,'DIRECTIONAL_BIAS_INVALID',`/motion/directional_bias/${key}`,`${key} must be 0..1`);
    if(!Array.isArray(motion.activity_grid)||motion.activity_grid.length!==4||motion.activity_grid.some(row=>!Array.isArray(row)||row.length!==4))add(errors,'ACTIVITY_GRID_INVALID','/motion/activity_grid','activity_grid must be 4x4');
  }
  const appearance=observation.appearance;
  if(!isObject(appearance))add(errors,'APPEARANCE_REQUIRED','/appearance','appearance observations required');
  else if(!Array.isArray(appearance.edge_grid)||appearance.edge_grid.length!==4||appearance.edge_grid.some(row=>!Array.isArray(row)||row.length!==4))add(errors,'EDGE_GRID_INVALID','/appearance/edge_grid','edge_grid must be 4x4');
  if(!Array.isArray(observation.cut_candidates))add(errors,'CUTS_INVALID','/cut_candidates','cut_candidates must be array');
  return {valid:errors.length===0,errors:sortErrors(errors)};
}

export function materializeVideoObservation(input){
  const value=structuredClone(input);
  value.schema=VIDEO_OBSERVATION_SCHEMA;
  value.version=1;
  const report=validateVideoObservation(value);
  if(!report.valid)throw new Error(`invalid video observation: ${JSON.stringify(report.errors)}`);
  const {observation_id,...projection}=value;
  value.observation_id=`nbobs1_${sha256Canonical(projection)}`;
  return value;
}

export function buildInverseVocabulary(registry=buildCanonicalTemplateVariabilityRegistry(),policy=buildDefaultTemplateAutoPolicy()){
  const registryIds={
    structural_layout:new Set(registry.axes.structural_layout.map(item=>item.id)),
    visual_system:new Set(registry.axes.visual_system.map(item=>item.id)),
    typography:new Set(registry.axes.typography.map(item=>item.id)),
    motion_grammar:new Set(registry.axes.motion_grammar.map(item=>item.id)),
    asset_staging:new Set(registry.axes.asset_staging.map(item=>item.id)),
    graphic_devices:new Set(registry.axes.graphic_devices.map(item=>item.id)),
  };
  const vocabulary={
    structural_layout:sortedUnique(policy.structural_layouts),
    visual_system:sortedUnique(policy.visual_systems),
    typography:sortedUnique(policy.typography),
    motion_grammar:sortedUnique(policy.motion_grammars),
    asset_staging:sortedUnique(policy.asset_staging),
    graphic_devices:sortedUnique(policy.graphic_devices),
  };
  for(const axis of AXES)for(const id of vocabulary[axis])if(!registryIds[axis].has(id))throw new Error(`inverse vocabulary ${axis} contains unknown registry option ${id}`);
  return vocabulary;
}

function gridMass(grid,cols,rows){
  let total=0,selected=0;
  for(let y=0;y<4;y++)for(let x=0;x<4;x++){
    const value=Math.max(0,Number(grid?.[y]?.[x])||0);total+=value;
    if(cols.includes(x)&&rows.includes(y))selected+=value;
  }
  return total>0?selected/total:0;
}
function columnMass(grid,columns){return gridMass(grid,columns,[0,1,2,3]);}
function rowMass(grid,rows){return gridMass(grid,[0,1,2,3],rows);}
function gridSymmetry(grid){
  let diff=0,total=0;
  for(let y=0;y<4;y++)for(let x=0;x<2;x++){
    const a=Math.max(0,Number(grid?.[y]?.[x])||0),b=Math.max(0,Number(grid?.[y]?.[3-x])||0);
    diff+=Math.abs(a-b);total+=a+b;
  }
  return clamp01(1-safeRatio(diff,total||1));
}
function spatialSpread(grid){
  const values=[];for(const row of grid||[])for(const cell of row||[])values.push(Math.max(0,Number(cell)||0));
  const total=values.reduce((a,b)=>a+b,0);if(total<=0)return 0;
  const probs=values.map(v=>v/total).filter(v=>v>0);
  const entropy=-probs.reduce((sum,p)=>sum+p*Math.log(p),0)/Math.log(16);
  return clamp01(entropy);
}
function candidate(id,score,...evidence){return {id,score:clamp01(score),evidence:evidence.filter(Boolean)};}
function ensureVocabularyCandidates(candidates,allowed,baseScore=0.02){
  const byId=new Map(candidates.map(item=>[item.id,item]));
  for(const id of allowed)if(!byId.has(id))byId.set(id,candidate(id,baseScore,'bounded_dsl_candidate'));
  return rankCandidates([...byId.values()].filter(item=>allowed.includes(item.id)));
}

function inferLayoutCandidates(observation,allowed){
  const grid=observation.appearance.edge_grid;
  const center=gridMass(grid,[1,2],[1,2]);
  const top=rowMass(grid,[0,1]);
  const left=columnMass(grid,[0,1]);
  const right=columnMass(grid,[2,3]);
  const symmetry=gridSymmetry(grid);
  const spread=spatialSpread(grid);
  const balance=1-Math.min(1,Math.abs(left-right));
  const bottomRight=gridMass(grid,[2,3],[2,3]);
  return ensureVocabularyCandidates([
    candidate('layout_type_led_poster_v2',0.18+0.45*top+0.18*left,'edge_mass_top','edge_mass_left'),
    candidate('layout_split_editorial_v2',0.15+0.50*balance+0.18*(1-center),'left_right_balance','low_center_dominance'),
    candidate('layout_cover_dominant_stage_v2',0.12+0.68*center,'center_edge_mass'),
    candidate('layout_modular_card_stack_v2',0.12+0.65*spread,'distributed_edge_mass'),
    candidate('layout_quote_wall_v2',0.12+0.40*left+0.25*bottomRight,'left_edge_mass','bottom_right_payoff'),
    candidate('layout_centered_cinematic_v2',0.12+0.45*symmetry+0.30*center,'horizontal_symmetry','center_edge_mass'),
  ],allowed);
}

function inferMotionCandidates(observation,allowed){
  const motion=observation.motion;
  const e=clamp01(motion.mean_abs_diff/0.14);
  const p=clamp01(motion.p95_abs_diff/0.28);
  const burst=clamp01(motion.burstiness/2.5);
  const h=clamp01(motion.directional_bias.horizontal);
  const v=clamp01(motion.directional_bias.vertical);
  const delta=motion.feature_centroid_delta||{};
  const displacement=clamp01(((Number(delta.mean_abs_dx)||0)+(Number(delta.mean_abs_dy)||0))/10);
  const cutRate=clamp01((observation.cut_candidates?.length||0)/6);
  const centerMotion=gridMass(motion.activity_grid,[1,2],[1,2]);
  return ensureVocabularyCandidates([
    candidate('motion_editorial_cuts_v2',0.15+0.55*(1-e)+0.30*cutRate,'low_continuous_motion','cut_candidates'),
    candidate('motion_staggered_type_v2',0.12+0.48*v*displacement+0.25*e,'vertical_feature_displacement','motion_energy'),
    candidate('motion_directional_slide_v2',0.12+0.55*h*displacement+0.20*e,'horizontal_feature_displacement','motion_energy'),
    candidate('motion_scale_depth_reveal_v2',0.12+0.42*centerMotion+0.25*e*(1-displacement),'center_motion','low_translation_relative_to_motion'),
    candidate('motion_restrained_parallax_v2',0.12+0.42*(1-p)+0.30*displacement*(1-e),'restrained_motion','small_feature_displacement'),
    candidate('motion_rhythmic_cards_v2',0.12+0.36*e+0.28*burst+0.22*cutRate,'motion_energy','burstiness','cut_cadence'),
  ],allowed);
}

function inferStagingCandidates(observation,allowed){
  const grid=observation.appearance.edge_grid;
  const center=gridMass(grid,[1,2],[1,2]);
  const edge=1-center;
  const spread=spatialSpread(grid);
  const asymmetry=1-gridSymmetry(grid);
  return ensureVocabularyCandidates([
    candidate('stage_hero_cover_v2',0.16+0.34*center,'center_visual_mass'),
    candidate('stage_partial_crop_detail_v2',0.14+0.27*edge+0.08*spread,'edge_visual_mass'),
    candidate('stage_depth_stack_v2',0.14+0.27*spread,'distributed_visual_mass'),
    candidate('stage_edge_peek_v2',0.14+0.30*edge+0.08*asymmetry,'edge_visual_mass','asymmetry'),
    candidate('stage_repeated_card_motif_v2',0.14+0.28*spread,'distributed_visual_mass'),
    candidate('stage_floating_tilt_v2',0.14+0.18*asymmetry+0.12*center,'asymmetry','center_visual_mass'),
  ],allowed);
}

function unresolvedCandidates(ids,reason){return rankCandidates(ids.map(id=>candidate(id,0.2,reason)));}
function axisConfidence(candidates){
  if(!candidates?.length)return 0;
  const top=candidates[0]?.score||0,second=candidates[1]?.score||0;
  return round(clamp01(top*0.65+Math.max(0,top-second)*1.2));
}

export function inferCreativeHypothesis(observation,{registry=buildCanonicalTemplateVariabilityRegistry()}={}){
  const report=validateVideoObservation(observation);
  if(!report.valid)throw new Error(`observation rejected: ${JSON.stringify(report.errors)}`);
  const vocabulary=buildInverseVocabulary(registry);
  const structural_layout=inferLayoutCandidates(observation,vocabulary.structural_layout);
  const motion_grammar=inferMotionCandidates(observation,vocabulary.motion_grammar);
  const asset_staging=inferStagingCandidates(observation,vocabulary.asset_staging);
  const visual_system=unresolvedCandidates(vocabulary.visual_system,'not_identifiable_from_v1_scalar_observations');
  const typography=unresolvedCandidates(vocabulary.typography,'font_and_hierarchy_classifier_not_in_v1');
  const graphic_devices=unresolvedCandidates(vocabulary.graphic_devices,'device_detector_not_in_v1');
  const axes={structural_layout,visual_system,typography,motion_grammar,asset_staging,graphic_devices};
  const confidences=Object.fromEntries(AXES.map(axis=>[axis,axisConfidence(axes[axis])]));
  const resolvedAxes=AXES.filter(axis=>confidences[axis]>=0.5);
  const ambiguousAxes=AXES.filter(axis=>confidences[axis]<0.5);
  const hypothesis={
    schema:INVERSE_CREATIVE_HYPOTHESIS_SCHEMA,
    version:1,
    observation_id:observation.observation_id||null,
    delivery:{
      aspect:inferDeliveryAspect(observation.source.width,observation.source.height),
      width:observation.source.width,
      height:observation.source.height,
      fps:round(observation.source.fps,3),
      duration_seconds:round(observation.source.duration_seconds,3),
    },
    temporal:{
      cut_candidates:observation.cut_candidates.map(item=>({time_seconds:round(item.time_seconds,3),score:round(item.score)})),
      sampled_frames:observation.sampling.sampled_frames,
      sample_fps:observation.sampling.sample_fps,
    },
    axes,
    explainability:{
      temporal:round(clamp01(0.7+Math.min(0.25,(observation.cut_candidates.length||0)*0.04))),
      layout:confidences.structural_layout,
      motion:confidences.motion_grammar,
      appearance:round(clamp01(0.25+0.35*spatialSpread(observation.appearance.edge_grid))),
      typography:confidences.typography,
      asset_staging:confidences.asset_staging,
      graphic_devices:confidences.graphic_devices,
      dsl_coverage:round(resolvedAxes.length/AXES.length),
      unresolved_axes:ambiguousAxes,
    },
    ambiguity:ambiguousAxes.map(axis=>({axis,reason:axis==='typography'||axis==='visual_system'||axis==='graphic_devices'?'detector_not_implemented_v1':'candidate_margin_too_small'})),
  };
  hypothesis.hypothesis_id=`nbinv1_${sha256Canonical(hypothesis)}`;
  return hypothesis;
}

function maybeId(value){return typeof value==='string'&&value?value:null;}
export function extractGroundTruthAxes(sceneProgram){
  if(!isObject(sceneProgram))throw new Error('scene program required');
  const typography=sortedUnique((sceneProgram.typography_fits||[]).map(item=>item.system_id).filter(Boolean));
  const devices=sortedUnique((sceneProgram.graphic_devices||[]).map(item=>item.device_id).filter(Boolean));
  return {
    structural_layout:maybeId(sceneProgram.resolved_layout?.family_id),
    visual_system:maybeId(sceneProgram.visual_system),
    typography:typography.length===1?typography[0]:typography,
    motion_grammar:maybeId(sceneProgram.motion_recipe?.family_id),
    asset_staging:maybeId(sceneProgram.cover_staging?.family_id),
    graphic_devices:devices,
  };
}
function rankOf(candidates,truth){
  const truths=Array.isArray(truth)?truth:[truth];
  const ranks=truths.filter(Boolean).map(id=>candidates.findIndex(item=>item.id===id)).filter(index=>index>=0).map(index=>index+1);
  return ranks.length?Math.min(...ranks):null;
}
export function scoreInverseHypothesis({hypothesis,scene_program}){
  if(hypothesis?.schema!==INVERSE_CREATIVE_HYPOTHESIS_SCHEMA)throw new Error('inverse hypothesis required');
  const truth=extractGroundTruthAxes(scene_program);
  const axes={};
  for(const axis of AXES){
    const rank=rankOf(hypothesis.axes?.[axis]||[],truth[axis]);
    axes[axis]={truth:truth[axis],rank,top1:rank===1,top3:rank!==null&&rank<=3};
  }
  const comparable=Object.values(axes).filter(item=>item.rank!==null);
  const result={
    schema:INVERSE_BENCHMARK_SCHEMA,
    version:1,
    hypothesis_id:hypothesis.hypothesis_id,
    scene_program_id:scene_program.scene_program_id||null,
    delivery_aspect_match:hypothesis.delivery.aspect===scene_program.delivery?.aspect,
    axes,
    top1_accuracy:round(safeRatio(comparable.filter(item=>item.top1).length,comparable.length)),
    top3_accuracy:round(safeRatio(comparable.filter(item=>item.top3).length,comparable.length)),
    comparable_axes:comparable.length,
  };
  result.benchmark_id=`nbinvbench1_${sha256Canonical(result)}`;
  return result;
}
