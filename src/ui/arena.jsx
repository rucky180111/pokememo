// 対戦フェーズ: 横幅があれば自分と相手の盤面を横並びにする。ターン操作は共通。
import {useMemo, useState} from 'preact/hooks';
import {dex, speciesName, STAT_JA, STAT_KEYS} from '../engine/dex.js';
import {currentSpecies} from '../engine/calc.js';
import {condOf} from '../engine/battle.js';
import {estimateStats} from '../engine/estimate.js';
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
  if (!s || !est) return null;
  const rg = e => (e[0] === e[1] ? `${e[0]}` : `${e[0]}〜${e[1]}`);
  const mods = new Set();
  for (const r of est.rows) if (r.known && r.byMod) for (const m of Object.keys(r.byMod)) mods.add(Number(m));
  const all = [[1, 'Pt 補正なし'], [1.1, 'Pt 補正↑'], [0.9, 'Pt 補正↓']].filter(([m]) => mods.has(m));
  const estRows = all.length ? all : [[1, '能力Pt']];
  const fmtVal = r => (r.valLo === r.valHi ? `${r.valLo}` : `${r.valLo}〜${r.valHi}`);
  return (
    <table class="mp-table">
      <thead><tr><th></th>{STAT_JA.map(l => <th>{l}</th>)}</tr></thead>
      <tbody>
        <tr><th>種族値</th>{s.bs.map(v => <td class="num">{v}</td>)}</tr>
        {estRows.map(([mod, label]) => (
          <tr class="est" key={mod}><th>{label}</th>
            {est.rows.map(r => {
              if (!r.known) return <td></td>;
              if (r.key === 'hp') return <td class="num known">{mod === estRows[0][0] ? rg([r.spLo, r.spHi]) : ''}</td>;
              const e = r.byMod?.[mod];
              return <td class={cx('num', e && 'known')}>{e ? rg(e) : '×'}</td>;
            })}
          </tr>
        ))}
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
  );
}
