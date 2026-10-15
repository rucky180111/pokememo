// 自分のサーバー (ラズパイなど) との同期の adapter。server/server.js と組み合わせて使う
const RETRY = [1000, 3000, 8000, 20000, 60000];
// これだけ何も届かなければ、つながりが切れたとみなして張り直す (サーバーは 25 秒ごとに合図を送る)
const IDLE_MS = 70000;

export function serverAdapter(baseUrl, key, {fetchFn = (...a) => fetch(...a), onState, idleMs = IDLE_MS} = {}) {
  const base = baseUrl.replace(/\/+$/, '');
  const headers = {Authorization: `Bearer ${key}`};
  const handlers = {team: null, battle: null};
  const errs = new Set();
  let seq = 0, stopped = false, ctrl = null, started = false, tries = 0, kicked = false;
  let idle = null, retryTimer = null, retryWake = null;
  const cancelRetry = () => { clearTimeout(retryTimer); retryTimer = null; retryWake?.(); retryWake = null; };
  // 画面に戻ってきたとき・ネットが戻ったときは、すぐに張り直して取りこぼしを受け取る
  const kick = () => { if (stopped || !started) return; kicked = true; ctrl?.abort(); cancelRetry(); };
  const onVis = () => { if (typeof document === 'undefined' || document.visibilityState === 'visible') kick(); };
  const fail = e => { for (const f of errs) f(e); };
  const dispatch = (records, first) => {
    for (const kind of ['team', 'battle']) {
      const list = records.filter(r => r.kind === kind).map(({id, u, d, j}) => ({id, u, d, j}));
      if ((first || list.length) && handlers[kind]) handlers[kind](list);
    }
  };
  const msg = async res => {
    if (res.status === 401) return '同期キーが違います';
    try { return (await res.json()).error || `サーバーエラー ${res.status}`; } catch { return `サーバーエラー ${res.status}`; }
  };
  async function loop() {
    // 最初に全件を受け取り、そのあとは変更を流し続けてもらう (切れたら続きから再接続)
    let first = true;
    while (!stopped) {
      try {
        ctrl = new AbortController();
        if (first) {
          const r = await fetchFn(`${base}/api/records?since=0`, {headers, cache: 'no-store', signal: ctrl.signal});
          if (!r.ok) throw new Error(await msg(r));
          const data = await r.json();
          if (stopped) break;
          seq = data.seq || 0;
          dispatch(data.records || [], true);
          first = false;
          onState?.('ok');
        }
        const r = await fetchFn(`${base}/api/stream?since=${seq}`, {headers, cache: 'no-store', signal: ctrl.signal});
        if (!r.ok || !r.body) throw new Error(r.ok ? 'この端末ではリアルタイム受信が使えません' : await msg(r));
        tries = 0;
        onState?.('ok');
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        // iPhone をスリープ・アプリ切り替えすると、エラーにならないまま受信が止まることがあるので見張る
        const arm = () => { clearTimeout(idle); idle = setTimeout(() => ctrl?.abort(), idleMs); };
        arm();
        for (;;) {
          let res;
          try { res = await reader.read(); } finally { arm(); }
          const {value, done} = res;
          if (done) { clearTimeout(idle); break; }
          buf += dec.decode(value, {stream: true});
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i); buf = buf.slice(i + 2);
            const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
            if (!data) continue;
            try { const m = JSON.parse(data); if (m.seq) seq = Math.max(seq, m.seq); dispatch(m.records || [], false); } catch { /* 壊れた行は無視 */ }
          }
        }
      } catch (e) {
        if (stopped) break;
        if (kicked) { kicked = false; tries = 0; continue; }
        if (e?.name !== 'AbortError') fail(new Error(/fetch|network|load failed/i.test(e?.message || '') ? 'サーバーにつながりません (ラズパイの電源・ネット・アドレスを確認してください)' : e?.message || String(e)));
      } finally {
        clearTimeout(idle); idle = null;
      }
      if (stopped) break;
      await new Promise(r => { retryWake = r; retryTimer = setTimeout(r, RETRY[Math.min(tries++, RETRY.length - 1)]); });
      retryWake = null; retryTimer = null;
    }
  }
  return {
    listen(kind, onChanges, onError) {
      handlers[kind] = onChanges;
      if (onError) errs.add(onError);
      if (!started && handlers.team && handlers.battle) {
        started = true;
        if (typeof window !== 'undefined') { document.addEventListener('visibilitychange', onVis); window.addEventListener('online', kick); window.addEventListener('pageshow', kick); }
        loop();
      }
      return () => {
        handlers[kind] = null; stopped = true; ctrl?.abort(); clearTimeout(idle); cancelRetry();
        if (typeof window !== 'undefined') { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('online', kick); window.removeEventListener('pageshow', kick); }
      };
    },
    async put(kind, id, data) {
      let r;
      try { r = await fetchFn(`${base}/api/records/${kind}/${encodeURIComponent(id)}`, {method: 'PUT', headers: {...headers, 'Content-Type': 'application/json'}, body: JSON.stringify(data)}); }
      catch { throw new Error('サーバーにつながりません (ラズパイの電源・ネット・アドレスを確認してください)'); }
      if (!r.ok) throw new Error(await msg(r));
      await r.text();
    },
  };
}

/** 接続の確認 (設定画面の「接続テスト」) */
export async function testServer(baseUrl, key, fetchFn = (...a) => fetch(...a)) {
  const base = baseUrl.replace(/\/+$/, '');
  let r;
  try { r = await fetchFn(`${base}/api/health`, {cache: 'no-store'}); } catch { throw new Error('サーバーにつながりません。アドレスと、ラズパイ側の公開設定を確認してください'); }
  if (!r.ok) throw new Error(`サーバーの応答がおかしいです (${r.status})`);
  await r.text();
  r = await fetchFn(`${base}/api/records?since=999999999999`, {headers: {Authorization: `Bearer ${key}`}, cache: 'no-store'});
  if (r.status === 401) throw new Error('同期キーが違います');
  if (!r.ok) throw new Error(`サーバーエラー ${r.status}`);
  await r.text();
  return true;
}
