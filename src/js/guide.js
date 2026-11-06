function openChart() {
  let h = '<table><tr><th>牌型</th><th>等级</th><th>筹码 × 倍率</th><th>本局打出</th><th>示例</th></tr>';
  const ex = { flushfive:'同花色 5 张同点数',flushhouse:'同花色的葫芦',five:'AAAAA',sf:'♥5♥6♥7♥8♥9', four:'8888+x', fh:'QQQ+55', flush:'5 张同花色', straight:'5 张连续点数', trips:'JJJ+xy', twopair:'KK+33+x', pair:'99+xyz', high:'其余情况' };
  HORDER.forEach(k => {
    const b = handBase(k);
    h += '<tr><td class="hn">' + HANDS[k].name + '</td><td>' + b.lv + '</td><td>' + b.chips + ' × ' + b.mult + '</td><td>' + S.playCounts[k] + '</td><td>' + ex[k] + '</td></tr>';
  });
  $('chartBody').innerHTML = h + '</table>';
  show('ovChart');
}
function openInfo() {
  if (!S) return;
  let h = '<p style="text-align:left">💰 金钱 <b class="gold">$' + S.money + '</b>　🏆 最高单次 <b class="gold">' + fmt(S.bestHand) + '</b>　🃏 总出牌 <b class="blue">' + S.totHands + '</b></p>' +
    '<p style="text-align:left">🎴 手牌上限 <b>' + S.handSize + '</b>　🂠 牌组张数 <b>' + S.deckAll.length + '</b>　🌌 已用星球 <b>' + S.planetsUsed + '</b>　➕ 已加入牌 <b>' + S.cardsAdded + '</b></p>' +
    '<p style="text-align:left">🃏 出牌/盲注 <b>' + S.baseHands + '</b>　🗑️ 弃牌/盲注 <b>' + S.baseDisc + '</b>　利息上限 <b class="green">$' + S.interestCap + '</b></p>' +
    '<p style="text-align:left;color:#57e6ff;margin-top:8px">🎟️ 已拥有的优惠券：</p>';
  if (S.vouchers.length) {
    h += '<p style="text-align:left">' + S.vouchers.map(id => {
      const v = VOUCHERS.find(x => x.id === id);
      return v.ic + ' <span class="gold">' + v.name + '</span> — ' + v.desc;
    }).join('<br>') + '</p>';
  } else h += '<p style="text-align:left;color:#667">还没有。商店里每个底注会出现一张 $10 优惠券，永久生效，值得投资！</p>';
  $('infoBody').innerHTML = h;
  show('ovInfo');
}
function openDeck() {
  const g = $('deckGrid');
  g.innerHTML = '<div class="hd">花色</div>' + [14,13,12,11,10,9,8,7,6,5,4,3,2].map(r => '<div class="hd">' + rankName(r) + '</div>').join('');
  const inPile = new Set(S.drawPile.map(c => c.id));
  for (let s = 0; s < 4; s++) {
    g.innerHTML += '<div class="hd" style="color:' + (RED(s) ? '#ff6b6b' : '#cdd6e0') + '">' + SUITS[s] + '</div>';
    for (const r of [14,13,12,11,10,9,8,7,6,5,4,3,2]) {
      const cards = S.deckAll.filter(c => c.suit === s && c.rank === r);
      const live = cards.filter(c => inPile.has(c.id)).length;
      g.innerHTML += '<div class="' + (live ? '' : 'gone') + '">' + (cards.length > 1 ? live + '/' + cards.length : (live ? '●' : '○')) + '</div>';
    }
  }
  show('ovDeck');
}

