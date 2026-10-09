import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore, memoryBackend} from '../src/store.js';
import {syncOnce, mergeRecords, slimBattle, battleFile, TEAMS_FILE, createSyncer} from '../src/sync.js';
import {newTeam, newBattle, newOpp, sendOut, commitTurn, normalizeBattle} from '../src/engine/battle.js';

// GitHub Gist API の最小限の模擬 (メモリ上)
function fakeGitHub({token = 'tok', truncate = false} = {}) {
  const gists = new Map();
  let seq = 0;
  const calls = [];
  const json = (status, body) => ({ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body)});
  const view = g => ({id: g.id, public: g.public, files: Object.fromEntries(Object.entries(g.files).map(([n, c]) => [n, truncate ? {truncated: true, raw_url: `https://raw.test/${g.id}/${n}`} : {content: c, truncated: false}]))});
  const fetchFn = async (url, init = {}) => {
    calls.push({url, method: init.method || 'GET'});
    if (url.startsWith('https://raw.test/')) {
      const [, , , id, name] = url.split('/');
      return {ok: true, status: 200, text: async () => gists.get(id).files[name]};
    }
    if (init.headers?.Authorization !== `Bearer ${token}`) return json(401, {});
    const path = url.replace('https://api.github.com', '');
    if (path.startsWith('/gists?')) return json(200, [...gists.values()].map(view));
    if (path === '/gists' && init.method === 'POST') {
      const body = JSON.parse(init.body);
      const g = {id: `g${++seq}`, public: body.public, files: Object.fromEntries(Object.entries(body.files).map(([n, f]) => [n, f.content]))};
      gists.set(g.id, g);
      return json(201, view(g));
    }
    const m = /^\/gists\/(\w+)$/.exec(path);
    if (m) {
      const g = gists.get(m[1]);
      if (!g) return json(404, {});
      if (init.method === 'PATCH') for (const [n, f] of Object.entries(JSON.parse(init.body).files)) g.files[n] = f.content;
      return json(200, view(g));
    }
    return json(404, {});
  };
  return {fetchFn, gists, calls};
}

async function device(token = 'tok') {
  const store = createStore(memoryBackend());
  await store.load();
  await store.saveSettings({sync: {...store.state.settings.sync, token}});
  return store;
}
let clock = 1000;
const tick = () => { clock += 1000; return clock; };
// テストでは時刻を明示的に進める
async function saveTeamAt(store, team) { team.updatedAt = tick(); await store.saveTeam(team, {touch: false}); }
async function saveBattleAt(store, b) { b.updatedAt = tick(); await store.saveBattle(b, {touch: false}); }

test('マージ: 新しい方を採用し、片方にしか無いものは両方へ', () => {
  const r = mergeRecords([{id: 'a', updatedAt: 5, v: 'L'}, {id: 'b', updatedAt: 1, v: 'L'}, {id: 'c', updatedAt: 3}], [{id: 'a', updatedAt: 2, v: 'R'}, {id: 'b', updatedAt: 9, v: 'R'}, {id: 'd', updatedAt: 1}]);
  const byId = Object.fromEntries(r.merged.map(x => [x.id, x]));
  assert.equal(byId.a.v, 'L');
  assert.equal(byId.b.v, 'R');
  assert.deepEqual(r.toLocal.map(x => x.id).sort(), ['b', 'd']);
  assert.ok(r.remoteStale);
  assert.equal(mergeRecords([{id: 'a', updatedAt: 1}], [{id: 'a', updatedAt: 1}]).remoteStale, false);
  assert.deepEqual(mergeRecords([], [null, {x: 1}]).merged, [], '壊れたレコードは無視');
});

