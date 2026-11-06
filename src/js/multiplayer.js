async function mpApi(p, body) {
  const r = await fetch(MP.base + p, { method:'POST', headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.err || ('HTTP ' + r.status));
  return j;
}
function relayAddress() {
  const value=$('mpServer').value.trim();
  if (!value) throw new Error('请填写运行对战服务器的 HTTP 或 HTTPS 地址');
  const url=new URL(value);
  if (!['http:','https:'].includes(url.protocol)) throw new Error('服务器地址须以 http:// 或 https:// 开头');
  if (location.protocol==='https:' && url.protocol==='http:') throw new Error('请填写 HTTPS 地址，或直接打开局域网服务器提供的游戏页');
  return url.href.replace(/\/+$/, '');
}
function escapeText(value) { const el=document.createElement('span'); el.textContent=value; return el.innerHTML; }
function mpListen() {
  if (MP.net) MP.net.close();
  MP.net = new EventSource(MP.base + '/api/events?room=' + MP.room + '&pid=' + MP.pid);
  MP.net.onmessage = e => { let d; try { d = JSON.parse(e.data); } catch (_) { return; } mpOnEvent(d); };
}
function mpSend(type, data) {
  if (!MP.room) return;
  fetch(MP.base + '/api/send', { method:'POST', headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({ room: MP.room, pid: MP.pid, type, data: data || {} }) }).catch(() => {});
}
function mpSendState() {
  if (!MP.on || !S) return;
  mpSend('state', { ante: S.ante, blind: S.blindIdx, score: S.score, lives: MP.lives, phase: S.screen });
}

// —— 大厅 ——
function openMpLobby() {
  initAudio();
  $('mpServer').value = $('mpServer').value ||
    (/^https?:$/.test(location.protocol) && !location.hostname.endsWith('.github.io') ? location.origin : '');
  $('mpName').value = $('mpName').value || '玩家' + (100 + Math.floor(Math.random() * 900));
  $('mpStatus').textContent = '';
  hide('ovStart'); show('ovMpLobby');
}
function mpCancel() {
  if (MP.net) { MP.net.close(); MP.net = null; }
  MP.room = ''; MP.pid = '';
  hide('ovMpLobby'); show('ovStart');
}
async function mpCreate() {
  try {
    MP.base = relayAddress();
    MP.name = $('mpName').value.trim() || '玩家';
    $('mpStatus').textContent = '正在创建房间…';
    const r = await mpApi('/api/create', { name: MP.name });
    MP.room = r.room; MP.pid = r.pid; MP.host = true;
    mpListen();
    $('mpStatus').innerHTML = '房间码 <b style="font-size:24px;color:#ffd54a;letter-spacing:5px">' + escapeText(r.room) +
      '</b><br>把房间码发给朋友，等待加入…';
  } catch (e) { $('mpStatus').textContent = '❌ ' + e.message + ''; }
}
async function mpJoin() {
  try {
    MP.base = relayAddress();
    MP.name = $('mpName').value.trim() || '玩家';
    const code = $('mpCode').value.trim().toUpperCase();
    if (code.length !== 4) { $('mpStatus').textContent = '请输入 4 位房间码'; return; }
    $('mpStatus').textContent = '正在加入…';
    const r = await mpApi('/api/join', { room: code, name: MP.name });
    MP.room = code; MP.pid = r.pid; MP.host = false;
    mpListen();
    $('mpStatus').textContent = '已加入房间，正在连接对手…';
  } catch (e) { $('mpStatus').textContent = '❌ ' + e.message; }
}

// —— 事件分发 ——
function mpOnEvent(d) {
  if (d.ev === 'paired') {
    for (const id in d.names) if (id !== MP.pid) MP.oppName = d.names[id];
    if (MP.host) {
      // 房主生成 30 个底注的 Boss 序列，保证双方每轮对决面对同一 Boss
      const seq = [];
      for (let a = 1; a <= 30; a++) {
        const pool = BOSSES.filter(b => a > 1 || !['needle', 'wall', 'water'].includes(b.id));
        seq.push(randOf(pool).id);
      }
      mpSend('start', { bossSeq: seq, lives: 2 });
      mpBegin(seq, 2);
    } else $('mpStatus').textContent = '匹配成功！等待房主开始…';
    return;
  }
  if (d.ev === 'peer-left') {
    if (MP.on && !MP.over) mpMatchEnd(true, escapeText(MP.oppName) + ' 已断线 / 退出');
    else if (!MP.on) $('mpStatus').textContent = '对方已离开房间';
    return;
  }
  if (d.ev !== 'msg') return;
  const m = d.data || {};
  switch (d.type) {
    case 'start': if (!MP.on) mpBegin(m.bossSeq, m.lives || 2); break;
    case 'state': {
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
  sfxBad();
  mpSendState();
  mpShowRes('💨 挑战失败', '未达到目标分数——本关<span class="red">无金钱奖励、不进商店</span><br>（生命只会在 ⚔️ 对决中扣除）',
    '前往下一盲注 ▶', () => { hide('ovMpRes'); S.blindIdx++; showBlindSelect(); });
}

// —— 比赛结束 ——
function mpMatchEnd(won, reason) {
  MP.over = true;
  if (S) S.screen = 'over';
  if (won) sfxWin(); else sfxBad();
  mpShowRes(won ? '🏆 你获胜！' : '💀 败北…',
    reason + '<br><br>本场最高单次得分：<b class="gold">' + fmt(S ? S.bestHand : 0) + '</b>',
    '返回标题', () => location.reload());
  if (MP.net) setTimeout(() => { try { MP.net.close(); } catch (e) {} }, 800);
}