// ================= 新手教程 =================
const TUT = [
  { sel: null, title: '🃏 欢迎来到像素小丑牌！', body:
    '这是一款<b class="gold">用扑克牌得分</b>的 Roguelike 游戏。<br>核心循环：<b class="blue">打出牌型得分 → 击败盲注 → 拿钱进商店买小丑牌变强 → 挑战更高的底注</b>。<br>撑过 8 个底注即通关！我们一步步来看。' },
  { sel: '#handRow', title: '1️⃣ 你的手牌', body:
    '每回合手上有 <b class="gold">8 张牌</b>。<br>点击卡牌可以<b class="blue">选中（最多 5 张）</b>，再点一次取消；长按可看牌面效果。<br>下方「按点数 / 按花色」按钮可以整理手牌，找同花时很好用。' },
  { sel: '#previewBox', title: '2️⃣ 牌型与预览', body:
    '选中牌后，这里会实时显示组成的<b class="gold">牌型</b>和计入小丑及牌面效果的预计分数。随机倍率会显示范围。<br>牌型从弱到强：高牌 → 对子 → 两对 → 三条 → 顺子 → 同花 → 葫芦 → 四条 → 同花顺。<br>随时点菜单中的「牌型表」查看完整数值。' },
  { sel: '#previewBox', title: '3️⃣ 得分公式（重点！）', body:
    '得分 = (<b class="blue">牌型基础筹码 + 牌面筹码</b>) × <b class="red">倍率</b><br>牌面筹码：数字牌=面值，J/Q/K=10，<b class="gold">A=11</b>。<br>例：打出 ♥K ♦K = 对子。基础 10 筹码 ×2 倍率，两张 K 各 +10 筹码<br>→ (10+10+10) × 2 = <b class="gold">60 分</b>。只有参与牌型的牌才计分！' },
  { sel: '#btnRow', title: '4️⃣ 出牌与弃牌', body:
    '<b class="blue">出牌</b>：打出选中的牌并计分，每个盲注只有 <b class="gold">4 次</b>！<br><b class="red">弃牌</b>：把选中的牌扔掉换新牌，<b class="gold">3 次</b>机会，不计分。<br>策略核心：用弃牌凑大牌型，别浪费出牌次数打高牌！' },
  { sel: '#blindBox', title: '5️⃣ 盲注（关卡）', body:
    '每个底注有 3 关：<b>🔸小盲注 → 🔶大盲注 → 💀Boss盲注</b>，目标分数越来越高。<br>Boss 有特殊规则（比如禁用某花色、只能出 1 手牌），选盲注时会提前展示。<br><b class="gold">小盲/大盲可以跳过</b>，换一个标签奖励（半价商店、免费小丑等）；Boss 必须挑战。<br>在出牌次数耗尽前把「当前得分」刷过「目标分数」就赢！' },
  { sel: '#statsBox', title: '6️⃣ 金钱与利息', body:
    '击败盲注可获得：<b class="green">基础奖励($3~5) + 剩余出牌次数×$1 + 利息</b>。<br>利息 = 每持有 $5 得 $1（上限 $5）。<b class="gold">存钱到 $25 吃满利息</b>是常见运营思路。' },
  { sel: '#jokerRow', title: '7️⃣ 小丑牌（构筑核心！）', body:
    '商店里买的<b class="gold">小丑牌</b>会显示在这里（最多 5 张），出牌时自动触发：加筹码、加倍率、甚至 <b class="red">×倍率</b>！<br>比如「快乐小丑」：牌型含对子就 +8 倍率。<br>把小丑和你常打的牌型搭配起来，分数会滚雪球。点击小丑可查看效果、调整左右顺序或卖出。' },
  { sel: '#consRow', title: '8️⃣ 星球牌与塔罗牌', body:
    '商店还卖两种消耗牌，买了存在这里，点击使用：<br><b class="blue">🌌 星球牌</b>：永久提升某个牌型的等级（筹码和倍率都涨）。<br><b class="gold">🔮 塔罗牌</b>：强化手牌（钢铁/玻璃/黄金/万能等）、复制、销毁牌、变钱。<br>商店里还有 <b class="blue">🎁 卡包</b>（开包三选一）和 <b class="gold">🎟️ 优惠券</b>（$10 永久强化，如 +1 出牌次数）！' },
  { sel: null, title: '9️⃣ 实战建议', body:
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
  $('tutBody').innerHTML = t.body;
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
