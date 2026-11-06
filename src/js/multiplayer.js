let mpGeneration=0, mpPending=false, mpMessageId=0, mpQueue=Promise.resolve();
async function mpApi(path,body,base=MP.base) {
  const control=new AbortController(), timer=setTimeout(()=>control.abort(),10000);
  try {
    const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:control.signal});
    const data=await r.json().catch(()=>({}));
    if(!r.ok) throw Error(data.err||'HTTP '+r.status);
    return data;
  } finally { clearTimeout(timer); }
}
function relayAddress() {
  const value=$('mpServer').value.trim();
  if(!value) throw Error('请填写对战服务器地址');
  let url;
  try { url=new URL(value); } catch { throw Error('服务器地址格式不正确'); }
  if(!['http:','https:'].includes(url.protocol)) throw Error('地址须以 http:// 或 https:// 开头');
  if(location.protocol==='https:'&&url.protocol==='http:') throw Error('请填写 HTTPS 地址，或直接打开局域网服务器的游戏页');
  return url.href.replace(/\/+$/, '');
}
function escapeText(value) {const el=document.createElement('span');el.textContent=value;return el.innerHTML;}
function networkStatus(text) {
  $('netStatus').hidden=!text; $('netStatus').textContent=text;
}
function mpListen() {
  if(MP.net) MP.net.close();
  const generation=mpGeneration;
  MP.net=new EventSource(MP.base+'/api/events?room='+MP.room+'&pid='+MP.pid);
  MP.net.onopen=()=>{if(generation===mpGeneration) networkStatus('');};
  MP.net.onerror=()=>{if(generation===mpGeneration&&!MP.over) networkStatus('连接中断，正在重连…');};
  MP.net.onmessage=e=>{
    if(generation!==mpGeneration||MP.over) return;
    let data;try {data=JSON.parse(e.data);}catch{return;}
    mpOnEvent(data);
  };
}
function mpSend(type,data={}) {
  if(!MP.room||MP.over) return Promise.resolve();
  const generation=mpGeneration,base=MP.base;
  const body={room:MP.room,pid:MP.pid,type,data,messageId:++mpMessageId};
  mpQueue=mpQueue.catch(()=>{}).then(async()=>{
    for(let attempt=0;attempt<2;attempt++) {
      if(generation!==mpGeneration) return;
      try {await mpApi('/api/send',body,base);return;}
      catch(error) {
        if(attempt===1&&generation===mpGeneration) {
          networkStatus('消息未送达');
          if(MP.on&&!MP.over) mpMatchEnd(false,'连接失败，本场对战已结束。');
        }
      }
    }
  });
  return mpQueue;
}
function mpSendState() {
  if(!MP.on||!S) return;
  mpSend('state',{ante:S.ante,blind:S.blindIdx,score:S.score,lives:MP.lives,phase:S.screen});
}
function lobbyBusy(busy) {
  mpPending=busy;
  for(const id of ['mpCreateBtn','mpJoinBtn']) $(id).disabled=busy||!!MP.room;
}
function openMpLobby() {
  initAudio();
  $('mpServer').value ||= /^https?:$/.test(location.protocol)&&!location.hostname.endsWith('.github.io')?location.origin:'';
  $('mpName').value ||= '玩家'+(100+Math.floor(Math.random()*900));
  $('mpStatus').textContent=''; lobbyBusy(false);
  hide('ovStart');show('ovMpLobby');
}
function mpLeave() {
  mpGeneration++;
  if(MP.net) MP.net.close();MP.net=null;
  if(MP.room&&MP.pid) fetch(MP.base+'/api/leave',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({room:MP.room,pid:MP.pid}),keepalive:true}).catch(()=>{});
  MP.room='';MP.pid='';mpMessageId=0;mpQueue=Promise.resolve();
  lobbyBusy(false);networkStatus('');
}
function mpCancel() {
  mpLeave();hide('ovMpLobby');refreshTitle();show('ovStart');
}
async function joinLobby(create) {
  if(mpPending||MP.room) return;
  const generation=++mpGeneration;
  let base,room='';
  try {
    base=relayAddress();room=$('mpCode').value.trim().toUpperCase();
    if(!create&&!/^[A-HJ-NP-Z2-9]{4}$/.test(room)) throw Error('请输入有效的 4 位房间码');
    MP.base=base;MP.name=$('mpName').value.trim()||'玩家';
    lobbyBusy(true);$('mpStatus').textContent=create?'正在创建房间…':'正在加入…';
    const r=await mpApi(create?'/api/create':'/api/join',{name:MP.name,...(!create?{room}:{})},base);
    const joinedRoom=create?r.room:room;
    if(generation!==mpGeneration) {
      await mpApi('/api/leave',{room:joinedRoom,pid:r.pid},base).catch(()=>{});
      return;
    }
    if(!r.pid||!joinedRoom) throw Error('该地址不是对战服务器');
    MP.room=joinedRoom;MP.pid=r.pid;MP.host=create;MP.over=false;mpMessageId=0;
    mpListen();
    $('mpStatus').textContent=create?'房间码 '+joinedRoom+'，等待对手加入…':'已加入，正在连接对手…';
  } catch(error) {
    if(generation===mpGeneration) $('mpStatus').textContent=error.name==='AbortError'?'连接超时，请检查服务器地址。':error.message;
  } finally {if(generation===mpGeneration) lobbyBusy(false);}
}
function mpCreate() {return joinLobby(true);}
function mpJoin() {return joinLobby(false);}

