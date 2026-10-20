// 観測マスク、性格、能力Pt合計66を満たす配分からダメージの外側の範囲を求める。
// 持ち物・特性はコンテキストの条件を固定する。未判明の全持ち物を網羅する範囲ではない。
import {dex,STAT_KEYS,natureMod,statValue,SP_TOTAL} from './dex.js';
import {comboOf} from './assume.js';
import {currentAbility,currentSpecies} from './calc.js';
import {attackTable} from './board.js';

const cache = new WeakMap();
export function candidateSpreads(opp, base, sid, stat) {
  const signature=JSON.stringify([opp.statOk,opp.speOk]);
  let cached = cache.get(opp);
  if (!cached || cached.signature!==signature) {cached=new Map();cached.signature=signature;cache.set(opp,cached);}
  const key=`${sid}:${stat}:${base.item}`;
  if(cached.has(key))return cached.get(key);
  const si=STAT_KEYS.indexOf(stat), masks=opp.statOk || {}, out=[];
  const speeds=base.item==='choicescarf' ? opp.speOk?.scarf : opp.speOk?.plain;
  for(let h=0;h<=32;h++) {
    if(masks.hp && masks.hp[h]!=='1')continue;
    for(const nature of Object.keys(dex.natures)) {
      const choices=STAT_KEYS.slice(1).map(k=>Array.from({length:33},(_,sp)=>sp).filter(sp=>{
        const c=comboOf(natureMod(nature,k),sp), mask=masks[k];
        if(mask && mask[(mask.length===99 ? 0 : h*99)+c]!=='1')return false;
        return k!=='spe' || !speeds || speeds[c]==='1';
      }));
      if(choices.some(a=>!a.length))continue;
      const sp=[h,...choices.map(a=>a[0])], used=sp.reduce((a,b)=>a+b,0);
      if(used>SP_TOTAL)continue;
      for(const v of choices[si-1]) {
        if(used-sp[si]+v>SP_TOTAL)continue;
        const spread=sp.slice();spread[si]=v;
        out.push({nature,sp:spread,hp:statValue(dex.species[sid].bs[0],h,1,true),value:statValue(dex.species[sid].bs[si],v,natureMod(nature,stat),false)});
      }
    }
  }
  // 同じ実数値の組をまとめる。通常技はHPと参照能力の大小に対して単調。
  const unique=[...new Map(out.map(v=>[`${v.hp}:${v.value}`,v])).values()];
  cached.set(key,unique);return unique;
}

function frontier(candidates, bulk) {
  if(!candidates.length)return [];
  if(!bulk) return [...new Set([candidates.reduce((a,b)=>a.value<b.value?a:b),candidates.reduce((a,b)=>a.value>b.value?a:b)])];
  // 片方の実数値だけが極端でも、HPと防御の相関を無視しない。
  const ends=[];
  for(const sign of [1,-1]) {
    const ordered=candidates.slice().sort((a,b)=>sign*(a.hp-b.hp || a.value-b.value));
    let best=sign===1?Infinity:-Infinity;
    for(const c of ordered)if(sign*c.value<sign*best){ends.push(c);best=c.value;}
  }
  return [...new Set(ends)];
}

const SPECIAL = new Set(['payback','boltbeak','fishiousrend','avalanche','brine','gyroball','electroball','foulplay','photongeyser','shellsidearm','terablast','waterspout','eruption','dragonenergy','flail','reversal','wringout','crushgrip','hardpress','finalgambit','endeavor','counter','mirrorcoat','metalburst','comeuppance','beatup','punishment']);
export function damageRange(ctx,side,attacker,defender,move,opts={}) {
  const mv=dex.moves[move], oi=side==='me'?defender:attacker;
  const base=ctx.build('opp',oi), cond=ctx.cond('opp',oi);
  const calc=c=>attackTable(c,side,attacker,{...opts,includeFainted:true,only:{def:defender,move}})?.targets[0]?.results[move];
  if(!mv||!base)return null;
  if(mv.c==='Z'||SPECIAL.has(move)||cond.transformed||ctx.ability(side,attacker)==='analytic') {
    const r=calc(ctx);return r?{...r,rangeMode:mv.c==='Z'?'status':'assumed'}:null;
  }
  const stat=side==='me' ? (mv.c==='P'||['psyshock','psystrike','secretsword'].includes(move)?'def':'spd') : move==='bodypress'?'def':mv.c==='P'?'atk':'spa';
  const candidates=frontier(candidateSpreads(ctx.b.opp[oi],base,currentSpecies(base,cond),stat),side==='me');
  let low=null,high=null, count=0;
  for(const spread of candidates) {
    const alt={...base,nature:spread.nature,sp:spread.sp,natureMods:undefined};
    const c={...ctx,build:(sd,i)=>sd==='opp'&&i===oi?alt:ctx.build(sd,i)};
    c.ability=(sd,i)=>currentAbility(c.build(sd,i),c.cond(sd,i));
    const r=calc(c);if(!r?.ok)continue;count++;
    if(!low||r.minPct<low.r.minPct)low={r,spread};
    if(!high||r.maxPct>high.r.maxPct)high={r,spread};
  }
  if(!low)return {ok:false,error:'観測条件に合う配分がありません'};
  return {...high.r,min:low.r.min,minPct:low.r.minPct,max:high.r.max,maxPct:high.r.maxPct,immune:high.r.max===0,rangeMode:'candidates',candidateCount:count,lowBuild:low.spread,highBuild:high.spread,lowResult:low.r,highResult:high.r,
    koText:low.r.minPct>=100?'全候補で確定1発':high.r.maxPct>=100?'1発の可能性あり':'',rolls:undefined,chance:null,guaranteed:low.r.minPct>=100};
}
