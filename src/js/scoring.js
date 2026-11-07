function popAt(wrap, txt, col) {
  scoreFeedback(wrap, txt);
  const s = document.createElement('span');
  s.className = 'scorepop';
  s.style.color = col || '#57e6ff';
  s.textContent = txt;
  wrap.appendChild(s);
  setTimeout(() => s.remove(), 800);
}
function jokerPop(j, txt) {
  const el = $('jk' + j.uid);
  if (!el) return;
  el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
  jokerFx(el, txt);
  const s = document.createElement('span');
  s.className = 'jpop'; s.textContent = txt;
  el.appendChild(s);
  setTimeout(() => s.remove(), 900);
  sfxJok();
}
function fmtM(m) { return m % 1 ? (Math.round(m * 100) / 100) : m; }
function setCalc(c, m, strong=false) {
  const changedC=$('prevChips').textContent!==fmt(c),changedM=$('prevMult').textContent!==String(fmtM(m));
  $('prevChips').textContent = fmt(c);
  $('prevMult').textContent = fmtM(m);
  if(changedC) calcPunch($('prevChips'),false);
  if(changedM) calcPunch($('prevMult'),strong);
}
async function doPlay() {
  if (!S || S.screen !== 'play' || S.busy || S.handsLeft <= 0 || MP.over) return;
  const sel = S.hand.filter(c => c.sel);
  if (!sel.length) { msg('请先选择 1~5 张牌', 1); return; }
  if (S.boss && S.boss.id === 'psychic' && sel.length !== 5) { msg('🧿 通灵者：必须打出恰好 5 张牌！', 1); return; }
  if(S.boss?.id==='eye'&&S.blindPlayed.includes(evalHand(sel).key))return msg('👁️ 独眼：本盲注不能重复打出同一种牌型。',1);
  persistRun();
  const activeRun=S;
  const origins=handPositions();
  const result=scoreHand({...S,handsLeft:S.handsLeft-1},sel);
  S.busy = true; S.sellId = null;
  S.handsLeft--; S.totHands++;
  S.hand = S.hand.filter(c => !c.sel);
  renderStats(); renderJokers();

  const ev = result.hand;
  S.playCounts[ev.key]++;
  S.blindPlayed ||= []; S.blindPlayed.push(ev.key);
  const base = result.base;
  let chips = base.chips, mult = base.mult;
  $('prevName').textContent = HANDS[ev.key].name;
  $('prevLvl').textContent = '等级 ' + base.lv;
  setCalc(chips, mult);

  // 摆出打出的牌
  const prow = $('playedRow');
  prow.innerHTML = '';
  const wraps = new Map();
  sel.forEach(c => {
    const w = document.createElement('div');
    w.className = 'pwrap';
    const el = cardEl(c);
    el.style.cursor = 'default';
    if (!ev.scoring.includes(c)) el.style.opacity = 0.45;
    w.appendChild(el);
    prow.appendChild(w);
    wraps.set(c.id, w);
  });
  renderHand();
  animatePlayed(origins);
  await sleep(300);

  for (const event of result.events) {
    if (S!==activeRun || MP.over) return;
    setCalc(event.chips,event.mult,event.text.includes('×'));
    if (event.kind==='card') popAt(wraps.get(event.id),event.text);
    else if (event.kind==='joker') {
      const j=S.jokers.find(x=>x.uid===event.id);
      if (j) jokerPop(j,event.text);
    } else { msg(event.text); scoreEventFx(event); }
    sfxTick(event.chips);
    await sleep(event.kind==='card'?180:event.kind==='weak'?420:220);
  }
  if (S!==activeRun || MP.over) return;
  chips=result.chips; mult=result.mult;
  S.money+=result.money;
  S.lastResult={name:HANDS[ev.key].name,total:result.total,chips,mult,money:result.money,
    events:result.events.map(e=>({text:e.text,chips:e.chips,mult:e.mult}))};
  S.rhythm=result.rhythm;

  // —— 总分 ——
  const total = Math.floor(chips * mult);
  S.bestHand = Math.max(S.bestHand, total);
  const tp = $('totalPop');
  tp.textContent = (total >= 3000 ? '🔥 ' : '⭐ ') + fmt(total) + ' 分！';
  tp.classList.toggle('big', total >= 3000);
  tp.style.display = 'block';
  sfxUp();
  const scoreBefore=S.score;
  S.score += total;
  renderStats(); totalFeedback();
  totalFx(total, scoreBefore, S.target);
  await sleep(650);
  if (S!==activeRun || MP.over) return;
  tp.style.display = 'none';
  $('previewBox').classList.remove('onFire');
  prow.innerHTML = '';

  // —— 后处理 ——
  sel.forEach(c => {
    if (c.glass && ev.scoring.includes(c) && !isDebuffed(c) && Math.random() < 0.25) {
      S.deckAll = S.deckAll.filter(x => x.id !== c.id);
      msg('🏺 一张玻璃牌碎裂了！', 1);
    }
  });
  S.jokers = S.jokers.filter(j => {
    if (j.id === 'ice') { j.state -= 5; if (j.state <= 0) { msg('🍦 冰淇淋融化消失了…', 1); return false; } }
    return true;
  });
  S.jokers.forEach(j => {
    if (['green','runner','bus'].includes(j.id)) j.state=jokerStateForHand(j,ev,sel);
  });

  renderStats();
  if (MP.on && S.blindIdx === 2) {
    // 对决盲注：不因达标提前结束，出牌次数用完后提交总分
    mpSendState();
    if (S.handsLeft <= 0) { S.busy = false; return duelFinish(); }
  } else {
    if (S.score >= S.target) { S.busy = false; return beatBlind(); }
    if (S.handsLeft <= 0) { S.busy = false; return gameLost(); }
  }
  if (S.boss && S.boss.id === 'hook' && S.hand.length) {
    for (let i = 0; i < 2 && S.hand.length; i++)
      S.hand.splice(Math.floor(Math.random() * S.hand.length), 1);
    msg('⚓ 钩爪抓走了你 2 张手牌！', 1);
  }
  drawTo(effHandSize());
  S.busy = false;
  renderAll();
  checkStuck();
  persistRun();
  mpSendState();
}
function doDiscard() {
  if (!S || S.screen !== 'play' || S.busy || S.discLeft <= 0 || MP.over) return;
  const sel = S.hand.filter(c => c.sel);
  if (!sel.length) { msg('请先选择要弃掉的牌', 1); return; }
  animateDiscard(sel);
  S.discLeft--;
  if(S.contract)S.contract.discards++;
  S.hand = S.hand.filter(c => !c.sel);
  S.jokers.forEach(j => { if (j.id === 'green' && j.state) { j.state = 0; jokerPop(j, '清零!'); } });
  sfxBad();
  drawTo(effHandSize());
  renderAll();
  msg('弃掉了 ' + sel.length + ' 张牌');
  checkStuck();
  persistRun();
}

