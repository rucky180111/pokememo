# ビルドはリポジトリの一番上から (docker-compose.yml の context: ..)。アプリの図鑑データと変換処理を使うため
FROM node:24-alpine
WORKDIR /app
COPY src/engine ./src/engine
COPY src/generated/dex.json ./src/generated/dex.json
COPY docs/usage-single.json ./docs/usage-single.json
# usage-scrape.mjs (サイトから取る部分) はラズパイ側で用意する。無くても同期は動く
COPY server/server.js server/usage-convert.mjs server/usage-update.mjs server/usage-scrape.mj[s] ./server/
WORKDIR /app/server
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
EXPOSE 8787
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
