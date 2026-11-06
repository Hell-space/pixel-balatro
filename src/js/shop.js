const PACKS = [
  { id:'arcana',   ic:'🔮', name:'秘术包', price:4, desc:'3 选 1 塔罗牌，放入消耗槽' },
  { id:'celestial',ic:'🌌', name:'天体包', price:4, desc:'3 选 1 星球牌，立即使用' },
  { id:'buffoon',  ic:'🃏', name:'小丑包', price:5, desc:'2 选 1 小丑牌' },
  { id:'standard', ic:'🂡', name:'标准包', price:4, desc:'3 选 1 强化扑克牌，永久加入牌组' },
  { id:'spectral', ic:'👻', name:'幽灵包', price:6, desc:'2 选 1 幻灵牌，立即生效' },
];
function rollJokerItem(forceUnc) {
  const owned = new Set(S.jokers.map(j => j.id));
  let pool = JDEFS.filter(j => !owned.has(j.id));
  if (forceUnc) pool = pool.filter(j => j.rar >= 1);
  if (!pool.length) pool = JDEFS.slice();
  const r = Math.random();
  const want = forceUnc ? (r < 0.75 ? 1 : 2) : (r < 0.7 ? 0 : r < 0.95 ? 1 : 2);
  let sub = pool.filter(j => j.rar === want);
  if (!sub.length) sub = pool;
  const def = { ...randOf(sub), sold: false, ed: 0 };
  const e = Math.random();
  if (e < 0.04) { def.ed = 3; def.price += 4; }
  else if (e < 0.10) { def.ed = 2; def.price += 3; }
  else if (e < 0.17) { def.ed = 1; def.price += 2; }
  return def;
}
function addJoker(def) {
  S.jokers.push({ ...def, uid: ++cid, state: def.state || 0,
    sell: Math.max(1, Math.ceil((def.price || 4) / 2)) });
}
function shopPrice(base) {
  if (base <= 0) return 0;
  return Math.max(1, Math.ceil(base * S.shop.disc));
}
function genShopMain() {
  S.shop.jokers = [rollJokerItem(S.shop.unc), rollJokerItem(S.shop.unc)];
  if (S.shop.unc && !S.shop.freeUsed) S.shop.jokers[0].price = 0;
  S.shop.cons = [
    { ...randOf(availablePlanets()), kind: 'planet', price: 3, sold: false },
    { ...randOf(TAROTS), kind: 'tarot', price: 3, sold: false },
  ];
}
function openShop() {
  if(S.screen!=='cash') return;
  hide('ovCash');
  S.shop = {
    disc: S.discount * (S.nextShopHalf ? 0.5 : 1),
    unc: S.nextShopUnc, freeUsed: false,
    rerollCost: S.rerollBase, voucherSold: false,
    packs: [],
  };
  if (S.nextShopHalf) msg('🏷️ 优惠标签生效：本商店全场半价！');
  if (S.nextShopUnc) msg('🃏 珍稀标签生效：小丑全为罕见以上，第一张免费！');
  S.nextShopHalf = false; S.nextShopUnc = false;
  genShopMain();
  const pp = shuffle(PACKS.slice());
  S.shop.packs = [{ ...pp[0], sold: false }, { ...pp[1], sold: false }];
  S.screen = 'shop';
  renderShop();
  show('ovShop');
  mpSendState();
}
function shopItemEl(it, price, extraCls, tipFn, onBuy) {
  const d = document.createElement('button');
  d.disabled=!!it.sold;
  d.className = 'shopItem' + (extraCls || '') + (it.sold ? ' sold' : '') + (S.money < price ? ' noafford' : '');
  d.style.position = 'relative';
  d.innerHTML = '<div class="ic">' + it.ic + '</div><div class="nm">' + it.name + '</div>' +
    '<div class="ds">' + (it.descShow || it.desc || '') + '</div>' +
    '<div class="pr">' + (it.sold ? '已购买' : price === 0 ? '免费' : '$' + price) + '</div>' +
    (it.ed ? '<span class="edfx ' + ['', 'f', 'h', 'p'][it.ed] + '"></span>' : '');
  if (tipFn) bindTip(d, tipFn);
  d.onclick = onBuy;
  return d;
}
function renderShop() {
  hideTip();
  $('shopMoney').textContent = '$' + S.money;
  $('shopSlots').textContent = S.jokers.length + '/' + S.jokerSlots;
  $('shopCons').textContent = S.cons.length + '/' + S.consSlots;
  $('rerollBtn').textContent = '🎲 刷新 $' + S.shop.rerollCost;
  const box = $('shopItems');
  box.innerHTML = '';
  S.shop.jokers.forEach((j, i) => {
    box.appendChild(shopItemEl(j, shopPrice(j.price),
      j.rar === 1 ? ' ru' : j.rar === 2 ? ' rr' : '',
      () => '<span class="tn">' + j.ic + ' ' + j.name + '</span> <span class="tr rc' + j.rar + '">[' + RARNAME[j.rar] + ']</span>' +
        (j.ed ? '<br><span class="tr">' + EDNAME[j.ed] + '</span>' : '') + '<br>' + j.desc,
      () => buyJoker(i)));
  });
  S.shop.cons.forEach((t, i) => {
    t.descShow = t.kind === 'planet' ? HANDS[t.key].name + ' 牌型永久升 1 级' : t.desc;
    box.appendChild(shopItemEl(t, shopPrice(t.price), '', null, () => buyCons(i)));
  });
  const pb = $('shopPacks');
  pb.innerHTML = '';
  S.shop.packs.forEach((p, i) => {
    pb.appendChild(shopItemEl(p, shopPrice(p.price), '', null, () => buyPack(i)));
  });
  const vb = $('shopVouch');
  vb.innerHTML = '';
  if (S.anteVoucher && !S.shop.voucherSold && !S.vouchers.includes(S.anteVoucher.id)) {
    vb.appendChild(shopItemEl(S.anteVoucher, shopPrice(10), ' ru', null, buyVoucher));
  } else {
    vb.innerHTML = '<p style="color:#556;font-size:12px">' +
      (S.anteVoucher ? '本底注的优惠券已购买 ✔' : '优惠券已全部收集！') + '</p>';
  }
  renderInventory($('shopOwned'));
  renderJokers(); renderCons(); renderStats();
}
function buyJoker(i) {
  const j = S.shop.jokers[i];
  if (j.sold) return;
  const p = shopPrice(j.price);
  if (S.jokers.length >= S.jokerSlots) { msg('小丑槽位已满！点自己的小丑两次可卖出', 1); return; }
  if (S.money < p) { msg('钱不够！', 1); return; }
  S.money -= p;
  if (j.price === 0) S.shop.freeUsed = true;
  j.sold = true;
  addJoker(j);
  sfxCash();
  renderShop();
}
function buyCons(i) {
  const t = S.shop.cons[i];
  if (t.sold) return;
  const p = shopPrice(t.price);
  if (S.money < p) { msg('钱不够！', 1); return; }
  if (S.cons.length >= S.consSlots) {
    msg('消耗牌槽位已满（' + S.cons.length + '/' + S.consSlots + '）！先使用或卖出持有的消耗牌', 1);
    return;
  }
  S.money -= p;
  t.sold = true;
  S.cons.push({ ...t });
  sfxCash();
  renderShop();
}
function buyVoucher() {
  const v = S.anteVoucher;
  if(!v || S.shop.voucherSold || S.vouchers.includes(v.id)) return;
  const p = shopPrice(10);
  if (S.money < p) { msg('钱不够！', 1); return; }
  S.money -= p;
  S.shop.voucherSold = true;
  S.vouchers.push(v.id);
  switch (v.id) {
    case 'grabber': S.baseHands++; break;
    case 'wasteful': S.baseDisc++; break;
    case 'paint': S.handSize++; break;
    case 'anti': S.jokerSlots++; break;
    case 'crystal': S.consSlots++; break;
    case 'seed': S.interestCap = 10; break;
    case 'surplus': S.shop.rerollCost=Math.max(0,S.shop.rerollCost-(S.rerollBase-3)); S.rerollBase=3; break;
    case 'sale': S.shop.disc*=.75/S.discount; S.discount=.75; break;
  }
  sfxUp();
  msg('🎟️ ' + v.name + '：' + v.desc + '（永久生效）');
  renderShop();
}
function doReroll() {
  if (S.money < S.shop.rerollCost) { msg('钱不够刷新！', 1); return; }
  S.money -= S.shop.rerollCost;
  S.shop.rerollCost += 2;
  genShopMain();
  sfxCash();
  renderShop();
}
function leaveShop() {
  if(S.screen!=='shop' || S.pack) return;
  hide('ovShop');
  S.shop = null;
  S.blindIdx++;
  if (S.blindIdx > 2) { S.blindIdx = 0; S.ante++; rollAnte(); }
  showBlindSelect();
}

