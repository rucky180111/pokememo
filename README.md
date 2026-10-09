# 対戦メモ (pokememo)

ポケモンチャンピオンズ向けの、対戦メモ + ダメージ計算ツールです (非公式のファンメイド)。
ブラウザだけで動き、GitHub Pages に置けばスマホ・iPad・PC から同じ URL で使えます。

## できること

- **構築**: 6体の持ち物・特性・性格・能力ポイント・技を登録 (シングル / ダブル)
- **見せ合い**: 相手6体を入力すると、使用率からの推定型、過去の似た並びの選出傾向、6×6 の相性表が出る
- **盤面**: 場のポケモン・HP・状態異常・ランク・メガシンカ・天候・フィールド・壁・設置技を入力して、いまの状況を再現
- **ターン記録**: 技・交代・メガシンカ・急所/外れなどを記録。ランク変化や天候、いかく等は自動で盤面に反映 (取り消し可)
- **ダメージ**: 自分の全技 × 相手6体 (場 + 控え)、相手の候補技 × 自分6体。控えは設置技・いかく・天候変化込み
- **素早さ**: スカーフ・おいかぜ・まひ・天候特性込みの比較、使用率から見た先手確率、行動順からの絞り込み
- **予測**: 自分の対戦記録 (対面ごとの行動・初手・選出) と、使用率データ (技・持ち物・配分)
- **同期**: GitHub の非公開 Gist に保存して端末間で共有

## 使用環境

- 利用: iOS / iPadOS Safari 15 以降、Chrome、Edge、Firefox の現行版
- 開発: Node.js 22 以降

## GitHub Pages で公開する

前提条件: GitHub アカウント。

1. GitHub で新しいリポジトリを作る (公開リポジトリ。名前は自由、例: `pokememo`)
2. このフォルダの中身をそのままリポジトリに入れる (ブラウザの「Add file → Upload files」でも可)
3. リポジトリの Settings → Pages → Build and deployment で、Source を **Deploy from a branch**、Branch を **main** / **/docs** にして Save
4. 数分後に `https://<ユーザー名>.github.io/<リポジトリ名>/` で開ける
5. スマホ・iPad では、共有メニューの「ホーム画面に追加」でアプリのように起動できる

git を使う場合:

```sh
git init
git add .
git commit -m "対戦メモ"
git branch -M main
git remote add origin https://github.com/<ユーザー名>/<リポジトリ名>.git
git push -u origin main
```

## 端末間の同期

アプリの「設定 → 端末間の同期」に、scope を **gist** だけにした GitHub トークン (classic) を入れます。
各端末で同じトークンを入れると、同じデータになります。トークンはその端末のブラウザにだけ保存されます。

注意点:

- リポジトリを公開にしても、対戦データはリポジトリには入りません (自分の非公開 Gist に入ります)
- 非公開 Gist は「URL を知っている人は見られる」仕組みです。メモに個人情報は書かないでください
- 同じ記録を2台で同時に編集すると、あとから保存したほうが残ります

## 開発

必要ライブラリ: `@smogon/calc` (ダメージ計算)、`preact` (画面)、`esbuild` (ビルド)、`playwright` (動作確認)。

```sh
npm install
npm test
npm run build
node tests/serve.mjs 4173
node tests/e2e.mjs
```

- `npm test`: 計算・対戦ロジック・同期のテスト
- `npm run build`: `src/` から `docs/` を生成
- `node tests/serve.mjs 4173`: `http://127.0.0.1:4173/` で確認
- `node tests/e2e.mjs`: 実ブラウザでの通し確認 (Chromium が必要)

図鑑や使用率スナップショットを作り直すとき:

```sh
sh scripts/fetch-raw.sh
npm run data
npm run build
```

## データの出どころと限界

- ダメージ計算式・ポケモン/技/持ち物/特性のデータ: [@smogon/calc](https://github.com/smogon/damage-calc) のチャンピオンズ用実装
- 習得技: [Pokémon Showdown](https://github.com/smogon/pokemon-showdown) のチャンピオンズ用データ
- 日本語名: [PokéAPI](https://github.com/PokeAPI/pokeapi) (一部の新特性・フォルム名は手入力)
- 使用率: Pokémon Showdown の月次集計 ([pkmn/smogon](https://github.com/pkmn/smogon) 経由)。ゲーム内ランクバトルとは母集団が違います
- ゲームのアップデートで仕様やポケモンが増えたときは、`@smogon/calc` を更新してデータを作り直す必要があります
- ターン記録の自動反映は主要な技・特性に限ります。HP の増減は手入力です

ポケモン・Pokémon は任天堂・クリーチャーズ・ゲームフリークの登録商標です。
