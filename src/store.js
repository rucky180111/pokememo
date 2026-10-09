// データの保存 (端末内: IndexedDB) と、アプリ全体の状態管理。
// レコードは id / updatedAt / deleted(削除の印) を持ち、同期時は updatedAt の新しい方を採用する。
export const TOMBSTONE_TTL = 1000 * 60 * 60 * 24 * 120;

export function memoryBackend(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    async getAll() { return [...m.entries()]; },
    async set(k, v) { m.set(k, JSON.parse(JSON.stringify(v))); },
    async del(k) { m.delete(k); },
    _map: m,
  };
}

export function idbBackend(name = 'pokememo') {
  let dbp = null;
  const open = () => (dbp ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction('kv', mode);
      const out = fn(t.objectStore('kv'));
      t.oncomplete = () => resolve(out?.result ?? out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  };
  return {
    async getAll() {
      const db = await open();
      return new Promise((resolve, reject) => {
        const out = [];
        const req = db.transaction('kv', 'readonly').objectStore('kv').openCursor();
        req.onsuccess = () => { const c = req.result; if (c) { out.push([c.key, c.value]); c.continue(); } else resolve(out); };
        req.onerror = () => reject(req.error);
      });
    },
    set: (k, v) => tx('readwrite', s => s.put(v, k)),
    del: k => tx('readwrite', s => s.delete(k)),
  };
}

// IndexedDB が使えない環境 (一部のプライベートブラウズ) 用
export function localStorageBackend(prefix = 'pokememo:') {
  return {
    async getAll() {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith(prefix)) { try { out.push([k.slice(prefix.length), JSON.parse(localStorage.getItem(k))]); } catch { /* 壊れた値は無視 */ } }
      }
      return out;
    },
    async set(k, v) { localStorage.setItem(prefix + k, JSON.stringify(v)); },
    async del(k) { localStorage.removeItem(prefix + k); },
  };
}

export const DEFAULT_SETTINGS = {format: 'single', sync: {token: '', gistId: '', auto: true, lastSync: 0, lastError: ''}, bulkMode: 'usage'};

export function createStore(backend) {
  const state = {teams: [], battles: [], settings: structuredCloneSafe(DEFAULT_SETTINGS), usage: {single: null, double: null}, ready: false, saveError: ''};
  const subs = new Set();
  let version = 0;
  const emit = () => { version++; for (const f of subs) f(version); };
  const write = async (k, v) => {
    try { await backend.set(k, v); if (state.saveError) { state.saveError = ''; emit(); } }
    catch (e) { state.saveError = `保存に失敗しました: ${e?.message || e}`; emit(); }
  };
  const upsert = (list, rec) => {
    const i = list.findIndex(x => x.id === rec.id);
    if (i >= 0) list[i] = rec; else list.push(rec);
  };
  const api = {
    state,
    get version() { return version; },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
    async load() {
      const rows = await backend.getAll();
      state.teams = []; state.battles = [];
      for (const [k, v] of rows) {
        if (k.startsWith('team:')) state.teams.push(v);
        else if (k.startsWith('battle:')) state.battles.push(v);
        else if (k === 'settings') state.settings = {...structuredCloneSafe(DEFAULT_SETTINGS), ...v, sync: {...DEFAULT_SETTINGS.sync, ...(v.sync || {})}};
        else if (k === 'usage:single') state.usage.single = v;
        else if (k === 'usage:double') state.usage.double = v;
      }
      // 古い削除の印を掃除する
      const cutoff = Date.now() - TOMBSTONE_TTL;
      for (const [kind, list] of [['team', state.teams], ['battle', state.battles]]) {
        for (const r of list.filter(x => x.deleted && x.updatedAt < cutoff)) await backend.del(`${kind}:${r.id}`);
      }
      state.teams = state.teams.filter(x => !(x.deleted && x.updatedAt < cutoff));
      state.battles = state.battles.filter(x => !(x.deleted && x.updatedAt < cutoff));
      state.ready = true;
      emit();
    },
    teams: () => state.teams.filter(t => !t.deleted).sort((a, b) => b.updatedAt - a.updatedAt),
    battles: () => state.battles.filter(t => !t.deleted).sort((a, b) => b.createdAt - a.createdAt),
    team: id => state.teams.find(t => t.id === id && !t.deleted) || null,
    battle: id => state.battles.find(t => t.id === id && !t.deleted) || null,
    // touch=false は同期で受け取ったレコードをそのまま保存するとき
    async saveTeam(team, {touch = true, silent = false} = {}) {
      if (touch) team.updatedAt = Date.now();
      upsert(state.teams, team);
      if (!silent) emit();
      await write(`team:${team.id}`, team);
      if (touch) api.onLocalChange?.();
    },
    async saveBattle(battle, {touch = true, silent = false} = {}) {
      if (touch) battle.updatedAt = Date.now();
      upsert(state.battles, battle);
      if (!silent) emit();
      await write(`battle:${battle.id}`, battle);
      if (touch) api.onLocalChange?.();
    },
    async deleteTeam(id) { await api.saveTeam({id, deleted: true, updatedAt: Date.now(), createdAt: 0}); },
    async deleteBattle(id) { await api.saveBattle({id, deleted: true, updatedAt: Date.now(), createdAt: 0}); },
    async saveSettings(patch) {
      state.settings = {...state.settings, ...patch};
      emit();
      await write('settings', state.settings);
    },
    async saveUsage(key, data) {
      state.usage[key] = data;
      emit();
      await write(`usage:${key}`, data);
    },
    setUsage(key, data) { state.usage[key] = data; emit(); },
    // バックアップ (トークンは含めない)
    exportAll() {
      return {app: 'pokememo', v: 1, exportedAt: new Date().toISOString(), teams: state.teams, battles: state.battles};
    },
    async importAll(data) {
      if (!data || data.app !== 'pokememo' || !Array.isArray(data.teams) || !Array.isArray(data.battles)) throw new Error('このアプリのバックアップファイルではありません');
      let n = 0;
      for (const [kind, incoming, list] of [['team', data.teams, state.teams], ['battle', data.battles, state.battles]]) {
        for (const r of incoming) {
          if (!r || typeof r.id !== 'string') continue;
          const cur = list.find(x => x.id === r.id);
          if (cur && (cur.updatedAt || 0) >= (r.updatedAt || 0)) continue;
          upsert(list, r);
          await write(`${kind}:${r.id}`, r);
          n++;
        }
      }
      emit();
      api.onLocalChange?.();
      return n;
    },
    // この端末のデータを全消去 (削除の印も残さないので、同期先には影響しない)
    async wipe() {
      for (const [k] of await backend.getAll()) await backend.del(k);
      state.teams = []; state.battles = []; state.settings = structuredCloneSafe(DEFAULT_SETTINGS); state.usage = {single: null, double: null};
      emit();
    },
    onLocalChange: null,
  };
  return api;
}

function structuredCloneSafe(o) { return JSON.parse(JSON.stringify(o)); }