// ================= 卡包 =================
function buyPack(i) {
  const p=S.shop.packs[i];
  if(p.sold || S.pack) return;
  const cost=shopPrice(p.price);
  if(S.money<cost) return msg('钱不够！',1);
  if(!p.options) p.options=packOptions(p.id);
  S.money-=cost; p.sold=true;
  S.pack={index:i,type:p.id,cost,options:p.options};
  sfxCash(); renderShop(); openPackUI(); persistRun();
}
function availablePlanets() {
  return PLANETS.filter(p=>!['five','flushhouse','flushfive'].includes(p.key) || S.playCounts[p.key]>0);
}
function randCard() {
  const c = { id: ++cid, suit: Math.floor(Math.random() * 4), rank: 2 + Math.floor(Math.random() * 13),
    bonus: 0, multB: 0, wild: false, steel: false, glass: false, goldc: false, ed: 0, seal: null };
  const r = Math.random();
  if (r < 0.55) {
    const k = randOf(['bonus', 'multB', 'wild', 'steel', 'glass', 'goldc']);
    if (k === 'bonus') c.bonus = 30; else if (k === 'multB') c.multB = 4; else c[k] = true;
  }
  if (Math.random() < 0.2) c.seal = Math.random() < 0.5 ? 'red' : 'gold';
  if (Math.random() < 0.15) c.ed = 1 + Math.floor(Math.random() * 3);
  return c;
}
function packOptions(type) {
  const unique=(pool,n)=>shuffle(pool.slice()).slice(0,n).map(x=>({...x}));
  if(type==='arcana') return unique(TAROTS,3);
  if(type==='celestial') return unique(availablePlanets(),3);
  if(type==='buffoon') {
    const a=rollJokerItem(false);
    let b=rollJokerItem(false);
    if(b.id===a.id) b={...randOf(JDEFS.filter(j=>j.id!==a.id)),sold:false,ed:0};
    return [a,b];
  }
  if(type==='standard') return [randCard(),randCard(),randCard()];
  return unique(SPECTRALS,2);
}
function openPackUI() {
  const pack=S.pack;
  if(!pack) return;
  const definition=PACKS.find(p=>p.id===pack.type);
  $('packTitle').textContent=definition.ic+' '+definition.name;
  $('packHint').textContent=definition.desc;
  const box=$('packCards'); box.replaceChildren();
  pack.options.forEach((option,i)=>{
    const button=document.createElement('button'); button.className='pk shopItem';
    if(pack.type==='standard') {
      button.append(cardEl(option));
      const desc=document.createElement('div'); desc.className='pkds';
      desc.innerHTML=cardTipHTML(option); button.append(desc);
    } else {
      button.innerHTML='<div class="ic">'+option.ic+'</div><div class="nm">'+option.name+
        '</div><div class="pkds">'+(pack.type==='celestial'?HANDS[option.key].name+' 升 1 级':option.desc)+
        (option.ed?'<br>'+EDNAME[option.ed]:'')+'</div>';
    }
    button.onclick=()=>pickPack(i);
    box.append(button);
  });
  show('ovPack');
}
function pickPack(i) {
  const pack=S.pack, option=pack?.options[i];
  if(!option) return;
  if(pack.type==='arcana') {
    if(S.cons.length>=S.consSlots) return msg('消耗牌槽位已满，可取消并整理后重开。',1);
    S.cons.push({...option,kind:'tarot',price:3});
  } else if(pack.type==='celestial') { S.levels[option.key]++; S.planetsUsed++; }
  else if(pack.type==='buffoon') {
    if(S.jokers.length>=S.jokerSlots) return msg('小丑槽位已满，可取消并整理后重开。',1);
    addJoker(option);
  } else if(pack.type==='standard') { S.deckAll.push(option); S.cardsAdded++; }
  else if(!useSpectral(option)) return;
  sfxUp(); closePack(true);
}
function closePack(picked=false) {
  if(!S.pack) return;
  const pack=S.pack;
  if(!picked) {
    S.money+=pack.cost; S.shop.packs[pack.index].sold=false;
    msg('已退回 $'+pack.cost+'，卡包保留原候选。');
  }
  S.pack=null;
  hideTip(); hide('ovPack'); renderShop(); persistRun();
}
function useSpectral(sp) {
  switch (sp.id) {
    case 'soul': {
      if (S.jokers.length >= S.jokerSlots) { msg('小丑槽位已满！', 1); return false; }
      const owned = new Set(S.jokers.map(j => j.id));
      let pool = JDEFS.filter(j => j.rar === 2 && !owned.has(j.id));
      if (!pool.length) pool = JDEFS.filter(j => !owned.has(j.id));
      if(!pool.length) return false;
      const def = randOf(pool);
      addJoker({ ...def });
      msg('👻 灵魂赐予你：' + def.name + '！');
      return true;
    }
    case 'bhole':
      HORDER.forEach(k => S.levels[k]++);
      S.planetsUsed++;
      updatePreview();
      msg('🕳️ 黑洞：所有牌型等级 +1！');
      return true;
    case 'talis': case 'dejavu': {
      const c = randOf(S.deckAll);
      if(!c) { msg('牌组中没有可强化的牌。',1); return false; }
      c.seal = sp.id === 'talis' ? 'gold' : 'red';
      msg(sp.ic + ' ' + rankName(c.rank) + (c.wild ? '🌈' : SUITS[c.suit]) + ' 获得了' + (sp.id === 'talis' ? '金' : '红') + '蜡封！');
      return true;
    }
  }
  return false;
}

