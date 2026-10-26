// 選出ルール: 構築の画面で編集し、対戦の選出画面で「今回はどのルールか」を出す
import {useMemo, useState} from 'preact/hooks';
import {speciesName, selectionSpeciesId} from '../engine/dex.js';
import {parseCond, decidePick, pickIndexes, parseRulesText, rulesToText} from '../engine/pickrule.js';
import {Sheet, Sprite, TypeChip, cx} from './common.jsx';

// 条件をアイコンで表示: ポケモンはアイコン、タイプはタイプ表示。+ は「かつ」、| は「か」、/ は「または」
export function CondIcons({cond, preview = false}) {
  const c = typeof cond === 'string' ? parseCond(cond) : cond;
  if (c.any) return <span class="pr-cond"><span class="pr-any">どれにも当てはまらないとき</span></span>;
  if (!c.alts.length) return <span class="pr-cond muted">(条件なし)</span>;
  const atom = a => a.type ? <TypeChip type={a.type} small />
    : <span class="pr-mon" title={speciesName(preview ? selectionSpeciesId(a.show) : a.show)}><Sprite id={preview ? selectionSpeciesId(a.show) : a.show} size={30} fallback={<span class="pr-fb">{speciesName(preview ? selectionSpeciesId(a.show) : a.show)}</span>} /></span>;
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

// 選出をアイコンで (左が先発)。空いている枠は「他の行で決める」、出さないポケモンは×つき
function PickIcons({pick, ban}) {
  const p = pick || [];
  const mon = (id, k) => <span class={cx('pr-mon', k === 0 && 'lead')} title={speciesName(id)}><Sprite id={id} size={34} fallback={<span class="pr-fb">{speciesName(id)}</span>} />{k === 0 && <span class="tag">先発</span>}</span>;
  return (
    <span class="pr-picks">
      {p.map((id, k) => <>
        {k > 0 && <span class="pr-op sm">→</span>}
        {id ? mon(id, k) : <span class="pr-slot" title="ほかの行で決める">{k === 0 ? '先発は下の行' : '空き'}</span>}
      </>)}
      {p.filter(Boolean).length < 3 && p.length > 0 && <span class="pr-op sm">…</span>}
      {(ban || []).map(id => <span class="pr-mon pr-ban" title={`${speciesName(id)}を出さない`}><Sprite id={id} size={30} fallback={<span class="pr-fb">{speciesName(id)}</span>} /><span class="pr-neg">出さない</span></span>)}
    </span>
  );
}

const HELP = [
  ['ルカリオ', 'ルカリオがいる'],
  ['A+B', 'AとBの両方がいる'],
  ['A|B', 'AかBのどちらかがいる'],
  ['A+B|C', 'Aがいて、BかCがいる (| が先にまとまる)'],
  ['A-B', 'Aがいて、Bはいない'],
  ['2体以上:A|B|C', '並べたうち2体以上がいる'],
  ['ゴーストタイプ', 'そのタイプがいる'],
  ['A / B+C', '/ の左右どちらかの条件を満たす'],
  ['*', 'どれにも当てはまらないとき (いちばん下に置く)'],
];
// まとめて入力 (CSV) の書き方
const CSV_HELP = [
  '1行に1ルール。列は「条件,先発,2体目,3体目」の順 (区切りはカンマ)。',
  '上の行ほど優先。相手の6体に当てはまる行を上から順に重ねて、3体そろったところで決まります。3体を書いた行に当たれば、その3体がそのまま選出です。',
  '1体・2体だけの行も書けます。「サーフゴー」なら「この相手にはサーフゴーを出す」、先発の列に書けば「この相手にはこいつが先発」。残りは下の行で埋まります。',
  '先発の列を空けて書くと (例: ルカリオ,,エンペルト)「出すけど先発は下の行に任せる」。',
  '名前の前に - を付けると「出さない」(例: ルカリオ,,,,-エンペルト)。当てはまった行のどれかで出さないとされたポケモンは、ほかの行に書いてあっても選びません。',
  'いちばん下に * の行 (3体) を置くと、必ず3体そろいます。それでも足りないときは構築の並び順で埋め、「自動」と表示します。',
  '1行目に見出し「条件,先発,2体目,3体目」があれば読み飛ばします (なくてもよい)。',
  '表計算ソフト (スプレッドシート・Numbers・Excel) からコピーした表 (タブ区切り) もそのまま貼れます。',
  '条件の名前はポケモンの正式名で書きます。リージョンフォームは「ガラルヤドキング」「ヤドキング(ガラル)」のどちらでも可。メガシンカの名前は元のポケモンとして扱います。',
  '選出の名前はこの構築のポケモン。「ガブZ」「ゴリラ」のような略し方でも、構築の中で1体に決まれば読めます。',
  '# より後ろと、// で始まる行は無視します (コメント用)。',
  '名前の間違いや構築にいないポケモンがあると、どの行が悪いかを出して置き換えません。',
];

function HelpBody() {
  return <>
    <h5>条件の書き方</h5>
    <dl>{HELP.map(([k, v]) => <><dt><code>{k}</code></dt><dd>{v}</dd></>)}</dl>
    <h5>まとめて入力 (CSV) の書き方</h5>
    <ul class="pr-csv-help">{CSV_HELP.map(t => <li>{t}</li>)}</ul>
    <pre class="pr-example">{`条件,先発,2体目,3体目
フシギバナ,ガブZ,ゴリランダー,サーフゴー
ルカリオ,,,,-エンペルト
カバルドン,エンペルト
ボーマンダ,,サーフゴー
*,ドドゲザン,ガブZ,ゴリランダー`}</pre>
    <p class="hint">例: 相手がカバルドン+ボーマンダなら エンペルト(先発)→サーフゴー→ドドゲザン。ルカリオ+カバルドンなら エンペルトは出さないので ドドゲザン(先発)→ガブZ→ゴリランダー。フシギバナがいれば1行目の3体。</p>
  </>;
}

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
      <p class="hint">上から順に、当てはまった行のポケモンを重ねて3体を決めます (3体の行に当たればその3体)。左が先発。行を押すと編集できます。</p>
      <details class="pr-help"><summary>書き方のルール</summary>
        <HelpBody />
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
                <PickIcons pick={r.pick} ban={r.ban} />
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
                </div>
                <div class="pr-pick pr-banrow">
                  <span class="muted">出さない:</span>
                  {(r.ban || []).map((id, k) => <button class="btn ghost sm" onClick={() => upd(l => { l[i].ban = l[i].ban.filter((x, j) => j !== k); if (!l[i].ban.length) delete l[i].ban; })} aria-label={`${speciesName(id)}を出さないを解除`}>{speciesName(id)} ×</button>)}
                  <select class="input" aria-label="出さないポケモンを追加" value="" onChange={e => { const v = e.currentTarget.value; if (v) upd(l => { l[i].ban = [...new Set([...(l[i].ban || []), v])]; }); }}>
                    <option value="">＋ 追加</option>
                    {mons.filter(m => !(r.ban || []).includes(m.species)).map(m => <option value={m.species}>{speciesName(m.species)}</option>)}
                  </select>
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
        <button class="btn" onClick={() => { upd(l => { l.push({cond: '', pick: []}); }); setEditing(rules.length); }}>＋ ルールを追加</button>
        <button class="btn ghost" onClick={() => { setBulk(rulesToText(rules)); setBulkErr([]); }}>まとめて入力・書き出し</button>
      </div>
      {bulk != null && (
        <Sheet title="選出ルールをまとめて入力" onClose={() => setBulk(null)}>
          <div class="pad">
            <p class="hint">CSVの形で1行に1ルール (条件,先発,2体目,3体目)。上の行ほど優先。</p>
            <details class="pr-help"><summary>書き方のルール</summary><HelpBody /></details>
            <textarea class="input pr-bulk" rows={14} spellcheck={false} value={bulk} onInput={e => setBulk(e.currentTarget.value)} />
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

// 選出画面: 当てはまったルールを重ねて決めた3体と、そのまま選ぶボタン
export function PickRuleHint({team, battle, started, onApply}) {
  const rules = team?.pickRules;
  const opp = battle.opp.map(o => o.species);
  const myIds = battle.my.map(m => m?.species);
  const hit = useMemo(() => decidePick(rules, opp, myIds), [rules, opp.join(), myIds.join()]);
  if (!rules?.length || !opp.length) return null;
  if (!hit) return <div class="box pr-hint"><h4>選出ルール</h4><p class="hint">当てはまるルールがありません。</p></div>;
  const idx = pickIndexes(hit.pick, battle.my);
  const same = idx.length && idx.every((x, k) => battle.pick.me[k] === x) && battle.pick.me.length === idx.length;
  const one = hit.rows.length === 1 && !hit.auto ? rules[hit.rows[0]] : null;
  return (
    <div class="box pr-hint">
      <h4>選出ルール {hit.rows.map(i => <span class="num">{i + 1}</span>)}{one && <CondIcons cond={one.cond} preview />}{opp.length < 6 && <span class="muted"> (相手{opp.length}/6体で判定)</span>}</h4>
      <div class="pr-hint-row">
        <ol class="pr-hint-pick">
          {idx.map((mi, k) => (
            <li class={cx(k === 0 && 'lead')}><Sprite id={selectionSpeciesId(battle.my[mi].species)} size={32} />{speciesName(selectionSpeciesId(battle.my[mi].species))}{k === 0 && <span class="tag">先発</span>}
              {!one && <span class="muted pr-from">{hit.from[k] >= 0 ? `行${hit.from[k] + 1}` : '自動'}</span>}</li>
          ))}
        </ol>
        {hit.bans.length > 0 && <span class="muted">出さない: {hit.bans.map(id => speciesName(selectionSpeciesId(id))).join('・')}</span>}
        {hit.auto > 0 && <span class="muted">足りない{hit.auto}体は構築の並び順で埋めました</span>}
        {!started && idx.length > 0 && <button class={cx('btn sm', same ? 'ghost' : 'primary')} disabled={same} onClick={() => onApply(idx)}>{same ? 'この選出になっています' : 'この選出にする'}</button>}
      </div>
    </div>
  );
}
