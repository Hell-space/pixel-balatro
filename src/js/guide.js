function openChart() {
  let h = '';
  const ex = { flushfive:'同花色 5 张同点数',flushhouse:'同花色的葫芦',five:'AAAAA',sf:'♥5♥6♥7♥8♥9', four:'8888+x', fh:'QQQ+55', flush:'5 张同花色', straight:'5 张连续点数', trips:'JJJ+xy', twopair:'KK+33+x', pair:'99+xyz', high:'其余情况' };
  HORDER.forEach(k => {
    const b = handBase(k);
    h += '<article class="handLedgerRow"><div><b>'+HANDS[k].name+'</b><span>'+b.lv+' 级</span></div>'+
      '<strong><span class="ledgerChips">'+fmt(b.chips)+'</span> × <span class="ledgerMult">'+fmtM(b.mult)+'</span></strong>'+
      '<p>'+ex[k]+'</p><small>本局 '+S.playCounts[k]+' 次</small></article>';
  });
  $('chartBody').innerHTML = h;
  show('ovChart');
}
function openInfo() {
  if (!S) return;
  const metrics=[['金币','$'+fmt(S.money)],['最高单次',fmt(S.bestHand)],['总出牌',S.totHands],['手牌上限',S.handSize],
    ['牌组张数',S.deckAll.length],['已用星球',S.planetsUsed],['已加入牌',S.cardsAdded],['出牌 / 盲注',S.baseHands],
    ['弃牌 / 盲注',S.baseDisc],['利息上限','$'+S.interestCap],['本底注 Boss',S.anteBoss.name+' · '+bossWeakLabel(S.anteBoss)]];
  if(!MP.on)metrics.push(['工坊免费次数',S.workshopCredits],['出牌节奏',(RHYTHMS.find(r=>r.id===S.rhythmMode)||RHYTHMS[0]).name]);
  let h='<div class="runIdentity"><b>'+(DECKS.find(d=>d.id===S.deckId)?.name||'经典牌组')+'</b><span>'+
    (STAKES.find(t=>t.id===S.stakeId)?.name||'白注')+'</span></div><div class="runMetrics">'+metrics.map(([label,value])=>
    '<div><span>'+label+'</span><b>'+value+'</b></div>').join('')+'</div><h3 class="infoHeading">优惠券</h3>';
  h+=S.vouchers.length?S.vouchers.map(id=>{const v=VOUCHERS.find(x=>x.id===id);return '<article class="voucherRow"><b>'+v.ic+' '+v.name+'</b><p>'+v.desc+'</p></article>';}).join(''):'<p class="emptyInfo">暂无优惠券</p>';
  $('infoBody').innerHTML = h;
  show('ovInfo');
}
let deckFilter='all';
function openDeck() {
  deckFilter='all';const filters=$('deckSuitFilters');filters.replaceChildren();
  for(const value of ['all','0','1','2','3']) {
    const button=document.createElement('button');button.dataset.suit=value;
    button.innerHTML=value==='all'?'全部':suitSVG({suit:Number(value)});
    button.setAttribute('aria-label',value==='all'?'全部花色':['黑桃','红桃','梅花','方块'][Number(value)]);
    button.setAttribute('aria-pressed',String(value==='all'));
    if(value==='1'||value==='3')button.className='suitRed';
    button.onclick=()=>{
      deckFilter=value;
      for(const other of filters.children)other.setAttribute('aria-pressed',String(other.dataset.suit===value));
      renderDeckGrid();
    };filters.append(button);
  }
  renderDeckGrid();show('ovDeck');
}
function renderDeckGrid() {
  const g = $('deckGrid');
  const stored=reserveCard();
  $('deckSummary').innerHTML='<span>待抽 <b>'+S.drawPile.length+'</b></span><span>手牌 <b>'+S.hand.length+'</b></span>'+
    (stored?'<span>底牌 <b>'+cardLabel(stored)+'</b></span>':'')+'<span>牌组 <b>'+S.deckAll.length+'</b></span>';
  g.innerHTML='';
  const inPile = new Set(S.drawPile.map(c => c.id));
  for (let s = 0; s < 4; s++) {
    if(deckFilter!=='all'&&Number(deckFilter)!==s)continue;
    let cells='';
    for (const r of [14,13,12,11,10,9,8,7,6,5,4,3,2]) {
      const cards = S.deckAll.filter(c => c.suit === s && c.rank === r);
      const live = cards.filter(c => inPile.has(c.id)).length;
      const reserved=cards.some(c=>c.id===stored?.id);
      cells+='<div class="deckCell '+(!cards.length?'absent':live?'':'gone')+(reserved?' reserved':'')+'" aria-label="'+
        ['黑桃','红桃','梅花','方块'][s]+rankName(r)+'，待抽 '+live+'，共 '+cards.length+(reserved?'，含底牌':'')+'">'+
        '<b>'+rankName(r)+'</b><span>'+(!cards.length?'—':live+'/'+cards.length)+(reserved?' 底':'')+'</span></div>';
    }
    g.innerHTML+='<section class="deckSuitBlock"><h3 class="'+(RED(s)?'suitRed':'')+'">'+suitSVG({suit:s})+['黑桃','红桃','梅花','方块'][s]+'</h3><div class="deckRanks">'+cells+'</div></section>';
  }
}

