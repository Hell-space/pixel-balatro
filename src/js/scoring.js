function popAt(wrap, txt, col) {
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
  const s = document.createElement('span');
  s.className = 'jpop'; s.textContent = txt;
  el.appendChild(s);
  setTimeout(() => s.remove(), 900);
  sfxJok();
}
function fmtM(m) { return m % 1 ? (Math.round(m * 100) / 100) : m; }
function setCalc(c, m) {
  $('prevChips').textContent = fmt(c);
  $('prevMult').textContent = fmtM(m);
}
async function doPlay() {
  if (S.busy || S.handsLeft <= 0) return;
  const sel = S.hand.filter(c => c.sel);
  if (!sel.length) { msg('请先选择 1~5 张牌', 1); return; }
  if (S.boss && S.boss.id === 'psychic' && sel.length !== 5) { msg('🧿 通灵者：必须打出恰好 5 张牌！', 1); return; }
  S.busy = true; S.sellId = null;
  S.handsLeft--; S.totHands++;
  S.hand = S.hand.filter(c => !c.sel);
  renderStats(); renderJokers();

  const ev = evalHand(sel);
  S.playCounts[ev.key]++;
  const base = handBase(ev.key);
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
  await sleep(400);

  // —— 逐牌计分（含重复触发）——
  let photoUsed = false;
  const lastHand = S.handsLeft === 0;
  const hasDusk = S.jokers.some(j => j.id === 'dusk');
  const hasHack = S.jokers.some(j => j.id === 'hack');
  const scoreOne = async c => {
    const w = wraps.get(c.id);
    let add = chipVal(c);
    chips += add; popAt(w, '+' + add, '#57e6ff'); sfxTick(chips);
    if (c.bonus) { chips += c.bonus; popAt(w, '+' + c.bonus + ' 筹码', '#57e6ff'); }
    if (c.multB) { mult += c.multB; popAt(w, '+' + c.multB + ' 倍率', '#ff6b6b'); }
    if (c.glass) { mult *= 2; popAt(w, '×2 玻璃', '#8fd0ff'); }
    if (c.ed === 1) { chips += 50; popAt(w, '+50 闪箔', '#57e6ff'); }
    if (c.ed === 2) { mult += 10; popAt(w, '+10 全息', '#ff6b6b'); }
    if (c.ed === 3) { mult *= 1.5; popAt(w, '×1.5 多彩', '#ffd54a'); }
    if (c.goldc) { S.money += 3; popAt(w, '🪙 +$3', '#7ddf8f'); renderStats(); }
    if (c.seal === 'gold') { S.money += 3; popAt(w, '🟡 +$3 金封', '#7ddf8f'); renderStats(); }
    setCalc(chips, mult);
    // 逐牌触发的小丑
    for (const j of S.jokers) {
      const suitHit = tgt => c.wild || c.suit === tgt;
      if (j.id === 'greedy' && suitHit(3)) { mult += 3; jokerPop(j, '+3 倍率'); }
      if (j.id === 'lusty' && suitHit(1)) { mult += 3; jokerPop(j, '+3 倍率'); }
      if (j.id === 'wrath' && suitHit(0)) { mult += 3; jokerPop(j, '+3 倍率'); }
      if (j.id === 'glut' && suitHit(2)) { mult += 3; jokerPop(j, '+3 倍率'); }
      if (j.id === 'photo' && !photoUsed && c.rank >= 11 && c.rank <= 13) {
        photoUsed = true; mult *= 2; jokerPop(j, '×2 倍率');
      }
      if (j.id === 'fib' && [14, 2, 3, 5, 8].includes(c.rank)) { mult += 8; jokerPop(j, '+8 倍率'); }
      if (j.id === 'scary' && c.rank >= 11 && c.rank <= 13) { chips += 30; jokerPop(j, '+30 筹码'); }
      if (j.id === 'even' && c.rank <= 10 && c.rank % 2 === 0) { mult += 4; jokerPop(j, '+4 倍率'); }
      if (j.id === 'odd' && (c.rank === 14 || (c.rank <= 9 && c.rank % 2 === 1))) { chips += 31; jokerPop(j, '+31 筹码'); }
    }
    setCalc(chips, mult);
    await sleep(260);
  };
  for (const c of ev.scoring) {
    const w = wraps.get(c.id);
    if (isDebuffed(c)) { popAt(w, '🚫 禁用', '#888'); await sleep(220); continue; }
    let times = 1;
    if (c.seal === 'red') times++;
    if (hasHack && c.rank >= 2 && c.rank <= 5) times++;
    if (hasDusk && lastHand) times++;
    for (let k = 0; k < times; k++) {
      if (k > 0) { popAt(w, '↻ 重复触发', '#ffd54a'); await sleep(180); }
      await scoreOne(c);
    }
  }

  // —— 留在手中的钢铁牌 ——
  const steelN = S.hand.filter(c => c.steel && !isDebuffed(c)).length;
  if (steelN) {
    mult *= Math.pow(1.5, steelN);
    msg('🛡️ ' + steelN + ' 张钢铁牌留在手中，倍率 ×' + fmtM(Math.pow(1.5, steelN)) + '！');
    setCalc(chips, mult);
    await sleep(340);
  }

  // —— 小丑结算 ——
  for (const j of S.jokers) {
    let fx = [];
    switch (j.id) {
      case 'joker': fx = [['m', 4]]; break;
      case 'jolly': if (ev.contains.pair) fx = [['m', 8]]; break;
      case 'zany': if (ev.contains.trips) fx = [['m', 12]]; break;
      case 'mad': if (ev.contains.twopair) fx = [['m', 10]]; break;
      case 'crazy': if (ev.contains.straight) fx = [['m', 12]]; break;
      case 'droll': if (ev.contains.flush) fx = [['m', 10]]; break;
      case 'sly': if (ev.contains.pair) fx = [['c', 50]]; break;
      case 'clever': if (ev.contains.twopair) fx = [['c', 80]]; break;
      case 'devious': if (ev.contains.straight) fx = [['c', 100]]; break;
      case 'crafty': if (ev.contains.flush) fx = [['c', 80]]; break;
      case 'half': if (sel.length <= 3) fx = [['m', 20]]; break;
      case 'ice': if (j.state > 0) fx = [['c', j.state]]; break;
      case 'green': if (j.state > 0) fx = [['m', j.state]]; break;
      case 'runner': if (j.state > 0) fx = [['c', j.state]]; break;
      case 'abstract': fx = [['m', S.jokers.length * 3]]; break;
      case 'trio': if (ev.contains.trips) fx = [['x', 3]]; break;
      case 'family': if (ev.contains.quads) fx = [['x', 4]]; break;
      case 'misprint': fx = [['m', Math.floor(Math.random() * 24)]]; break;
      case 'gros': fx = [['m', 15]]; break;
      case 'nova': fx = [['m', S.playCounts[ev.key]]]; break;
      case 'bus': if (j.state > 0) fx = [['m', j.state]]; break;
      case 'stencil': { const e = S.jokerSlots - S.jokers.length + 1; if (e > 1) fx = [['x', e]]; break; }
      case 'constel': if (S.planetsUsed) fx = [['x', 1 + 0.1 * S.planetsUsed]]; break;
      case 'holog': if (S.cardsAdded) fx = [['x', 1 + 0.25 * S.cardsAdded]]; break;
      case 'baseball': { const n = S.jokers.filter(x => x.rar === 1 && x.uid !== j.uid).length; if (n) fx = [['x', Math.pow(1.5, n)]]; break; }
      case 'baron': { const n = S.hand.filter(c => c.rank === 13 && !isDebuffed(c)).length; if (n) fx = [['x', Math.pow(1.5, n)]]; break; }
      case 'moon': { const n = S.hand.filter(c => c.rank === 12 && !isDebuffed(c)).length; if (n) fx = [['m', 13 * n]]; break; }
    }
    if (j.ed === 1) fx.push(['c', 50]);
    if (j.ed === 2) fx.push(['m', 10]);
    if (j.ed === 3) fx.push(['x', 1.5]);
    for (const [t, v] of fx) {
      if (t === 'c') { chips += v; jokerPop(j, '+' + v + ' 筹码'); }
      if (t === 'm') { mult += v; jokerPop(j, '+' + v + ' 倍率'); }
      if (t === 'x') { mult *= v; jokerPop(j, '×' + fmtM(v) + ' 倍率'); }
      setCalc(chips, mult);
      await sleep(320);
    }
  }

  // —— 总分 ——
  const total = Math.floor(chips * mult);
  S.bestHand = Math.max(S.bestHand, total);
  const tp = $('totalPop');
  tp.textContent = (total >= 3000 ? '🔥 ' : '⭐ ') + fmt(total) + ' 分！';
  tp.classList.toggle('big', total >= 3000);
  tp.style.display = 'block';
  sfxUp();
  S.score += total;
  await sleep(900);
  tp.style.display = 'none';
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
  const faced = sel.some(c => c.rank >= 11 && c.rank <= 13);
  S.jokers.forEach(j => {
    if (j.id === 'green') j.state++;
    if (j.id === 'runner' && ev.contains.straight) j.state += 15;
    if (j.id === 'bus') j.state = faced ? 0 : j.state + 1;
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
    msg('🪝 钩爪抓走了你 2 张手牌！', 1);
  }
  drawTo(effHandSize());
  S.busy = false;
  renderAll();
  checkStuck();
  persistRun();
  mpSendState();
}
function doDiscard() {
  if (S.busy || S.discLeft <= 0) return;
  const sel = S.hand.filter(c => c.sel);
  if (!sel.length) { msg('请先选择要弃掉的牌', 1); return; }
  S.discLeft--;
  S.hand = S.hand.filter(c => !c.sel);
  S.jokers.forEach(j => { if (j.id === 'green' && j.state) { j.state = 0; jokerPop(j, '清零!'); } });
  sfxBad();
  drawTo(effHandSize());
  renderAll();
  msg('弃掉了 ' + sel.length + ' 张牌');
  checkStuck();
}

// ================= 胜负 =================
function beatBlind() {
  sfxWin();
  const m = blindMeta();
  const bounty = S.jokers.filter(j => j.id === 'bounty').length * 3;
  const goldenN = S.jokers.filter(j => j.id === 'golden').length * 4;
  const interest = Math.min(S.interestCap, Math.floor(S.money / 5));
  const handBonus = S.handsLeft;
  let invest = 0;
  if (S.boss && S.investN) { invest = S.investN * 15; S.investN = 0; }
  const total = m.reward + bounty + goldenN + interest + handBonus + invest;
  S.payout = [['盲注奖励',m.reward], ['剩余出牌 ×'+handBonus,handBonus], ['利息',interest]];
  for (const [name,value] of [['赏金猎人',bounty],['黄金小丑',goldenN],['投资标签',invest]]) {
    if (value) S.payout.push([name,value]);
  }
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
  const wasWin = !MP.on && S.ante === 8 && S.blindIdx === 2;
  S.winPending=wasWin;
  if (wasWin) {
    $('winStats').innerHTML = '最高单次得分：<span class="gold">' + fmt(S.bestHand) + '</span>　总出牌数：<span class="blue">' + S.totHands + '</span>';
    show('ovWin');
  } else show('ovCash');
  persistRun();
  renderStats();
  mpSendState();
}
function renderPayout() {
  const ledger = $('cashRows'); ledger.replaceChildren();
  for (const [label,value] of S.payout) {
    const line = document.createElement('p'), amount = document.createElement('b');
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
function gameLost() {
  if (MP.on) {
    // 对决中把牌打光（弃光/牌库耗尽）= 提交当前分数；小盲/大盲失败 = 无奖励跳过，不扣命
    if (S.blindIdx === 2 && S.screen === 'play') return duelFinish();
    return mpPveFail();
  }
  sfxBad();
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
