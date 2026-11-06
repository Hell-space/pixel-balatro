let S = null;
let cid = 0;
// 多人对战全局状态（详见文件底部「多人对战」模块）
const MP = { on:false, base:'', room:'', pid:'', host:false, name:'', oppName:'对手',
  lives:0, opp:{ lives:2, ante:1, blind:0, score:0, phase:'select' },
  bossSeq:[], myDuel:null, oppDuel:null, over:false, net:null };
function freshDeck() {
  const d = [];
  for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++)
    d.push({ id: ++cid, suit: s, rank: r, bonus: 0, multB: 0, wild: false,
             steel: false, glass: false, goldc: false, ed: 0, seal: null });
  return d;
}
function newGame(withTut) {
  initAudio();
  S = {
    deckAll: freshDeck(), money: 4, ante: 1, blindIdx: 0,
    levels: {}, jokers: [], cons: [], hand: [], drawPile: [], played: [],
    score: 0, handsLeft: 4, discLeft: 3, target: 300, boss: null,
    sortMode: 'rank', busy: false, sellId: null, shop: null,
    totKills: 0, totHands: 0, bestHand: 0, screen: 'select', wantTut: withTut,
    // —— 扩展系统 ——
    baseHands: 4, baseDisc: 3, handSize: 8, jokerSlots: 5, consSlots: 2,
    interestCap: 5, rerollBase: 5, discount: 1, vouchers: [],
    playCounts: {}, planetsUsed: 0, cardsAdded: 0,
    investN: 0, nextShopHalf: false, nextShopUnc: false,
    anteBoss: null, anteVoucher: null, skipTags: [],
  };
  HORDER.forEach(k => { S.levels[k] = 1; S.playCounts[k] = 0; });
  hide('ovStart');
  rollAnte();
  showBlindSelect();
}
const $ = id => document.getElementById(id);
const hide = id => $(id).style.display = 'none';
const show = id => $(id).style.display = 'flex';
const fmt = n => Math.floor(n).toLocaleString('en');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let msgT = null;
function msg(t, warn) {
  const b = $('infobar');
  b.textContent = t; b.className = warn ? 'warn' : 'transient';
  clearTimeout(msgT);
  msgT = setTimeout(() => { b.textContent = '选 1–5 张手牌，可出牌或弃牌'; b.className = ''; }, 3000);
}