// —— 事件分发 ——
function mpOnEvent(d) {
  if(d.ev==='peer-away') { networkStatus('对手暂时断线，等待重连…');return; }
  if(d.ev==='peer-back') { networkStatus('');return; }
  if (d.ev === 'paired') {
    if(MP.on) return;
    for (const id in d.names) if (id !== MP.pid) MP.oppName = d.names[id];
    if (MP.host) {
      // 房主生成 30 个底注的 Boss 序列，保证双方每轮对决面对同一 Boss
      const seq = [];let seen=new Set();
      for (let a = 1; a <= 30; a++) {
        const eligible=availableBosses(a);let pool=eligible.filter(b=>!seen.has(b.id));
        if(!pool.length){seen=new Set();pool=eligible;}
        const id=randOf(pool).id;seq.push(id);seen.add(id);
      }
      mpSend('start', { bossSeq: seq, lives: 2 });
      mpBegin(seq, 2);
    } else $('mpStatus').textContent = '匹配成功！等待房主开始…';
    return;
  }
  if (d.ev === 'peer-left') {
    if (MP.on && !MP.over) mpMatchEnd(true, escapeText(MP.oppName) + ' 已断线 / 退出');
    else if (!MP.on) { mpLeave(); $('mpStatus').textContent='对方已离开，请重新创建房间。'; }
    return;
  }
  if (d.ev !== 'msg') return;
  const m = d.data || {};
  switch (d.type) {
    case 'start': if(!MP.on&&Array.isArray(m.bossSeq)&&m.bossSeq.every(id=>BOSSES.some(b=>b.id===id))) mpBegin(m.bossSeq,2); break;
    case 'state': {
      if(!Number.isSafeInteger(m.score)||!Number.isInteger(m.lives)||m.lives<0||m.lives>2) return;
      Object.assign(MP.opp, m);
      mpRenderOpp();
      // 对决进行中：目标栏实时显示对手分数
      if (MP.on && S && S.blindIdx === 2 && (S.screen === 'play' || S.screen === 'duelwait')) renderStats();
      const dl = document.getElementById('duelOppLive');
      if (dl) dl.textContent = MP.opp.blind === 2 && MP.opp.phase === 'play'
        ? '对手当前：' + fmt(MP.opp.score) + ' 分' : '对手还没打到对决盲注…';
      break;
    }
    case 'duel': MP.oppDuel = m; mpTryResolve(); break;
    case 'dead': if (!MP.over) mpMatchEnd(true, escapeText(MP.oppName) + ' 生命耗尽'); break;
  }
}

// —— 开局 ——
function mpBegin(bossSeq, lives) {
  MP.on = true; MP.over = false;
  MP.lives = lives; MP.bossSeq = bossSeq || [];
  MP.myDuel = null; MP.oppDuel = null;
  MP.opp = { lives: lives, ante: 1, blind: 0, score: 0, phase: 'select' };
  hide('ovMpLobby');
  $('oppBox').style.display = 'block';
  $('livesRow').style.display = 'flex';
  newGame(false);
  mpRenderOpp();
  mpSendState();
}

