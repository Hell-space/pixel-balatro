const {test}=require('node:test');
const assert=require('node:assert/strict');
const {harness}=require('./game-harness.cjs');
const enhancement=c=>['bonus','multB','wild','steel','glass','goldc'].filter(k=>c[k]);
const plain=c=>Object.assign(c,{bonus:0,multB:0,wild:false,steel:false,glass:false,goldc:false,ed:0,seal:null});
function start(seed=1){const h=harness(seed);h.game.newGame(false);h.game.startBlind();return {...h,s:h.game.getState()};}
function shop(g,s){s.screen='cash';s.money=50;g.openShop();}

test('标准包每张候选都有基础强化，三种强化不同，取消重开不重抽',()=>{
  const {game:g,s}=start();
  for(let i=0;i<300;i++){
    const options=g.packOptions('standard');
    assert(options.every(c=>enhancement(c).length===1),'不得出现普通牌');
    assert.equal(new Set(options.map(c=>enhancement(c)[0])).size,3);
  }
  shop(g,s);s.shop.packs=[{id:'standard',price:4,sold:false}];
  g.buyPack(0);const before=JSON.stringify(s.pack.options),money=s.money;
  g.closePack();assert.equal(s.money,money+4);g.buyPack(0);
  assert.equal(JSON.stringify(s.pack.options),before);assert.equal(s.money,money);
  const card=s.pack.options[1];g.pickPack(1);assert.equal(s.deckAll.at(-1),card);
  assert.equal(s.cardsAdded,1);assert.equal(s.pack,null);g.pickPack(1);assert.equal(s.cardsAdded,1);
});

test('旧存档未选标准包补强化，保留候选点数、花色、ID和退款；已加入牌组的普通牌不改',()=>{
  const {game:g,s,load,storage}=start();shop(g,s);
  const options=Array.from({length:3},()=>plain(g.randCard()));
  options[1].ed=2;options[2].seal='red';
  s.shop.packs=[{id:'standard',price:4,sold:true,options}];
  s.pack={index:0,type:'standard',cost:4,options};s.money-=4;
  const original=options.map(c=>[c.id,c.rank,c.suit,c.ed,c.seal]);
  load('session');g.persistRun();const raw=storage.get('pixel-balatro.run.v1');
  const decoded=g.decodeRun(raw);assert(decoded);const restored=decoded.state;
  assert(restored.pack.options.every(c=>enhancement(c).length===1));
  assert.deepEqual(Array.from(restored.pack.options,c=>[c.id,c.rank,c.suit,c.ed,c.seal]),original);
  assert(restored.deckAll.every(c=>enhancement(c).length===0));
  const repaired=JSON.stringify(restored.pack.options);g.resumeGame();
  assert.equal(JSON.stringify(g.getState().pack.options),repaired);
  const money=g.getState().money;g.closePack();assert.equal(g.getState().money,money+4);
  g.buyPack(0);assert.equal(JSON.stringify(g.getState().pack.options),repaired);
  g.pickPack(0);g.persistRun();g.resumeGame();
  const again=g.getState();assert.equal(again.cardsAdded,1);
  assert(enhancement(again.deckAll.find(c=>c.id===options[0].id)).length===1);
  assert(again.hand.every(c=>again.deckAll.includes(c)));
});

test('成长效果本手生效，预览无副作用，顺风车遇到非计分人头牌也立即清零',async()=>{
  const {game:g,s}=start();s.target=100000;
  const cards=s.hand.slice(0,5);cards.forEach((c,i)=>Object.assign(plain(c),{rank:i+2,suit:i%4,sel:true}));
  s.hand=cards;s.drawPile=[];
  for(const id of ['green','runner','bus'])g.addJoker(g.getDefinitions().JDEFS.find(j=>j.id===id));
  const before=JSON.stringify(s),preview=g.scoreHand({...s,handsLeft:s.handsLeft-1},cards);
  assert.equal(preview.total,390); // (30 + 2+3+4+5+6 + 15) * (4 + 1 + 1)
  assert.equal(JSON.stringify(s),before);
  await g.doPlay();assert.equal(s.lastResult.total,preview.total);
  assert.deepEqual(Array.from(s.jokers,j=>j.state),[1,15,1]);
  const pair=s.deckAll.slice(0,3);pair.forEach((c,i)=>Object.assign(plain(c),{rank:i<2?14:11,suit:i,sel:true}));
  s.hand=pair;s.screen='play';s.handsLeft=4;s.busy=false;s.jokers=s.jokers.filter(j=>j.id==='bus');s.jokers[0].state=9;
  assert.equal(g.scoreHand(s,pair).total,64); // Pair of aces; the J is not scored but breaks the streak.
  await g.doPlay();assert.equal(s.lastResult.total,64);assert.equal(s.jokers[0].state,0);
});

