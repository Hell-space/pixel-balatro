const SUITS = ['♠','♥','♣','♦'];
const RED = s => s === 1 || s === 3;
const RNAME = { 11:'J', 12:'Q', 13:'K', 14:'A' };
const rankName = r => RNAME[r] || r;
const chipVal = c => c.rank === 14 ? 11 : c.rank > 10 ? 10 : c.rank;

const HANDS = {
  flushfive:{ name:'同花五条', chips:160, mult:16, incC:50, incM:3 },
  flushhouse:{ name:'同花葫芦', chips:140, mult:14, incC:40, incM:4 },
  five:     { name:'五条', chips:120, mult:12, incC:35, incM:3 },
  sf:       { name:'同花顺', chips:100, mult:8, incC:40, incM:4 },
  four:     { name:'四条',   chips:60,  mult:7, incC:30, incM:3 },
  fh:       { name:'葫芦',   chips:40,  mult:4, incC:25, incM:2 },
  flush:    { name:'同花',   chips:35,  mult:4, incC:15, incM:2 },
  straight: { name:'顺子',   chips:30,  mult:4, incC:30, incM:3 },
  trips:    { name:'三条',   chips:30,  mult:3, incC:20, incM:2 },
  twopair:  { name:'两对',   chips:20,  mult:2, incC:20, incM:1 },
  pair:     { name:'对子',   chips:10,  mult:2, incC:15, incM:1 },
  high:     { name:'高牌',   chips:5,   mult:1, incC:10, incM:1 },
};
const HORDER = ['flushfive','flushhouse','five','sf','four','fh','flush','straight','trips','twopair','pair','high'];

