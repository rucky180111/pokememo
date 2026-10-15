// 能力ランクは常時表示。＋／−を押すとその場で反映し、「1つ戻す」で取り消せる。
import {BOOST_KEYS} from '../engine/calc.js';
import {cx} from './common.jsx';

const LABELS = {atk: 'こうげき', def: 'ぼうぎょ', spa: 'とくこう', spd: 'とくぼう', spe: 'すばやさ'};
const fmt = v => (v > 0 ? `+${v}` : `${v}`);

export function BoostRow({boosts = {}, onSave}) {
  const step = (k, delta) => onSave?.({...boosts, [k]: Math.max(-6, Math.min(6, (boosts[k] || 0) + delta))});
  return (
    <tr class="rank-editing">
      <th>ランク</th><td aria-label="HPはランク変化なし">—</td>
      {BOOST_KEYS.map(k => {
        const v = boosts[k] || 0;
        return <td class="rank-cell" key={k}>
          <b class={cx('num rankv', v > 0 && 'pos', v < 0 && 'neg')} aria-live="polite">{fmt(v)}</b>
          <div class="rank-buttons">
            <button class="rank-btn" disabled={!onSave || v <= -6} onClick={() => step(k, -1)} aria-label={`${LABELS[k]}を1段階下げる`}>−</button>
            <button class="rank-btn" disabled={!onSave || v >= 6} onClick={() => step(k, 1)} aria-label={`${LABELS[k]}を1段階上げる`}>＋</button>
          </div>
        </td>;
      })}
    </tr>
  );
}