// ================= 盲注流程 =================
const randOf = a => a[Math.floor(Math.random() * a.length)];
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ================= 存档点（单槽 · 静默保存） =================
// 每次进入选盲注界面时快照当前状态；出局后可回到最新保存点重试。
let saveStr = null, saveMeta = null;
const BLINDN = ['小盲注', '大盲注', 'Boss盲注'];
function saveCheckpoint() {
  if (MP.on) return;   // 多人模式禁用存档回溯
  // 手牌/牌库在开始盲注时会重建，快照里清空即可（也避免存到过期引用）
  saveStr = JSON.stringify({ ...S, hand: [], drawPile: [], played: [], shop: null, busy: false, sellId: null });
  saveMeta = { ante: S.ante, blind: S.blindIdx };
}
function restoreCheckpoint() {
  if (!saveStr || MP.on) return;
  S = JSON.parse(saveStr);
  S.drawPile = S.deckAll.slice();   // 仅供牌库计数显示，开始盲注时会重新洗牌
  hide('ovOver');
  sfxUp();
  renderAll();
  showBlindSelect();
}
function rollAnte() {
  const pool = BOSSES.filter(b => S.ante > 1 || !['needle', 'wall', 'water'].includes(b.id));
  const mpBoss = MP.on ? BOSSES.find(b => b.id === MP.bossSeq[S.ante - 1]) : null;
  S.anteBoss = mpBoss || randOf(pool);
  S.skipTags = [randOf(TAGS), randOf(TAGS)];
  const vp = VOUCHERS.filter(v => !S.vouchers.includes(v.id));
  S.anteVoucher = vp.length ? randOf(vp) : null;
}
function blindMetaFor(i) {
  const base = S.ante <= 8 ? ANTE_BASE[S.ante] : Math.round(50000 * Math.pow(2.4, S.ante - 8));
  const defs = [
    { name:'🔸 小盲注', mul:1,   reward:3 },
    { name:'🔶 大盲注', mul:1.5, reward:4 },
    { name:'💀 Boss盲注', mul:2, reward:5 },
  ];
  return { ...defs[i], target: Math.round(base * defs[i].mul) };
}
function blindMeta() { return blindMetaFor(S.blindIdx); }
function showBlindSelect() {
  S.screen = 'select';
  S.boss = null;
  $('bsAnte').textContent = S.ante;
  const cols = $('blindCols');
  cols.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const m = blindMetaFor(i);
    const d = document.createElement('div');
    d.className = 'bcol ' + (i === S.blindIdx ? 'cur' : i < S.blindIdx ? 'done' : 'todo');
    let h = '<div class="bname">' + (i === 2 ? (MP.on ? '⚔️ ' : '') + S.anteBoss.name : m.name) + '</div>' +
      '<div class="btgt">' + fmt(i === 2 && S.anteBoss.id === 'wall' ? Math.round(m.target * 1.6) : m.target) + '</div>' +
      '<div class="brw">奖励 $' + m.reward + ' + 结算</div>' +
      '<div class="bbs">' + (i === 2 ? S.anteBoss.desc +
        (MP.on ? '<br><span style="color:#ffd54a">⚔️ 对决：与对手拼总分，低者 -1❤️</span>' : '') : '') + '</div>';
    if (i < S.blindIdx) h += '<div class="st">✔ 已完成</div>';
    else if (i > S.blindIdx) h += '<div class="st">等待中…</div>';
    d.innerHTML = h;
    if (i === S.blindIdx) {
      const go = document.createElement('button');
      go.className = 'bbtn'; go.textContent = '开始挑战 ▶';
      go.onclick = chooseBlind;
      d.appendChild(go);
      if (i < 2) {
        const tg = S.skipTags[i];
        const sk = document.createElement('button');
        sk.className = 'bbtn skip'; sk.textContent = '跳过 ' + tg.ic + ' ' + tg.name;
        bindTip(sk, () => '<span class="tn">' + tg.ic + ' ' + tg.name + '</span><br>' + tg.desc);
        sk.onclick = () => skipBlind(tg);
        sk.setAttribute('aria-label', sk.textContent+'：'+tg.desc);
        d.appendChild(sk);
      }
    }
    cols.appendChild(d);
  }
  renderStats();
  show('ovBlinds');
  saveCheckpoint();   // 静默存档：只保留最新一个保存点
  mpSendState();
}
function skipBlind(tg) {
  hideTip();
  applyTag(tg);
  sfxCash();
  msg('🏷️ 已跳过，获得 ' + tg.name + '：' + tg.desc);
  S.blindIdx++;
  showBlindSelect();
}
function chooseBlind() {
  hideTip();
  hide('ovBlinds');
  startBlind();
  if (S.wantTut) { S.wantTut = false; tutStart(); }
}
function effHandSize() { return S.handSize - (S.boss && S.boss.id === 'manacle' ? 1 : 0); }
function startBlind() {
  const m = blindMeta();
  S.boss = S.blindIdx === 2 ? S.anteBoss : null;
  S.target = m.target;
  if (S.boss && S.boss.id === 'wall') S.target = Math.round(S.target * 1.6);
  S.score = 0;
  S.handsLeft = S.boss && S.boss.id === 'needle' ? 1 : S.baseHands;
  S.discLeft = S.boss && S.boss.id === 'arm' ? 1 : S.boss && S.boss.id === 'water' ? 0 : S.baseDisc;
  S.drawPile = shuffle(S.deckAll.slice());
  S.hand = []; S.played = [];
  S.jokers.forEach(j => { if (j.id === 'green') j.state = 0; });
  drawTo(effHandSize());
  S.screen = 'play';
  renderAll();
  if (S.boss) msg('⚠️ ' + S.boss.name + '：' + S.boss.desc, 1);
  checkStuck();
  mpSendState();
}
function applyTag(t) {
  switch (t.id) {
    case 'money': S.money += 8; break;
    case 'coupon': S.nextShopHalf = true; break;
    case 'unc': S.nextShopUnc = true; break;
    case 'invest': S.investN++; break;
    case 'meteor':
      if (S.cons.length < S.consSlots) S.cons.push({ ...randOf(PLANETS), kind:'planet', price:3 });
      else S.money += 3;
      break;
    case 'charm':
      if (S.cons.length < S.consSlots) S.cons.push({ ...randOf(TAROTS), kind:'tarot', price:3 });
      else S.money += 3;
      break;
  }
  renderStats(); renderCons();
}
function drawTo(n) {
  while (S.hand.length < n && S.drawPile.length) {
    const c = S.drawPile.pop();
    c.sel = false; c.justDealt = true;
    S.hand.push(c);
    sfxDeal();
  }
  sortHand();
}
function sortHand() {
  if (S.sortMode === 'rank') S.hand.sort((a, b) => b.rank - a.rank || a.suit - b.suit);
  else S.hand.sort((a, b) => a.suit - b.suit || b.rank - a.rank);
}
function setSort(m) { if (S.busy) return; S.sortMode = m; sortHand(); renderHand(); }

