// 対戦の一覧
import {useState} from 'preact/hooks';
import {speciesName} from '../engine/dex.js';
import {newBattle, activeCount} from '../engine/battle.js';
import {useApp, Sheet, Empty, Sprite, cx} from './common.jsx';

const RESULT_JA = {win: '勝ち', lose: '負け', draw: '引分'};

export function BattleList() {
  const {store, nav} = useApp();
  const [fmt, setFmt] = useState('');
  const [choose, setChoose] = useState(null); // 'battle' | 'sim'
  const teams = store.teams();
  const all = store.battles();
  // 新しい対戦が上 (作成日時の新しい順)
  const list = all.filter(b => !fmt || b.format === fmt).slice().sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0));
  const create = async (team, kind) => {
    const b = newBattle({team, kind, format: 'single'});
    await store.saveBattle(b);
    nav(`#/battle/${b.id}`);
  };
  const start = kind => {
    if (teams.length === 1) create(teams[0], kind);
    else setChoose(kind);
  };
  return (
    <div class="page">
      <div class="page-head">
        <h1>対戦</h1>
        <div class="btnrow">
          <button class="btn" onClick={() => start('sim')}>仮想盤面</button>
          <button class="btn primary" onClick={() => start('battle')}>対戦を記録</button>
        </div>
      </div>
      {!teams.length && <div class="box"><p>はじめに「構築」で自分の6体を登録してください。登録した構築を選ぶと、対戦のメモとダメージ計算がすぐ始められます。</p><button class="btn primary" onClick={() => nav('#/teams')}>構築を作る</button></div>}
      {teams.length > 0 && !list.length && <Empty>まだ対戦の記録がありません。「対戦を記録」で見せ合いから入力できます。「仮想盤面」は統計に含めない計算用の盤面です。</Empty>}
      {list.length > 0 && (
        <div class="brows" role="list">
          <div class="brow head" aria-hidden="true">
            <span class="br-res">結果</span><span class="br-date">日付</span><span class="br-vs">対戦</span><span class="br-opp">相手 (明るい=選出・枠=初手)</span><span class="br-mine">自分の選出</span><span class="br-turn">ターン</span><span class="br-memo">メモ</span>
          </div>
          {list.map(b => {
            const leads = b.pick.opp.slice(0, activeCount(b.format));
            const myLead = b.pick.me.slice(0, activeCount(b.format));
            return (
              <button class={cx('brow', b.result && `r-${b.result}`)} role="listitem" key={b.id} onClick={() => nav(`#/battle/${b.id}`)}>
                <span class="br-res">{b.kind === 'sim' ? <span class="tag accent">仮想</span> : b.result ? <span class={cx('tag', 'res-' + b.result)}>{RESULT_JA[b.result]}</span> : <span class="tag">未決</span>}</span>
                <span class="br-date num">{(b.date || '').slice(5).replace('-', '/')}</span>
                <span class="br-vs"><b>{b.oppName || '相手'}</b><small class="muted">{b.teamName || '構築なし'}</small></span>
                <span class="br-opp">
                  {b.opp.map((o, i) => <span class={cx('br-mon', b.pick.opp.includes(i) ? 'picked' : 'out', leads.includes(i) && 'lead')} title={speciesName(o.species)}><Sprite id={o.species} size={36} /><small>{speciesName(o.species)}</small></span>)}
                  {!b.opp.length && <span class="muted">相手未入力</span>}
                </span>
                <span class="br-mine">{b.pick.me.map(i => b.my[i] && <span class={cx('br-mon', 'picked', myLead.includes(i) && 'lead')} title={speciesName(b.my[i].species)}><Sprite id={b.my[i].species} size={30} /><small>{speciesName(b.my[i].species)}</small></span>)}</span>
                <span class="br-turn num">{b.turns.length}<small>T</small></span>
                <span class="br-memo muted">{b.memo ? b.memo.slice(0, 60) : ''}</span>
              </button>
            );
          })}
        </div>
      )}
      {choose && (
        <Sheet title="使う構築をえらぶ" onClose={() => setChoose(null)}>
          <div class="picker-list">
            {teams.map(t => (
              <button class="row" onClick={() => { setChoose(null); create(t, choose); }}>
                <span class="nm">{t.name}</span><span class="row-sub">{t.mons.map(m => speciesName(m.species)).join(' ')}</span>
              </button>
            ))}
            {choose === 'sim' && <button class="row" onClick={() => { setChoose(null); create(null, 'sim'); }}><span class="muted">構築を使わず空の盤面で始める</span></button>}
            {!teams.length && choose === 'battle' && <p class="empty">先に「構築」で自分のパーティを登録してください。</p>}
          </div>
        </Sheet>
      )}
    </div>
  );
}
