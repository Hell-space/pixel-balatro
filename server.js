'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {randomBytes,randomInt}=require('node:crypto');
const HTML=path.join(__dirname,'balatro.html');
const PHASES=['select','play','duelwait','cash','shop','over'];
const int=(n,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(n)&&n>=min&&n<=max;

function createRelayServer({disconnectGrace=30000}={}) {
  const rooms=new Map(), alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const member=name=>({name:String(name||'玩家').slice(0,12),res:null,seq:0,events:[],timer:null,lastMessage:0});
  const pid=()=>randomBytes(18).toString('hex');
  function code() {
    let key;
    do { key=Array.from({length:4},()=>alphabet[randomInt(alphabet.length)]).join(''); } while(rooms.has(key));
    return key;
  }
  function cors(res) {
    res.setHeader('Access-Control-Allow-Origin','*');
    res.setHeader('Access-Control-Allow-Headers','Content-Type, Last-Event-ID');
    res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  }
  function json(res,status,value) {
    cors(res); res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
    res.end(JSON.stringify(value));
  }
  function write(m,event) {
    if(!m.res||m.res.destroyed) return;
    m.res.write('id: '+event.id+'\ndata: '+JSON.stringify(event.data)+'\n\n');
  }
  function send(m,data) {
    const event={id:++m.seq,data};
    m.events.push(event);
    if(m.events.length>128) m.events.shift();
    write(m,event);
  }
  function others(room,id,data) { for(const [key,m] of room.members) if(key!==id) send(m,data); }
  function endRoom(key,leaver) {
    const room=rooms.get(key); if(!room) return;
    rooms.delete(key);
    others(room,leaver,{ev:'peer-left'});
    for(const m of room.members.values()) {
      clearTimeout(m.timer); if(m.res) m.res.end(); m.res=null;
    }
  }
  function pair(room) {
    if(room.paired||room.members.size!==2||![...room.members.values()].every(m=>m.res)) return;
    room.paired=true;
    const names=Object.fromEntries([...room.members].map(([id,m])=>[id,m.name]));
    for(const [id,m] of room.members) send(m,{ev:'paired',names,you:id});
  }
  async function body(req) {
    const chunks=[];let size=0;
    for await (const chunk of req) {
      size+=chunk.length;
      if(size>16384) throw Error('请求过大');
      chunks.push(chunk);
    }
    const data=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
    if(!data||typeof data!=='object'||Array.isArray(data)) throw Error('请求格式错误');
    return data;
  }
  function message(room,id,type,data) {
    if(type==='start') {
      if(id!==room.host || room.started || !Array.isArray(data?.bossSeq) || data.bossSeq.length>100 ||
        data.bossSeq.some(b=>typeof b!=='string'||!/^[a-z]+$/.test(b))) return null;
      room.started=true; return {bossSeq:data.bossSeq,lives:2};
    }
    if(type==='state' && int(data?.ante,1) && int(data.blind,0,2) && int(data.score) &&
        int(data.lives,0,2) && PHASES.includes(data.phase))
      return {ante:data.ante,blind:data.blind,score:data.score,lives:data.lives,phase:data.phase};
    if(type==='duel' && int(data?.ante,1) && int(data.score)) return {ante:data.ante,score:data.score};
    if(type==='dead') return {};
    return null;
  }
  const server=http.createServer(async(req,res)=>{
    try {
      const u=new URL(req.url,'http://localhost');
      if(req.method==='OPTIONS') { cors(res);res.writeHead(204);return res.end(); }
      if(['GET','HEAD'].includes(req.method)&&['/','/index.html','/balatro.html'].includes(u.pathname)) {
        return fs.readFile(HTML,(err,bytes)=>{
          if(err) return json(res,500,{err:'游戏文件缺失，请运行 npm run build'});
          res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});
          res.end(req.method==='HEAD'?undefined:bytes);
        });
      }
      if(req.method==='GET'&&u.pathname==='/api/events') {
        const key=u.searchParams.get('room'), id=u.searchParams.get('pid'), room=rooms.get(key), m=room?.members.get(id);
        if(!m) return json(res,404,{err:'房间已关闭，请重新创建'});
        const old=m.res, reconnect=!!m.timer; clearTimeout(m.timer); m.timer=null;
        cors(res); res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','X-Accel-Buffering':'no'});
        res.write('retry: 1000\n: connected\n\n');
        m.res=res;
        if(old) old.end();
        const last=Number(req.headers['last-event-id']||0);
        for(const event of m.events) if(event.id>last) write(m,event);
        pair(room);
        if(reconnect&&room.paired) others(room,id,{ev:'peer-back'});
        room.touched=Date.now();
        res.on('close',()=>{
          if(m.res!==res || !rooms.has(key)) return;
          m.res=null; room.touched=Date.now();
          if(room.paired) others(room,id,{ev:'peer-away',seconds:disconnectGrace/1000});
          m.timer=setTimeout(()=>endRoom(key,id),disconnectGrace);m.timer.unref();
        });
        return;
      }
      if(req.method==='POST'&&u.pathname.startsWith('/api/')) {
        let data;
        try { data=await body(req); } catch { return json(res,400,{err:'请求格式错误或请求过大'}); }
        if(u.pathname==='/api/create') {
          if(rooms.size>=500) return json(res,503,{err:'房间已满，请稍后重试'});
          const key=code(), id=pid();
          rooms.set(key,{host:id,members:new Map([[id,member(data.name)]]),paired:false,started:false,created:Date.now(),touched:Date.now()});
          return json(res,200,{room:key,pid:id});
        }
        const key=String(data.room||'').toUpperCase(), room=rooms.get(key);
        if(!room) return json(res,404,{err:'房间不存在或已关闭'});
        if(u.pathname==='/api/join') {
          if(room.members.size>=2) return json(res,409,{err:'房间已满'});
          const id=pid();room.members.set(id,member(data.name));room.touched=Date.now();
          return json(res,200,{pid:id});
        }
        const m=room.members.get(data.pid);
        if(!m) return json(res,403,{err:'房间凭据无效'});
        if(u.pathname==='/api/leave') { endRoom(key,data.pid);return json(res,200,{ok:1}); }
        if(u.pathname==='/api/send') {
          if(!room.paired) return json(res,409,{err:'正在等待另一位玩家'});
          if(data.messageId!==undefined&&!int(data.messageId,1)) return json(res,400,{err:'消息编号无效'});
          if(data.messageId && data.messageId<=m.lastMessage) return json(res,200,{ok:1});
          const payload=message(room,data.pid,data.type,data.data);
          if(!payload) return json(res,400,{err:'不支持的对战消息'});
          if(data.messageId) m.lastMessage=data.messageId;
          others(room,data.pid,{ev:'msg',type:data.type,data:payload});room.touched=Date.now();
          return json(res,200,{ok:1});
        }
      }
      json(res,404,{err:'不存在的地址'});
    } catch { if(!res.headersSent) json(res,400,{err:'无效请求'}); else res.end(); }
  });
  const sweep=setInterval(()=>{
    const now=Date.now();
    for(const [key,room] of rooms) {
      if(now-room.created>2*3600e3 || (now-room.touched>5*60e3&&![...room.members.values()].some(m=>m.res))) {
        endRoom(key,'');continue;
      }
      for(const m of room.members.values()) if(m.res) m.res.write(': ping\n\n');
    }
  },15000);
  sweep.unref();
  server.on('close',()=>{clearInterval(sweep);for(const key of rooms.keys())endRoom(key,'');});
  return server;
}
module.exports={createRelayServer};
if(require.main===module) {
  const port=Number(process.argv[2]||process.env.PORT||8080);
  if(!int(port,1,65535)) { console.error('端口须为 1–65535 的整数'); process.exitCode=1; }
  else {
    const server=createRelayServer();
    server.on('error',error=>{console.error('启动失败：'+error.message);process.exitCode=1;});
    server.listen(port,()=>{
      console.log('像素小丑牌：http://localhost:'+port);
      for(const list of Object.values(os.networkInterfaces())) for(const item of list||[])
        if(item.family==='IPv4'&&!item.internal) console.log('局域网：http://'+item.address+':'+port);
    });
  }
}