// ================= 消耗牌 =================
let consLock = 0;
function useCons(i) {
  if (S.busy || !['play','shop','select'].includes(S.screen)) return;
  const t = S.cons[i];
  if (!t || Date.now() - consLock < 300) return;  // 防止双击连用两张
  consLock = Date.now();
  if (t.kind === 'planet') {
    S.levels[t.key]++;
    S.planetsUsed++;
    sfxUp();
    msg(t.ic + ' ' + HANDS[t.key].name + ' 升到 ' + S.levels[t.key] + ' 级！');
    S.cons.splice(i, 1);
    renderCons(); updatePreview(); if (S.shop) renderShop(); persistRun();
    return;
  }
  // 塔罗：id -> [最少选牌, 最多选牌]
  const NEED = { magician:[1,2], empress:[1,2], lovers:[1,1], death:[2,2], tower:[1,2],
                 devil:[1,1], chariot:[1,1], justice:[1,1], sun:[1,3], world:[1,3] };
  const sel = S.hand.filter(c => c.sel);
  if (NEED[t.id]) {
    if (S.screen !== 'play') { msg('这张塔罗牌需要在对局中选中手牌后使用', 1); return; }
    const [lo, hi] = NEED[t.id];
    if (sel.length < lo || sel.length > hi) {
      msg(t.name + '：请先选中' + (lo === hi ? '恰好 ' + lo : ' ' + lo + '~' + hi) + ' 张牌', 1); return;
    }
  }
  const clearEnh = c => { c.bonus = 0; c.multB = 0; c.steel = c.glass = c.goldc = false; };
  switch (t.id) {
    case 'magician': sel.forEach(c => c.bonus += 30); break;
    case 'empress': sel.forEach(c => { clearEnh(c); c.multB = 4; }); break;
    case 'lovers': sel[0].wild = true; break;
    case 'death': {
      const [a, b] = sel;
      a.rank = b.rank; a.suit = b.suit; a.bonus = b.bonus; a.multB = b.multB; a.wild = b.wild;
      a.steel = b.steel; a.glass = b.glass; a.goldc = b.goldc; a.ed = b.ed; a.seal = b.seal;
      break;
    }
    case 'tower':
      sel.forEach(c => {
        S.deckAll = S.deckAll.filter(x => x.id !== c.id);
        S.hand = S.hand.filter(x => x.id !== c.id);
      });
      break;
    case 'hermit': S.money = Math.min(S.money * 2, S.money + 20); break;
    case 'judge': {
      if (S.jokers.length >= S.jokerSlots) { msg('小丑槽位已满，无法使用审判', 1); return; }
      const owned = new Set(S.jokers.map(j => j.id));
      const pool = JDEFS.filter(j => !owned.has(j.id));
      const j = randOf(pool);
      if(!j) return;
      addJoker({ ...j });
      msg('⚖️ 审判赐予你：' + j.name + '！');
      break;
    }
    case 'devil': clearEnh(sel[0]); sel[0].goldc = true; break;
    case 'chariot': clearEnh(sel[0]); sel[0].steel = true; break;
    case 'justice': clearEnh(sel[0]); sel[0].glass = true; break;
    case 'sun': sel.forEach(c => { c.suit = 1; c.wild = false; }); break;
    case 'world': sel.forEach(c => { c.suit = 0; c.wild = false; }); break;
    case 'emperor': {
      let got = 0;
      while (S.cons.length < S.consSlots + 1 && got < 2) {  // +1：自己占的槽即将释放
        S.cons.push({ ...randOf(TAROTS), kind: 'tarot', price: 3 });
        got++;
      }
      if (!got) { msg('消耗牌槽位已满！', 1); return; }
      msg('🤴 皇帝赐予你 ' + got + ' 张塔罗牌！');
      break;
    }
  }
  sfxTarot();
  S.cons.splice(i, 1);
  S.hand.forEach(c => c.sel = false);
  renderAll(); if (S.shop) renderShop();
  if(t.id==='tower') { drawTo(effHandSize()); renderHand(); checkStuck(); }
  persistRun();
  if (t.id !== 'judge' && t.id !== 'emperor') msg(t.ic + ' ' + t.name + ' 已生效！');
}
