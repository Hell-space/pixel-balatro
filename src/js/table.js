const tipEl = () => $('tip');
function bindTip(el, fn) {
  let timer, startX, startY, held = false;
  const reveal = (x,y) => {
    const t = tipEl(); t.innerHTML = fn(); t.style.display = 'block'; moveTip(x,y);
  };
  const clear = () => clearTimeout(timer);
  el.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') reveal(e.clientX,e.clientY); });
  el.addEventListener('pointermove', e => {
    if (e.pointerType === 'mouse') moveTip(e.clientX,e.clientY);
    else if (Math.hypot(e.clientX-startX,e.clientY-startY)>9) clear();
  });
  el.addEventListener('pointerleave', () => { clear(); if (!held) hideTip(); });
  el.addEventListener('pointerdown', e => {
    clear(); held=false;
    if (e.pointerType === 'mouse') return;
    startX=e.clientX; startY=e.clientY;
    timer=setTimeout(() => { held=true; reveal(startX,startY); },450);
  });
  el.addEventListener('pointerup',clear); el.addEventListener('pointercancel',clear);
  el.addEventListener('contextmenu',e=>e.preventDefault());
  el.addEventListener('click',e=>{ if (held) { held=false; e.preventDefault(); e.stopImmediatePropagation(); } },true);
}
function moveTip(x,y) {
  const t=tipEl();
  t.style.left=Math.max(5,Math.min(innerWidth-t.offsetWidth-5,x+12))+'px';
  const top=y+t.offsetHeight+20<innerHeight ? y+14 : y-t.offsetHeight-12;
  t.style.top=Math.max(5,top)+'px';
}
function hideTip() { tipEl().style.display='none'; }
document.addEventListener('pointerdown',hideTip,true);
const EDNAME = ['', '✨ 闪箔 (+50 筹码)', '📽️ 全息 (+10 倍率)', '🌈 多彩 (×1.5 倍率)'];
function cardTipHTML(c) {
  let h = '<span class="tn">' + rankName(c.rank) + ' ' + (c.wild ? '🌈 百搭花色' : SUITS[c.suit]) + '</span><br>筹码 ' + (chipVal(c) + c.bonus);
  if (c.wild) h += '<br>视为所有花色，点数不变';
  if (c.bonus) h += '<br>奖励：计分时 +' + c.bonus + ' 筹码';
  if (c.multB) h += '<br>计分时 +' + c.multB + ' 倍率';
  if (c.steel) h += '<br>🛡️ 钢铁：留在手中 ×1.5 倍率';
  if (c.glass) h += '<br>🏺 玻璃：计分 ×2 倍率，25% 碎裂';
  if (c.goldc) h += '<br>💰 黄金：计分时 +$3';
  if (c.ed) h += '<br>' + EDNAME[c.ed];
  if (c.seal === 'red') h += '<br>🔴 红蜡封：重复触发计分或留手效果';
  if (c.seal === 'gold') h += '<br>🟡 金蜡封：计分时 +$3';
  if (isDebuffed(c)) h += '<br><span class="rc2">⚠️ 被 Boss 禁用！</span>';
  return h;
}
function jokerTipHTML(j) {
  return '<span class="tn">' + j.ic + ' ' + j.name + '</span> <span class="tr rc' + (j.rar || 0) + '">[' + RARNAME[j.rar || 0] + ']</span>' +
    (j.ed ? '<br><span class="tr">' + EDNAME[j.ed] + '</span>' : '') +
    '<br>' + jokerDesc(j);
}

// ================= 渲染 =================
// Pip positions on the three columns of a French playing card.
const PIPS = [[], [[50,50]], [[50,12],[50,88]], [[50,12],[50,50],[50,88]],
  [[18,12],[82,12],[18,88],[82,88]]];
