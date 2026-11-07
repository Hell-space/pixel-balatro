const {test}=require('node:test');
const assert=require('node:assert/strict');
const {harness}=require('./game-harness.cjs');
function start(){const h=harness(41);h.game.newGame(false);return {...h,g:h.game,s:h.game.getState()};}
function shop(g,s){s.screen='cash';g.openShop();}
function boss(g,s){s.blindIdx=2;g.startBlind();s.score=s.target;g.beatBlind();}

test('工坊价格、取消、一次性消费和跨店免费次数形成真实取舍',()=>{
  const {g,s}=start();s.money=20;shop(g,s);
  const id=s.deckAll[0].id;
  assert(g.openWorkshop('copy'));g.closeWorkshop();assert.equal(s.money,20);assert.equal(s.deckAll.length,52);
  assert(g.applyWorkshop('copy',id));assert.equal(s.money,14);assert.equal(s.deckAll.length,53);
  assert(!g.applyWorkshop('remove',id));assert.equal(s.money,14);
  g.doReroll();assert(!g.applyWorkshop('polish',id),'刷新不能重置工坊');
  g.leaveShop();s.workshopCredits=2;shop(g,s);
  const money=s.money;assert(g.applyWorkshop('polish',id));assert.equal(s.workshopCredits,1);assert.equal(s.money,money);
  g.leaveShop();shop(g,s);assert(g.applyWorkshop('remove',id));assert.equal(s.workshopCredits,0);assert.equal(s.money,money);
  g.leaveShop();shop(g,s);s.shop.disc=.5;
  assert(g.applyWorkshop('copy',s.deckAll[0].id));assert.equal(s.money,money-3);
});

test('复制保留强化和独立身份，删牌清理引用，强化真正增加计分',()=>{
  const {g,s,load}=start();s.money=100;g.startBlind();const card=s.hand[0];
  Object.assign(card,{bonus:30,multB:4,ed:3,seal:'red',steel:true,wild:true});shop(g,s);
  assert(g.applyWorkshop('copy',card.id));const copy=s.deckAll.at(-1);
  for(const key of ['rank','suit','bonus','multB','ed','seal','steel','wild'])assert.equal(copy[key],card[key]);
  assert.notEqual(copy.id,card.id);assert.notEqual(copy,card);assert.equal(s.cardsAdded,1);
  assert(!copy.sel);g.leaveShop();shop(g,s);
  const before=g.scoreHand(s,[copy]).total;assert(g.applyWorkshop('polish',copy.id));
  assert(g.scoreHand(s,[copy]).total>before);assert.equal(card.bonus,30);assert.equal(copy.bonus,60);
  g.leaveShop();shop(g,s);s.hand=[card];s.drawPile=s.deckAll.filter(c=>c!==card);
  assert(g.applyWorkshop('remove',card.id));assert(!s.hand.includes(card));assert(!s.deckAll.includes(card));
  load('session');g.persistRun();g.resumeGame();const restored=g.getState();
  assert(restored.drawPile.every(c=>restored.deckAll.includes(c)));assert.equal(restored.deckAll.find(c=>c.id===copy.id).bonus,60);
  assert(restored.shop.workshopUsed);assert(!g.applyWorkshop('copy',copy.id));
});

test('工坊缺钱、卡牌失效、最低牌数、开包和盲注中都不扣资源',()=>{
  const {g,s}=start();shop(g,s);s.money=0;const id=s.deckAll[0].id;
  assert(!g.applyWorkshop('copy',id));s.workshopCredits=1;
  assert(!g.applyWorkshop('copy',-1));assert(!g.applyWorkshop('missing',id));
  s.deckAll=s.deckAll.slice(0,5);assert(!g.applyWorkshop('remove',id));
  s.pack={};assert(!g.applyWorkshop('polish',id));s.pack=null;
  s.screen='play';assert(!g.applyWorkshop('polish',id));
  assert.equal(s.money,0);assert.equal(s.workshopCredits,1);assert.equal(s.deckAll.length,5);
});

test('Boss 三种奖励互斥并只结算一次，自选牌型与存档保持一致',()=>{
  for(const choice of ['cash','level','workshop']) {
    const {g,s,load}=start();boss(g,s);assert(s.bossReward);assert.equal(s.screen,'cash');
    g.openShop();assert.equal(s.screen,'cash');assert.equal(s.shop,null);
    g.selectRewardHand('pair');load('session');g.persistRun();g.resumeGame();
    const state=g.getState();assert.equal(state.bossReward.handKey,'pair');const money=state.money;
    assert(g.chooseBossReward(choice));assert(!g.chooseBossReward(choice));assert.equal(state.screen,'shop');
    assert.equal(state.money,money+(choice==='cash'?8:0));
    assert.equal(state.levels.pair,choice==='level'?3:1);
    assert.equal(state.workshopCredits,choice==='workshop'?2:0);
    g.persistRun();g.resumeGame();assert.equal(g.getState().bossReward,null);
  }
});

test('普通盲注、多人与旧存档不倒补奖励，最终胜利先展示，继续无尽后才选择',()=>{
  const {g,s,run,load,storage}=start();g.startBlind();g.beatBlind();assert.equal(s.bossReward,null);
  s.ante=8;boss(g,s);assert(s.winPending);assert(!g.chooseBossReward('cash'));g.openShop();assert.equal(s.shop,null);
  g.continueEndless();assert(g.chooseBossReward('workshop'));assert.equal(s.workshopCredits,2);
  load('session');g.persistRun();const old=JSON.parse(storage.get('pixel-balatro.run.v1'));old.version=3;
  for(const state of [old.state])for(const key of ['workshopCredits','bossReward'])delete state[key];
  old.checkpoint=JSON.stringify((()=>{const c=JSON.parse(old.checkpoint);for(const k of ['workshopCredits','bossReward'])delete c[k];return c;})());
  const decoded=g.decodeRun(JSON.stringify(old));assert(decoded);assert.equal(decoded.state.workshopCredits,0);assert.equal(decoded.state.bossReward,null);
  run('MP.on=true');s.bossReward=null;s.screen='play';g.prepareBossReward();assert.equal(s.bossReward,null);
});

