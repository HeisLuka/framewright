import { readFileSync } from 'node:fs';
import { sha256Canonical } from './factory-identity-v1.mjs';
import {
  TEMPLATE_VARIABILITY_ASPECTS,
  TEMPLATE_VARIABILITY_DURATIONS,
  TEMPLATE_VARIABILITY_ROLES,
  loadDefaultTemplateVariabilityRegistry,
  materializeTemplateVariabilityRegistry,
} from './template-variability-v1.mjs';

export const STRUCTURAL_LAYOUT_FAMILY_REGISTRY_SCHEMA='newboo-structural-layout-family-registry-v2';
export const RESOLVED_STRUCTURAL_LAYOUT_SCHEMA='newboo-resolved-structural-layout-v2';
export const STRUCTURAL_LAYOUT_SAFE_UNITS=1000;

const SLOT_NAMES=['primary_text','secondary_text','cover','cta','meta'];
const COMPOSITIONS=new Set([
  'type_led_poster','split_editorial','cover_dominant_stage','modular_card_stack','quote_wall','centered_cinematic',
]);
const REVEAL_MODES=new Set([
  'poster_lockup','split_cover_copy','center_cover_stage','modular_cover_card','quote_to_corner_cover','center_cover_then_lockup',
]);
const ROLE_BINDINGS={
  hook:{text_slot:'primary_text'},
  tension:{text_slot:'primary_text'},
  desire_payoff:{text_slot:'primary_text'},
  book_reveal:{text_slot:'secondary_text',asset_slot:'cover'},
  cta:{text_slot:'cta',asset_slot:'cover'},
};

