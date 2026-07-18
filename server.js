// ============================================================
// 像素小丑牌 · 多人对战中继服务器（零依赖，纯 Node.js）
// 本地运行：node server.js [端口]     默认端口 8080
// 云端运行：自动读取 PORT 环境变量（Render 等平台）
// 需要与 balatro.html 放在同一目录（服务器会直接托管游戏页面）
// ============================================================
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = parseInt(process.argv[2], 10) || parseInt(process.env.PORT, 10) || 8080;
const HTML = path.join(__dirname, 'balatro.html');

// 房间表：code -> { members: Map(pid -> {name, res}), paired, ts }
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 去掉易混淆的 I/O/0/1
function genCode() {
  let c = '';
  for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return rooms.has(c) ? genCode() : c;
}
const genPid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function json(res, code, obj) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function sse(res, obj) {
  try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch (e) {}
}
function toOther(room, pid, obj) {
  for (const [id, m] of room.members) if (id !== pid && m.res) sse(m.res, obj);
}
function readBody(req) {
  return new Promise((ok, no) => {
    let b = '';
    req.on('data', d => { b += d; if (b.length > 16384) { no(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { no(e); } });
    req.on('error', no);
  });
}
// 双方都建立了推送连接后，宣布配对成功
function tryPair(room) {
  if (room.paired || room.members.size !== 2) return;
  if (![...room.members.values()].every(m => m.res)) return;
  room.paired = true;
  const names = {};
  for (const [id, m] of room.members) names[id] = m.name;
  for (const [id, m] of room.members) sse(m.res, { ev: 'paired', names, you: id });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }

  // —— 托管游戏页面 ——
  if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/balatro.html')) {
    return fs.readFile(HTML, (e, d) => {
      if (e) { res.writeHead(404); return res.end('balatro.html not found - 请把本服务器和 balatro.html 放在同一目录'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(d);
    });
  }

  // —— 创建房间 ——
  if (req.method === 'POST' && u.pathname === '/api/create') {
    const b = await readBody(req).catch(() => null);
    if (!b) return json(res, 400, { err: '请求格式错误' });
    if (rooms.size > 500) return json(res, 503, { err: '房间数已达上限' });
    const code = genCode(), pid = genPid();
    rooms.set(code, {
      members: new Map([[pid, { name: String(b.name || '玩家').slice(0, 12), res: null }]]),
      paired: false, ts: Date.now(),
    });
    return json(res, 200, { room: code, pid });
  }

  // —— 加入房间 ——
  if (req.method === 'POST' && u.pathname === '/api/join') {
    const b = await readBody(req).catch(() => null);
    if (!b) return json(res, 400, { err: '请求格式错误' });
    const room = rooms.get(String(b.room || '').toUpperCase());
    if (!room) return json(res, 404, { err: '房间不存在' });
    if (room.members.size >= 2) return json(res, 409, { err: '房间已满' });
    const pid = genPid();
    room.members.set(pid, { name: String(b.name || '玩家').slice(0, 12), res: null });
    room.ts = Date.now();
    return json(res, 200, { pid });
  }

  // —— SSE 事件推送流 ——
  if (req.method === 'GET' && u.pathname === '/api/events') {
    const room = rooms.get(u.searchParams.get('room'));
    const pid = u.searchParams.get('pid');
    if (!room || !room.members.has(pid)) { cors(res); res.writeHead(404); return res.end(); }
    cors(res);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write(': hi\n\n');
    const m = room.members.get(pid);
    m.res = res;
    room.ts = Date.now();
    tryPair(room);
    req.on('close', () => {
      if (m.res === res) m.res = null;
      toOther(room, pid, { ev: 'peer-left' });
      room.ts = Date.now();
    });
    return;
  }

  // —— 消息中继：转发给房间里的另一人 ——
  if (req.method === 'POST' && u.pathname === '/api/send') {
    const b = await readBody(req).catch(() => null);
    if (!b) return json(res, 400, { err: '请求格式错误' });
    const room = rooms.get(b.room);
    if (!room || !room.members.has(b.pid)) return json(res, 404, { err: '房间不存在' });
    toOther(room, b.pid, { ev: 'msg', type: b.type, data: b.data });
    room.ts = Date.now();
    return json(res, 200, { ok: 1 });
  }

  res.writeHead(404); res.end('not found');
});

// 心跳保活 + 清理过期房间（无人连接 5 分钟 / 总时长 2 小时）
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    let anyLive = false;
    for (const m of room.members.values())
      if (m.res) { anyLive = true; try { m.res.write(': ping\n\n'); } catch (e) {} }
    if (now - room.ts > (anyLive ? 2 * 3600e3 : 5 * 60e3)) {
      for (const m of room.members.values()) if (m.res) { try { m.res.end(); } catch (e) {} }
      rooms.delete(code);
    }
  }
}, 20000);

server.listen(PORT, () => {
  console.log('====================================');
  console.log('  像素小丑牌 · 对战服务器已启动');
  console.log('====================================');
  console.log('本机游玩:  http://localhost:' + PORT);
  const ifs = os.networkInterfaces();
  for (const k in ifs) for (const i of ifs[k] || [])
    if (i.family === 'IPv4' && !i.internal)
      console.log('局域网:    http://' + i.address + ':' + PORT + '   <- 发给同 WiFi 的朋友');
})
