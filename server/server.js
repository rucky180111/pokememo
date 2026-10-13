// pokememo 同期サーバー (自宅のラズパイなどで動かす)。依存パッケージなし (Node 22.13+ / 24 の node:sqlite を使用)
// 環境変数:
//   SYNC_KEY      … 必須。アプリに入れる合言葉 (32文字以上のランダムな文字列)
//   PORT          … 待ち受けポート (既定 8787)
//   DATA_DIR      … データの保存先 (既定 /data)
//   ALLOW_ORIGIN  … アプリの配信元 (既定 https://rucky180111.github.io)
// API (すべて Authorization: Bearer <SYNC_KEY> が必要。/api/health を除く):
//   GET  /api/health                          → {ok: true}
//   GET  /api/records?since=<seq>             → {seq, records: [{kind, id, u, d, j, seq}]}
//   PUT  /api/records/<team|battle>/<id>      body {u, d, j} → {ok, stored, seq}  (u が新しいときだけ保存)
//   GET  /api/stream?since=<seq>              → Server-Sent Events。変更があるたびに {seq, records} を送る
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

const KEY = process.env.SYNC_KEY || '';
const PORT = Number(process.env.PORT || 8787);
const DATA_DIR = process.env.DATA_DIR || '/data';
const ORIGINS = (process.env.ALLOW_ORIGIN || 'https://rucky180111.github.io').split(',').map(s => s.trim()).filter(Boolean);
const MAX_BODY = 8 * 1024 * 1024;
if (KEY.length < 24) { console.error('SYNC_KEY を24文字以上で設定してください'); process.exit(1); }

fs.mkdirSync(DATA_DIR, {recursive: true});
const db = new DatabaseSync(path.join(DATA_DIR, 'pokememo.sqlite'));
db.exec(`PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, u INTEGER NOT NULL, d INTEGER NOT NULL, j TEXT NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY (kind, id));
CREATE INDEX IF NOT EXISTS records_seq ON records (seq);`);
const qGet = db.prepare('SELECT u FROM records WHERE kind = ? AND id = ?');
const qPut = db.prepare('INSERT INTO records (kind, id, u, d, j, seq) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET u = excluded.u, d = excluded.d, j = excluded.j, seq = excluded.seq');
const qSince = db.prepare('SELECT kind, id, u, d, j, seq FROM records WHERE seq > ? ORDER BY seq');
let seq = db.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM records').get().s;

const keyBuf = Buffer.from(KEY);
const authed = req => {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) return false;
  const b = Buffer.from(m[1]);
  return b.length === keyBuf.length && crypto.timingSafeEqual(b, keyBuf);
};
const cors = (req, res) => {
  const o = req.headers.origin;
  if (o && (ORIGINS.includes(o) || ORIGINS.includes('*'))) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
  }
};
const send = (res, code, obj) => { res.writeHead(code, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}); res.end(JSON.stringify(obj)); };
const rows = since => qSince.all(Number(since) || 0).map(r => ({...r, d: !!r.d}));

const streams = new Set();
function broadcast(rec) {
  const msg = `data: ${JSON.stringify({seq, records: [rec]})}\n\n`;
  for (const s of streams) s.write(msg);
}
setInterval(() => { for (const s of streams) s.write(': ping\n\n'); }, 25000).unref();

const server = http.createServer((req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/health') return send(res, 200, {ok: true});
  if (!url.pathname.startsWith('/api/')) return send(res, 404, {error: 'not found'});
  if (!authed(req)) return send(res, 401, {error: '同期キーが違います'});

  if (req.method === 'GET' && url.pathname === '/api/records') return send(res, 200, {seq, records: rows(url.searchParams.get('since'))});

  if (req.method === 'GET' && url.pathname === '/api/stream') {
    res.writeHead(200, {'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive'});
    res.write(`retry: 3000\n\n`);
    const missed = rows(url.searchParams.get('since'));
    res.write(`data: ${JSON.stringify({seq, records: missed})}\n\n`);
    streams.add(res);
    req.on('close', () => streams.delete(res));
    return;
  }

  const m = /^\/api\/records\/(team|battle)\/([\w-]{1,80})$/.exec(url.pathname);
  if (req.method === 'PUT' && m) {
    let size = 0;
    const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { send(res, 413, {error: '大きすぎます'}); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (res.writableEnded) return;
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(res, 400, {error: 'JSON ではありません'}); }
      const u = Number(body?.u), j = body?.j;
      if (!Number.isFinite(u) || typeof j !== 'string') return send(res, 400, {error: 'u と j が必要です'});
      const cur = qGet.get(m[1], m[2]);
      if (cur && cur.u >= u) return send(res, 200, {ok: true, stored: false, seq});
      seq++;
      qPut.run(m[1], m[2], u, body.d ? 1 : 0, j, seq);
      broadcast({kind: m[1], id: m[2], u, d: !!body.d, j, seq});
      send(res, 200, {ok: true, stored: true, seq});
    });
    return;
  }
  send(res, 404, {error: 'not found'});
});
server.listen(PORT, () => console.log(`pokememo sync server: port ${PORT}, data ${DATA_DIR}, origin ${ORIGINS.join(' ')}`));
const stop = () => { for (const s of streams) s.end(); server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 3000).unref(); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
