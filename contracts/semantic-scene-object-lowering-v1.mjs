import {lowerOrganic} from './semantic-scene-object-lowering-organic-v1.mjs';
import {lowerStructured} from './semantic-scene-object-lowering-structured-v1.mjs';
const ORGANIC_PREFIXES=['scene_tree_','scene_landscape_','scene_person_','scene_crowd_','scene_planet_','scene_orbit_','scene_botanical_','scene_cloud_','scene_constellation_','scene_moon_'];
export function lowerSemanticSceneObject(id,params,seed){return ORGANIC_PREFIXES.some(prefix=>id.startsWith(prefix))?lowerOrganic(id,params,seed):lowerStructured(id,params,seed);}