const JDEFS = [
  { id:'joker',   ic:'🤡', name:'小丑',     price:4, rar:0, desc:'+4 倍率' },
  { id:'greedy',  ic:'🟠', name:'贪婪小丑', price:5, rar:0, desc:'每张计分的 ♦ +3 倍率' },
  { id:'lusty',   ic:'❤️', name:'色欲小丑', price:5, rar:0, desc:'每张计分的 ♥ +3 倍率' },
  { id:'wrath',   ic:'🗡️', name:'愤怒小丑', price:5, rar:0, desc:'每张计分的 ♠ +3 倍率' },
  { id:'glut',    ic:'🍀', name:'暴食小丑', price:5, rar:0, desc:'每张计分的 ♣ +3 倍率' },
  { id:'jolly',   ic:'😄', name:'快乐小丑', price:4, rar:0, desc:'牌型含对子 +8 倍率' },
  { id:'zany',    ic:'🤪', name:'狂热小丑', price:5, rar:0, desc:'牌型含三条 +12 倍率' },
  { id:'mad',     ic:'😠', name:'疯狂小丑', price:5, rar:0, desc:'牌型含两对 +10 倍率' },
  { id:'crazy',   ic:'🌀', name:'疯癫小丑', price:5, rar:0, desc:'牌型含顺子 +12 倍率' },
  { id:'droll',   ic:'🎭', name:'滑稽小丑', price:5, rar:0, desc:'牌型含同花 +10 倍率' },
  { id:'sly',     ic:'🦊', name:'狡猾小丑', price:4, rar:0, desc:'牌型含对子 +50 筹码' },
  { id:'clever',  ic:'🧠', name:'聪明小丑', price:5, rar:0, desc:'牌型含两对 +80 筹码' },
  { id:'devious', ic:'😈', name:'诡诈小丑', price:5, rar:0, desc:'牌型含顺子 +100 筹码' },
  { id:'crafty',  ic:'🛠️', name:'灵巧小丑', price:5, rar:0, desc:'牌型含同花 +80 筹码' },
  { id:'half',    ic:'🌗', name:'半张小丑', price:5, rar:0, desc:'打出的牌 ≤3 张时 +20 倍率' },
  { id:'ice',     ic:'🍦', name:'冰淇淋',   price:5, rar:0, desc:'+100 筹码，每出一手牌融化 -5', state:100 },
  { id:'green',   ic:'🟢', name:'绿色小丑', price:5, rar:0, desc:'每出一手牌 +1 倍率，弃牌时清零', state:0 },
  { id:'runner',  ic:'🏃', name:'跑者',     price:5, rar:0, desc:'打出顺子后永久 +15 筹码', state:0 },
  { id:'photo',   ic:'📷', name:'摄影师',   price:6, rar:1, desc:'第一张计分的人头牌(J/Q/K) ×2 倍率' },
  { id:'abstract',ic:'🎨', name:'抽象小丑', price:6, rar:0, desc:'每持有 1 张小丑牌 +3 倍率' },
  { id:'bounty',  ic:'💰', name:'赏金猎人', price:5, rar:0, desc:'击败盲注时额外获得 $3' },
  { id:'trio',    ic:'👨‍👦‍👦', name:'三人组', price:8, rar:2, desc:'牌型含三条 ×3 倍率' },
  { id:'family',  ic:'👨‍👩‍👧‍👦', name:'四口之家', price:8, rar:2, desc:'牌型含四条 ×4 倍率' },
  // —— 扩展小丑 ——
  { id:'misprint', ic:'❓', name:'印刷错误',   price:4, rar:0, desc:'+0~23 随机倍率' },
  { id:'fib',      ic:'🐚', name:'斐波那契',   price:7, rar:1, desc:'每张计分的 A/2/3/5/8 +8 倍率' },
  { id:'scary',    ic:'👺', name:'恐怖面具',   price:4, rar:0, desc:'每张计分的人头牌 +30 筹码' },
  { id:'even',     ic:'2️⃣', name:'偶数史蒂文', price:4, rar:0, desc:'每张计分的偶数牌(2/4/6/8/10) +4 倍率' },
  { id:'odd',      ic:'3️⃣', name:'奇数托德',   price:4, rar:0, desc:'每张计分的奇数牌(A/3/5/7/9) +31 筹码' },
  { id:'hack',     ic:'💻', name:'黑客',       price:6, rar:1, desc:'重复触发每张计分的 2/3/4/5' },
  { id:'dusk',     ic:'🌆', name:'黄昏',       price:6, rar:1, desc:'最后一次出牌时，所有计分牌重复触发' },
  { id:'baron',    ic:'🎩', name:'男爵',       price:8, rar:2, desc:'留在手中的每张 K ×1.5 倍率' },
  { id:'moon',     ic:'🌙', name:'射月',       price:6, rar:1, desc:'留在手中的每张 Q +13 倍率' },
  { id:'golden',   ic:'🪙', name:'黄金小丑',   price:5, rar:0, desc:'击败盲注时 +$4' },
  { id:'egg',      ic:'🥚', name:'彩蛋',       price:4, rar:0, desc:'每击败一个盲注，卖价 +$3' },
  { id:'gros',     ic:'🍌', name:'大香蕉',     price:5, rar:0, desc:'+15 倍率，每次盲注结束有 1/6 概率烂掉' },
  { id:'stencil',  ic:'🖼️', name:'小丑模板',   price:7, rar:1, desc:'每个空小丑槽位 ×1 倍率(自身也算空位)' },
  { id:'nova',     ic:'💥', name:'超新星',     price:6, rar:0, desc:'+当前牌型本局的打出次数 倍率' },
  { id:'bus',      ic:'🚌', name:'顺风车',     price:5, rar:0, desc:'连续打出不含人头牌的手牌，每次 +1 倍率；打出人头牌清零', state:0 },
  { id:'constel',  ic:'✨', name:'星群',       price:7, rar:1, desc:'每使用过一张星球牌 ×0.1 倍率(累计)' },
  { id:'holog',    ic:'📽️', name:'全息影像',   price:7, rar:1, desc:'每往牌组加入一张牌 ×0.25 倍率(累计)' },
  { id:'baseball', ic:'⚾', name:'棒球卡',     price:8, rar:2, desc:'每张其他罕见(绿框)小丑 ×1.5 倍率' },
];
const RARNAME = ['普通', '罕见', '稀有'];

