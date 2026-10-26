import {useState} from 'preact/hooks';
import {condOf} from '../engine/battle.js';
import {speciesName, moveName} from '../engine/dex.js';
import {recordStatusAt, canReplay} from '../engine/flow.js';
import {Sheet, cx} from './common.jsx';

const statuses = [['brn','やけど'],['par','まひ'],['psn','どく'],['tox','もうどく'],['slp','ねむり'],['frz','こおり'],['','状態異常なし・回復']];
const sideName = side => side === 'me' ? '自分' : '相手';

export function LateStatusInput({battle, side, mon, mut, usage, toast}) {
  const [open, setOpen] = useState(false);
  return <>
    <button class="chip sm" aria-label={`${sideName(side)}の状態異常を後から入力`} onClick={() => setOpen(true)}>後から入力</button>
    {open && <StatusSheet battle={battle} side={side} mon={mon} mut={mut} usage={usage} toast={toast} onClose={() => setOpen(false)} />}
  </>;
}

function StatusSheet({battle, side, mon, mut, usage, toast, onClose}) {
  const [target, setTarget] = useState(`${side}:${mon}`), [timing, setTiming] = useState('now');
  const [error, setError] = useState('');
  const version = JSON.stringify(battle.turns);
  const [snapshot] = useState(version);
  const [sd, idx] = target.split(':'), index = Number(idx);
  const current = condOf(battle, sd, index);
  const options = battle.turns.flatMap((t, ti) => t.acts.flatMap((a, ai) => a.type === 'move' ? [{ti,ai,a,n:t.n}] : [])).reverse();
  const save = status => {
    let ok = false;
    mut(b => {
      if (timing !== 'now' && JSON.stringify(b.turns) !== snapshot) return;
      const at = timing === 'now' ? null : (() => {const [ti,ai,when] = timing.split(':'); return {ti:Number(ti),ai:Number(ai),when};})();
      ok = recordStatusAt(b,{side:sd,mon:index,status},at,usage);
    });
    if (ok) { toast(timing === 'now' ? '状態異常を記録しました' : '指定した時点に状態異常を追加し、盤面と推定を再計算しました'); onClose(); }
    else setError('記録が更新されたか、対象がひんしになっています。閉じて選び直してください');
  };
  return <Sheet title="状態異常を後から入力" onClose={onClose}>
    <p>技を記録した後でも、状態異常の追加・回復を記録できます。</p>
    <label class="field"><span>状態異常になったポケモン</span><select class="input" aria-label="状態異常の対象" value={target} onChange={e=>setTarget(e.currentTarget.value)}>{['me','opp'].flatMap(s => (s === 'me' ? battle.my : battle.opp).map((b,i) => <option value={`${s}:${i}`}>{sideName(s)}：{speciesName(b.species)}</option>))}</select></label>
    <label class="field"><span>入力するタイミング</span><select class="input" aria-label="状態異常のタイミング" value={timing} onChange={e=>setTiming(e.currentTarget.value)}>
      <option value="now">今の状態として追加</option>
      {canReplay(battle) && options.flatMap(({ti,ai,a,n}) => ['after','before'].map(when => <option value={`${ti}:${ai}:${when}`}>ターン{n}・{sideName(a.side)}の{a.move ? moveName(a.move) : '行動不能'}の{when === 'after' ? '後' : '前'}</option>))}
    </select></label>
    <p class="hint">くちばしキャノンのやけどは、接触したポケモンに入力し、その接触技の「後」を選びます。以降のダメージ計算に反映されます。</p>
    <p>現在：{statuses.find(([id])=>id === (current?.status || ''))?.[1]}</p>
    <div class="chips status-input-choices">{statuses.map(([id,label]) => <button class={cx('chip',current?.status === id && 'on')} disabled={timing === 'now' && current?.fainted} onClick={() => save(id)}>{label}</button>)}</div>
    {error && <p role="alert">{error}</p>}
  </Sheet>;
}
