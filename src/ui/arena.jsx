// 対戦フェーズ: 盤面 (入力もここで完結、play.jsx) と、右の ダメージ・傾向・ログ。ターン終了は右下 (スマホは盤面の下)
import {useMemo, useState} from 'preact/hooks';
import {dex, speciesName, abilityName, moveName, STAT_JA, STAT_KEYS} from '../engine/dex.js';
import {BOOST_KEYS, currentSpecies, currentAbility} from '../engine/calc.js';
import {condOf} from '../engine/battle.js';
import {attackTable} from '../engine/board.js';
import {estimateStats, scenarioBuild} from '../engine/estimate.js';
import {Seg, Toggle, TypeChip, Empty, cx, fmtPct, rate} from './common.jsx';
import {OppSheet, dmgClass, LogTab} from './battle.jsx';
import {MonEditor} from './teams.jsx';
import {DmgBar} from './board.jsx';
import {PredictTab} from './analysis.jsx';
import {PlayBoard, TurnBar} from './play.jsx';
import {DamageLab} from './dmglab.jsx';
import {BoostRow} from './boostrow.jsx';
import {dispOf} from '../engine/flow.js';

const alive = (battle, side) => battle.state.sides[side].active.filter(i => i != null && !condOf(battle, side, i)?.fainted);

export function Arena({battle, ctx, mut, usage, toast, wide, onDelete}) {
  const [pane, setPane] = useState('center');
  const [sheet, setSheet] = useState(null);
  const p = {battle, ctx, mut, usage, toast, setSheet, onDelete};
  return (
    <div class={cx('arena', wide && 'wide')}>
      {!wide && <div class="arena-tabs"><Seg value={pane} options={[['center', '盤面'], ['right', 'ダメージ・ログ']]} onChange={setPane} /></div>}
      {(wide || pane === 'center') && (
        <div class="ar-center">
          <PlayBoard {...p} />
          {!wide && <TurnBar {...p} />}
        </div>
      )}
      {(wide || pane === 'right') && (
        <div class="ar-right-col">
          <RightPane {...p} />
          {wide && <TurnBar {...p} />}
        </div>
      )}
      {sheet && sheet.side === 'opp' && battle.opp[sheet.idx] && <OppSheet battle={battle} idx={sheet.idx} ctx={ctx} mut={mut} usage={usage} onClose={() => setSheet(null)} />}
      {sheet && sheet.side === 'me' && battle.my[sheet.idx] && (
        <MonEditor title="この対戦での自分の型" usage={usage} build={battle.my[sheet.idx]}
          onSave={bd => { mut(b => { b.my[sheet.idx] = bd; }); setSheet(null); }} onClose={() => setSheet(null)} />
      )}
    </div>
  );
}

// ---- 右: ダメージ表・統計 ----
function RightPane(props) {
  const [tab, setTab] = useState('dmg');
  return (
    <div class="ar-right">
      <Seg value={tab} options={[['dmg', 'ダメージ'], ['stat', '傾向'], ['log', 'ログ・メモ']]} onChange={setTab} />
      {tab === 'dmg' && <DamageLab {...props} />}
      {tab === 'stat' && <PredictTab battle={props.battle} ctx={props.ctx} />}
      {tab === 'log' && <LogTab battle={props.battle} mut={props.mut} onDelete={props.onDelete} ctx={props.ctx} usage={props.usage} toast={props.toast} />}
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
  const all = [[1, '能力Pt 補正なし'], [1.1, '能力Pt 補正↑'], [0.9, '能力Pt 補正↓']].filter(([m]) => mods.has(m));
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
