import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createStore, memoryBackend} from '../src/store.js';
import {createCloudSync} from '../src/cloud-sync.js';
import {serverAdapter, testServer} from '../src/cloud-server.js';
import {newTeam, newBattle} from '../src/engine/battle.js';

const KEY = 'k'.repeat(32);
const wait = ms => new Promise(r => setTimeout(r, ms));
async function startServer(dir, port) {
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/server.js'], {env: {...process.env, SYNC_KEY: KEY, PORT: String(port), DATA_DIR: dir, ALLOW_ORIGIN: '*'}, stdio: 'pipe'});
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return p; } catch { /* 起動待ち */ } await wait(100); }
  p.kill(); throw new Error('server did not start');
}
async function device(url) {
  const store = createStore(memoryBackend());
  await store.load();
  const sync = createCloudSync(store, serverAdapter(url, KEY), {delay: 5});
  store.onLocalChange = (k, r) => sync.changed(k, r);
  return {store, sync};
}

test('自分のサーバー (server/server.js) で2台が同期する', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmsync-'));
  const port = 18000 + Math.floor(Math.random() * 1000);
  const url = `http://127.0.0.1:${port}`;
  let srv = await startServer(dir, port);
  try {
    await assert.rejects(testServer(url, 'wrong-key-wrong-key-wrong'), /同期キーが違います/);
    assert.ok(await testServer(url, KEY));
    const A = await device(url);
    const t = newTeam(); t.name = 'ラズパイ構築';
    await A.store.saveTeam(t);
    await wait(150);
    const B = await device(url);
    await wait(200);
    assert.equal(B.store.teams()[0]?.name, 'ラズパイ構築', '2台目は全件を受け取る');
    // リアルタイム: A の対戦が B に届く
    const b = newBattle({team: t}); b.memo = 'A で記録';
    await A.store.saveBattle(b);
    await wait(200);
    assert.equal(B.store.battles()[0]?.memo, 'A で記録');
    // 古い更新はサーバーが受け付けない
    const r = await fetch(`${url}/api/records/team/${t.id}`, {method: 'PUT', headers: {Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json'}, body: JSON.stringify({u: 1, d: false, j: '{}'})});
    assert.equal((await r.json()).stored, false);
    // サーバーを再起動しても、データは残り、つなぎ直して続きを受け取る
    srv.kill(); await wait(300);
    srv = await startServer(dir, port);
    await wait(1500);
    const bb = structuredClone(B.store.battles()[0]); bb.memo = 'B で追記';
    await B.store.saveBattle(bb);
    await wait(2500);
    assert.equal(A.store.battles()[0]?.memo, 'B で追記', '再接続後も届く');
    A.sync.stop(); B.sync.stop();
  } finally { srv.kill(); }
});