test('蜡封只选会改变的牌，无目标不消耗；灵魂绝不降级发普通小丑',()=>{
  const {game:g,s}=start();const target=s.deckAll.at(-1);
  for(const [id,seal] of [['talis','gold'],['dejavu','red']]){
    s.deckAll.forEach(c=>c.seal=seal);target.seal=null;
    assert.equal(g.useSpectral({id}),true);assert.equal(target.seal,seal);
    assert.equal(g.useSpectral({id}),false);
  }
  s.jokers=[];for(const j of g.getDefinitions().JDEFS.filter(j=>j.rar===2))g.addJoker(j);
  s.jokerSlots=20;const before=s.jokers.length;
  assert.equal(g.useSpectral({id:'soul'}),false);assert.equal(s.jokers.length,before);
  s.jokers.pop();assert.equal(g.useSpectral({id:'soul'}),true);assert.equal(s.jokers.at(-1).rar,2);
  shop(g,s);s.deckAll.forEach(c=>c.seal='gold');
  s.shop.packs=[{id:'spectral',price:6,sold:false,options:[{id:'talis'}]}];
  g.buyPack(0);const money=s.money;g.pickPack(0);assert(s.pack);assert.equal(s.money,money);
  g.closePack();assert.equal(s.money,money+6);
});

test('全部选牌塔罗共用使用条件，失败不消耗；零收益金钱牌可保留',()=>{
  const {game:g,s,run}=start();
  for(const id of ['magician','empress','lovers','death','tower','devil','chariot','justice','sun','world','star','mooncard','strength']){
    const t={...g.getDefinitions().TAROTS.find(t=>t.id===id),kind:'tarot'};s.cons=[t];s.screen='shop';
    assert.equal(g.consumableUseState(t).ok,false,id);run('consLock=0');g.useCons(0);assert.equal(s.cons[0],t);
    s.screen='play';s.hand.forEach(c=>c.sel=false);
    assert.equal(g.consumableUseState(t).select,true,id);
    s.hand.slice(0,id==='death'?2:1).forEach(c=>c.sel=true);
    assert.equal(g.consumableUseState(t).ok,true,id);
  }
  for(const id of ['hermit','temperance']){
    s.money=0;s.jokers=[];const t={id,kind:'tarot'};s.cons=[t];run('consLock=0');g.useCons(0);
    assert.equal(s.cons[0],t,id);assert.equal(s.tarotsUsed,0);
  }
});

test('百搭只替代花色：用户截图J+6不成对子，6+6成对子，能补同花；双强化都显示加号',()=>{
  const {game:g,s,load}=start();const [wild,other]=s.hand;
  Object.assign(plain(wild),{rank:6,wild:true});Object.assign(plain(other),{rank:11,suit:3});
  assert.equal(g.evalHand([wild,other]).key,'high');other.rank=6;
  assert.equal(g.evalHand([wild,other]).key,'pair');
  const flush=s.hand.slice(1,5);flush.forEach((c,i)=>Object.assign(plain(c),{rank:i+8,suit:1}));
  assert.equal(g.evalHand([wild,...flush]).key,'flush');
  load('table');wild.bonus=30;wild.multB=4;
  const html=g.cardEl(wild).innerHTML;assert(html.includes('+30'));assert(html.includes('+4'));
  const tip=g.cardTipHTML(wild);assert(tip.includes('百搭花色'));assert(tip.includes('点数不变'));
  assert(!html.includes('×倍'));
});

test('四条和五条不是两对；葫芦仍包含两对',()=>{
  const {game:g,s}=start();const cards=s.hand.slice(0,5);
  cards.forEach((c,i)=>Object.assign(plain(c),{rank:i<4?8:14,suit:i%4}));
  assert.equal(g.evalHand(cards).contains.twopair,false);
  const base=g.scoreHand(s,cards).total;g.addJoker(g.getDefinitions().JDEFS.find(j=>j.id==='mad'));
  g.addJoker(g.getDefinitions().JDEFS.find(j=>j.id==='clever'));
  assert.equal(g.scoreHand(s,cards).total,base);
  cards[4].rank=8;assert.equal(g.evalHand(cards).contains.twopair,false);
  cards[3].rank=cards[4].rank=9;assert.equal(g.evalHand(cards).contains.twopair,true);
});
