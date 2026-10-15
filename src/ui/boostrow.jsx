// 能力表の「能力上昇」の行。edit があれば ✎ で編集でき、まとめて1件の記録にする
import {useState} from 'preact/hooks';
import {BOOST_KEYS} from '../engine/calc.js';
import {cx} from './common.jsx';

const fmt = v => (v > 0 ? `+${v}` : `${v}`);

export function BoostRow({boosts = {}, onSave}) {
  const [draft, setDraft] = useState(null);
  if (!draft) {
    return (
      <tr>
        <th>{onSave ? <button class="rank-edit" onClick={() => setDraft({...boosts})} title="能力ランクを直接入力">能力上昇 ✎</button> : '能力上昇'}</th>
        <td></td>
        {BOOST_KEYS.map(k => { const v = boosts[k] || 0; return <td class={cx('num rankv', v > 0 && 'pos', v < 0 && 'neg')}>{fmt(v)}</td>; })}
      </tr>
    );
  }
  const step = (k, d) => setDraft(x => ({...x, [k]: Math.max(-6, Math.min(6, (x[k] || 0) + d))}));
  const changed = BOOST_KEYS.some(k => (draft[k] || 0) !== (boosts[k] || 0));
  return (
    <>
      <tr class="rank-editing">
        <th>能力上昇</th><td></td>
        {BOOST_KEYS.map(k => {
          const v = draft[k] || 0;
          return (
            <td class="rank-cell">
              <button class="rank-btn" onClick={() => step(k, 1)} aria-label="上げる">＋</button>
              <b class={cx('num', v > 0 && 'pos', v < 0 && 'neg', v !== (boosts[k] || 0) && 'diff')}>{fmt(v)}</b>
              <button class="rank-btn" onClick={() => step(k, -1)} aria-label="下げる">－</button>
            </td>
          );
        })}
      </tr>
      <tr class="rank-actions"><td colSpan={7}>
        <button class="btn ghost sm" onClick={() => setDraft(null)}>やめる</button>
        <button class="btn ghost sm" onClick={() => setDraft(Object.fromEntries(BOOST_KEYS.map(k => [k, 0])))}>すべて0</button>
        <button class="btn primary sm" disabled={!changed} onClick={() => { onSave(draft); setDraft(null); }}>記録</button>
      </td></tr>
    </>
  );
}
