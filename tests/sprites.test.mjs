import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import sharp from 'sharp';
import {dex, selectionSpeciesId} from '../src/engine/dex.js';
import {spriteIds,spriteSources} from '../src/engine/sprites.js';
import manifest from '../src/generated/sprites.json' with {type:'json'};
test('全メガを選出時だけメガ前にし、リージョン・別種の姿は維持',()=>{
 for(const [id,s] of Object.entries(dex.species))assert.equal(selectionSpeciesId(id),s.mega||id);
 assert.equal(selectionSpeciesId('raichumegax'),'raichu');assert.equal(selectionSpeciesId('raichumegay'),'raichu');assert.equal(selectionSpeciesId('raichualola'),'raichualola');assert.equal(selectionSpeciesId('taurospaldeaaqua'),'taurospaldeaaqua');
});
test('全359種・フォルムの同梱画像があり、画像として読める',async()=>{
 const ids=Object.keys(dex.species);assert.equal(Object.keys(manifest.files).length,ids.length);
 for(const id of ids){const p=new URL(`../docs/sprites/${id}.webp`,import.meta.url);assert.ok(fs.existsSync(p),id);const m=await sharp(p.pathname).metadata();assert.equal(m.format,'webp');assert.ok(m.width>0&&m.width<=128);assert.ok(m.height>0&&m.height<=128);assert.ok(spriteSources(id)[0].startsWith(`./sprites/${id}.webp`));}
});
test('メガとリージョンの画像が欠けても通常の姿へフォールバックしない',()=>{
 for(const id of ['raichumegax','raichumegay','charizardmegax','charizardmegay','slowbrogalar','raichualola','taurospaldeaaqua','toxtricitylowkey'])assert.equal(spriteIds(id).length,1);
 assert.deepEqual(spriteIds('raichumegax'),['raichu-megax']);assert.deepEqual(spriteIds('taurospaldeaaqua'),['tauros-paldeaaqua']);assert.deepEqual(spriteIds('toxtricitylowkey'),['toxtricity-lowkey']);assert.deepEqual(spriteIds('kommoo'),['kommoo']);
});
test('メガ・リージョンの画像そのものが通常の姿と異なる',()=>{
 for(const [a,b] of [['raichumegax','raichu'],['raichumegay','raichu'],['raichualola','raichu'],['taurospaldeaaqua','taurospaldeablaze'],['mimikyubusted','mimikyu']])assert.ok(!fs.readFileSync(new URL(`../docs/sprites/${a}.webp`,import.meta.url)).equals(fs.readFileSync(new URL(`../docs/sprites/${b}.webp`,import.meta.url))),`${a} ≠ ${b}`);
});