test('2台の端末で構築と対戦記録が行き来する', async () => {
  const gh = fakeGitHub();
  const A = await device(), B = await device();
  const team = newTeam('single'); team.name = 'A の構築';
  team.mons = [{species: 'garchomp', item: '', ability: 'roughskin', nature: 'Jolly', sp: [0, 32, 0, 0, 0, 32], moves: ['earthquake'], note: ''}];
  await saveTeamAt(A, team);
  const battle = newBattle({team});
  battle.opp.push(newOpp('salamence')); normalizeBattle(battle);
  sendOut(battle, 'me', 0, 0); sendOut(battle, 'opp', 0, 0);
  commitTurn(battle, {acts: [{side: 'me', mon: 0, type: 'move', move: 'earthquake', flags: {}}]});
  await saveBattleAt(A, battle);

  let r = await syncOnce(A, {fetchFn: gh.fetchFn});
  assert.ok(r.gistId);
  assert.equal(r.pushed, 2);
  assert.equal(gh.gists.size, 1);
  assert.equal([...gh.gists.values()][0].public, false, '非公開 Gist');
  assert.equal(A.state.settings.sync.gistId, r.gistId);

  // B は既存の Gist を見つけて取り込む (新しく作らない)
  r = await syncOnce(B, {fetchFn: gh.fetchFn});
  assert.equal(gh.gists.size, 1);
  assert.equal(r.pulled, 2);
  assert.equal(r.pushed, 0);
  assert.equal(B.teams()[0].name, 'A の構築');
  assert.equal(B.battles()[0].turns.length, 1);
  assert.equal(B.battles()[0].turns[0].before, undefined, '取り消し用スナップショットは同期に載せない');
  assert.ok(A.battles()[0].turns[0].before, '元の端末には残る');

  // B が構築を編集、A が別の対戦を追加 → 双方に反映
  const tb = structuredClone(B.teams()[0]); tb.name = 'B が改名';
  await saveTeamAt(B, tb);
  const b2 = newBattle({team}); b2.oppName = '2戦目';
  await saveBattleAt(A, b2);
  await syncOnce(B, {fetchFn: gh.fetchFn});
  await syncOnce(A, {fetchFn: gh.fetchFn});
  await syncOnce(B, {fetchFn: gh.fetchFn});
  assert.equal(A.teams()[0].name, 'B が改名');
  assert.equal(B.battles().length, 2);
  assert.equal(A.battles().length, 2);

  // 変更がなければ何も送らない
  const before = gh.calls.filter(c => c.method === 'PATCH').length;
  r = await syncOnce(A, {fetchFn: gh.fetchFn});
  assert.equal(r.pushed, 0);
  assert.equal(r.pulled, 0);
  assert.equal(gh.calls.filter(c => c.method === 'PATCH').length, before);

  // 削除が伝わる
  const id = A.battles()[0].id;
  await A.saveBattle({id, deleted: true, updatedAt: tick(), createdAt: A.battle(id).createdAt}, {touch: false});
  await syncOnce(A, {fetchFn: gh.fetchFn});
  await syncOnce(B, {fetchFn: gh.fetchFn});
  assert.equal(B.battles().length, 1);
  assert.equal(B.battle(id), null);

  // 同じ記録を両方で編集 → あとから保存したほうが残る
  const t1 = structuredClone(A.teams()[0]); t1.memo = 'A のメモ';
  await saveTeamAt(A, t1);
  const t2 = structuredClone(B.teams()[0]); t2.memo = 'B のメモ (あと)';
  await saveTeamAt(B, t2);
  await syncOnce(A, {fetchFn: gh.fetchFn});
  await syncOnce(B, {fetchFn: gh.fetchFn});
  await syncOnce(A, {fetchFn: gh.fetchFn});
  assert.equal(A.teams()[0].memo, 'B のメモ (あと)');
  assert.equal(B.teams()[0].memo, 'B のメモ (あと)');

  // トークンは同期データに含まれない
  const all = JSON.stringify([...gh.gists.values()]);
  assert.ok(!all.includes('"token"'));
});