const PLANETS = [
  { key:'five', ic:'🪐', name:'谷神星' }, { key:'flushhouse', ic:'🪐', name:'阋神星' },
  { key:'flushfive', ic:'🪐', name:'塞德娜' },
  { key:'high',     ic:'🪐', name:'冥王星' }, { key:'pair',    ic:'☿️', name:'水星' },
  { key:'twopair',  ic:'🌌', name:'天王星' }, { key:'trips',   ic:'💛', name:'金星' },
  { key:'straight', ic:'🪐', name:'土星' },   { key:'flush',   ic:'🟠', name:'木星' },
  { key:'fh',       ic:'🌍', name:'地球' },   { key:'four',    ic:'🔴', name:'火星' },
  { key:'sf',       ic:'🔵', name:'海王星' },
];
const TAROTS = [
  { id:'magician', ic:'🎩', name:'魔术师', desc:'选中的最多 2 张牌永久 +30 筹码' },
  { id:'empress',  ic:'👑', name:'女皇',   desc:'选中的最多 2 张牌变为倍率牌(+4 倍率)' },
  { id:'lovers',   ic:'💞', name:'恋人',   desc:'选中的 1 张牌变为万能牌(视为所有花色)' },
  { id:'death',    ic:'💀', name:'死神',   desc:'选中 2 张牌：左侧牌变成右侧牌的复制' },
  { id:'tower',    ic:'🗼', name:'高塔',   desc:'摧毁选中的最多 2 张牌(永久移出牌组)' },
  { id:'hermit',   ic:'🏮', name:'隐士',   desc:'金钱翻倍(最多 +$20)' },
  { id:'judge',    ic:'⚖️', name:'审判',   desc:'随机获得一张小丑牌(需有空位)' },
  { id:'devil',    ic:'👿', name:'恶魔',   desc:'选中的 1 张牌变为黄金牌(计分时 +$3)' },
  { id:'chariot',  ic:'🛡️', name:'战车',   desc:'选中的 1 张牌变为钢铁牌(留在手中时 ×1.5 倍率)' },
  { id:'justice',  ic:'🏺', name:'正义',   desc:'选中的 1 张牌变为玻璃牌(计分 ×2 倍率，25% 碎裂)' },
  { id:'sun',      ic:'☀️', name:'太阳',   desc:'选中的最多 3 张牌变为 ♥' },
  { id:'world',    ic:'🌐', name:'世界',   desc:'选中的最多 3 张牌变为 ♠' },
  { id:'emperor',  ic:'🤴', name:'皇帝',   desc:'获得最多 2 张随机塔罗牌(受槽位限制)' },
];
const SPECTRALS = [
  { id:'soul',   ic:'👻', name:'灵魂',   desc:'获得一张随机稀有小丑牌(需有空位)' },
  { id:'bhole',  ic:'🕳️', name:'黑洞',   desc:'所有牌型等级 +1' },
  { id:'talis',  ic:'🥇', name:'护符',   desc:'随机一张牌组中的牌获得金蜡封(计分 +$3)' },
  { id:'dejavu', ic:'🔴', name:'既视感', desc:'随机一张牌组中的牌获得红蜡封(计分时重复触发)' },
];
const VOUCHERS = [
  { id:'grabber',  ic:'🖐️', name:'抓取器',     desc:'每个盲注 +1 出牌次数' },
  { id:'wasteful', ic:'🗑️', name:'回收站',     desc:'每个盲注 +1 弃牌次数' },
  { id:'paint',    ic:'🖌️', name:'画笔',       desc:'手牌上限 +1' },
  { id:'anti',     ic:'⚛️', name:'反物质',     desc:'小丑槽位 +1' },
  { id:'crystal',  ic:'🔮', name:'水晶球',     desc:'消耗牌槽位 +1' },
  { id:'seed',     ic:'🌱', name:'种子基金',   desc:'利息上限从 $5 提高到 $10' },
  { id:'surplus',  ic:'♻️', name:'过剩刷新',   desc:'商店刷新基础价降为 $3' },
  { id:'sale',     ic:'🏷️', name:'清仓大甩卖', desc:'商店所有商品 75 折' },
];
const TAGS = [
  { id:'money',  ic:'💰', name:'钱币标签', desc:'立即获得 $8' },
  { id:'coupon', ic:'🏷️', name:'优惠标签', desc:'下个商店全场半价' },
  { id:'unc',    ic:'🃏', name:'珍稀标签', desc:'下个商店的小丑均为罕见以上，第一张免费' },
  { id:'invest', ic:'📈', name:'投资标签', desc:'击败本底注的 Boss 时 +$15' },
  { id:'meteor', ic:'☄️', name:'天体标签', desc:'获得一张随机星球牌(槽满则 +$3)' },
  { id:'charm',  ic:'🎀', name:'魔法标签', desc:'获得一张随机塔罗牌(槽满则 +$3)' },
];

const BOSSES = [
  { id:'hearts', name:'🌹 血月',  desc:'所有 ♥ 不提供筹码、不触发效果' },
  { id:'spades', name:'⚓ 暗礁',  desc:'所有 ♠ 不提供筹码、不触发效果' },
  { id:'club',   name:'🍀 三叶草', desc:'所有 ♣ 不提供筹码、不触发效果' },
  { id:'window', name:'🪟 窗户',  desc:'所有 ♦ 不提供筹码、不触发效果' },
  { id:'wall',   name:'🧱 巨墙',  desc:'目标分数额外提高 60%' },
  { id:'needle', name:'🪡 之针',  desc:'本盲注只能打出 1 手牌' },
  { id:'arm',    name:'💪 铁腕',  desc:'本盲注只有 1 次弃牌机会' },
  { id:'hook',   name:'🪝 钩爪',  desc:'每打出一手牌后随机弃掉 2 张手牌' },
  { id:'water',  name:'💧 流水',  desc:'本盲注不能弃牌' },
  { id:'psychic',name:'🧿 通灵者', desc:'必须每次打出恰好 5 张牌' },
  { id:'manacle',name:'⛓️ 镣铐',  desc:'本盲注手牌上限 -1' },
  { id:'flint',  name:'🔥 燧石',  desc:'牌型的基础筹码和倍率减半' },
];
const ANTE_BASE = [0, 300, 800, 2000, 5000, 11000, 20000, 35000, 50000];
