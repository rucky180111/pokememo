// 固定したShowdownの画像を同梱する。更新時は sprites.json の対応・revisionを確認して実行。
// プロキシ環境: NODE_USE_ENV_PROXY=1 node scripts/build-sprites.mjs
import fs from 'node:fs/promises';
import sharp from 'sharp';
import {fileURLToPath} from 'node:url';
import manifest from '../src/generated/sprites.json' with {type:'json'};
const dir = new URL('../docs/sprites/',import.meta.url);
await fs.mkdir(dir,{recursive:true});
const pending = Object.entries(manifest.files); let count = 0;
await Promise.all(Array.from({length:10},async()=>{
  while(pending.length){
    const [id,path] = pending.pop();
    const url = `https://raw.githubusercontent.com/smogon/sprites/${manifest.revision}/${path}`;
    let bytes;
    for(let n=0;n<3;n++){
      try {const response=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error(`${response.status}: ${path}`);bytes=Buffer.from(await response.arrayBuffer());break;}
      catch(e){if(n===2)throw e;}
    }
    await sharp(bytes,{animated:false}).resize(128,128,{fit:'inside',withoutEnlargement:true}).webp({lossless:true}).toFile(fileURLToPath(new URL(`${id}.webp`,dir)));
    count++;
  }
}));
console.log(`built ${count} species/form sprites`);