test('大きいファイル (truncated) は raw_url から読む', async () => {
  const gh = fakeGitHub({truncate: true});
  const A = await device(), B = await device();
  const team = newTeam(); await saveTeamAt(A, team);
  await syncOnce(A, {fetchFn: gh.fetchFn});
  const r = await syncOnce(B, {fetchFn: gh.fetchFn});
  assert.equal(r.pulled, 1);
  assert.ok(gh.calls.some(c => c.url.startsWith('https://raw.test/')));
});

test('エラー: トークン不正・未設定・Gist 消失は分かる文言で失敗し、データは壊さない', async () => {
  const gh = fakeGitHub({token: 'right'});
  const A = await device('wrong');
  await saveTeamAt(A, newTeam());
  await assert.rejects(syncOnce(A, {fetchFn: gh.fetchFn}), /トークンが無効/);
  assert.equal(A.teams().length, 1);
  const N = await device('');
  await assert.rejects(syncOnce(N, {fetchFn: gh.fetchFn}), /未設定/);
  const C = await device('right');
  await C.saveSettings({sync: {...C.state.settings.sync, gistId: 'nope'}});
  await assert.rejects(syncOnce(C, {fetchFn: gh.fetchFn}), /見つかりません/);
  const D = await device('right');
  await assert.rejects(syncOnce(D, {fetchFn: async () => { throw new Error('offline'); }}), /接続できません/);
  // 自動同期の窓口は例外を投げず、状態にエラーを残す
  const s = createSyncer(A, {fetchFn: gh.fetchFn});
  assert.equal(await s.run(), null);
  assert.equal(s.status.state, 'error');
  assert.match(A.state.settings.sync.lastError, /トークンが無効/);
});

test('対戦記録は月ごとのファイルに分かれる', () => {
  assert.equal(battleFile({createdAt: Date.UTC(2026, 9, 9)}), 'pokememo-battles-2026-10.json');
  assert.equal(battleFile({createdAt: 0, updatedAt: 0}), 'pokememo-battles-misc.json');
  assert.equal(TEAMS_FILE, 'pokememo-teams.json');
  assert.deepEqual(slimBattle({id: 'x', turns: [{n: 1, before: {a: 1}, acts: []}]}).turns[0], {n: 1, acts: []});
  assert.deepEqual(slimBattle({id: 'x', deleted: true}), {id: 'x', deleted: true});
});

test('保存: 再読み込みで復元、バックアップの書き出しと読み込み', async () => {
  const backend = memoryBackend();
  const s1 = createStore(backend);
  await s1.load();
  const t = newTeam(); t.name = '保存テスト';
  await s1.saveTeam(t);
  await s1.saveBattle(newBattle({team: t}));
  await s1.saveSettings({format: 'double'});
  const s2 = createStore(backend);
  await s2.load();
  assert.equal(s2.teams()[0].name, '保存テスト');
  assert.equal(s2.battles().length, 1);
  assert.equal(s2.state.settings.format, 'double');
  assert.equal(s2.state.settings.sync.auto, true, '既定値が補われる');
  const dump = JSON.parse(JSON.stringify(s2.exportAll()));
  assert.ok(!JSON.stringify(dump).includes('token'));
  const s3 = createStore(memoryBackend());
  await s3.load();
  assert.equal(await s3.importAll(dump), 2);
  assert.equal(await s3.importAll(dump), 0, '同じものは二重に入らない');
  await assert.rejects(s3.importAll({foo: 1}), /バックアップファイルではありません/);
  // 削除の印は一定期間で掃除される
  await s3.saveTeam({id: 'old', deleted: true, updatedAt: 1, createdAt: 0}, {touch: false});
  const s4 = createStore(memoryBackend(Object.fromEntries((await (async () => { const rows = []; for (const x of s3.state.teams) rows.push([`team:${x.id}`, x]); return rows; })()))));
  await s4.load();
  assert.ok(!s4.state.teams.some(x => x.id === 'old'));
  await s3.wipe();
  assert.equal(s3.state.teams.length, 0);
});