// ================= 胜负 =================
function beatBlind() {
  if (S.screen!=='play' && S.screen!=='duelwait') return;
  sfxWin();
  const m = blindMeta();
  const bounty = S.jokers.filter(j => j.id === 'bounty').length * Math.min(6,S.discLeft*2);
  const goldenN = S.jokers.filter(j => j.id === 'golden').length * 4;
  const green=S.deckId==='green';
  const interest = green?0:Math.min(S.interestCap, Math.floor(S.money / 5));
  const handBonus = S.handsLeft*(green?2:1),discardBonus=green?S.discLeft:0;
  let invest = 0;
  if (S.boss && S.investN) { invest = S.investN * 15; S.investN = 0; }
  let total = m.reward + bounty + goldenN + interest + handBonus + invest + discardBonus;
  S.payout = [['盲注奖励',m.reward], ['剩余出牌 '+S.handsLeft+' × $'+(green?2:1),handBonus], ['利息',interest]];
  if(green)S.payout.push(['剩余弃牌',discardBonus]);
  for (const [name,value] of [['赏金猎人',bounty],['黄金小丑',goldenN],['投资标签',invest]]) {
    if (value) S.payout.push([name,value]);
  }
  const overkill=overkillBonus(S);
  if(overkill.money){S.payout.push(['碾压 '+(Math.floor(overkill.ratio*10)/10)+'× 目标',overkill.money]);total+=overkill.money;}
  total+=settleContract();
  S.payout.push(['合计',total]);
  renderPayout();
  S.money += total;
  // 盲注结束时的小丑变化
  S.jokers.forEach(j => { if (j.id === 'egg') j.sell = sellPrice(j) + 3; });
  S.jokers = S.jokers.filter(j => {
    if (j.id === 'gros' && Math.random() < 1 / 6) { msg('🍌 大香蕉烂掉了…', 1); return false; }
    return true;
  });
  S.boss = null;   // 清除 Boss 效果，避免商店里的卡牌仍显示"被禁用"
  S.screen = 'cash';
  prepareBossReward();
  const wasWin = !MP.on && S.ante === 8 && S.blindIdx === 2;
  S.winPending=wasWin;
  if (wasWin) {
    if(typeof recordVictory==='function')recordVictory();
    $('winStats').innerHTML = '最高单次得分：<span class="gold">' + fmt(S.bestHand) + '</span>　总出牌数：<span class="blue">' + S.totHands + '</span>';
    show('ovWin');
  } else show('ovCash');
  celebrateBlind(overkill);
  persistRun();
  renderStats();
  mpSendState();
}
function renderPayout() {
  const ledger = $('cashRows'); ledger.replaceChildren();
  for (const [i,[label,value]] of S.payout.entries()) {
    const line = document.createElement('p'), amount = document.createElement('b');
    line.style.animationDelay=(i*90)+'ms';
    if(label.startsWith('碾压'))line.className='overkillRow';
    line.textContent=label; amount.textContent='$'+value; line.append(amount); ledger.append(line);
  }
}
function continueEndless() { S.winPending=false; hide('ovWin'); show('ovCash'); }
function checkStuck() {
  if (S.screen !== 'play' || S.drawPile.length) return false;
  if (S.hand.length === 0 || (S.boss && S.boss.id === 'psychic' && S.hand.length < 5)) {
    msg('🂠 牌库与手牌耗尽，无法继续出牌！', 1);
    gameLost();
    return true;
  }
  return false;
}
function gameLost(restoring=false) {
  if (S.screen!=='play' && !restoring) return;
  if (MP.on) {
    // 对决中把牌打光（弃光/牌库耗尽）= 提交当前分数；小盲/大盲失败 = 无奖励跳过，不扣命
    if (S.blindIdx === 2 && S.screen === 'play') return duelFinish();
    return mpPveFail();
  }
  sfxBad();
  if(!restoring) lossFx();
  S.screen = 'over';
  $('overStats').innerHTML = '倒在了 底注 ' + S.ante + ' 的 ' + (S.boss ? S.boss.name : blindMeta().name) +
    '<br>差 <span class="red">' + fmt(S.target - S.score) + '</span> 分　最高单次：<span class="gold">' + fmt(S.bestHand) + '</span>';
  const rb = $('btnRestore');
  if (saveStr && saveMeta) {
    rb.style.display = 'inline-block';
    rb.textContent = '⏪ 回到保存点（底注' + saveMeta.ante + ' · ' + BLINDN[saveMeta.blind] + '前）';
  } else rb.style.display = 'none';
  show('ovOver');
  persistRun();
}
