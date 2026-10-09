// 使用率データの読み込みと更新
import {dex} from './engine/dex.js';
import {slimUsage} from './engine/usage-slim.js';

export const USAGE_BASE = 'https://raw.githubusercontent.com/pkmn/smogon/main/data/stats/';
export const DEFAULT_SOURCES = {single: 'gen9championsbattlestadiumsingles', double: 'gen9championsvgc2026'};

// 同梱のスナップショットを読む (端末に更新済みのデータがあればそちらを使う)
export async function loadBundledUsage(store, fetchFn = fetch) {
  for (const key of ['single', 'double']) {
    if (store.state.usage[key]) continue;
    try {
      const res = await fetchFn(`./usage-${key}.json`);
      if (res.ok) store.setUsage(key, await res.json());
    } catch { /* オフラインでキャッシュも無い場合は使用率なしで動く */ }
  }
}

// 公開されている最新の集計を取得して端末に保存する
export async function refreshUsage(store, sources = DEFAULT_SOURCES, fetchFn = fetch) {
  let month = '';
  try {
    const st = await fetchFn(USAGE_BASE + 'state.json');
    if (st.ok) month = (await st.json()).last || '';
  } catch { /* 月が取れなくても続行 */ }
  const done = [];
  for (const key of ['single', 'double']) {
    const name = sources[key] || DEFAULT_SOURCES[key];
    const res = await fetchFn(`${USAGE_BASE}${name}.json`);
    if (!res.ok) throw new Error(`${name} を取得できませんでした (${res.status})。集計名が変わった可能性があります。`);
    const slim = slimUsage(await res.json(), dex);
    if (Object.keys(slim.pokemon).length < 20) throw new Error(`${name} の内容が想定と違います`);
    slim.month = month;
    slim.source = name;
    slim.fetchedAt = Date.now();
    await store.saveUsage(key, slim);
    done.push(`${key === 'single' ? 'シングル' : 'ダブル'} ${Object.keys(slim.pokemon).length}体`);
  }
  return {month, done};
}
