// 選出ルール: 構築の画面で編集し、対戦の選出画面で「今回はどのルールか」を出す
import {useMemo, useState} from 'preact/hooks';
import {speciesName} from '../engine/dex.js';
import {parseCond, matchRule, pickIndexes, parseRulesText, rulesToText} from '../engine/pickrule.js';
import {Sheet, Sprite, TypeChip, cx} from './common.jsx';

// 条件をアイコンで表示: ポケモンはアイコン、タイプはタイプ表示。+ は「かつ」、| は「か」、/ は「または」
export function CondIcons({cond}) {
  const c = typeof cond === 'string' ? parseCond(cond) : cond;
  if (c.any) return <span class="pr-cond"><span class="pr-any">どれにも当てはまらないとき</span></span>;
  if (!c.alts.length) return <span class="pr-cond muted">(条件なし)</span>;
  const atom = a => a.type ? <TypeChip type={a.type} small />
    : <span class="pr-mon" title={speciesName(a.show)}><Sprite id={a.show} size={30} fallback={<span class="pr-fb">{speciesName(a.show)}</span>} /></span>;
  return (
    <span class="pr-cond">
      {c.alts.map((terms, ai) => <>
        {ai > 0 && <span class="pr-op pr-or">または</span>}
        {terms.map((t, ti) => <>
          {ti > 0 && <span class="pr-op">＋</span>}
          <span class={cx('pr-term', t.neg && 'neg', t.any.length > 1 && 'multi')}>
            {t.any.length > 1 && <span class="pr-min">{t.min > 1 ? `${t.min}体以上` : 'どれか'}</span>}
            {t.any.map(atom)}
            {t.neg && <span class="pr-neg">いない</span>}
          </span>
        </>)}
      </>)}
    </span>
  );
}

// 選出3体をアイコンで (左が先発)
function PickIcons({pick}) {
  return (
    <span class="pr-picks">
      {(pick || []).filter(Boolean).map((id, k) => <>
        {k > 0 && <span class="pr-op sm">→</span>}
        <span class={cx('pr-mon', k === 0 && 'lead')} title={speciesName(id)}><Sprite id={id} size={34} fallback={<span class="pr-fb">{speciesName(id)}</span>} />{k === 0 && <span class="tag">先発</span>}</span>
      </>)}
    </span>
  );
}

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
  const [editing, setEditing] = useState(-1);
  return (
    <div class="pick-rules">
      <p class="hint">上から順に調べ、最初に当てはまった行の3体を選出画面に出します。左が先発。行を押すと編集できます。</p>
      <details class="pr-help"><summary>条件の書き方</summary>
        <dl>{HELP.map(([k, v]) => <><dt><code>{k}</code></dt><dd>{v}</dd></>)}</dl>
      </details>
      <ol class="pr-list">
        {rules.map((r, i) => {
          const c = parseCond(r.cond);
          if (editing !== i) return (
            <li class="pr-row view" key={i}>
              <span class="pr-no num">{i + 1}</span>
              <button class="pr-view" onClick={() => setEditing(i)} aria-label={`ルール${i + 1}を編集`}>
                <CondIcons cond={c} />
                <span class="pr-arrow">⇒</span>
                <PickIcons pick={r.pick} />
                {r.note && <span class="pr-note-v muted">{r.note}</span>}
                {c.errors.length > 0 && <span class="pr-err">{c.errors.join(' / ')}</span>}
              </button>
              <div class="pr-tools">
                <button class="btn ghost sm" disabled={i === 0} onClick={() => upd(l => { [l[i - 1], l[i]] = [l[i], l[i - 1]]; })} aria-label="上へ">↑</button>
                <button class="btn ghost sm" disabled={i === rules.length - 1} onClick={() => upd(l => { [l[i + 1], l[i]] = [l[i], l[i + 1]]; })} aria-label="下へ">↓</button>
                <button class="btn ghost sm" onClick={() => setEditing(i)} aria-label="編集">✎</button>
              </div>
            </li>
          );
          return (
            <li class="pr-row" key={i}>
              <span class="pr-no num">{i + 1}</span>
              <div class="pr-body">
                <CondIcons cond={c} />
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
                <button class="btn ghost sm" onClick={() => { upd(l => { l.splice(i, 1); }); setEditing(-1); }} aria-label="削除">×</button>
                <button class="btn primary sm" onClick={() => setEditing(-1)} aria-label="編集を閉じる">完了</button>
              </div>
            </li>
          );
        })}
      </ol>
      <div class="btnrow pad-s">
        <button class="btn" onClick={() => { upd(l => { l.push({cond: '', pick: [], note: ''}); }); setEditing(rules.length); }}>＋ ルールを追加</button>
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
      <h4>選出ルール <span class="num">{hit.index + 1}</span> <CondIcons cond={hit.rule.cond} />{opp.length < 6 && <span class="muted"> (相手{opp.length}/6体で判定)</span>}</h4>
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