// —— 对手面板 ——
const MPPHASE = { select:'选盲注', play:'对局中', duelwait:'等待对决结果', cash:'结算', shop:'逛商店', over:'—' };
function mpRenderOpp() {
  if (!MP.on) return;
  $('oppNameV').textContent = MP.oppName;
  $('oppLivesV').textContent = '❤️'.repeat(Math.max(0, MP.opp.lives)) || '💀';
  $('oppPhaseV').textContent = '底注' + MP.opp.ante + ' · ' + (['小盲', '大盲', '⚔️对决'][MP.opp.blind] || '') +
    ' · ' + (MPPHASE[MP.opp.phase] || '');
  $('oppScoreV').textContent = MP.opp.phase === 'play' || MP.opp.phase === 'duelwait'
    ? fmt(MP.opp.score) + ' 分' : '';
}

// —— 通用结果弹窗 ——
function mpShowRes(title, bodyHTML, btnText, onBtn) {
  $('mpResTitle').textContent = title;
  $('mpResBody').innerHTML = '<p>' + bodyHTML + '</p>';
  const b = $('mpResBtn');
  if (btnText) { b.style.display = 'inline-block'; b.textContent = btnText; b.onclick = onBtn; }
  else b.style.display = 'none';
  show('ovMpRes');
}

// —— 对决盲注：出牌次数用完后提交总分，双方到齐后比分 ——
function duelFinish() {
  if (MP.myDuel) return;
  S.screen = 'duelwait';
  MP.myDuel = { ante: S.ante, score: S.score };
  mpSend('duel', MP.myDuel);
  mpSendState();
  mpShowRes('⚔️ 对决出牌完毕', '你的总分：<b class="gold">' + fmt(S.score) + '</b><br>等待对手打完……<br>' +
    '<span id="duelOppLive" class="blue"></span>', null);
  mpTryResolve();
}
function mpTryResolve() {
  if (!MP.myDuel || !MP.oppDuel || MP.oppDuel.ante !== MP.myDuel.ante) return;
  if(MP.over) return;
  const my = MP.myDuel.score, op = MP.oppDuel.score;
  MP.myDuel = null; MP.oppDuel = null;
  const goShop = () => { hide('ovMpRes'); beatBlind(); };
  let h = '你 <b class="gold">' + fmt(my) + '</b>　vs　' + escapeText(MP.oppName) + ' <b class="red">' + fmt(op) + '</b><br><br>';
  if (my === op) {
    mpShowRes('🤝 平局', h + '双方都不扣生命', '前往结算 🛒', goShop);
  } else if (my > op) {
    S.money += 3;
    sfxWin();
    mpShowRes('🏆 对决胜利！', h + '奖励 <span class="green">$3</span>，对手 -1❤️', '前往结算 🛒', goShop);
  } else {
    MP.lives--;
    mpSendState();
    renderStats();
    if (MP.lives <= 0) { mpSend('dead'); return mpMatchEnd(false, '对决落败，生命耗尽'); }
    sfxBad();
    mpShowRes('😖 对决失利', h + '-1❤️（剩余 ' + '❤️'.repeat(MP.lives) + '）', '前往结算 🛒', goShop);
  }
}

// —— 小盲/大盲 PvE 失败：不扣命，只是无金钱奖励、不进商店，直接下一盲注 ——
function mpPveFail() {
  S.screen='duelwait';
  sfxBad();
  mpSendState();
  mpShowRes('💨 挑战失败', '未达到目标分数——本关<span class="red">无金钱奖励、不进商店</span><br>（生命只会在 ⚔️ 对决中扣除）',
    '前往下一盲注 ▶', () => { hide('ovMpRes'); S.blindIdx++; showBlindSelect(); });
}

// —— 比赛结束 ——
function mpMatchEnd(won, reason) {
  if(MP.over) return;
  MP.over = true;
  if (S) S.screen = 'over';
  if (won) sfxWin(); else sfxBad();
  mpShowRes(won ? '🏆 你获胜！' : '💀 败北…',
    reason + '<br><br>本场最高单次得分：<b class="gold">' + fmt(S ? S.bestHand : 0) + '</b>',
    '返回标题',exitToTitle);
  networkStatus('');
  mpQueue.finally(()=>{if(MP.net) MP.net.close();});
}
