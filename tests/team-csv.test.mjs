import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTeamCSV,readTable,TEAM_CSV_TEMPLATE} from '../src/engine/team-csv.js';
test('日本語テンプレートは能力Pt・性格・特性・技を取り込める',()=>{
 const {teams,errors}=parseTeamCSV('\uFEFF'+TEAM_CSV_TEMPLATE);assert.deepEqual(errors,[]);assert.equal(teams.length,1);assert.equal(teams[0].mons.length,2);const b=teams[0].mons[0];assert.equal(b.species,'garchomp');assert.equal(b.nature,'Jolly');assert.equal(b.ability,'roughskin');assert.equal(b.item,'focussash');assert.deepEqual(b.sp,[2,32,0,0,0,32]);assert.deepEqual(b.moves,['earthquake','dragonclaw','swordsdance','rocktomb']);
});
test('英語ID・タブ区切り・複数構築・空欄の構築名引き継ぎ',()=>{
 const r=parseTeamCSV('team\tpokemon\titem\tmove1\nAlpha\tgarchomp\t\tearthquake\n\tdragonite\tleftovers\textremespeed\nBeta\tsnorlax\t\t');assert.deepEqual(r.errors,[]);assert.equal(r.teams.length,2);assert.deepEqual(r.teams.map(t=>t.mons.length),[2,1]);assert.notEqual(r.teams[0].id,r.teams[1].id);assert.equal(r.teams[0].mons[1].item,'leftovers');
});
test('最小限のポケモン列だけでも1パーティになる',()=>{const r=parseTeamCSV('ポケモン\nガブリアス\nカイリュー');assert.deepEqual(r.errors,[]);assert.equal(r.teams[0].mons.length,2);assert.equal(r.teams[0].mons[0].nature,'Serious');});
test('カンマ・引用符・改行を含むメモを保持し、行番号も正しい',()=>{
 const r=parseTeamCSV('構築名,ポケモン,メモ\r\n"雨,構築",ガブリアス,"1行目\r\n""2行目"""\r\n"雨,構築",不明,');assert.equal(r.teams[0].name,'雨,構築');assert.equal(r.teams[0].mons[0].note,'1行目\n"2行目"');assert.match(r.errors[0],/^4行目/);
});
for(const [text,message] of [
 ['species\ngarbage','見つかりません'],['ポケモン,技1\nガブリアス,存在しない技','技'],['ポケモン,持ち物\nガブリアス,存在しない持ち物','持ち物'],['ポケモン,特性\nガブリアス,マルチスケイル','持てません'],['ポケモン,性格\nガブリアス,なんとなく','性格'],['ポケモン,H\nガブリアス,252','0〜32'],['ポケモン,H,A,B\nガブリアス,32,32,32','合計'],['ポケモン,H\nガブリアス,-1','整数'],['ポケモン,H\nガブリアス,1.5','整数'],['ポケモン,技1,技2\nガブリアス,じしん,じしん','重複'],['ポケモン,持ち物\nガブリアス','列数'],['ポケモン,努力値\nガブリアス,252','見出し'],['構築名\nA','ポケモン'],['ポケモン,species\nガブリアス,garchomp','重複'],['ポケモン\n"ガブリアス','引用符'],['ポケモン\n"ガブリアス"x','引用符'],['ポケモン','1体以上'],
])test(`入力ミスを取り込み前に検出: ${message} / ${text}`,()=>{assert.ok(parseTeamCSV(text).errors.some(s=>s.includes(message)));});
test('7体の構築は拒否し、名前を分ければ別パーティになる',()=>{
 assert.ok(parseTeamCSV('ポケモン\n'+Array(7).fill('ガブリアス').join('\n')).errors.some(s=>s.includes('6体')));
});
test('全角数字やひらがな名を扱い、空行を無視する',()=>{const r=parseTeamCSV('ポケモン,H\nがぶりあす,３２\n\n');assert.deepEqual(r.errors,[]);assert.equal(r.teams[0].mons[0].sp[0],32);});
