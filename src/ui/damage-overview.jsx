import {useMemo,useState} from 'preact/hooks';
import {dex,speciesName,moveName,itemName,abilityName,STAT_JA} from '../engine/dex.js';
import {currentAbility,currentSpecies} from '../engine/calc.js';
import {damageRange} from '../engine/damage-range.js';
import {attackTable} from '../engine/board.js';
import {Sprite,TypeChip,Toggle,Seg,Sheet,Empty,cx,fmtPct} from './common.jsx';
import {DamageLab} from './dmglab.jsx';

const WALLS=[['reflect','リフレクター'],['lightScreen','ひかりのかべ'],['auroraVeil','オーロラベール']];
const STATUS={brn:'やけど',par:'まひ',psn:'どく',tox:'もうどく',slp:'ねむり',frz:'こおり'};
export function DamageOverview({battle,ctx}) {
 const [side,setSide]=useState('me'),[selected,setSelected]=useState({me:null,opp:null}),[formes,setFormes]=useState({}),[crit,setCrit]=useState(false),[detail,setDetail]=useState(null);
 const opposite=side==='me'?'opp':'me';
 const list=s=>s==='me'?battle.my:battle.opp;
 const current=s=>{const valid=i=>i!=null&&dex.species[list(s)[i]?.species];return valid(selected[s])?selected[s]:battle.state.sides[s].active.find(valid)??list(s).findIndex(b=>dex.species[b.species]);};
 const idx=current(side);
 const preview=useMemo(()=>{
  const c={...ctx,cond:(s,i)=>({...ctx.cond(s,i),...(formes[`${s}${i}`]!==undefined?{forme:formes[`${s}${i}`]}:{})})};
  c.ability=(s,i)=>currentAbility(c.build(s,i),c.cond(s,i));return c;
 },[ctx,JSON.stringify(formes)]);
 const table=useMemo(()=>attackTable(preview,side,idx,{crit,includeStatus:true,includeFainted:true}),[preview,side,idx,crit]);
 const moves=(table?.moves||[]).slice(0,side==='me'?4:8);
 const ranges=useMemo(()=>moves.map(m=>({...m,cells:(table?.targets||[]).map(t=>({...t,r:damageRange(preview,side,idx,t.idx,m.id,{crit})}))})),[preview,side,idx,crit,table]);
 const selectForm=(s,i,forme)=>setFormes(prev=>({...Object.fromEntries(Object.entries(prev).filter(([k])=>!k.startsWith(s))),[`${s}${i}`]:forme}));
 const stateText=(s,i)=>[STATUS[preview.cond(s,i)?.status],...WALLS.filter(([k])=>battle.state.sides[s][k]).map(([,label])=>label)].filter(Boolean).join('・');
 if(!battle.my.some(b=>dex.species[b.species])||!battle.opp.some(b=>dex.species[b.species]))return <Empty>自分と相手のポケモンを登録すると、6体のダメージを一覧できます。</Empty>;
 return <div class="damage-overview">
  <div class="damage-overview-head"><Seg value={side} options={[["me","与ダメージ"],["opp","被ダメージ"]]} onChange={s=>{setSide(s);setDetail(null);}}/><Toggle small on={crit} onChange={setCrit}>急所</Toggle><span class="muted">タップで内訳</span>{stateText(side,idx)&&<span class="damage-active-effects">攻撃側：{stateText(side,idx)}</span>}</div>
  <p class="damage-range-help"><b>配分候補＋乱数の最小〜最大</b>　観測済みの能力・性格補正・能力Pt合計66で絞り込み。持ち物・特性は現在の想定を固定。特殊な参照をする技は「想定配分」と表示します。</p>
  <div class="damage-move-grid">{ranges.map(m=><section class="damage-move" key={m.id}>
   <header><TypeChip type={dex.moves[m.id].t} small/><b>{moveName(m.id)}</b><small>{dex.moves[m.id].c==='Z'?'変化技':`${dex.moves[m.id].c==='P'?'物理':'特殊'}・威力${dex.moves[m.id].bp || '変動'}`}</small></header>
   <div class="damage-six">{m.cells.map(t=>{const r=t.r;return <button key={t.idx} class={cx('damage-target',t.idx===current(opposite)&&'focused',t.active&&'active')} onClick={()=>{setSelected(p=>({...p,[opposite]:t.idx}));setDetail({move:m.id,target:t,r});}}>
    <span class="damage-target-name"><Sprite id={currentSpecies(preview.build(t.side,t.idx),preview.cond(t.side,t.idx))} size={28}/><b>{speciesName(currentSpecies(preview.build(t.side,t.idx),preview.cond(t.side,t.idx)))}</b>{preview.cond(t.side,t.idx).fainted&&<small>瀕死</small>}</span>
    {!r?.ok?<small class="muted">計算条件を確認</small>:r.status?<span class="muted">変化技</span>:r.immune?<b class="muted">効果なし</b>:<>
     <span class="damage-percent num">{fmtPct(r.minPct)}<span>〜</span>{fmtPct(r.maxPct)}<small>%</small></span>
     <span class="damage-range-bar" aria-hidden="true"><i style={{width:`${Math.min(100,r.maxPct)}%`}}/><b style={{width:`${Math.min(100,r.minPct)}%`}}/></span>
     
    </>}
    <span class="damage-cell-caption"><small class="damage-cell-note">{r?.rangeMode==='assumed'?'想定配分':r?.koText||''}</small>{stateText(t.side,t.idx)&&<small class="damage-cell-effects">{stateText(t.side,t.idx)}</small>}</span>
   </button>;})}</div>
  </section>)}</div>
  {!moves.length&&<Empty>攻撃側の技が未登録です。盤面で技を登録してください。</Empty>}
  <div class="damage-bottom-picker">{['me','opp'].map(s=>{const i=current(s),bd=list(s)[i],fm=dex.species[bd?.species]?.megas||[];return <div class="damage-team-picker" key={s}>
   <div class="damage-team-label"><b class={s}>{s==='me'?'自分':'相手'}</b><span>{s===side?'攻撃側':'受ける側・枠を強調'}</span></div>
   <div class="damage-team-icons">{list(s).map((b,i)=>dex.species[b.species]&&<button class={cx('damage-mon',i===current(s)&&'on')} aria-label={`${s==='me'?'自分':'相手'}の${speciesName(b.species)}を計算`} aria-pressed={i===current(s)} onClick={()=>setSelected(p=>({...p,[s]:i}))}><Sprite id={currentSpecies(preview.build(s,i),preview.cond(s,i))} size={32}/><small>{speciesName(b.species)}</small></button>)}</div>
   {!!fm.length&&<div class="damage-form-picker"><span>計算する姿</span><button class={cx('chip sm',!preview.cond(s,i).forme&&'on')} onClick={()=>selectForm(s,i,null)}>通常</button>{fm.map(f=><button class={cx('chip sm',preview.cond(s,i).forme===f&&'on')} aria-pressed={preview.cond(s,i).forme===f} onClick={()=>selectForm(s,i,f)}>{speciesName(f)}</button>)}</div>}
  </div>;})}</div>
  <p class="hint">姿の切り替えは計算用です。対戦の記録は変更しません。天候・フィールド・壁・状態異常・能力ランクは盤面を反映します。</p>
  <details class="damage-manual"><summary>配分・持ち物・特性を指定して詳しく計算</summary><DamageLab battle={battle} ctx={preview}/></details>
  {detail&&<Sheet title={`${moveName(detail.move)} → ${speciesName(detail.target.species)}`} onClose={()=>setDetail(null)}><div class="pad">
   {detail.r?.ok&&!detail.r.status?<><p class="big num">{fmtPct(detail.r.minPct)}〜{fmtPct(detail.r.maxPct)}%</p><p>{detail.r.rangeMode==='assumed'?'この技は現在の想定配分で計算しています。':'観測条件に合う配分とダメージ乱数を含めた範囲です。'}</p>{[['最小側',detail.r.lowBuild],['最大側',detail.r.highBuild]].map(([label,build])=>build&&<p><b>{label}</b>：{dex.natures[build.nature]?.j||build.nature} / {build.sp.map((v,i)=>`${STAT_JA[i]}${v}`).join('・')} Pt</p>)}</>:<p>{detail.r?.status?'変化技です。実際の効果は盤面で技を記録すると反映されます。':detail.r?.error||'計算できませんでした'}</p>}
   <h4>相手の計算条件</h4>{(()=>{const i=side==='me'?detail.target.idx:idx,bd=preview.build('opp',i);return <p>持ち物：{itemName(bd.item)||'なし'}{!battle.opp[i].item?'（想定）':''}<br/>特性：{abilityName(preview.ability('opp',i))||'なし'}{!battle.opp[i].ability?'（想定）':''}</p>;})()}
   <p>{stateText(detail.target.side,detail.target.idx)||'受ける側の壁・状態異常なし'}</p>{detail.target.notes.map(note=><p class="hint">{note}</p>)}
  </div></Sheet>}
 </div>;
}
