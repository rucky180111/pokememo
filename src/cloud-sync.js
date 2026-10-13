// アカウント同期 (Firebase) のしくみ。Firebase そのものは adapter として外から渡す (テストでは模擬を使う)。
// 保存先: users/{uid}/teams/{id}, users/{uid}/battles/{id}
//   各ドキュメント = {u: updatedAt, d: 削除の印, j: レコードの JSON 文字列}
// 端末側の変更は少し待ってまとめて送り、相手の端末の変更はリアルタイムで受け取る。
import {slimBattle} from './sync.js';
import {TOMBSTONE_TTL} from './store.js';

const KINDS = ['team', 'battle'];

/** 貼り付けられた firebaseConfig (JS のオブジェクト or JSON) から必要な値を取り出す */
export function parseFirebaseConfig(text) {
  const out = {};
  for (const m of String(text || '').matchAll(/["']?(\w+)["']?\s*:\s*["']([^"']+)["']/g)) out[m[1]] = m[2];
  const need = ['apiKey', 'authDomain', 'projectId', 'appId'];
  const miss = need.filter(k => !out[k]);
  if (miss.length) throw new Error(`設定に ${miss.join('・')} が見つかりません。Firebase の「アプリの設定」に出る firebaseConfig を丸ごと貼り付けてください`);
  return Object.fromEntries(['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'].filter(k => out[k]).map(k => [k, out[k]]));
}

const listOf = (store, kind) => (kind === 'team' ? store.state.teams : store.state.battles);
const toWire = (kind, r) => ({u: r.updatedAt || 0, d: !!r.deleted, j: JSON.stringify(kind === 'battle' ? slimBattle(r) : r)});

/**
 * adapter: {
 *   listen(kind, onChanges([{id, u, d, j}]), onError) → unsubscribe   … 最初の呼び出しで全件、以降は変更分
 *   put(kind, id, {u, d, j}) → Promise
 * }
 */
export function createCloudSync(store, adapter, {delay = 1500, now = Date.now, onStatus} = {}) {
  const remoteU = {team: new Map(), battle: new Map()}; // 相手側にある各レコードの updatedAt
  const dirty = new Set(); // 送る必要のある "kind:id"
  let ready = {team: false, battle: false};
  let timer = null, flushing = null, stopped = false;
  const unsubs = [];
  const status = {state: 'connecting', message: '', last: 0};
  const set = (state, message = '') => { status.state = state; status.message = message; onStatus?.({...status}); };

  const cutoff = () => now() - TOMBSTONE_TTL;
  function receive(kind, changes) {
    let pulled = 0;
    for (const c of changes) {
      remoteU[kind].set(c.id, c.u || 0);
      const cur = listOf(store, kind).find(x => x.id === c.id);
      if (cur && (cur.updatedAt || 0) >= (c.u || 0)) { if ((cur.updatedAt || 0) > (c.u || 0)) dirty.add(`${kind}:${c.id}`); continue; }
      if (c.d && (c.u || 0) < cutoff()) continue;
      let rec;
      try { rec = JSON.parse(c.j); } catch { continue; }
      if (!rec || rec.id !== c.id) continue;
      // 取り消し用の盤面スナップショットは端末内だけのものなので、手元にあれば残す
      if (kind === 'battle' && cur?.turns && rec.turns) rec.turns = rec.turns.map((t, i) => (cur.turns[i]?.before && cur.turns[i].n === t.n ? {...t, before: cur.turns[i].before} : t));
      (kind === 'team' ? store.saveTeam(rec, {touch: false}) : store.saveBattle(rec, {touch: false}));
      pulled++;
    }
    if (!ready[kind]) {
      ready[kind] = true;
      // 最初の受信のあと: 相手側に無い・古いものを送る
      for (const r of listOf(store, kind)) {
        if (r.deleted && (r.updatedAt || 0) < cutoff()) continue;
        if ((remoteU[kind].get(r.id) ?? -1) < (r.updatedAt || 0)) dirty.add(`${kind}:${r.id}`);
      }
    }
    if (pulled) set('ok', `${pulled}件を受け取りました`);
    else if (ready.team && ready.battle && status.state === 'connecting') set('ok');
    if (dirty.size) schedule(200);
  }

  async function flush() {
    if (stopped || !ready.team || !ready.battle) return;
    if (flushing) { schedule(); return flushing; }
    const keys = [...dirty];
    dirty.clear();
    flushing = (async () => {
      set('syncing');
      try {
        for (const key of keys) {
          const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
          const r = listOf(store, kind).find(x => x.id === id);
          if (!r) continue;
          if ((remoteU[kind].get(id) ?? -1) >= (r.updatedAt || 0)) continue;
          await adapter.put(kind, id, toWire(kind, r));
          remoteU[kind].set(id, r.updatedAt || 0);
        }
        status.last = now();
        set('ok');
      } catch (e) {
        for (const k of keys) dirty.add(k);
        set('error', e?.message || String(e));
        schedule(15000);
      } finally { flushing = null; }
    })();
    return flushing;
  }
  function schedule(ms = delay) {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(flush, ms);
  }

  for (const kind of KINDS) {
    unsubs.push(adapter.listen(kind, ch => receive(kind, ch), e => set('error', e?.message || String(e))));
  }
  set('connecting');
  return {
    status,
    /** 端末側で記録が変わったとき (store.onLocalChange から呼ぶ) */
    changed(kind, rec) {
      if (rec) dirty.add(`${kind}:${rec.id}`);
      else for (const k of KINDS) for (const r of listOf(store, k)) if ((remoteU[k].get(r.id) ?? -1) < (r.updatedAt || 0)) dirty.add(`${k}:${r.id}`);
      schedule();
    },
    flush,
    stop() { stopped = true; clearTimeout(timer); for (const u of unsubs) try { u?.(); } catch { /* 無視 */ } },
  };
}
