// 表示だけをまとめる。元の行動番号・時系列は保持し、各記録を訂正できる。
import {dex} from './dex.js';
import {actLine} from './flow.js';
const abilityNames = Object.values(dex.abilities).map(a => a.j);
const itemNames = Object.values(dex.items).map(a => a.j);
export function effectKind(text) {
  if (/メガシンカ/.test(text)) return 'メガシンカ';
  if (/推定|実数値|能力ポイント|絞り込|候補|説明がつ/.test(text)) return '推定';
  if (abilityNames.some(n => n && text.includes(n))) return '特性';
  if (itemNames.some(n => n && text.includes(n))) return '持ち物';
  if (/天候|フィールド|ターンで終了|が終わった/.test(text)) return '場の変化';
  return '効果';
}
function kindOf(a) {
  if (a.type === 'switch' || a.kind === 'send') return '場に出る';
  if (a.type === 'move') return a.flags?.cant ? '行動不能' : '技';
  return ({ability:'特性', item:'持ち物', residual:'定数処理', field:'場の変化', side:'場の変化', spikes:'場の変化', hazard:'設置ダメージ', mega:'メガシンカ', hp:'HP確認', boosts:'能力変化', boost:'能力変化', faint:'ひんし',status:'状態異常'})[a.kind] || '変化';
}
export function logGroups(battle, turn) {
  const groups = [];
  (turn.acts || []).forEach((a, ai) => {
    const field = ['field','side','spikes'].includes(a.kind);
    const side = field ? 'field' : a.side || 'field';
    const mon = a.type === 'switch' ? a.to : a.mon;
    const species = a.type === 'switch' ? a.toSp : a.sp;
    const previous = groups.at(-1);
    const key = `${side}:${mon ?? ''}:${species || ''}`;
    const group = previous?.key === key ? previous : {key, side, species, actions:[]};
    if (group !== previous) groups.push(group);
    group.actions.push({ai, a, kind:kindOf(a), text:a.kind === 'ability' ? actLine(battle,a).replace(/^特性 /, '') : actLine(battle,a), effects:(a.auto || []).map(text => ({kind:effectKind(text),text}))});
  });
  return groups;
}
export function remainingTurnEffects(turn) {
  const used = new Set((turn.acts || []).flatMap(a => a.auto || []));
  return (turn.auto || []).filter(text => !used.has(text)).map(text => ({kind:effectKind(text),text}));
}
