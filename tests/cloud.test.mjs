import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore, memoryBackend} from '../src/store.js';
import {createCloudSync, parseFirebaseConfig} from '../src/cloud-sync.js';
import {newTeam, newBattle, newOpp, sendOut, commitTurn, normalizeBattle} from '../src/engine/battle.js';

// Firestore の模擬: 書き込みはリスナーへ非同期で届く
function fakeDB() {
  const data = {team: new Map(), battle: new Map()};
  const ls = {team: new Set(), battle: new Set()};
  let writes = 0;
  return {
    data, get writes() { return writes; },
    adapter: () => ({
      listen(kind, cb) {
        ls[kind].add(cb);
        queueMicrotask(() => cb([...data[kind]].map(([id, v]) => ({id, ...v}))));
        return () => ls[kind].delete(cb);
      },
      async put(kind, id, v) {
        writes++;
        data[kind].set(id, v);
        for (const cb of ls[kind]) setTimeout(() => cb([{id, ...v}]), 1);
      },
    }),
  };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
async function device(db) {
  const store = createStore(memoryBackend());
  await store.load();
  const sync = createCloudSync(store, db.adapter(), {delay: 5});
  store.onLocalChange = (k, r) => sync.changed(k, r);
  return {store, sync};
}

test('アカウント同期: 2台の端末でリアルタイムに行き来する', async () => {
  const db = fakeDB();
  // 1台目には同期前からの記録がある
  const A = await device(db);
  const team = newTeam(); team.name = 'A の構築';
  team.mons = [{species: 'garchomp', item: '', ability: 'roughskin', nature: 'Jolly', sp: [0, 32, 0, 0, 0, 32], moves: ['earthquake'], note: ''}];
  await A.store.saveTeam(team);
  await wait(30);
  assert.equal(db.data.team.size, 1, '同期前の記録も送られる');
  const B = await device(db);
  await wait(30);
  assert.equal(B.store.teams()[0]?.name, 'A の構築', '2台目は最初に全部受け取る');

  // A で対戦を記録 → B にすぐ届く (取り消し用スナップショットは送らないが、A には残る)
  const b = newBattle({team}); b.opp.push(newOpp('salamence')); normalizeBattle(b);
  sendOut(b, 'me', 0, 0); sendOut(b, 'opp', 0, 0);
  commitTurn(b, {acts: [{side: 'me', mon: 0, type: 'move', move: 'earthquake', flags: {}}]});
  await A.store.saveBattle(b);
  await wait(40);
  assert.equal(B.store.battles().length, 1);
  assert.equal(B.store.battles()[0].turns[0].before, undefined);
  assert.ok(A.store.battles()[0].turns[0].before);

  // B で編集 → A に届き、A の取り消し用スナップショットは消えない
  const bb = structuredClone(B.store.battles()[0]); bb.memo = 'B で書いたメモ';
  await B.store.saveBattle(bb);
  await wait(40);
  assert.equal(A.store.battles()[0].memo, 'B で書いたメモ');
  assert.ok(A.store.battles()[0].turns[0].before, '手元のスナップショットは残す');

  // 削除も伝わる
  await A.store.deleteBattle(b.id);
  await wait(40);
  assert.equal(B.store.battles().length, 0);

  // 受け取っただけでは送り返さない (無限に往復しない)
  const w = db.writes;
  await wait(60);
  assert.equal(db.writes, w);
  A.sync.stop(); B.sync.stop();
});

test('アカウント同期: 送信に失敗したら、あとで送り直す', async () => {
  const db = fakeDB();
  const ad = db.adapter();
  let fail = true;
  const flaky = {...ad, put: (...a) => (fail ? Promise.reject(new Error('offline')) : ad.put(...a))};
  const store = createStore(memoryBackend());
  await store.load();
  const statuses = [];
  const sync = createCloudSync(store, flaky, {delay: 5, onStatus: s => statuses.push(s.state)});
  store.onLocalChange = (k, r) => sync.changed(k, r);
  await wait(10);
  await store.saveTeam(newTeam());
  await wait(30);
  assert.ok(statuses.includes('error'));
  assert.equal(db.data.team.size, 0);
  fail = false;
  await sync.flush();
  assert.equal(db.data.team.size, 1);
  sync.stop();
});

test('firebaseConfig の貼り付けを読み取る', () => {
  const c = parseFirebaseConfig(`// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaTEST",
  authDomain: "pm-test.firebaseapp.com",
  projectId: "pm-test",
  storageBucket: "pm-test.firebasestorage.app",
  messagingSenderId: "123",
  appId: "1:123:web:abc"
};`);
  assert.equal(c.projectId, 'pm-test');
  assert.equal(c.appId, '1:123:web:abc');
  assert.throws(() => parseFirebaseConfig('apiKey: "x"'), /見つかりません/);
});
