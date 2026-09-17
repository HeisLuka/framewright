import {lowerOrganic} from './semantic-scene-object-lowering-organic-v1.mjs';
import {lowerStructured} from './semantic-scene-object-lowering-structured-v1.mjs';
export function lowerSemanticSceneObject(id,params,seed){return id.startsWith('scene_tree_')||id.startsWith('scene_landscape_')||id.startsWith('scene_person_')||id.startsWith('scene_crowd_')||id.startsWith('scene_planet_')||id.startsWith('scene_orbit_')?lowerOrganic(id,params,seed):lowerStructured(id,params,seed);}