PIPS[5]=[...PIPS[4],[50,50]]; PIPS[6]=[...PIPS[4],[18,50],[82,50]];
PIPS[7]=[...PIPS[6],[50,31]]; PIPS[8]=[...PIPS[7],[50,69]];
PIPS[9]=[...PIPS[4],[18,37],[82,37],[18,63],[82,63],[50,50]];
PIPS[10]=[...PIPS[9].slice(0,8),[50,25],[50,75]];
function suitSVG(c){return '<svg class="suitIcon" viewBox="0 0 24 24" aria-hidden="true"><use href="#suit'+(c.wild?'Wild':c.suit)+'"/></svg>';}
function cornerSuit(c){return suitSVG(c)+'<span class="suitText">'+(c.wild?'✦':SUITS[c.suit])+'</span>';}
function facePrint(c) {
  const suit=suitSVG(c), r=c.rank;
  if(r>10 && r<14) return '<span class="facePip" aria-hidden="true">'+rankName(r)+'<small>'+suit+' '+suit+'</small></span>';
  return '<span class="pips" aria-hidden="true">'+PIPS[r===14?1:r].map(([x,y])=>
    '<i class="'+(r===14?'acePip':'')+'" style="left:'+x+'%;top:'+y+'%">'+suit+'</i>').join('')+'</span>';
}
function cardEl(c, interactive = false) {
  const d = document.createElement(interactive ? 'button' : 'div');
  d.dataset.cardId=String(c.id);
  d.className = 'card ' + (RED(c.suit) ? 'red' : 'blk') + (c.wild ? ' wild' : '') +
    (c.steel ? ' steel' : '') + (c.glass ? ' glass' : '') + (c.goldc ? ' goldc' : '') +
    (isDebuffed(c) ? ' debuff' : '');
  if (c.sel) d.classList.add('sel');
  if (c.justDealt) { d.classList.add('dealt'); c.justDealt = false; }
  let en = '';
  if (c.bonus) en += '<span class="en b">+' + c.bonus + '</span>';
  if (c.multB) en += '<span class="en m">+' + c.multB + '</span>';
  if (en) { en='<span class="enhancements">'+en+'</span>';d.classList.add('hasBadges'); }
  if (c.wild) en += '<span class="en w">花</span>';
  if (c.seal) en += '<span class="seal ' + c.seal + '"></span>';
  if (c.ed) en += '<span class="edfx ' + ['', 'f', 'h', 'p'][c.ed] + '"></span>';
  d.innerHTML = '<span class="rk">' + rankName(c.rank) + '</span><span class="st2" aria-hidden="true">' + cornerSuit(c) + '</span>' +
    '<span class="st" aria-hidden="true">' + cornerSuit(c) + '</span>' + facePrint(c) + en;
  bindTip(d, () => cardTipHTML(c));
  return d;
}
function renderHand() {
  const row = $('handRow');
  row.style.setProperty('--hand-columns',S.hand.length>8?5:4);
  row.innerHTML = '';
  S.hand.forEach(c => {
    const el = cardEl(c, true);
    if(el.classList.contains('dealt')) el.style.setProperty('--deal-delay',(row.children.length*22)+'ms');
    el.setAttribute('aria-label', (c.wild?'百搭花色，点数':['黑桃','红桃','梅花','方块'][c.suit])+rankName(c.rank));
    el.setAttribute('aria-pressed',String(!!c.sel)); el.disabled=S.busy;
    el.onclick = () => {
      if (S.busy) return;
      if (!c.sel && S.hand.filter(x => x.sel).length >= 5) { msg('最多只能选 5 张牌', 1); return; }
      c.sel = !c.sel;
      sfxSel();
      el.classList.toggle('sel'); el.setAttribute('aria-pressed',String(c.sel));
      updatePreview();
    };
    row.appendChild(el);
  });
  updatePreview();
}
function updatePreview() {
  const sel = S.hand.filter(c => c.sel);
  $('selCount').textContent = sel.length && !S.busy ? sel.length+'/5' : '';
  if (!S.busy) $('scoreEstimate').textContent='';
  if (!S.busy && !sel.length) {
    $('prevName').textContent = '选择手牌'; $('prevLvl').textContent = '';
    $('prevChips').textContent = '0'; $('prevMult').textContent = '0';
  } else if (!S.busy) {
    const ev = evalHand(sel);
    const state={...S,handsLeft:S.handsLeft-1};
    const lo=scoreHand(state,sel,()=>0), hi=scoreHand(state,sel,()=>.999999);
    const b = handBase(ev.key);
    $('prevName').textContent = HANDS[ev.key].name;
    $('prevLvl').textContent = '等级 ' + b.lv;
    $('prevChips').textContent = fmt(lo.chips);
    $('prevMult').textContent = lo.mult===hi.mult?fmtM(lo.mult):fmtM(lo.mult)+'–'+fmtM(hi.mult);
    $('scoreEstimate').textContent=(lo.total===hi.total?fmt(lo.total):fmt(lo.total)+'–'+fmt(hi.total))+' 分';
  }
  const repeated=S.boss?.id==='eye'&&S.blindPlayed.includes(evalHand(sel).key);
  const needFive=S.boss?.id==='psychic'&&sel.length!==5;
  const forbidden=repeated||needFive;
  if(!S.busy&&repeated)$('scoreEstimate').textContent='本盲注已打出此牌型';
  else if(!S.busy&&needFive)$('scoreEstimate').textContent='需选满 5 张牌';
  $('btnPlay').disabled = S.busy || !sel.length || S.handsLeft <= 0 || forbidden;
  $('btnDiscard').disabled = S.busy || !sel.length || S.discLeft <= 0;
}
function renderStats() {
  $('game').classList.toggle('isScoring',!!S.busy);
  renderReserveEntry();
  for(const mode of ['rank','suit']) {
    const button=$(mode==='rank'?'btnSortRank':'btnSortSuit');
    button.setAttribute('aria-pressed',String(S.sortMode===mode));button.disabled=S.busy;
  }
  $('handsVal').textContent = S.handsLeft;
  $('discVal').textContent = S.discLeft;
  $('moneyVal').textContent = '$' + S.money;
  $('handSizeVal').textContent = effHandSize();
  $('anteVal').textContent = MP.on ? S.ante + ' ⚔️' : (S.ante > 8 ? S.ante + ' ♾️' : S.ante + ' / 8');
  $('deckVal').textContent = (S.screen==='select'?S.deckAll.length:S.drawPile.length) + '/' + S.deckAll.length;
  $('scoreVal').textContent = fmt(S.score);
  // 对决盲注：目标栏实时显示对手分数
  const duel = MP.on && S.blindIdx === 2 && (S.screen === 'play' || S.screen === 'duelwait');
  const oppSc = duel && MP.opp.ante === S.ante && MP.opp.blind === 2 ? MP.opp.score : 0;
  $('targetLbl').textContent = duel ? '⚔️ 对手得分' : '目标分数';
  const target=S.screen==='select'?blindMeta().target:S.target;
  $('blindBox').classList.toggle('largeScore',Math.max(fmt(S.score).length,fmt(duel?oppSc:target).length)>6);
  $('targetVal').textContent = fmt(duel ? oppSc : target);
  $('scorebar').style.width = Math.min(100, S.score / Math.max(1, duel ? oppSc : S.target) * 100) + '%';
  if (MP.on) $('livesVal').textContent = '❤️'.repeat(Math.max(0, MP.lives)) || '💀';
  const m = blindMeta();
  $('blindName').textContent = S.boss ? S.boss.name + (MP.on ? ' ⚔️对决' : ' (Boss)') : m.name;
  const bd = $('bossDesc');
  if (S.boss) { bd.style.display = 'block'; bd.textContent = S.boss.desc; }
  else bd.style.display = 'none';
  const tactics=tacticsStatus();$('tacticsStatus').textContent=tactics;$('tacticsStatus').hidden=!tactics;
}
function jokerDesc(j) {
  let d = j.desc;
  if (j.id === 'ice') d += '（当前 +' + j.state + '）';
  if (j.id === 'green') d += '（当前 +' + j.state + '）';
  if (j.id === 'runner') d += '（当前 +' + j.state + '）';
  if (j.id === 'bus') d += '（当前 +' + j.state + '）';
  if (j.id === 'abstract') d += '（当前 +' + S.jokers.length * 3 + '）';
  if (j.id === 'constel') d += '（当前 ×' + (1 + 0.1 * S.planetsUsed).toFixed(1) + '）';
  if (j.id === 'holog') d += '（当前 ×' + (1 + 0.25 * S.cardsAdded).toFixed(2) + '）';
  if (j.id === 'stencil') d += '（当前 ×' + Math.max(1, S.jokerSlots - S.jokers.length + 1) + '）';
  if (j.id === 'fortune') d += '（当前 +'+S.tarotsUsed+'）';
  if (j.id === 'boots') d += '（当前 +'+2*Math.floor(S.money/5)+'）';
  if (j.id === 'compass') d += '（已打出 '+Object.values(S.playCounts).filter(n=>n>0).length+' 种）';
  return d;
}
function sellPrice(j) { return j.sell || Math.max(1, Math.ceil(j.price / 2)); }
function renderJokers() {
  hideTip();
  const row = $('jokerRow');
  row.innerHTML = '';
  S.jokers.forEach(j => {
    const d = document.createElement('button');
    d.className = 'joker' + (j.rar === 1 ? ' ru' : j.rar === 2 ? ' rr' : '');
    d.id = 'jk' + j.uid;
    d.innerHTML = '<div class="ic">' + j.ic + '</div><div class="nm">' + j.name + '</div>' +
      (j.ed ? '<span class="edfx ' + ['', 'f', 'h', 'p'][j.ed] + '"></span>' : '') +
      (S.sellId === j.uid ? '<div class="sellbadge">卖出 $' + sellPrice(j) + '</div>' : '');
    bindTip(d, () => jokerTipHTML(j));
    d.onclick = () => { if(!S.busy) openOwned('joker',j.uid); };
    row.appendChild(d);
  });
  for (let i = S.jokers.length; i < S.jokerSlots; i++) {
    const d = document.createElement('div');
    d.className = 'jslot'; d.textContent = '小丑';
    row.appendChild(d);
  }
}
function renderCons() {
  hideTip();
  const row = $('consRow');
  row.innerHTML = '';
  S.cons.forEach((t, i) => {
    const d = document.createElement('button');
    d.className = 'joker ' + (t.kind === 'planet' ? 'cons' : 'cons tarot');
    d.innerHTML = '<div class="ic">' + t.ic + '</div><div class="nm">' + t.name + '</div>';
    bindTip(d, () => '<span class="tn">' + t.ic + ' ' + t.name + '</span><br>' +
      (t.kind === 'planet' ? HANDS[t.key].name + ' 牌型升 1 级' : t.desc) +
      '<br><span class="tr" style="color:#667">点击查看 / 使用</span>');
    d.onclick = () => { if(!S.busy) openOwned('cons',i); };
    row.appendChild(d);
  });
  for (let i = S.cons.length; i < S.consSlots; i++) {
    const d = document.createElement('div');
    d.className = 'jslot'; d.textContent = '消耗';
    row.appendChild(d);
  }
}
function renderAll() { renderStats(); renderJokers(); renderCons(); renderHand(); }