function isObject(value){return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function clone(value){return structuredClone(value);}
function box(x,y,w,h){return {x,y,w,h};}
function add(errors,code,path,message){errors.push({code,path,message});}
function sortErrors(errors){return errors.sort((a,b)=>a.path.localeCompare(b.path)||a.code.localeCompare(b.code)||a.message.localeCompare(b.message));}
function intersects(a,b){return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;}
function area(value){return value.w*value.h;}
function center(value){return {x:value.x+value.w/2,y:value.y+value.h/2};}

const GEOMETRY={
  type_led_poster:{
    vertical:{primary_text:box(40,60,920,430),secondary_text:box(520,520,440,160),cover:box(40,520,420,330),cta:box(520,720,440,120),meta:box(40,910,920,50)},
    square:{primary_text:box(50,50,900,360),secondary_text:box(460,450,490,170),cover:box(50,450,360,360),cta:box(460,660,490,140),meta:box(50,900,900,50)},
    landscape:{primary_text:box(50,80,560,500),secondary_text:box(660,590,290,120),cover:box(660,80,290,480),cta:box(660,740,290,130),meta:box(50,920,900,40)},
  },
  split_editorial:{
    vertical:{primary_text:box(40,80,480,500),secondary_text:box(40,620,480,150),cover:box(570,100,390,590),cta:box(570,730,390,130),meta:box(40,920,920,40)},
    square:{primary_text:box(50,80,420,500),secondary_text:box(50,620,420,150),cover:box(530,80,420,500),cta:box(530,620,420,150),meta:box(50,900,900,50)},
    landscape:{primary_text:box(50,90,430,600),secondary_text:box(50,730,430,120),cover:box(520,90,430,600),cta:box(520,730,430,120),meta:box(50,920,900,40)},
  },
  cover_dominant_stage:{
    vertical:{primary_text:box(60,40,880,190),secondary_text:box(100,720,800,100),cover:box(220,270,560,420),cta:box(240,850,520,110),meta:box(800,230,140,30)},
    square:{primary_text:box(80,40,840,180),secondary_text:box(100,720,800,90),cover:box(230,260,540,430),cta:box(250,840,500,110),meta:box(780,220,140,30)},
    landscape:{primary_text:box(60,80,420,230),secondary_text:box(60,360,420,180),cover:box(540,80,410,650),cta:box(60,600,420,130),meta:box(60,900,890,40)},
  },
  modular_card_stack:{
    vertical:{primary_text:box(40,60,440,420),secondary_text:box(40,530,920,170),cover:box(540,60,420,420),cta:box(540,750,420,120),meta:box(40,920,920,40)},
    square:{primary_text:box(50,60,430,390),secondary_text:box(50,500,900,180),cover:box(520,60,430,390),cta:box(520,730,430,140),meta:box(50,920,900,30)},
    landscape:{primary_text:box(50,80,380,520),secondary_text:box(50,650,580,160),cover:box(470,80,480,520),cta:box(670,650,280,160),meta:box(50,920,900,40)},
  },
  quote_wall:{
    vertical:{primary_text:box(40,60,920,520),secondary_text:box(40,620,560,180),cover:box(650,620,310,230),cta:box(40,850,500,110),meta:box(650,900,310,50)},
    square:{primary_text:box(50,50,900,430),secondary_text:box(50,520,560,180),cover:box(650,520,300,250),cta:box(50,790,500,130),meta:box(650,850,300,50)},
    landscape:{primary_text:box(50,80,600,460),secondary_text:box(50,580,600,170),cover:box(700,80,250,500),cta:box(700,620,250,130),meta:box(50,920,900,40)},
  },
  centered_cinematic:{
    vertical:{primary_text:box(140,550,720,200),secondary_text:box(190,770,620,70),cover:box(280,60,440,450),cta:box(280,860,440,100),meta:box(40,20,920,30)},
    square:{primary_text:box(130,500,740,180),secondary_text:box(180,700,640,70),cover:box(300,60,400,390),cta:box(290,800,420,120),meta:box(50,950,900,30)},
    landscape:{primary_text:box(80,620,840,130),secondary_text:box(180,770,640,60),cover:box(350,60,300,520),cta:box(300,850,400,100),meta:box(50,20,900,30)},
  },
};

export function classifyStructuralCopyDensity(copy={}){
  const hook=typeof copy.hook==='string'?copy.hook.trim():'';
  const title=typeof copy.title==='string'?copy.title.trim():'';
  const author=typeof copy.author==='string'?copy.author.trim():'';
  const cta=typeof copy.cta==='string'?copy.cta.trim():'';
  const weighted=hook.length+title.length*0.8+author.length*0.35+cta.length*0.35;
  return weighted<=80?'short':weighted<=180?'medium':'long';
}

export function loadStructuralLayoutFamilyRegistry(){
  const registry=JSON.parse(readFileSync(new URL('./structural-layout-families-v2.json',import.meta.url),'utf8'));
  const report=validateStructuralLayoutFamilyRegistry(registry);
  if(!report.valid)throw new Error(`invalid C39 layout registry: ${JSON.stringify(report.errors)}`);
  return registry;
}

export function computeStructuralLayoutFamilyRegistryId(registry){
  return `c39lr2_${sha256Canonical(registry)}`;
}

export function validateStructuralLayoutFamilyRegistry(registry){
  const errors=[];
  if(!isObject(registry))return {valid:false,errors:[{code:'TYPE_OBJECT_REQUIRED',path:'',message:'layout registry must be an object'}]};
  const topAllowed=new Set(['schema','version','families']);
  for(const key of Object.keys(registry).sort())if(!topAllowed.has(key))add(errors,'UNKNOWN_FIELD',`/${key}`,`unknown field ${key}`);
  if(registry.schema!==STRUCTURAL_LAYOUT_FAMILY_REGISTRY_SCHEMA)add(errors,'SCHEMA_VERSION_MISMATCH','/schema',`expected ${STRUCTURAL_LAYOUT_FAMILY_REGISTRY_SCHEMA}`);
  if(registry.version!==2)add(errors,'VERSION_UNSUPPORTED','/version','version must be 2');
  if(!Array.isArray(registry.families)||registry.families.length<6)add(errors,'FAMILY_COUNT_INSUFFICIENT','/families','at least six structural layout families are required');
  else{
    const ids=[];
    registry.families.forEach((family,index)=>{
      const path=`/families/${index}`;
      if(!isObject(family)){add(errors,'TYPE_OBJECT_REQUIRED',path,'family must be an object');return;}
      const allowed=new Set(['id','version','composition','book_reveal_mode','reading_order']);
      for(const key of Object.keys(family).sort())if(!allowed.has(key))add(errors,'UNKNOWN_FIELD',`${path}/${key}`,`unknown field ${key}`);
      if(typeof family.id!=='string'||!/^layout_[a-z0-9_]+_v2$/.test(family.id))add(errors,'INVALID_FAMILY_ID',`${path}/id`,'family ID must be a stable layout_*_v2 ID');
      else ids.push(family.id);
      if(family.version!==2)add(errors,'INVALID_VERSION',`${path}/version`,'family version must be 2');
      if(!COMPOSITIONS.has(family.composition))add(errors,'COMPOSITION_UNSUPPORTED',`${path}/composition`,`unsupported composition ${family.composition}`);
      if(!REVEAL_MODES.has(family.book_reveal_mode))add(errors,'REVEAL_MODE_UNSUPPORTED',`${path}/book_reveal_mode`,`unsupported reveal mode ${family.book_reveal_mode}`);
      if(!Array.isArray(family.reading_order)||family.reading_order.length!==SLOT_NAMES.length||new Set(family.reading_order).size!==SLOT_NAMES.length||family.reading_order.some(slot=>!SLOT_NAMES.includes(slot)))add(errors,'READING_ORDER_INVALID',`${path}/reading_order`,'reading_order must contain every structural slot exactly once');
      if(family.composition&&(!GEOMETRY[family.composition]||TEMPLATE_VARIABILITY_ASPECTS.some(aspect=>!GEOMETRY[family.composition][aspect])))add(errors,'GEOMETRY_MISSING',`${path}/composition`,'composition must define all supported aspects');
    });
    if(new Set(ids).size!==ids.length)add(errors,'DUPLICATE_FAMILY_ID','/families','family IDs must be unique');
  }
  return {valid:errors.length===0,errors:sortErrors(errors),registry_id:errors.length?null:computeStructuralLayoutFamilyRegistryId(registry)};
}

export function extendRegistryWithStructuralLayouts(baseRegistry=loadDefaultTemplateVariabilityRegistry(),familyRegistry=loadStructuralLayoutFamilyRegistry()){
  const familyReport=validateStructuralLayoutFamilyRegistry(familyRegistry);
  if(!familyReport.valid)throw new Error(`invalid family registry: ${JSON.stringify(familyReport.errors)}`);
  const next=clone(baseRegistry);
  next.registry_id='auto';
  const existing=new Set(next.axes.structural_layout.map(option=>option.id));
  for(const family of familyRegistry.families){
    if(existing.has(family.id))throw new Error(`structural layout option already exists: ${family.id}`);
    next.axes.structural_layout.push({
      id:family.id,
      version:family.version,
      supported_semantic_roles:[...TEMPLATE_VARIABILITY_ROLES],
      supported_duration_seconds:[...TEMPLATE_VARIABILITY_DURATIONS],
      supported_aspects:[...TEMPLATE_VARIABILITY_ASPECTS],
      required_asset_kinds:[],
      requires:[],
    });
  }
  return materializeTemplateVariabilityRegistry(next);
}

export function resolveStructuralLayout({family_id,aspect,copy={}}){
  const registry=loadStructuralLayoutFamilyRegistry();
  const family=registry.families.find(item=>item.id===family_id);
  if(!family)throw new Error(`unknown structural layout family ${family_id}`);
  if(!TEMPLATE_VARIABILITY_ASPECTS.includes(aspect))throw new Error(`unsupported aspect ${aspect}`);
  const slots=clone(GEOMETRY[family.composition][aspect]);
  const copy_density=classifyStructuralCopyDensity(copy);
  const resolved={
    schema:RESOLVED_STRUCTURAL_LAYOUT_SCHEMA,
    family_id:family.id,
    family_version:family.version,
    aspect,
    safe_space:{width:STRUCTURAL_LAYOUT_SAFE_UNITS,height:STRUCTURAL_LAYOUT_SAFE_UNITS},
    copy_density,
    book_reveal_mode:family.book_reveal_mode,
    reading_order:[...family.reading_order],
    role_bindings:clone(ROLE_BINDINGS),
    slots,
  };
  resolved.layout_instance_id=`c39li2_${sha256Canonical({family_id:resolved.family_id,family_version:resolved.family_version,aspect:resolved.aspect,copy_density:resolved.copy_density,slots:resolved.slots,book_reveal_mode:resolved.book_reveal_mode,reading_order:resolved.reading_order})}`;
  return resolved;
}

export function validateResolvedStructuralLayout(layout){
  const errors=[];
  if(!isObject(layout))return {valid:false,errors:[{code:'TYPE_OBJECT_REQUIRED',path:'',message:'resolved layout must be an object'}]};
  if(layout.schema!==RESOLVED_STRUCTURAL_LAYOUT_SCHEMA)add(errors,'SCHEMA_VERSION_MISMATCH','/schema',`expected ${RESOLVED_STRUCTURAL_LAYOUT_SCHEMA}`);
  if(!TEMPLATE_VARIABILITY_ASPECTS.includes(layout.aspect))add(errors,'ASPECT_UNSUPPORTED','/aspect',`unsupported aspect ${layout.aspect}`);
  if(!isObject(layout.slots))add(errors,'TYPE_OBJECT_REQUIRED','/slots','slots must be an object');
  else{
    for(const slot of SLOT_NAMES){
      const value=layout.slots[slot],path=`/slots/${slot}`;
      if(!isObject(value)){add(errors,'SLOT_MISSING',path,`missing ${slot}`);continue;}
      for(const key of ['x','y','w','h'])if(!Number.isFinite(value[key]))add(errors,'INVALID_COORDINATE',`${path}/${key}`,`${key} must be finite`);
      if(Number.isFinite(value.x)&&Number.isFinite(value.y)&&Number.isFinite(value.w)&&Number.isFinite(value.h)){
        if(value.w<=0||value.h<=0)add(errors,'INVALID_BOX_SIZE',path,'slot width/height must be positive');
        if(value.x<0||value.y<0||value.x+value.w>STRUCTURAL_LAYOUT_SAFE_UNITS||value.y+value.h>STRUCTURAL_LAYOUT_SAFE_UNITS)add(errors,'SAFE_ZONE_VIOLATION',path,`${slot} leaves normalized safe space`);
      }
    }
    const critical=['primary_text','secondary_text','cover','cta'];
    for(let i=0;i<critical.length;i++)for(let j=i+1;j<critical.length;j++){
      const a=layout.slots[critical[i]],b=layout.slots[critical[j]];
      if(isObject(a)&&isObject(b)&&intersects(a,b))add(errors,'CRITICAL_SLOT_OVERLAP','/slots',`${critical[i]} overlaps ${critical[j]}`);
    }
  }
  if(!['short','medium','long'].includes(layout.copy_density))add(errors,'COPY_DENSITY_INVALID','/copy_density','copy density must be short, medium or long');
  const expected=errors.length?null:`c39li2_${sha256Canonical({family_id:layout.family_id,family_version:layout.family_version,aspect:layout.aspect,copy_density:layout.copy_density,slots:layout.slots,book_reveal_mode:layout.book_reveal_mode,reading_order:layout.reading_order})}`;
  if(expected&&layout.layout_instance_id!==expected)add(errors,'LAYOUT_ID_MISMATCH','/layout_instance_id',`expected ${expected}`);
  return {valid:errors.length===0,errors:sortErrors(errors)};
}

export function structuralLayoutDistance(a,b){
  if(!a?.slots||!b?.slots)throw new Error('resolved layouts required');
  let total=0;
  for(const slot of SLOT_NAMES){
    const ac=center(a.slots[slot]),bc=center(b.slots[slot]);
    const centerDistance=Math.hypot(ac.x-bc.x,ac.y-bc.y)/Math.hypot(STRUCTURAL_LAYOUT_SAFE_UNITS,STRUCTURAL_LAYOUT_SAFE_UNITS);
    const areaDistance=Math.abs(area(a.slots[slot])-area(b.slots[slot]))/(STRUCTURAL_LAYOUT_SAFE_UNITS**2);
    total+=centerDistance+areaDistance;
  }
  return total/SLOT_NAMES.length;
}

export function estimatePrimaryTextCapacity(layout){
  const primary=layout?.slots?.primary_text;
  if(!primary)return 0;
  const aspectFactor=layout.aspect==='landscape'?0.92:layout.aspect==='square'?1:1.05;
  return Math.floor(area(primary)/450*aspectFactor);
}
