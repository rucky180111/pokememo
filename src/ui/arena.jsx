// 対戦フェーズ: 横幅があれば自分と相手の盤面を横並びにする。ターン操作は共通。
import {useMemo, useState} from 'preact/hooks';
import {dex, speciesName, STAT_JA, STAT_KEYS, natureMod, natureName} from '../engine/dex.js';
import {currentSpecies} from '../engine/calc.js';
import {condOf} from '../engine/battle.js';
import {estimateStats, bulkPatterns} from '../engine/estimate.js';
import {cx} from './common.jsx';
import {OppSheet} from './battle.jsx';
import {MonEditor} from './teams.jsx';
import {PlayBoard} from './play.jsx';
import {BoostRow} from './boostrow.jsx';

export function Arena({battle, ctx, mut, usage, toast, wide, onDelete}) {
  const [sheet, setSheet] = useState(null);
  const p = {battle, ctx, mut, usage, toast, setSheet, onDelete};
  return (
    <div class={cx('arena', wide && 'wide')}>
      <div class="ar-center"><PlayBoard {...p} /></div>
      {sheet && sheet.side === 'opp' && battle.opp[sheet.idx] && <OppSheet battle={battle} idx={sheet.idx} ctx={ctx} mut={mut} usage={usage} onClose={() => setSheet(null)} />}
      {sheet && sheet.side === 'me' && battle.my[sheet.idx] && (
        <MonEditor title="この対戦での自分の型" usage={usage} build={battle.my[sheet.idx]}
          onSave={bd => { mut(b => { b.my[sheet.idx] = bd; }); setSheet(null); }} onClose={() => setSheet(null)} />
      )}
    </div>
  );
}

/** 相手の能力表 (中央の盤面と同じもの)。相手の詳細シートでも使う */
export function OppStatTable({battle, idx, forme, onBoosts}) {
  const opp = battle.opp[idx];
  const raw0 = condOf(battle, 'opp', idx) || {boosts: {}};
  const raw = forme ? {...raw0, forme} : raw0;
  const sid = currentSpecies(opp, raw);
  const s = dex.species[sid];
  const est = useMemo(() => estimateStats(opp, sid), [opp, sid]);
  const patterns = useMemo(() => bulkPatterns(opp), [opp]);
  if (!s || !est) return null;
  const rg = e => (e[0] === e[1] ? `${e[0]}` : `${e[0]}〜${e[1]}`);
  const fmtVal = r => (r.valLo === r.valHi ? `${r.valLo}` : `${r.valLo}〜${r.valHi}`);
  return (
    <div class="opp-estimate"><table class="mp-table">
      <thead><tr><th></th>{STAT_JA.map(l => <th>{l}</th>)}</tr></thead>
      <tbody>
        <tr><th>種族値</th>{s.bs.map(v => <td class="num">{v}</td>)}</tr>
        <tr class="est"><th>推定Pt</th>{est.rows.map(r => <td class={cx('num', r.known && 'known')}>{r.known ? rg([r.spLo, r.spHi]) : '—'}</td>)}</tr>
        <BoostRow boosts={raw.boosts} onSave={onBoosts} />
        <tr class="real"><th>実数値</th>
          {STAT_KEYS.map((k, i) => {
            const st = raw.boosts?.[k] || 0;
            const r = est.rows[i];
            const base = fmtVal(r);
            if (!st) return <td class={cx('num', r.known && 'known')}>{base}</td>;
            const up = v => Math.floor(st > 0 ? (v * (2 + st)) / 2 : (v * 2) / (2 - st));
            return <td class={cx('num', r.known && 'known', st > 0 ? 'pos' : 'neg')}>{fmtVal({valLo: up(r.valLo), valHi: up(r.valHi)})}<small>({base})</small></td>;
          })}
        </tr>
      </tbody>
    </table>
    <div class="estimate-speed"><b>素早さ S</b><strong>{fmtVal(est.rows[5])}</strong><span>{est.rows[5].valLo === est.rows[5].valHi ? '実数値確定' : est.rows[5].known ? '推定範囲' : '未判明'} ・ ランク補正前</span></div>
    {patterns.length > 0 && <div class="bulk-patterns">
      <div class="bulk-pattern-heading"><b>耐久配分の代表例</b><span>同時に成立する組み合わせ</span></div>
      <table class="bulk-pattern-table"><thead><tr><th>配分の方向</th><th>H</th><th>B</th><th>D</th><th>性格</th></tr></thead><tbody>{patterns.map(p => <tr>
        <th>{p.labels.join('・')}</th>{[0,2,4].map(i => {const mod = natureMod(p.nature, STAT_KEYS[i]);return <td>{p.sp[i]}{mod !== 1 && <small>{mod > 1 ? '↑' : '↓'}</small>}</td>;})}<td>{natureName(p.nature)}</td>
      </tr>)}</tbody></table>
      <p>数値は能力Pt。↑↓は性格補正。観測に合う一例で、途中の配分も候補に残ります。各行のH・B・Dをセットで見てください。</p>
    </div>}
    </div>
  );
}