// ================= 牌型判定 =================
const SUIT_BOSS = { hearts: 1, spades: 0, club: 2, window: 3 };
function isDebuffed(c) {
  if (!S.boss || c.wild) return false;
  const t = SUIT_BOSS[S.boss.id];
  return t !== undefined && c.suit === t;
}
function evalHand(cards) {
  const n = cards.length;
  const cnt = {};
  cards.forEach(c => cnt[c.rank] = (cnt[c.rank] || 0) + 1);
  const groups = Object.entries(cnt).map(([r, c]) => ({ r: +r, c })).sort((a, b) => b.c - a.c || b.r - a.r);
  const nonWild = cards.filter(c => !c.wild);
  const isFlush = n === 5 && (nonWild.length === 0 || nonWild.every(c => c.suit === nonWild[0].suit));
  const uniq = [...new Set(cards.map(c => c.rank))].sort((a, b) => a - b);
  let isStraight = false;
  if (n === 5 && uniq.length === 5) {
    if (uniq[4] - uniq[0] === 4) isStraight = true;
    if (uniq.join(',') === '2,3,4,5,14') isStraight = true;
  }
  const contains = {
    pair: groups[0].c >= 2, trips: groups[0].c >= 3, quads: groups[0].c >= 4,
    twopair: (groups[0].c >= 2 && groups[1] && groups[1].c >= 2) || groups[0].c >= 4,
    straight: isStraight, flush: isFlush,
  };
  let key, scoring;
  const ofRank = r => cards.filter(c => c.rank === r);
  if (isStraight && isFlush) { key = 'sf'; scoring = cards; }
  else if (groups[0].c === 4) { key = 'four'; scoring = ofRank(groups[0].r); }
  else if (groups[0].c === 3 && groups[1] && groups[1].c >= 2) { key = 'fh'; scoring = cards; }
  else if (isFlush) { key = 'flush'; scoring = cards; }
  else if (isStraight) { key = 'straight'; scoring = cards; }
  else if (groups[0].c === 3) { key = 'trips'; scoring = ofRank(groups[0].r); }
  else if (groups[0].c === 2 && groups[1] && groups[1].c === 2) { key = 'twopair'; scoring = [...ofRank(groups[0].r), ...ofRank(groups[1].r)]; }
  else if (groups[0].c === 2) { key = 'pair'; scoring = ofRank(groups[0].r); }
  else {
    key = 'high';
    scoring = [cards.slice().sort((a, b) => b.rank - a.rank)[0]];
  }
  return { key, scoring, contains };
}
function handBase(key) {
  const h = HANDS[key], lv = S.levels[key];
  let chips = h.chips + (lv - 1) * h.incC, mult = h.mult + (lv - 1) * h.incM;
  if (S.boss && S.boss.id === 'flint' && S.screen === 'play') {
    chips = Math.ceil(chips / 2); mult = Math.ceil(mult / 2);
  }
  return { chips, mult, lv };
}
