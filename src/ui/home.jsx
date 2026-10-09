// 対戦の一覧
import {useState} from 'preact/hooks';
import {speciesName} from '../engine/dex.js';
import {newBattle, activeCount} from '../engine/battle.js';
import {useApp, Sheet, Seg, Empty, cx} from './common.jsx';

const RESULT_JA = {win: '勝ち', lose: '負け', draw: '引分'};

export function BattleList() {
  const {store, nav} = useApp();
  const [fmt, setFmt] = useState('');
  const [choose, setChoose] = useState(null); // 'battle' | 'sim'
  const teams = store.teams();
  const all = store.battles();
  const list = all.filter(b => !fmt || b.format === fmt);
  const create = async (team, kind) => {
    const b = newBattle({team, kind, format: team ? team.format : store.state.settings.format});
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
      {all.length > 0 && <Seg small value={fmt} options={[['', 'すべて'], ['single', 'シングル'], ['double', 'ダブル']]} onChange={setFmt} />}
      {teams.length > 0 && !list.length && <Empty>まだ対戦の記録がありません。「対戦を記録」で見せ合いから入力できます。「仮想盤面」は統計に含めない計算用の盤面です。</Empty>}
      <div class="cards">
        {list.map(b => {
          const leads = b.pick.opp.slice(0, activeCount(b.format));
          return (
            <button class="card link" key={b.id} onClick={() => nav(`#/battle/${b.id}`)}>
              <div class="card-top">
                <strong>{b.teamName || '構築なし'} <span class="muted">vs {b.oppName || '相手'}</span></strong>
                <span>
                  {b.kind === 'sim' ? <span class="tag accent">仮想</span> : b.result ? <span class={cx('tag', 'res-' + b.result)}>{RESULT_JA[b.result]}</span> : <span class="tag">未決</span>}
                </span>
              </div>
              <div class="chips">
                {b.opp.map((o, i) => <span class={cx('chip', b.pick.opp.includes(i) && 'on', leads.includes(i) && 'lead')}>{speciesName(o.species)}</span>)}
                {!b.opp.length && <span class="muted">相手未入力</span>}
              </div>
              <div class="card-foot muted">{b.date}・{b.format === 'double' ? 'ダブル' : 'シングル'}・{b.turns.length}ターン{b.memo ? `・${b.memo.slice(0, 40)}` : ''}</div>
            </button>
          );
        })}
      </div>
      {choose && (
        <Sheet title="使う構築をえらぶ" onClose={() => setChoose(null)}>
          <div class="picker-list">
            {teams.map(t => (
              <button class="row" onClick={() => { setChoose(null); create(t, choose); }}>
                <span class="nm">{t.name}</span><span class="row-sub">{t.format === 'double' ? 'ダブル' : 'シングル'}・{t.mons.map(m => speciesName(m.species)).join(' ')}</span>
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
