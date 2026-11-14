const {test}=require('node:test');
const assert=require('node:assert/strict');
const {harness}=require('./game-harness.cjs');
test('六种牌组与难度按明示规则发放初始资源',()=>{
  const {game:g}=harness();
  for(const [id,money,hands,disc,slots] of [['classic',4,4,3,5],['red',4,4,4,5],['blue',0,5,3,5],['yellow',10,4,3,5],['green',4,4,3,5],['black',4,3,3,6],['open',4,4,3,5]]){
    g.newGame(false,id);const s=g.getState();assert.deepEqual([s.money,s.baseHands,s.baseDisc,s.jokerSlots],[money,hands,disc,slots]);
  }
  g.newGame(false,'red','gold');const s=g.getState();assert.equal(s.baseDisc,3);assert.equal(g.blindMetaFor(0).target,300);
  s.ante=2;assert.equal(g.blindMetaFor(0).target,1120);
});

test('明牌是实际第一张补牌，出牌与弃牌都按同一牌序补足',async()=>{
  function position(score,target,hands) {
    const {game:g}=harness(35);
    g.newGame(false,'open');g.chooseBlind();
    const s=g.getState();
    const find=(rank,suit)=>s.deckAll.find(c=>c.rank===rank&&c.suit===suit);
    s.hand=[[9,0],[10,1],[11,2],[12,3],[3,0],[3,1],[7,3],[2,2]].map(([r,k])=>find(r,k));
    const king=find(13,0);
    s.drawPile=s.deckAll.filter(c=>!s.hand.includes(c)&&c!==king).concat(king);
    Object.assign(s,{score,target,handsLeft:hands,discLeft:1});
    return {g,s,king};
  }
  const a=position(40,300,1);
  assert.equal(a.g.openTopCard(),a.king);
  assert.equal(a.g.applyReserve('store',a.s.hand[0].id),false);
  a.g.selectCards([a.s.hand.find(c=>c.rank===2).id]);a.g.doDiscard();
  assert(a.s.hand.includes(a.king));assert.equal(a.s.discLeft,0);
  assert.equal(a.g.openTopCard(),a.s.drawPile.at(-1));
  const straight=s=>s.hand.filter(c=>c.rank>=9&&c.rank<=13).map(c=>c.id);
  a.g.selectCards(straight(a.s));await a.g.doPlay();
  assert.equal(a.s.score,356);assert.equal(a.s.screen,'cash');assert.equal(a.g.openTopCard(),null);

  const b=position(110,450,2);
  b.g.selectCards(b.s.hand.filter(c=>c.rank===3).map(c=>c.id));await b.g.doPlay();
  assert.equal(b.s.score,142);assert(b.s.hand.includes(b.king));assert.equal(b.s.drawPile.length,42);
  b.g.selectCards(straight(b.s));await b.g.doPlay();
  assert.equal(b.s.score,458);assert.equal(b.s.discLeft,1);assert.equal(b.s.screen,'cash');
});

test('明牌续局保持牌序与强化，零弃牌和塔罗补牌、牌库空时均使用真实状态',async()=>{
  const {game:g,load,run}=harness(8);
  g.newGame(false,'open','gold');
  assert.equal(g.openTopCard(),null);
  const before=g.getState();before.blindIdx=2;before.anteBoss=run("BOSSES.find(b=>b.id==='water')");
  g.showBlindSelect();g.chooseBlind();
  const first=g.openTopCard();Object.assign(first,{steel:true,seal:'red',bonus:30});
  load('session');g.persistRun();g.resumeGame();
  const s=g.getState(),top=g.openTopCard(),next=s.drawPile.at(-2);
  assert.equal(s.deckId,'open');assert.equal(s.discLeft,0);
  assert.equal(top.id,first.id);assert.equal(top,s.deckAll.find(c=>c.id===first.id));
  g.selectCards([s.hand[0].id]);g.doDiscard();
  assert.equal(g.openTopCard(),top);
  s.cons=[{id:'tower',kind:'tarot',price:3}];g.useCons(0);
  assert(s.hand.includes(top));assert.equal(top.seal,'red');assert.equal(g.openTopCard(),next);
  assert.equal(s.drawPile.length,43);assert.equal(s.discLeft,0);
  s.drawPile=[next];s.target=100000;
  g.selectCards([s.hand[0].id]);await g.doPlay();
  assert(s.hand.includes(next));assert.equal(g.openTopCard(),null);
  g.persistRun();g.resumeGame();assert.equal(g.openTopCard(),null);
});

