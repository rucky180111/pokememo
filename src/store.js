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
  // iPhone / iPad の Safari では、開く処理が戻ってこないことがあるので、時間で区切ってやり直す
  const openOnce = ms => new Promise((resolve, reject) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; reject(new Error('保存領域 (IndexedDB) を開けませんでした')); } }, ms);
    let req;
    try { req = indexedDB.open(name, 1); } catch (e) { clearTimeout(t); reject(e); return; }
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => { if (done) { req.result.close(); return; } done = true; clearTimeout(t); req.result.onversionchange = () => { req.result.close(); dbp = null; }; resolve(req.result); };
    req.onerror = () => { if (done) return; done = true; clearTimeout(t); reject(req.error); };
    req.onblocked = () => { /* 別のタブが古い版で開いている。待つ */ };
  });
  const open = () => (dbp ||= (async () => {
    for (let i = 0; i < 3; i++) {
      try { return await openOnce(2500 + i * 2500); } catch (e) {
        if (i === 2) { dbp = null; throw e; }
        // Safari の不具合よけ: 一度一覧を取ってから開き直すと戻ってくることがある
        try { await indexedDB.databases?.(); } catch { /* 無視 */ }
      }
    }
  })());
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
  // 入力時点の値を順番どおり保存する。非同期バックエンドでも古い入力が後から上書きしない。
  let pending = Promise.resolve();
  const failures = new Map();
  const write = (k, v) => {
    const snapshot = structuredCloneSafe(v);
    const task = pending.then(async () => {
      try { await backend.set(k, snapshot); failures.delete(k); }
      catch (e) { failures.set(k, `保存に失敗しました: ${e?.message || e}`); }
      const message = [...failures.values()].join(' / ');
      if (state.saveError !== message) { state.saveError = message; emit(); }
      return !failures.has(k);
    });
    pending = task.then(() => {});
    return task;
  };
  const upsert = (list, rec) => {
    const i = list.findIndex(x => x.id === rec.id);
    if (i >= 0) list[i] = rec; else list.push(rec);
  };
  const api = {
    state,
    get version() { return version; },
    flush: () => pending,
    async retrySaves() {
      for (const k of [...failures.keys()]) {
        const v = k.startsWith('battle:') ? state.battles.find(r => r.id === k.slice(7)) : k.startsWith('team:') ? state.teams.find(r => r.id === k.slice(5)) : k === 'settings' ? state.settings : state.usage[k.slice(6)];
        if (v != null) await write(k, v);
      }
      return !state.saveError;
    },
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
      if (touch) api.onLocalChange?.('team', team);
    },
    async saveBattle(battle, {touch = true, silent = false} = {}) {
      if (touch) battle.updatedAt = Date.now();
      upsert(state.battles, battle);
      if (!silent) emit();
      await write(`battle:${battle.id}`, battle);
      if (touch) api.onLocalChange?.('battle', battle);
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
          if (!await write(`${kind}:${r.id}`, r)) { emit(); throw new Error(state.saveError); }
          // 保存中に新しい編集が入った場合は、表示を古いバックアップに戻さない。
          const latest = list.find(x => x.id === r.id);
          if (!latest || (latest.updatedAt || 0) < (r.updatedAt || 0)) upsert(list, r);
          n++;
        }
      }
      emit();
      api.onLocalChange?.();
      return n;
    },
    // この端末のデータを全消去 (削除の印も残さないので、同期先には影響しない)
    async wipe() {
      await pending;
      for (const [k] of await backend.getAll()) await backend.del(k);
      failures.clear(); state.saveError = '';
      state.teams = []; state.battles = []; state.settings = structuredCloneSafe(DEFAULT_SETTINGS); state.usage = {single: null, double: null};
      emit();
    },
    onLocalChange: null,
  };
  return api;
}

function structuredCloneSafe(o) { return JSON.parse(JSON.stringify(o)); }
