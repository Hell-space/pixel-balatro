const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createRelayServer}=require('../server.js');

async function run(callback) {
  const server=createRelayServer({disconnectGrace:200});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const streams=[];
  async function post(route,data) {
    const response=await fetch(base+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    return {status:response.status,...await response.json()};
  }
  async function events(room,pid,lastId=0) {
    const control=new AbortController();
    const response=await fetch(base+'/api/events?room='+room+'&pid='+pid,{
      signal:control.signal,headers:{'Last-Event-ID':String(lastId)}});
    assert.equal(response.status,200);
    const queue=[], waiters=[];
    const stream={lastId,close:()=>control.abort(),next(predicate) {
      const i=queue.findIndex(e=>predicate(e.data));
      if(i>=0) return Promise.resolve(queue.splice(i,1)[0]);
      return new Promise((resolve,reject)=>{
        const item={predicate,resolve};
        item.timer=setTimeout(()=>{waiters.splice(waiters.indexOf(item),1);reject(Error('SSE event timeout'));},2000);
        waiters.push(item);
      });
    }};
    streams.push(stream);
    (async()=>{
      const reader=response.body.getReader(), decoder=new TextDecoder();let buffer='';
      try {
        for(;;) {
          const chunk=await reader.read();if(chunk.done) break;
          buffer+=decoder.decode(chunk.value,{stream:true});
          while(buffer.includes('\n\n')) {
            const at=buffer.indexOf('\n\n'), block=buffer.slice(0,at);buffer=buffer.slice(at+2);
            const data=block.split('\n').find(line=>line.startsWith('data: '));
            if(!data) continue;
            const event={id:Number(block.match(/id: (\d+)/)?.[1]),data:JSON.parse(data.slice(6))};
            stream.lastId=event.id;
            const i=waiters.findIndex(w=>w.predicate(event.data));
            if(i>=0) {const w=waiters.splice(i,1)[0];clearTimeout(w.timer);w.resolve(event);}
            else queue.push(event);
          }
        }
      } catch(error) {if(error.name!=='AbortError') throw error;}
    })().catch(()=>{});
    return stream;
  }
  try { await callback({post,events,base}); }
  finally {
    streams.forEach(s=>s.close());
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
  }
}
test('主动离开释放房间，非法请求不让服务器退出',()=>run(async({post,base})=>{
  const host=await post('create',{name:'host'});
  assert.equal(host.status,200);
  assert.equal((await post('leave',{room:host.room,pid:'invalid'})).status,403);
  assert.equal((await post('leave',host)).status,200);
  assert.equal((await post('join',{room:host.room})).status,404);
  const bad=await fetch(base+'/api/create',{method:'POST',body:'{broken'});
  assert.equal(bad.status,400);
  assert.equal((await post('create',[])).status,400);
  assert.equal((await post('create',{name:'next'})).status,200);
}));
test('暂时断线保留房间并按 Last-Event-ID 补发；消息重试不重复应用',()=>run(async({post,events})=>{
  const host=await post('create',{name:'host'}), guest=await post('join',{room:host.room,name:'guest'});
  let h=await events(host.room,host.pid);
  const g=await events(host.room,guest.pid);
  await h.next(d=>d.ev==='paired');await g.next(d=>d.ev==='paired');
  const lastId=h.lastId;h.close();await g.next(d=>d.ev==='peer-away');
  const body={room:host.room,pid:guest.pid,type:'state',messageId:1,
    data:{ante:1,blind:0,score:25,lives:2,phase:'play'}};
  assert.equal((await post('send',body)).status,200);
  assert.equal((await post('send',body)).status,200);
  h=await events(host.room,host.pid,lastId);
  const replay=await h.next(d=>d.ev==='msg');
  assert.equal(replay.id,lastId+1);assert.equal(replay.data.data.score,25);
  await g.next(d=>d.ev==='peer-back');
  assert.equal((await post('send',{...body,messageId:2,data:{...body.data,score:-1}})).status,400);
  assert.equal((await post('send',{...body,messageId:2,data:{...body.data,score:30}})).status,200);
  assert.equal((await h.next(d=>d.ev==='msg')).id,lastId+2);
}));
test('超过断线宽限关闭房间；只允许房主开始对局',()=>run(async({post,events})=>{
  const host=await post('create',{}),guest=await post('join',{room:host.room});
  const h=await events(host.room,host.pid),g=await events(host.room,guest.pid);
  await h.next(d=>d.ev==='paired');await g.next(d=>d.ev==='paired');
  const start={room:host.room,pid:guest.pid,type:'start',data:{bossSeq:['hearts']}};
  assert.equal((await post('send',start)).status,400);
  assert.equal((await post('send',{...start,pid:host.pid})).status,200);
  assert.equal((await g.next(d=>d.ev==='msg')).data.data.lives,2);
  h.close();await g.next(d=>d.ev==='peer-left');
  assert.equal((await post('join',{room:host.room})).status,404);
}));