test('经典单人和联机不公开牌序，明牌牌组看牌不改变洗牌、计分和留手效果',()=>{
  const open=harness(205),classic=harness(205);
  for(const [h,deck] of [[open,'open'],[classic,'classic']]) {
    h.game.newGame(false,deck);h.game.chooseBlind();
  }
  const s=open.game.getState(),other=classic.game.getState();
  assert.deepEqual(Array.from(s.drawPile,c=>c.id),Array.from(other.drawPile,c=>c.id));
  assert.equal(classic.game.openTopCard(),null);
  const cards=[s.hand[0]],pts=open.game.scoreHand(s,cards).total;
  Object.assign(open.game.openTopCard(),{steel:true,seal:'red',glass:true,ed:3});
  assert.equal(open.game.scoreHand(s,cards).total,pts);
  open.run('MP.on=true');
  assert.equal(open.game.openTopCard(),null);assert(!open.game.openReserve());
});
test('之针和巨墙的选择界面目标与实际目标一致；Boss循环不重复且初期无高压组合',()=>{
  for(let seed=1;seed<=40;seed++){
    const {game:g}=harness(seed);g.newGame(false);const s=g.getState();const seen=new Set();
    for(let ante=1;ante<=8;ante++){
      if(ante>1){s.ante=ante;g.rollAnte();}
      assert(!seen.has(s.anteBoss.id));seen.add(s.anteBoss.id);
      if(ante<3)assert(!['needle','eye','flint'].includes(s.anteBoss.id));
    }
  }
  const {game:g}=harness();g.newGame(false);const s=g.getState();s.ante=2;s.blindIdx=2;
  for(const [id,expected] of [['needle',800],['wall',2560]]){s.anteBoss={id};assert.equal(g.blindMetaFor(2).target,expected);g.startBlind();assert.equal(s.target,expected);}
});
test('商店不出现重复小丑，首次普通商店保留$4计分选择；免费标签不能重复购买',()=>{
  for(let seed=1;seed<=100;seed++){
    const {game:g}=harness(seed);g.newGame(false);const s=g.getState();s.screen='cash';g.openShop();
    assert.equal(new Set(s.shop.jokers.map(j=>j.id)).size,2);assert.equal(s.shop.jokers[0].price,4);
    assert(['joker','jolly','sly','scary','even','odd'].includes(s.shop.jokers[0].id));
  }
  const {game:g}=harness();g.newGame(false);const s=g.getState();s.nextShopUnc=true;s.screen='cash';g.openShop();
  assert.equal(s.shop.jokers[0].price,0);g.buyJoker(0);s.money=20;g.doReroll();assert(s.shop.jokers.every(j=>j.price>0));
});
test('新塔罗支持四花色、A循环和节制上限，成功使用才增加占卜师计数',()=>{
  const {game:g,run}=harness();g.newGame(false);g.startBlind();const s=g.getState();
  function use(id,n){s.cons=[{id,kind:'tarot'}];s.hand.forEach((c,i)=>c.sel=i<n);run('consLock=0');g.useCons(0);}
  use('star',3);assert.equal(s.tarotsUsed,1);assert.equal(s.hand.slice(0,3).filter(c=>c.suit===3).length,3);
  use('mooncard',0);assert.equal(s.cons.length,1);assert.equal(s.tarotsUsed,1);
  use('mooncard',3);assert.equal(s.hand.slice(0,3).filter(c=>c.suit===2).length,3);
  const card=s.hand[0];card.rank=14;use('strength',1);assert.equal(card.rank,2);
  s.jokers=[{id:'egg',sell:40}];const before=s.money;use('temperance',0);assert.equal(s.money,before+30);assert.equal(s.tarotsUsed,4);
});
test('绿色牌组无利息、按资源结算；赏金奖励有上限',()=>{
  const {game:g}=harness();g.newGame(false,'green');g.startBlind();const s=g.getState();
  s.money=100;s.handsLeft=2;s.discLeft=4;s.jokers=[{id:'bounty'}];g.beatBlind();
  assert.equal(s.money,117); // base3 + hands4 + disc4 + bounty6
  assert.equal(s.payout.find(r=>r[0]==='利息')[1],0);
  for(let i=0;i<50;i++){g.rollAnte();assert.notEqual(s.anteVoucher?.id,'seed');}
});
test('独眼重复牌型不消耗行动，正常出牌记录用于判断且下盲重置',async()=>{
  const {game:g}=harness();g.newGame(false);g.startBlind();const s=g.getState();
  s.boss={id:'eye'};s.blindPlayed=['high'];g.selectCards([s.hand[0].id]);const n=s.handsLeft;
  await g.doPlay();assert.equal(s.handsLeft,n);s.blindPlayed=[];await g.doPlay();assert.equal(s.handsLeft,n-1);assert(s.blindPlayed.includes('high'));
  g.startBlind();assert.equal(s.blindPlayed.length,0);
});
