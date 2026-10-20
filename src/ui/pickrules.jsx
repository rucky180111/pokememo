// 選出ルール: 構築の画面で編集し、対戦の選出画面で「今回はどのルールか」を出す
import {useMemo, useState} from 'preact/hooks';
import {speciesName} from '../engine/dex.js';
import {parseCond, matchRule, pickIndexes, parseRulesText, rulesToText} from '../engine/pickrule.js';
import {Sheet, Sprite, cx} from './common.jsx';

const HELP = [
  ['ルカリオ', 'ルカリオがいる'],
  ['A+B', 'AとBの両方がいる'],
  ['A+B|C', 'Aがいて、BかCがいる'],
  ['A-B', 'Aがいて、Bはいない'],
  ['2体以上:A|B|C', '並べたうち2体以上'],
  ['ゴーストタイプ', 'そのタイプがいる'],
  ['A / B+C', 'どちらかの条件'],
  ['*', 'どれにも当てはまらないとき'],
];

// 構築の画面: ルールの一覧 (上が優先)
export function PickRulesEditor({team, save}) {
  const rules = team.pickRules || [];
  const [bulk, setBulk] = useState(null); // 一括入力の文字列
  const [bulkErr, setBulkErr] = useState([]);
  const upd = fn => save(t => { t.pickRules = t.pickRules || []; fn(t.pickRules); });
  const mons = team.mons;
  return (
    <div class="pick-rules">
      <p class="hint">上から順に調べ、最初に当てはまった行の3体を選出画面に出します。左が先発。</p>
      <details class="pr-help"><summary>条件の書き方</summary>
        <dl>{HELP.map(([k, v]) => <><dt><code>{k}</code></dt><dd>{v}</dd></>)}</dl>
      </details>
      <ol class="pr-list">
        {rules.map((r, i) => {
          const c = parseCond(r.cond);
          return (
            <li class="pr-row" key={i}>
              <span class="pr-no num">{i + 1}</span>
              <div class="pr-body">
                <input class="input" placeholder="条件 (例: ルカリオ+ミミッキュ|ギルガルド)" value={r.cond} onChange={e => upd(l => { l[i].cond = e.currentTarget.value; })} />
                {c.errors.length > 0 && <div class="pr-err">{c.errors.join(' / ')}</div>}
                <div class="pr-pick">
                  {[0, 1, 2].map(k => (
                    <select class="input" aria-label={k === 0 ? '先発' : `${k + 1}体目`} value={r.pick?.[k] || ''}
                      onChange={e => upd(l => { const p = (l[i].pick || []).slice(); p[k] = e.currentTarget.value; l[i].pick = p.filter((x, j) => j <= 2); })}>
                      <option value="">{k === 0 ? '先発' : `${k + 1}体目`}</option>
                      {mons.map(m => <option value={m.species}>{speciesName(m.species)}</option>)}
                    </select>
                  ))}
                  <input class="input pr-note" placeholder="メモ (勝率など)" value={r.note || ''} onChange={e => upd(l => { l[i].note = e.currentTarget.value; })} />
                </div>
              </div>
              <div class="pr-tools">
                <button class="btn ghost sm" disabled={i === 0} onClick={() => upd(l => { [l[i - 1], l[i]] = [l[i], l[i - 1]]; })} aria-label="上へ">↑</button>
                <button class="btn ghost sm" disabled={i === rules.length - 1} onClick={() => upd(l => { [l[i + 1], l[i]] = [l[i], l[i + 1]]; })} aria-label="下へ">↓</button>
                <button class="btn ghost sm" onClick={() => upd(l => { l.splice(i, 1); })} aria-label="削除">×</button>
              </div>
            </li>
          );
        })}
      </ol>
      <div class="btnrow pad-s">
        <button class="btn" onClick={() => upd(l => { l.push({cond: '', pick: [], note: ''}); })}>＋ ルールを追加</button>
        <button class="btn ghost" onClick={() => { setBulk(rulesToText(rules)); setBulkErr([]); }}>まとめて入力・書き出し</button>
      </div>
      {bulk != null && (
        <Sheet title="選出ルールをまとめて入力" onClose={() => setBulk(null)}>
          <div class="pad">
            <p class="hint">1行に1ルール。<code>条件 =&gt; 先発, 2体目, 3体目 # メモ</code></p>
            <textarea class="input pr-bulk" rows={14} value={bulk} onInput={e => setBulk(e.currentTarget.value)} />
            {bulkErr.length > 0 && <ul class="warn">{bulkErr.map(e => <li>{e}</li>)}</ul>}
            <div class="btnrow pad-s">
              <button class="btn" onClick={() => setBulk(null)}>取消</button>
              <button class="btn primary" onClick={() => {
                const {rules: next, errors} = parseRulesText(bulk, mons);
                if (errors.length) { setBulkErr(errors); return; }
                save(t => { t.pickRules = next; });
                setBulk(null);
              }}>この内容で置き換える</button>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}

// 選出画面: 当てはまったルールと、その3体をそのまま選ぶボタン
export function PickRuleHint({team, battle, started, onApply}) {
  const rules = team?.pickRules;
  const opp = battle.opp.map(o => o.species);
  const hit = useMemo(() => matchRule(rules, opp), [rules, opp.join()]);
  if (!rules?.length || !opp.length) return null;
  if (!hit) return <div class="box pr-hint"><h4>選出ルール</h4><p class="hint">当てはまるルールがありません。</p></div>;
  const idx = pickIndexes(hit.rule.pick, battle.my);
  const same = idx.length && idx.every((x, k) => battle.pick.me[k] === x) && battle.pick.me.length === idx.length;
  return (
    <div class="box pr-hint">
      <h4>選出ルール <span class="num">{hit.index + 1}</span> <span class="muted">{hit.rule.cond || '*'}{opp.length < 6 ? ` (相手${opp.length}/6体で判定)` : ''}</span></h4>
      <div class="pr-hint-row">
        <ol class="pr-hint-pick">
          {idx.map((mi, k) => (
            <li class={cx(k === 0 && 'lead')}><Sprite id={battle.my[mi].species} size={32} />{speciesName(battle.my[mi].species)}{k === 0 && <span class="tag">先発</span>}</li>
          ))}
        </ol>
        {hit.rule.note && <span class="muted">{hit.rule.note}</span>}
        {!started && idx.length > 0 && <button class={cx('btn sm', same ? 'ghost' : 'primary')} disabled={same} onClick={() => onApply(idx)}>{same ? 'この選出になっています' : 'この選出にする'}</button>}
      </div>
    </div>
  );
}
