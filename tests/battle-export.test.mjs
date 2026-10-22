import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore,memoryBackend} from '../src/store.js';
import {newTeam,newBuild,newBattle} from '../src/engine/battle.js';
test('対戦1件のみ書き出し、別端末にパーティとログを復元できる',async()=>{
 const store=createStore(memoryBackend()), team=newTeam();team.mons=[newBuild('garchomp')];await store.saveTeam(team);
 const b=newBattle({team});b.memo='対戦メモ';b.turns=[{n:1,acts:[],note:'技を確認'}];await store.saveBattle(b);await store.saveBattle(newBattle({team}));await store.saveSettings({sync:{token:'secret'}});
 const data=store.exportBattle(b.id);assert.equal(data.battles.length,1);assert.deepEqual(data.teams,[]);assert.ok(!JSON.stringify(data).includes('secret'));assert.equal(data.battles[0].id,b.id);
 data.battles[0].memo='編集';assert.equal(store.battle(b.id).memo,'対戦メモ');
 const restored=createStore(memoryBackend());assert.equal(await restored.importAll(store.exportBattle(b.id)),1);assert.deepEqual(restored.battle(b.id),b);assert.equal(restored.teams().length,0);
 await store.deleteBattle(b.id);assert.throws(()=>store.exportBattle(b.id),/見つかりません/);assert.throws(()=>store.exportBattle('missing'),/見つかりません/);
});
