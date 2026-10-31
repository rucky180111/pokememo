// 構築診断: 受け (半減で受けられるか) ・攻め (全部の組み合わせに弱点を突けるか) ・使用率上位への打点
import {useMemo, useState} from 'preact/hooks';
import {dex, speciesName, moveName, abilityName, itemName, TYPES} from '../engine/dex.js';
import {defenseReport, offenseReport, topReport, recommendTypes, recommendMons, megaCount} from '../engine/teamdiag.js';
import {useApp, Seg, Sprite, TypeChip, Empty, cx} from './common.jsx';

const TOP = 100;
const multLabel = m => (m === 0 ? '無効' : m === 0.25 ? '¼' : m === 0.5 ? '½' : m === 1 ? '' : m === 2 ? '2' : m === 4 ? '4' : `${m}`);
const multClass = m => (m === 0 ? 'm0' : m < 0.5 ? 'm025' : m < 1 ? 'm05' : m === 1 ? 'm1' : m < 4 ? 'm2' : 'm4');

export function TeamDiagnosis({team}) {
  const {store} = useApp();
  const usage = store.state.usage.single;
  const [view, setView] = useState('def');
  const [onlyMiss, setOnlyMiss] = useState(false);
  const mons = team.mons.filter(m => dex.species[m.species]);
  const def = useMemo(() => defenseReport(mons), [team]);
  const off = useMemo(() => offenseReport(mons), [team]);
  const top = useMemo(() => topReport(mons, usage, TOP), [team, usage]);
  if (!mons.length) return <Empty>ポケモンを登録すると診断できます。</Empty>;
  const topMiss = top.filter(t => t.best.m < 2);
  return (
    <div class="tdiag">
      <div class="td-sum">
        <div class={cx('td-card', def.notResisted.length ? 'bad' : 'good')} onClick={() => setView('def')}>
          <span class="td-k">受け</span>
          <b>{def.notResisted.length ? `半減で受けられない: ${def.notResisted.length}タイプ` : '全タイプを半減以下で受けられる'}</b>
          <span class="chips td-col">{def.notResisted.map(t => <TypeChip type={t} small />)}</span>
        </div>
        <div class={cx('td-card', off.notHit.length ? 'bad' : 'good')} onClick={() => setView('off')}>
          <span class="td-k">攻め</span>
          <b>{off.notHit.length ? `弱点を突けない組み合わせ: ${off.notHit.length} / ${off.combos.length}` : `全 ${off.combos.length} 通りの組み合わせに弱点を突ける`}</b>
          <span class="chips td-col">{off.notHit.slice(0, 4).map(c => <span class="td-combo">{c.types.map(t => <TypeChip type={t} small />)}</span>)}{off.notHit.length > 4 ? '…' : ''}</span>
        </div>
        <div class={cx('td-card', topMiss.length ? 'bad' : 'good')} onClick={() => setView('top')}>
          <span class="td-k">使用率上位{TOP}</span>
          <b>{!usage ? '使用率データがありません' : topMiss.length ? `弱点を突けない: ${topMiss.length}体` : '全員に弱点を突ける'}</b>
          <span class="chips">{topMiss.slice(0, 6).map(t => <Sprite id={t.id} size={28} />)}</span>
        </div>
      </div>
      <Seg value={view} options={[['def', '受け (タイプ別)'], ['off', '攻め (組み合わせ別)'], ['top', `使用率上位${TOP}`], ['rec', 'おすすめ']]} onChange={setView} />

      {view === 'def' && <>
        <div class="scroll-x">
          <table class="td-table">
            <thead><tr><th></th>{def.forms.map(({b, f}) => <th title={`${speciesName(f.sid)} / ${abilityName(f.ability)}`}><Sprite id={f.sid} size={36} /><small>{speciesName(f.sid)}</small></th>)}<th>いちばん<br />受けられる</th><th>弱点<br />の数</th></tr></thead>
            <tbody>
              {def.rows.map(r => (
                <tr class={cx(r.best > 0.5 && 'td-miss')}>
                  <th><TypeChip type={r.type} small /></th>
                  {r.mult.map((m, i) => <td class={cx('td-m', multClass(m))}>{multLabel(m)}{m > 1 && r.filter[i] ? <small>軽減</small> : null}</td>)}
                  <td class={cx('td-m', multClass(r.best))}>{r.best === 1 ? '等倍' : multLabel(r.best)}</td>
                  <td class={cx('num', r.weak >= 3 && 'td-warn')}>{r.weak || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p class="hint">受けるときの倍率 (空欄 = 等倍・特性/ふうせん/メガ後を含む)</p>
      </>}

      {view === 'off' && <>
        <p class="hint">攻撃技 {off.moves}個 × タイプの組み合わせ {off.combos.length}通り</p>
        <p class="hint">くさむすびなどの威力変動技も含むタイプ相性の診断です。固定ダメージ・一撃必殺技は弱点を突く技に数えません。技の成立条件・実際の威力・倒せるかどうかはダメージ計算で確認してください。</p>
        {off.notHit.length > 0 && <h4>弱点を突けない組み合わせ</h4>}
        <div class="td-combos">
          {off.notHit.map(c => (
            <div class="td-crow miss">
              <span class="td-combo">{c.types.map(t => <TypeChip type={t} small />)}</span>
              <span class="td-ex">{c.examples.map(id => <span class="td-exm"><Sprite id={id} size={28} />{speciesName(id)}</span>)}</span>
              <span class="td-best">{c.best.m < 0 ? '攻撃技なし' : `最大 ×${c.best.m} (${moveName(c.best.move)})`}</span>
            </div>
          ))}
        </div>
        <details class="td-all"><summary>全部の組み合わせを見る</summary>
          <div class="td-combos">
            {off.combos.filter(c => c.best.m >= 2).map(c => (
              <div class="td-crow">
                <span class="td-combo">{c.types.map(t => <TypeChip type={t} small />)}</span>
                <span class="td-ex muted">{c.examples.slice(0, 2).map(speciesName).join('・')}</span>
                <span class={cx('td-best', c.best.m >= 4 && 'x4')}>×{c.best.m} {moveName(c.best.move)} <small class="muted">({speciesName(c.best.sp)})</small></span>
              </div>
            ))}
          </div>
        </details>
      </>}

      {view === 'top' && <>
        {!usage && <Empty>使用率データを読み込むと診断できます。</Empty>}
        <p class="hint">使用率上位{TOP}位 ({usage?.month || ''}) に弱点を突けるか（威力変動技を含む・相手の特性や持ち物は使用率からの想定）</p>
        <label class="td-opt"><input type="checkbox" checked={onlyMiss} onChange={e => setOnlyMiss(e.currentTarget.checked)} /> 弱点を突けないポケモンだけ表示</label>
        <div class="td-top">
          {top.filter(t => !onlyMiss || t.best.m < 2).map(t => (
            <div class={cx('td-tile', t.best.m < 2 && 'miss')}>
              <span class="td-rank num">{t.rank}</span>
              <Sprite id={t.id} size={44} />
              <span class="td-nm">{speciesName(t.id)}</span>
              <span class="td-res">{t.best.m >= 2 ? <>×{t.best.m} {moveName(t.best.move)}</> : t.best.m < 0 ? '攻撃技なし' : `最大 ×${t.best.m}`}</span>
              <small class="muted">{t.best.m >= 2 ? speciesName(t.best.sp) : [abilityName(t.ability), itemName(t.item)].filter(Boolean).join('・')}</small>
            </div>
          ))}
        </div>
      </>}
      {view === 'rec' && <Recommend mons={mons} usage={usage} />}
    </div>
  );
}

const TJ = t => <TypeChip type={t} small />;
function Fixes({d}) {
  const items = [];
  if (d.fixedRes.length) items.push(<li class="good">半減以下で受けられる: {d.fixedRes.map(TJ)}</li>);
  if (d.fixedHit.length) items.push(<li class="good">弱点を突けるようになる組み合わせ: {d.fixedHit.length}通り <span class="td-mini">{d.fixedHit.slice(0, 4).map(c => <span class="td-combo">{c.types.map(TJ)}</span>)}</span></li>);
  if (d.fixedTop.length) items.push(<li class="good">上位で弱点を突けるようになる: <span class="td-mini">{d.fixedTop.map(t => <Sprite id={t.id} size={26} />)}</span></li>);
  if (d.fixedStack.length) items.push(<li class="good">弱点の重なりが減る: {d.fixedStack.map(TJ)}</li>);
  if (d.newRes.length) items.push(<li class="bad">半減で受けられなくなる: {d.newRes.map(TJ)}</li>);
  if (d.newHit.length) items.push(<li class="bad">弱点を突けなくなる組み合わせ: {d.newHit.length}通り</li>);
  if (d.newTop.length) items.push(<li class="bad">上位で弱点を突けなくなる: <span class="td-mini">{d.newTop.map(t => <Sprite id={t.id} size={26} />)}</span></li>);
  if (d.newStack.length) items.push(<li class="bad">弱点が3体以上重なる: {d.newStack.map(TJ)}</li>);
  return <ul class="td-fix">{items}</ul>;
}

function Recommend({mons, usage}) {
  const [replace, setReplace] = useState(-1);
  const rest = mons.filter((_, i) => i !== replace);
  const [mega, setMega] = useState(null);
  const megaOn = mega ?? megaCount(rest) === 0;
  const rt = useMemo(() => recommendTypes(mons, usage, {replace, n: TOP, limit: 10}), [mons, usage, replace]);
  const rm = useMemo(() => recommendMons(mons, usage, {replace, n: TOP, pool: TOP, limit: 12, mega: megaOn}), [mons, usage, replace, megaOn]);
  if (!usage) return <Empty>使用率データを読み込むと、おすすめを出せます。</Empty>;
  return <>
    <div class="td-rec-ctl">
      <span class="td-k">入れ替える枠</span>
      <div class="td-slots">
        <button class={cx('chip', replace === -1 && 'on')} onClick={() => setReplace(-1)}>足すだけ</button>
        {mons.map((b, i) => <button class={cx('chip', replace === i && 'on')} onClick={() => setReplace(i)}><Sprite id={b.species} size={24} />{speciesName(b.species)}</button>)}
      </div>
      <label class="td-opt"><input type="checkbox" checked={megaOn} onChange={e => setMega(e.currentTarget.checked)} /> メガシンカするポケモンも出す{megaCount(rest) ? ` (構築にメガストーン持ちが${megaCount(rest)}体います)` : ''}</label>
    </div>
    <h4>おすすめのタイプ</h4>
    <div class="td-recs">
      {rt.list.map(x => (
        <div class="td-rec">
          <div class="td-rec-h"><span class="td-combo">{x.types.map(TJ)}</span><span class="td-gain">+{x.gain.toFixed(1)}</span></div>
          <div class="td-ex">{x.examples.slice(0, 4).map(id => <span class="td-exm"><Sprite id={id} size={26} />{speciesName(id)}</span>)}{!x.inTop && <small class="muted">(上位{TOP}にはいない)</small>}</div>
          <Fixes d={x.diff} />
        </div>
      ))}
    </div>
    <h4>使用率上位{TOP}からのおすすめ</h4>
    <div class="td-recs">
      {rm.list.map(x => (
        <div class="td-rec">
          <div class="td-rec-h"><span class="td-exm"><Sprite id={x.id} size={36} /><b>{speciesName(x.id)}</b></span><span class="td-gain">+{x.gain.toFixed(1)}</span></div>
          <div class="muted td-moves">{[abilityName(x.build.ability), itemName(x.build.item)].filter(Boolean).join('・')}{x.build.moves.length ? ` / ${x.build.moves.map(moveName).join('・')}` : ''}</div>
          <Fixes d={x.diff} />
        </div>
      ))}
    </div>
  </>;
}
