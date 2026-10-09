// GitHub の非公開 Gist を使った端末間同期。
// 構築は 1 ファイル、対戦記録は月ごとのファイルに分けて保存し、レコード単位で updatedAt の新しい方を採用する。
const API = 'https://api.github.com';
export const TEAMS_FILE = 'pokememo-teams.json';
export const battleFile = b => {
  const d = new Date(b.createdAt || b.updatedAt || 0);
  const ym = Number.isFinite(d.getTime()) && d.getTime() > 0 ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` : 'misc';
  return `pokememo-battles-${ym}.json`;
};
const isBattleFile = name => /^pokememo-battles-[\w-]+\.json$/.test(name);

// 同期に載せる形 (取り消し用の盤面スナップショットは端末内だけに持つ)
export function slimBattle(b) {
  if (b.deleted || !b.turns) return b;
  return {...b, turns: b.turns.map(t => { const {before, ...rest} = t; return rest; })};
}

// レコード単位のマージ。戻り値: {merged, changedLocal: ローカルに取り込むべきレコード, changedRemote: リモートに無い/古いものがあるか}
export function mergeRecords(local, remote) {
  const map = new Map();
  for (const r of remote) if (r && typeof r.id === 'string') map.set(r.id, {r, from: 'remote'});
  const toLocal = [];
  let remoteStale = false;
  for (const l of local) {
    const cur = map.get(l.id);
    if (!cur) { map.set(l.id, {r: l, from: 'local'}); remoteStale = true; continue; }
    const lu = l.updatedAt || 0, ru = cur.r.updatedAt || 0;
    if (lu > ru) { map.set(l.id, {r: l, from: 'local'}); remoteStale = true; }
    else if (ru > lu) toLocal.push(cur.r);
    else map.set(l.id, {r: l, from: 'same'});
  }
  const localIds = new Set(local.map(l => l.id));
  for (const [id, e] of map) if (e.from === 'remote' && !localIds.has(id)) toLocal.push(e.r);
  return {merged: [...map.values()].map(e => e.r), toLocal, remoteStale};
}

async function gh(fetchFn, token, path, init = {}) {
  let res;
  try {
    res = await fetchFn(path.startsWith('http') ? path : API + path, {
      ...init,
      headers: {Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', Authorization: `Bearer ${token}`, ...(init.body ? {'Content-Type': 'application/json'} : {})},
    });
  } catch (e) {
    throw new Error(`GitHub に接続できません (${e?.message || e})`);
  }
  if (res.status === 401) throw new Error('トークンが無効です (期限切れか、入力ミスの可能性)');
  if (res.status === 403) throw new Error('権限が足りないか、アクセス回数の上限に達しました (トークンに Gist の権限が必要です)');
  if (res.status === 404) throw new Error('同期先の Gist が見つかりません');
  if (!res.ok) throw new Error(`GitHub エラー ${res.status}`);
  return res.json();
}

async function readFile(fetchFn, file) {
  let text = file.content;
  if (file.truncated || text == null) {
    const res = await fetchFn(file.raw_url);
    if (!res.ok) throw new Error(`同期データの取得に失敗 (${res.status})`);
    text = await res.text();
  }
  try { return JSON.parse(text); } catch { throw new Error('同期データが壊れています'); }
}

export async function findOrCreateGist(fetchFn, token) {
  for (let page = 1; page <= 5; page++) {
    const list = await gh(fetchFn, token, `/gists?per_page=100&page=${page}`);
    const hit = list.find(g => g.files && g.files[TEAMS_FILE]);
    if (hit) return hit.id;
    if (list.length < 100) break;
  }
  const created = await gh(fetchFn, token, '/gists', {
    method: 'POST',
    body: JSON.stringify({description: 'ポケモン対戦メモ (pokememo) の同期データ', public: false, files: {[TEAMS_FILE]: {content: JSON.stringify({v: 1, teams: []})}}}),
  });
  return created.id;
}

/**
 * 同期を1回行う。store は createStore() の戻り値。
 * 戻り値: {pulled: 取り込んだ件数, pushed: 送信したファイル数, gistId}
 */
export async function syncOnce(store, {fetchFn = fetch, now = Date.now} = {}) {
  const cfg = store.state.settings.sync;
  if (!cfg.token) throw new Error('GitHub トークンが未設定です');
  let gistId = cfg.gistId;
  if (!gistId) gistId = await findOrCreateGist(fetchFn, cfg.token);
  const gist = await gh(fetchFn, cfg.token, `/gists/${gistId}`);

  const remoteTeams = [];
  const remoteBattles = [];
  const remoteText = {};
  for (const [name, file] of Object.entries(gist.files || {})) {
    if (name !== TEAMS_FILE && !isBattleFile(name)) continue;
    const data = await readFile(fetchFn, file);
    remoteText[name] = JSON.stringify(data);
    if (name === TEAMS_FILE) remoteTeams.push(...(data.teams || []));
    else remoteBattles.push(...(data.battles || []));
  }

  const lt = store.state.teams, lb = store.state.battles;
  const mt = mergeRecords(lt, remoteTeams);
  const mb = mergeRecords(lb.map(slimBattle), remoteBattles);

  // ローカルへ取り込み (リモートの方が新しいもの)
  // 通信中に端末側で編集されていた場合は、その編集を上書きしない
  const newer = (list, r) => { const cur = list.find(x => x.id === r.id); return !cur || (cur.updatedAt || 0) < (r.updatedAt || 0); };
  let pulled = 0;
  for (const r of mt.toLocal) if (newer(store.state.teams, r)) { await store.saveTeam(r, {touch: false, silent: true}); pulled++; }
  for (const r of mb.toLocal) if (newer(store.state.battles, r)) { await store.saveBattle(r, {touch: false, silent: true}); pulled++; }

  // リモートへ送る内容を組み立て、変わったファイルだけ更新する
  const files = {};
  const teamsText = JSON.stringify({v: 1, teams: mt.merged.sort((a, b) => (a.id < b.id ? -1 : 1))});
  if (teamsText !== remoteText[TEAMS_FILE]) files[TEAMS_FILE] = {content: teamsText};
  const groups = {};
  for (const r of mb.merged) (groups[battleFile(r)] ||= []).push(r);
  for (const [name, list] of Object.entries(groups)) {
    const text = JSON.stringify({v: 1, battles: list.sort((a, b) => (a.id < b.id ? -1 : 1))});
    if (text !== remoteText[name]) files[name] = {content: text};
  }
  const pushed = Object.keys(files).length;
  if (pushed) await gh(fetchFn, cfg.token, `/gists/${gistId}`, {method: 'PATCH', body: JSON.stringify({files})});

  await store.saveSettings({sync: {...store.state.settings.sync, gistId, lastSync: now(), lastError: ''}});
  return {pulled, pushed, gistId};
}

// 自動同期の制御 (変更から少し待って実行、多重実行しない)
export function createSyncer(store, {delay = 4000, fetchFn} = {}) {
  let timer = null, running = null, again = false;
  const subs = new Set();
  const status = {state: 'idle', message: ''};
  const set = (state, message = '') => { status.state = state; status.message = message; for (const f of subs) f(status); };
  async function run() {
    if (running) { again = true; return running; }
    if (!store.state.settings.sync.token) { set('off'); return null; }
    set('syncing');
    running = (async () => {
      try {
        const r = await syncOnce(store, fetchFn ? {fetchFn} : {});
        set('ok', r.pulled ? `${r.pulled}件を取り込みました` : '');
        return r;
      } catch (e) {
        const msg = e?.message || String(e);
        await store.saveSettings({sync: {...store.state.settings.sync, lastError: msg}});
        set('error', msg);
        return null;
      } finally {
        running = null;
        if (again) { again = false; schedule(); }
      }
    })();
    return running;
  }
  function schedule() {
    if (!store.state.settings.sync.token || !store.state.settings.sync.auto) return;
    clearTimeout(timer);
    timer = setTimeout(run, delay);
  }
  return {run, schedule, status, subscribe(f) { subs.add(f); return () => subs.delete(f); }};
}
