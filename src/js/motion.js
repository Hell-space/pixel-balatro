// Decorative motion: particles, stamps, rolling numbers and pointer play. It never changes game state,
// and uses its own random sequence so the game's draws stay untouched. Module state uses `var`
// because earlier modules may render before this section runs.
var fxSeed = 0x5eed1234, numberRolls = new Map(), moneyShown = { run: null, value: 0 };
var swipe = null, swipeClickBlock = 0, lastShopStock = '';
function fxRand() {
  fxSeed = (fxSeed + 0x6D2B79F5) | 0;
  let t = fxSeed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61);
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}
const FX_TONES = {
  chips: ['#8fd3ff', '#4ea3d8', '#e6f6ff'], mult: ['#ff8a7a', '#d8473b', '#ffd2c4'],
  money: ['#ffe28a', '#f0b93f', '#fff6cf'], gold: ['#ffe8a3', '#f2c769', '#fff'], weak: ['#ff6b5b', '#ffd36b', '#fff1d0'],
};
function centerOf(el) {
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, r };
}
// ── Rolling numbers ──
function parseShown(text) { return Number(String(text).replace(/[^\d.-]/g, '')) || 0; }
function rollNumber(el, to, { from, duration = 480, format = fmt, scoring = true } = {}) {
  if (!el) return;
  const running = numberRolls.get(el);
  if (running) cancelAnimationFrame(running.raf);
  const start = from ?? running?.value ?? parseShown(el.textContent);
  if (!motionAllowed(scoring) || start === to || !window.requestAnimationFrame) {
    numberRolls.delete(el); el.textContent = format(to); return;
  }
  const roll = { value: start, to, format, raf: 0 }, began = performance.now();
  const length = scoring ? duration / (settings.speed || 1) : duration;
  const step = now => {
    const k = Math.min(1, (now - began) / length), eased = 1 - Math.pow(1 - k, 3);
    roll.value = start + (roll.to - start) * eased;
    el.textContent = roll.format(roll.value);
    if (k < 1) roll.raf = requestAnimationFrame(step);
    else { numberRolls.delete(el); el.textContent = roll.format(roll.to); }
  };
  numberRolls.set(el, roll); roll.raf = requestAnimationFrame(step);
}
// Renders the final value, or retargets a roll that is still running.
function setNumber(el, value, format = fmt) {
  const roll = numberRolls.get(el);
  if (roll) { roll.to = value; roll.format = format; } else el.textContent = format(value);
}
// ── Particles and stamps ──
function sparkBurst(x, y, { count = 10, tone = 'gold', spread = 70, size = 6, duration = 560, scoring = true, rise = 0 } = {}) {
  if (!motionAllowed(scoring)) return;
  const colors = FX_TONES[tone] || FX_TONES.gold;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i'), angle = fxRand() * Math.PI * 2, dist = spread * (.45 + fxRand() * .7);
    const s = size * (.6 + fxRand() * .8);
    p.className = 'spark';
    Object.assign(p.style, { left: x + 'px', top: y + 'px', width: s + 'px', height: s + 'px', background: colors[i % colors.length] });
    const dx = Math.cos(angle) * dist, dy = Math.sin(angle) * dist - rise;
    transient(p, [{ transform: 'translate(-50%,-50%) scale(1) rotate(0)', opacity: 1 },
      { transform: `translate(calc(-50% + ${dx * .8}px),calc(-50% + ${dy * .8}px)) scale(.9) rotate(${fxRand() * 180}deg)`, opacity: 1, offset: .6 },
      { transform: `translate(calc(-50% + ${dx}px),calc(-50% + ${dy + 18}px)) scale(.2) rotate(${fxRand() * 360}deg)`, opacity: 0 }],
      duration * (.75 + fxRand() * .5), scoring);
  }
}
function stamp(text, tone = 'gold', { scoring = false, duration = 1000, y = 42 } = {}) {
  if (!motionAllowed(scoring)) return;
  const el = document.createElement('div');
  el.className = 'stamp ' + tone; el.textContent = text; el.style.top = y + '%';
  transient(el, [{ transform: 'translate(-50%,-50%) scale(2.4) rotate(-16deg)', opacity: 0 },
    { transform: 'translate(-50%,-50%) scale(.94) rotate(-7deg)', opacity: 1, offset: .2 },
    { transform: 'translate(-50%,-50%) scale(1) rotate(-7deg)', opacity: 1, offset: .78 },
    { transform: 'translate(-50%,-62%) scale(1.03) rotate(-7deg)', opacity: 0 }], duration, scoring);
}
function shakeTable(power = 6, scoring = true) {
  const frames = [0, 1, 2, 3, 4, 5].map(i => {
    const f = power * (1 - i / 6);
    return { transform: `translate(${(fxRand() - .5) * 2 * f}px,${(fxRand() - .5) * 2 * f}px) rotate(${(fxRand() - .5) * f * .12}deg)` };
  });
  feedback($('game'), [...frames, { transform: 'none' }], 380, scoring);
}
function floatText(x, y, text, tone = 'gold', scoring = false) {
  if (!motionAllowed(scoring)) return;
  const el = document.createElement('b');
  el.className = 'floatText ' + tone; el.textContent = text;
  Object.assign(el.style, { left: x + 'px', top: y + 'px' });
  transient(el, [{ transform: 'translate(-50%,-30%) scale(.7)', opacity: 0 },
    { transform: 'translate(-50%,-90%) scale(1.08)', opacity: 1, offset: .25 },
    { transform: 'translate(-50%,-190%) scale(1)', opacity: 0 }], 900, scoring);
}
function coinShower(fromEl, toEl, count = 8) {
  if (!fromEl || !toEl || !motionAllowed()) return;
  const a = centerOf(fromEl), b = centerOf(toEl);
  for (let i = 0; i < count; i++) {
    const coin = document.createElement('i'); coin.className = 'flyingCoin';
    Object.assign(coin.style, { left: a.x + 'px', top: a.y + 'px' });
    const dx = b.x - a.x, dy = b.y - a.y, lift = 40 + fxRand() * 60, side = (fxRand() - .5) * 120;
    transient(coin, [{ transform: 'translate(-50%,-50%) scale(.4)', opacity: 0 },
      { transform: `translate(calc(-50% + ${dx * .3 + side}px),calc(-50% + ${dy * .2 - lift}px)) scale(1.1) rotateY(180deg)`, opacity: 1, offset: .4 },
      { transform: `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(.5) rotateY(540deg)`, opacity: .2 }], 620 + i * 55);
  }
}
// ── Scoring hooks ──
function eventTone(text) { return /\$/.test(text) ? 'money' : /倍率|×/.test(text) ? 'mult' : 'chips'; }
function calcPunch(el, strong) {
  if (!el) return;
  feedback(el, strong ? [{ transform: 'scale(1)', filter: 'brightness(1)' }, { transform: 'scale(1.32) rotate(-4deg)', filter: 'brightness(1.6)', offset: .3 },
    { transform: 'scale(.94) rotate(2deg)', offset: .65 }, { transform: 'scale(1)', filter: 'brightness(1)' }]
    : [{ transform: 'scale(1)' }, { transform: 'scale(1.16)', offset: .35 }, { transform: 'scale(1)' }], strong ? 320 : 170, true);
  if (strong && motionAllowed(true)) { const c = centerOf(el); sparkBurst(c.x, c.y, { count: 8, tone: 'mult', spread: 46, size: 5 }); }
}
function jokerFx(el, text) {
  if (!el || !motionAllowed(true)) return;
  const c = centerOf(el);
  sparkBurst(c.x, c.y, { count: text.includes('×') ? 12 : 6, tone: eventTone(text), spread: text.includes('×') ? 62 : 40, size: 5 });
}
function scoreEventFx(event) {
  if (!motionAllowed(true)) return;
  if (event.kind === 'held') {
    const el = handCardEl(event.id);
    if (el) {
      feedback(el, [{ transform: 'translateY(0)' }, { transform: 'translateY(-12px) scale(1.08) rotate(3deg)', offset: .4 }, { transform: 'translateY(0)' }], 260, true);
      const c = centerOf(el); sparkBurst(c.x, c.y, { count: 8, tone: 'mult', spread: 42, size: 5 }); floatText(c.x, c.r.y, event.text, 'mult', true);
    }
  } else if (event.kind === 'rhythm') {
    const c = centerOf($('previewBox'));
    floatText(c.x, c.r.y, event.text.split(' · ')[0] + '！', 'chips', true);
    sparkBurst(c.x, c.r.y + 6, { count: 10, tone: 'chips', spread: 60, size: 5 });
  } else if (event.kind === 'weak') {
    stamp('破绽！', 'weak', { scoring: true, duration: 760, y: 36 });
    shakeTable(7);
    const c = centerOf($('prevMult')); sparkBurst(c.x, c.y, { count: 16, tone: 'weak', spread: 80, size: 6 });
  }
}
function totalFx(total, before, target) {
  const tp = $('totalPop');
  if (!motionAllowed(true)) return;
  const prefix = total >= 3000 ? '🔥 ' : '⭐ ';
  rollNumber(tp, total, { from: 0, duration: 420, format: v => prefix + fmt(v) + ' 分！' });
  rollNumber($('scoreVal'), before + total, { from: before, duration: 560 });
  const c = centerOf(tp), share = target ? total / target : 0;
  sparkBurst(c.x, c.y, { count: share >= 1 ? 26 : share >= .5 ? 16 : 9, tone: 'gold', spread: share >= 1 ? 140 : 90, size: 7, duration: 700 });
  if (before + total >= target && !(MP.on && S.blindIdx === 2)) {
    $('previewBox').classList.add('onFire');
    shakeTable(share >= 1 ? 9 : 5);
  }
}
function celebrateBlind(overkill) {
  if (!motionAllowed()) return;
  // Wait for the result dialog to take its layer, so the stamp paints above it.
  setTimeout(() => celebrateNow(overkill), 30);
}
function celebrateNow(overkill) {
  if (!S || S.screen !== 'cash') return;
  const big = overkill && overkill.money > 0;
  stamp(big ? '碾压 ×' + (Math.floor(overkill.ratio * 10) / 10) + '！' : '击破！', big ? 'weak' : 'gold', { duration: 1150, y: 30 });
  const rows = $('cashRows').lastElementChild?.querySelector('b');
  const total = S.payout[S.payout.length - 1]?.[1] || 0;
  if (rows) setTimeout(() => rollNumber(rows, total, { from: 0, duration: 520, format: v => '$' + Math.round(v), scoring: false }), 90 * S.payout.length);
  coinShower($('scoreVal'), $('moneyVal'), big ? 12 : 7);
  const c = centerOf($('scoreVal'));
  sparkBurst(c.x, c.y, { count: 18, tone: 'gold', spread: 110, size: 7, duration: 800, scoring: false });
}
function lossFx() {
  if (!motionAllowed()) return;
  for (const [i, el] of [...$('handRow').children].entries()) {
    feedback(el, [{ transform: 'translateY(0) rotate(0)', opacity: 1 },
      { transform: `translateY(-14px) rotate(${(fxRand() - .5) * 10}deg)`, opacity: 1, offset: .2 },
      { transform: `translateY(${180 + fxRand() * 120}px) rotate(${(fxRand() - .5) * 70}deg)`, opacity: 0 }], 700 + i * 60);
    setTimeout(() => { if (el.isConnected) el.style.opacity = '0'; }, 680 + i * 60);
  }
  $('game').classList.add('lost');
}
// ── Hand: dealing, hint hop, money and stock entrances ──
function dealFx(row) {
  const pile = $('deckPile');
  const dealt = row.querySelectorAll('.card.dealt');
  if (!dealt.length) return;
  for (const el of dealt) el.addEventListener('animationend', e => { if (e.animationName === 'cardDeal') el.classList.remove('dealt'); });
  if (!pile || !pile.getClientRects().length) return;
  const from = centerOf(pile);
  for (const el of dealt) {
    const to = centerOf(el);
    el.style.setProperty('--dx', (from.x - to.x).toFixed(1) + 'px');
    el.style.setProperty('--dy', (from.y - to.y).toFixed(1) + 'px');
  }
  feedback(pile, [{ transform: 'translateY(0)' }, { transform: 'translateY(-4px) rotate(-3deg)', offset: .3 }, { transform: 'translateY(0)' }], 260);
}
function hintFx(ids) {
  if (!motionAllowed()) return;
  ids.forEach((id, i) => {
    const el = handCardEl(id);
    if (!el) return;
    feedback(el, [{ transform: 'translateY(0)' }, { transform: 'translateY(-16px) scale(1.06)', offset: .45 }, { transform: 'translateY(0)' }], 300 + i * 40);
    const c = centerOf(el); setTimeout(() => sparkBurst(c.x, c.r.y, { count: 5, tone: 'gold', spread: 30, size: 4, scoring: false }), i * 40);
  });
}
function trackMoney() {
  const before = moneyShown.run === S ? moneyShown.value : null;
  moneyShown = { run: S, value: S.money };
  if (before === null || before === S.money || activeDialog()) return;
  const c = centerOf($('moneyVal')), diff = S.money - before;
  floatText(c.x, c.y, (diff > 0 ? '+$' : '-$') + Math.abs(diff), diff > 0 ? 'money' : 'mult');
  feedback($('moneyVal'), [{ transform: 'scale(1)' }, { transform: 'scale(1.3)', offset: .3 }, { transform: 'scale(1)' }], 260);
}
function shopEnterFx() {
  const stock = S.shop ? [...S.shop.jokers, ...S.shop.cons].map(i => i.id || i.key).join() + '|' + S.shop.packs.map(p => p.id).join() : '';
  if (stock === lastShopStock) return;
  lastShopStock = stock;
  if (!motionAllowed()) return;
  for (const panel of ['shopItems', 'shopPacks', 'shopVouch'])
    [...$(panel).children].forEach((el, i) => feedback(el, [
      { transform: 'perspective(700px) rotateY(80deg) translateY(16px) scale(.9)', opacity: 0 },
      { transform: 'perspective(700px) rotateY(-8deg) translateY(-3px) scale(1.02)', opacity: 1, offset: .65 },
      { transform: 'none', opacity: 1 }], 380 + (i % 2) * 90));
}
// ── Pointer play: swipe across cards to select, tilt and glare on fine pointers ──
(function installHandPointer() {
  const row = $('handRow');
  const cardOf = el => S?.hand.find(c => c.id === Number(el.dataset.cardId));
  const apply = el => { const c = cardOf(el); if (c) toggleHandCard(c, el, swipe.want); };
  row.addEventListener('pointerdown', e => {
    const el = e.target.closest('.card');
    if (!el || !S || S.busy || S.screen !== 'play' || e.button > 0) return;
    swipe = { pointer: e.pointerId, start: el, want: null, seen: new Set([el]) };
  });
  addEventListener('pointermove', e => {
    if (!swipe || e.pointerId !== swipe.pointer) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('#handRow .card');
    if (!el || swipe.seen.has(el)) return;
    if (swipe.want === null) { const first = cardOf(swipe.start); if (!first) return; swipe.want = !first.sel; hideTip(); apply(swipe.start); }
    swipe.seen.add(el); apply(el);
  });
  const end = () => { if (swipe?.want !== null && swipe) swipeClickBlock = Date.now() + 400; swipe = null; };
  addEventListener('pointerup', end); addEventListener('pointercancel', () => { swipe = null; });
  row.addEventListener('click', e => { if (Date.now() < swipeClickBlock) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  // A sideways drag that starts on a card belongs to the swipe from its first move; the browser must
  // not turn it into a scroll or fling, otherwise Chrome swallows the next tap to stop that fling.
  // Mostly vertical drags still scroll the table.
  let touchStart = null;
  row.addEventListener('touchstart', e => {
    const t = e.touches[0];
    touchStart = e.touches.length === 1 && e.target.closest('.card') ? { x: t.clientX, y: t.clientY, mode: null } : null;
  }, { passive: true });
  row.addEventListener('touchmove', e => {
    if (!touchStart || !e.cancelable) return;
    const t = e.touches[0], dx = Math.abs(t.clientX - touchStart.x), dy = Math.abs(t.clientY - touchStart.y);
    if (!touchStart.mode && dx + dy > 3) touchStart.mode = dx >= dy ? 'swipe' : 'scroll';
    if (touchStart.mode === 'swipe') e.preventDefault();
  }, { passive: false });
  if (!matchMedia('(hover:hover) and (pointer:fine)').matches) return;
  let frame = 0;
  row.addEventListener('pointermove', e => {
    const el = e.target.closest('.card');
    if (!el || e.pointerType !== 'mouse') return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const r = el.getBoundingClientRect(), px = (e.clientX - r.x) / r.width, py = (e.clientY - r.y) / r.height;
      el.style.setProperty('--ry', ((px - .5) * 16).toFixed(1) + 'deg'); el.style.setProperty('--rx', ((.5 - py) * 14).toFixed(1) + 'deg');
      el.style.setProperty('--gx', (px * 100).toFixed(0) + '%'); el.style.setProperty('--gy', (py * 100).toFixed(0) + '%');
    });
  });
  row.addEventListener('pointerout', e => {
    const el = e.target.closest('.card');
    if (el && !el.contains(e.relatedTarget)) for (const v of ['--rx', '--ry']) el.style.removeProperty(v);
  });
})();
// ── Title ambience: drifting suit motes ──
(function installTitleMotes() {
  const host = $('ovStart');
  if (!host || host.querySelector('.titleMotes')) return;
  const layer = document.createElement('div'); layer.className = 'titleMotes'; layer.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 16; i++) {
    const m = document.createElement('i');
    m.textContent = SUITS[i % 4]; m.className = RED(i % 4) ? 'red' : '';
    m.style.cssText = `--x:${(fxRand() * 100).toFixed(1)}%;--d:${(9 + fxRand() * 9).toFixed(1)}s;--delay:${(-fxRand() * 18).toFixed(1)}s;--s:${(14 + fxRand() * 18).toFixed(0)}px;--sway:${((fxRand() - .5) * 60).toFixed(0)}px`;
    layer.append(m);
  }
  host.prepend(layer);
})();
