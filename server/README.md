# pokememo 同期サーバー (自宅のラズパイ用)

スマホと iPad の「対戦メモ」のデータを、自宅のラズパイに集めて同期するためのサーバーです。
外からは Tailscale Funnel で https 公開し、スマホ・iPad 側には何も入れずに使えます。

- 依存パッケージなし (Node 24 の組み込み SQLite)。Docker で動かします
- データ量は対戦1,000戦でも数十MB程度。メモリは 128MB で制限しています
- 同期キー (合言葉) を知っている端末だけが読み書きできます

## 手順

```sh
git clone https://github.com/rucky180111/pokememo.git
cd pokememo/server
cp .env.example .env
# 同期キーを作って .env に書き込む
sed -i "s/^SYNC_KEY=.*/SYNC_KEY=$(openssl rand -hex 24)/" .env
# (USB メモリに置く場合) DATA_PATH=/mnt/usb/pokememo のように書き換える
docker compose up -d --build
curl -s http://127.0.0.1:8787/api/health   # {"ok":true} なら起動成功
```

### 外から使えるようにする (Tailscale Funnel)

ラズパイにだけ Tailscale を入れます。スマホ・iPad 側には不要です。

```sh
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
sudo tailscale funnel --bg 8787
tailscale funnel status   # https://<名前>.<tailnet>.ts.net が公開アドレス
```

初回は Funnel を有効にするためのリンクが表示されるので、ブラウザで開いて許可します。

## アプリ側

「設定」→「アカウント同期」→「自分のサーバー (ラズパイ)」で、公開アドレスと `.env` の `SYNC_KEY` を入れて「接続を確認して保存」。
スマホと iPad の両方で同じものを入れると、記録が数秒でもう一方に反映されます。

## 更新・バックアップ

```sh
cd pokememo && git pull && cd server && docker compose up -d --build   # 更新
cp ${DATA_PATH:-./data}/pokememo.sqlite ~/pokememo-backup.sqlite        # バックアップ
```
