import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore,memoryBackend} from '../src/store.js';
import {newTeam,newBuild,newBattle,newOpp} from '../src/engine/battle.js';
import {teamRecord} from '../src/engine/predict.js';
test('構築と全対戦・相手選出・過去の型を丸ごと復元し、同名の別構築は混ぜない',async()=>{
 const s=createStore(memoryBackend()),t=newTeam(),other=newTeam();t.name=other.name='同名構築';t.mons=[{...newBuild('garchomp'),moves:['earthquake']}];t.pickRules=[{cond:'*',pick:['garchomp']}];await s.saveTeam(t);await s.saveTeam(other);
 const win=newBattle({team:t});win.result='win';win.opp=[newOpp('snorlax')];win.pick={me:[0],opp:[0]};win.turns=[{n:1,open:true,acts:[],note:'ターンのメモ'}];win.opp[0].statOk={hp:'101'};win.memo='対戦メモ';await s.saveBattle(win);
 t.name='改名後';t.mons[0].moves=['dragonclaw'];await s.saveTeam(t);const unfinished=newBattle({team:t}),sim=newBattle({team:t,kind:'sim'});await s.saveBattle(unfinished);await s.saveBattle(sim);const removed=newBattle({team:t});await s.saveBattle(removed);await s.deleteBattle(removed.id);await s.saveBattle(newBattle({team:other}));await s.saveSettings({sync:{token:'private-secret',gistId:'private-gist'}});
 const data=s.exportTeam(t.id);assert.equal(data.teams.length,1);assert.equal(data.teams[0].name,'改名後');assert.equal(data.battles.length,3);assert.equal(data.battles.find(b=>b.id===win.id).teamName,'同名構築');assert.deepEqual(data.battles.find(b=>b.id===win.id).my[0].moves,['earthquake']);assert.ok(!JSON.stringify(data).includes('private-secret'));assert.ok(!JSON.stringify(data).includes(other.id));
 const restored=createStore(memoryBackend());assert.equal(await restored.importAll(data),4);assert.deepEqual(restored.team(t.id),t);for(const b of [win,unfinished,sim])assert.deepEqual(restored.battle(b.id),b);assert.deepEqual(teamRecord(restored.battles(),t.id),teamRecord(s.battles(),t.id));assert.equal(await restored.importAll(data),0);
 data.teams[0].name='別の名前';data.battles[0].memo='別のメモ';assert.equal(s.team(t.id).name,'改名後');assert.equal(s.battle(win.id).memo,'対戦メモ');
});
test('対戦ゼロでも構築の全項目を保存でき、削除済み構築は書き出さない',async()=>{const s=createStore(memoryBackend()),t=newTeam();await s.saveTeam(t);assert.deepEqual(s.exportTeam(t.id).battles,[]);assert.throws(()=>s.exportTeam('unknown'),/見つかりません/);await s.deleteTeam(t.id);assert.throws(()=>s.exportTeam(t.id),/見つかりません/);});