// ================= 新手教程 =================
const TUT = [
  { sel: null, title: '🃏 欢迎来到像素小丑牌！', body:
    '这是一款<b class="gold">用扑克牌得分</b>的 Roguelike 游戏。<br>核心循环：<b class="blue">打出牌型得分 → 击败盲注 → 拿钱进商店买小丑牌变强 → 挑战更高的底注</b>。<br>撑过 8 个底注即通关！我们一步步来看。' },
  { sel: '#handRow', title: '1️⃣ 你的手牌', body:
    '本局手牌上限为 <b class="gold">{handSize} 张牌</b>。<br>点击卡牌可以<b class="blue">选中（最多 5 张）</b>，再点一次取消；<b class="gold">按住滑过多张牌</b>可一次选中，长按可看牌面效果。<br>参与计分的选中牌会发光。「✦ 推荐」按钮会选出本手保底得分最高的组合。下方「按点数 / 按花色」可整理手牌。' },
  { sel: '#previewBox', title: '2️⃣ 牌型与预览', body:
    '选中牌后，这里会实时显示组成的<b class="gold">牌型</b>和计入小丑及牌面效果的预计分数。随机倍率会显示范围。<br>牌型从弱到强：高牌 → 对子 → 两对 → 三条 → 顺子 → 同花 → 葫芦 → 四条 → 同花顺。<br>随时点菜单中的「牌型表」查看完整数值。' },
  { sel: '#previewBox', title: '3️⃣ 得分公式（重点！）', body:
    '得分 = (<b class="blue">牌型基础筹码 + 牌面筹码</b>) × <b class="red">倍率</b><br>牌面筹码：数字牌=面值，J/Q/K=10，<b class="gold">A=11</b>。<br>例：打出 ♥K ♦K = 对子。基础 10 筹码 ×2 倍率，两张 K 各 +10 筹码<br>→ (10+10+10) × 2 = <b class="gold">60 分</b>。只有参与牌型的牌才计分！' },
  { sel: '#btnRow', title: '4️⃣ 出牌与弃牌', body:
    '<b class="blue">出牌</b>：打出选中的牌并计分，本局每个普通盲注有 <b class="gold">{hands} 次</b>。<br><b class="red">弃牌</b>：把选中的牌扔掉换新牌，<b class="gold">{discards} 次</b>机会，不计分。<br>用弃牌凑牌型；小丑构筑也能让高牌成为主力。' },
  { sel: '#blindBox', title: '5️⃣ 盲注（关卡）', body:
    '每个底注有 3 关：<b>🔸小盲注 → 🔶大盲注 → 💀Boss盲注</b>，目标分数越来越高。<br>Boss 有特殊规则（比如禁用某花色、只能出 1 手牌），选盲注时会提前展示。每个 Boss 还有一个<b class="red">🎯 破绽牌型</b>：在 Boss 盲注打出该牌型，最终倍率 ×1.5。<br><b class="gold">小盲/大盲可以跳过</b>，换一个标签奖励（半价商店、免费小丑等）；Boss 必须挑战。<br>在出牌次数耗尽前把「当前得分」刷过「目标分数」就赢！' },
  { sel: '#statsBox', title: '6️⃣ 金钱与利息', body:
    '击败盲注可获得：<b class="green">基础奖励($3~5) + 剩余出牌次数×$1 + 利息</b>。<br>利息 = 每持有 $5 得 $1（通常上限 $5）。绿色牌组改为每次剩余出牌 $2、弃牌 $1，没有利息。<br><b class="gold">碾压奖励</b>：过关时得分达到目标 2 倍 +$1，3 倍 +$2，4 倍及以上 +$3。' },
  { sel: '#jokerRow', title: '7️⃣ 小丑牌（构筑核心！）', body:
    '商店里买的<b class="gold">小丑牌</b>会显示在这里（本局 {jokerSlots} 个槽位），出牌时自动触发：加筹码、加倍率、甚至 <b class="red">×倍率</b>！<br>比如「快乐小丑」：牌型含对子就 +8 倍率。<br>把小丑和你常打的牌型搭配起来。点击小丑可查看效果、调整左右顺序或卖出。' },
  { sel: '#consRow', title: '8️⃣ 星球牌与塔罗牌', body:
    '商店还卖两种消耗牌，买了存在这里，点击使用：<br><b class="blue">🌌 星球牌</b>：永久提升某个牌型的等级（筹码和倍率都涨）。<br><b class="gold">🔮 塔罗牌</b>：强化手牌（钢铁/玻璃/黄金/百搭花色等）、复制、销毁牌、变钱。百搭花色不改变点数，仍需相同点数组成对子。<br>商店里还有 <b class="blue">🎁 卡包</b>和 <b class="gold">🎟️ 优惠券</b>（$10 永久强化，如 +1 出牌次数）！' },
  { sel: null, title: '底牌与主动构筑', body:
    '单人每盲可用一次<b class="gold">袖中底牌</b>：牌桌上点「底牌」，藏一张手牌并补一张，之后可选一张换回。底牌不触发留手效果，不耗弃牌次数。<br>盲注前「备战」可选节奏和悬赏；商店「工坊」可指定删牌、复制或强化；击败 Boss 后选择一次战利品。' },
  { sel: null, title: '实战建议', body:
    '① 前期优先买小丑牌，别裸奔打分。<br>② 认准 1~2 个主力牌型（如同花/顺子），星球牌全升它。<br>③ 弃牌是资源：先弃散牌凑型，最后一手再梭哈。<br>④ Boss 禁用花色时提前看牌库（🂠）调整思路。<br><br>教程结束！菜单中的「新手教程」可随时重看。祝你好运，小丑！🎉' },
];
let tutI = 0, tutHl = null;
function tutStart() {
  if (!S) return;
  tutI = 0;
  $('tutDim').style.display = 'block';
  $('tutBox').style.display = 'block';
  tutShow();
}
function tutShow() {
  const t = TUT[tutI];
  if (tutHl) { tutHl.classList.remove('tut-hl'); tutHl = null; }
  if (t.sel) {
    const el = document.querySelector(t.sel);
    if (el) { el.classList.add('tut-hl'); tutHl = el; }
  }
  $('tutTitle').textContent = t.title;
  $('tutBody').innerHTML = t.body.replace('{hands}',S.baseHands).replace('{discards}',S.baseDisc)
    .replace('{handSize}',effHandSize()).replace('{jokerSlots}',S.jokerSlots);
  $('tutStep').textContent = (tutI + 1) + ' / ' + TUT.length;
  $('tutPrev').style.visibility = tutI === 0 ? 'hidden' : 'visible';
  $('tutNext').textContent = tutI === TUT.length - 1 ? '完成 ✓' : '下一步';
  $('tutBody').scrollTop=0;
  positionGuide();
}
function positionGuide() {
  const panel=$('tutBox');
  if (panel.style.display!=='block') return;
  const target=tutHl?.getBoundingClientRect();
  const above=(target?.top || 0)-20, below=target ? innerHeight-target.bottom-20 : innerHeight-24;
  const useTop=!!target && above>below;
  panel.classList.toggle('guideTop',useTop);
  panel.style.setProperty('--guide-room',Math.max(135,Math.min(innerHeight-24,useTop?above:below))+'px');
}
addEventListener('resize',positionGuide);
function tutMove(d) {
  tutI += d;
  if (tutI >= TUT.length) return tutEnd();
  if (tutI < 0) tutI = 0;
  tutShow();
  sfxSel();
}
function tutEnd() {
  if (tutHl) { tutHl.classList.remove('tut-hl'); tutHl = null; }
  $('tutDim').style.display = 'none';
  $('tutBox').style.display = 'none';
}
