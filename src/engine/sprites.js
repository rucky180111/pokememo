import {dex, toID} from './dex.js';
import manifest from '../generated/sprites.json' with {type:'json'};

const HYPHEN_NAMES = new Set(['Kommo-o','Hakamo-o','Jangmo-o','Ho-Oh','Porygon-Z','Ting-Lu','Chien-Pao','Wo-Chien','Chi-Yu']);
const SHARED_ART = {aegislashshield:'aegislash',aegislashboth:'aegislash',polteageistantique:'polteageist',sinistchamasterpiece:'sinistcha'};
export function spriteIds(id) {
  const s = dex.species[id];
  if (!s) return [];
  if (SHARED_ART[id]) return [SHARED_ART[id]];
  const at = s.n.indexOf('-');
  return [at > 0 && !HYPHEN_NAMES.has(s.n) ? `${toID(s.n.slice(0,at))}-${toID(s.n.slice(at+1))}` : toID(s.n)];
}
export function spriteSources(id) {
  if (!dex.species[id]) return [];
  const sources = manifest.files[id] ? [`./sprites/${id}.webp?v=${manifest.revision.slice(0,10)}`] : [];
  // 正しいフォルムの画像だけを試す。欠けたメガ/リージョンを通常の姿で代用しない。
  return sources.concat(spriteIds(id).map(name => `https://play.pokemonshowdown.com/sprites/gen5/${name}.png`));
}
