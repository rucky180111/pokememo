// アプリの外枠: 画面切り替え・下部ナビ・同期表示・通知
import {useCallback, useEffect, useMemo, useRef, useState} from 'preact/hooks';
import {AppCtx, useStoreVersion, cx} from './common.jsx';
import {BattleList} from './home.jsx';
import {BattleScreen} from './battle.jsx';
import {TeamList, TeamEditor} from './teams.jsx';
import {StatsScreen} from './stats.jsx';
import {SettingsScreen} from './settings.jsx';

const NAV = [['#/battles', '対戦'], ['#/teams', '構築'], ['#/stats', '統計'], ['#/settings', '設定']];

function parseHash() {
  const h = location.hash || '#/battles';
  const [, page, id] = h.split('/');
  return {page: page || 'battles', id: id ? decodeURIComponent(id) : null, hash: h};
}

export function App({store, syncer}) {
  useStoreVersion(store);
  const [route, setRoute] = useState(parseHash);
  const [toastMsg, setToastMsg] = useState('');
  const [syncStatus, setSyncStatus] = useState({...syncer.status});
  const timer = useRef(null);
  useEffect(() => {
    const f = () => { setRoute(parseHash()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  useEffect(() => syncer.subscribe(s => setSyncStatus({...s})), [syncer]);
  const toast = useCallback(msg => {
    setToastMsg(msg);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToastMsg(''), 3500);
  }, []);
  const nav = useCallback(h => { location.hash = h; }, []);
  const app = useMemo(() => ({store, syncer, nav, toast}), [store, syncer]);
  if (!store.state.ready) return <div class="loading">読み込み中…</div>;
  let screen;
  switch (route.page) {
    case 'battle': screen = <BattleScreen key={route.id} id={route.id} />; break;
    case 'teams': screen = <TeamList />; break;
    case 'team': screen = <TeamEditor key={route.id} id={route.id} />; break;
    case 'stats': screen = <StatsScreen />; break;
    case 'settings': screen = <SettingsScreen />; break;
    default: screen = <BattleList />;
  }
  const hasToken = !!store.state.settings.sync.token;
  const section = route.page === 'battle' ? 'battles' : route.page === 'team' ? 'teams' : route.page;
  const syncLabel = !hasToken ? '' : syncStatus.state === 'syncing' ? '同期中' : syncStatus.state === 'error' ? '同期エラー' : '同期済み';
  return (
    <AppCtx.Provider value={app}>
      <header class="topbar">
        <a class="brand" href="#/battles">対戦メモ</a>
        <span class="grow" />
        {store.state.saveError && <span class="tag bad">{store.state.saveError}</span>}
        {hasToken
          ? <button class={cx('syncbtn', syncStatus.state)} onClick={() => syncer.run()} title={syncStatus.message || '今すぐ同期'}><span class="dot" />{syncLabel}</button>
          : <a class="syncbtn off" href="#/settings"><span class="dot" />同期オフ</a>}
      </header>
      <main>{screen}</main>
      <nav class="bottomnav" aria-label="メニュー">
        {NAV.map(([h, label]) => <a href={h} class={cx(h === `#/${section}` && 'on')} aria-current={h === `#/${section}` ? 'page' : undefined}>{label}</a>)}
      </nav>
      {toastMsg && <div class="toast" role="status">{toastMsg}</div>}
    </AppCtx.Provider>
  );
}
