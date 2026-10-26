// HP×防御/特防の相関、1つの性格、能力Pt合計66を同時に満たす配分の領域。
// 全33^6配分は列挙せず、HP・性格ごとの各能力の許容値と最小コストを持つ。
import {dex,STAT_KEYS,natureMod,SP_TOTAL} from './dex.js';
const cache=new WeakMap();
export const domainCombo=(nature,key,sp)=>(natureMod(nature,key)<1?0:natureMod(nature,key)>1?66:33)+sp;
export function spreadDomains(opp, item=opp.item || '', fixedItem=false) {
  const signature=JSON.stringify([opp.statOk,opp.speOk,item,fixedItem]);
  const prior=cache.get(opp);if(prior?.signature===signature)return prior.blocks;
  const masks=opp.statOk || {}, blocks=[];
  const speeds=item==='choicescarf' ? opp.speOk?.scarf : item || fixedItem ? opp.speOk?.plain : null;
  const speedOK=c=>speeds ? speeds[c]==='1' : !opp.speOk || !opp.speOk.plain && !opp.speOk.scarf || opp.speOk.plain?.[c]==='1' || opp.speOk.scarf?.[c]==='1';
  for(let h=0;h<=32;h++) {
    if(masks.hp && masks.hp[h]!=='1')continue;
    for(const nature of Object.keys(dex.natures)) {
      const choices=STAT_KEYS.slice(1).map(k=>Array.from({length:33},(_,sp)=>sp).filter(sp=>{
        const c=domainCombo(nature,k,sp), mask=masks[k];
        return (!mask || mask[(mask.length===99?0:h*99)+c]==='1') && (k!=='spe' || speedOK(c));
      }));
      if(choices.some(v=>!v.length))continue;
      const mins=[h,...choices.map(v=>v[0])],cost=mins.reduce((a,v)=>a+v,0);
      if(cost>SP_TOTAL)continue;
      const feasible=choices.map((v,i)=>v.filter(sp=>cost-mins[i+1]+sp<=SP_TOTAL));
      blocks.push({h,nature,choices:feasible,mins,cost});
    }
  }
  cache.set(opp,{signature,blocks});return blocks;
}
export function supportedMasks(opp) {
  const blocks=spreadDomains(opp), hp=Array(33).fill('0'), masks=Object.fromEntries(STAT_KEYS.slice(1).map(k=>[k,Array(k==='def'||k==='spd'?3267:99).fill('0')]));
  if(!blocks.length)return null;
  for(const b of blocks){hp[b.h]='1';for(let i=0;i<5;i++){const key=STAT_KEYS[i+1];for(const sp of b.choices[i])masks[key][(key==='def'||key==='spd'?b.h*99:0)+domainCombo(b.nature,key,sp)]='1';}}
  return {hp:hp.join(''),...Object.fromEntries(Object.entries(masks).map(([k,v])=>[k,v.join('')]))};
}
