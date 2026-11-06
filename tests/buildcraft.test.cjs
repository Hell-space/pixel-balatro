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
  for(const state of [old.state])for(const key of ['workshopCredits','bossReward','rhythmMode','rhythm','contract','contractChoice'])delete state[key];
  old.checkpoint=JSON.stringify((()=>{const c=JSON.parse(old.checkpoint);for(const k of ['workshopCredits','bossReward','rhythmMode','rhythm','contract','contractChoice'])delete c[k];return c;})());
  const decoded=g.decodeRun(JSON.stringify(old));assert(decoded);assert.equal(decoded.state.workshopCredits,0);assert.equal(decoded.state.bossReward,null);assert.equal(decoded.state.rhythmMode,'none');
  run('MP.on=true');s.bossReward=null;s.screen='play';g.prepareBossReward();assert.equal(s.bossReward,null);
  assert(!g.selectContract('clean'));assert(!g.selectRhythm('flow'));
});

test('悬赏只在开打扣押金，切换与跳过不收费，不适用的 Boss 条件被拒绝',()=>{
  const {g,s}=start();const money=s.money;
  assert(g.selectContract('clean'));assert(g.selectContract('first'));assert.equal(s.money,money);
  g.skipBlind(s.skipTags[0]);assert.equal(s.contractChoice,null);
  const afterSkip=s.money;assert(g.selectContract('variety'));g.chooseBlind();assert.equal(s.money,afterSkip-2);
  g.chooseBlind();assert.equal(s.money,afterSkip-2);assert.equal(s.contract.id,'variety');
  s.screen='select';s.blindIdx=2;s.anteBoss={id:'needle'};assert(!g.selectContract('variety'));
  s.anteBoss={id:'water'};assert(!g.selectContract('clean'));
  s.money=1;assert(!g.selectContract('first'));
});

test('悬赏按实际出牌/弃牌结算，三牌型过关只发一次奖金',async()=>{
  const {g,s}=start();g.selectContract('variety');g.chooseBlind();s.target=100;
  // Unit fixture: three controlled, canonical hands. The production play/settlement functions run unchanged.
  const groups=[[2],[2,2],[2,2,2]],used=[];let at=0;
  for(const ranks of groups){
    const hand=ranks.map(rank=>Object.assign(s.deckAll[at++],{rank,sel:true}));used.push(...hand);
    s.hand=[...hand,s.deckAll[50]];s.hand.at(-1).sel=false;s.drawPile=[];
    await g.doPlay();
  }
  assert.equal(s.screen,'cash');assert.equal(new Set(s.blindPlayed).size,3);
  assert.equal(s.payout.find(([label])=>label.startsWith('悬赏'))[1],9);
  const money=s.money;g.beatBlind();assert.equal(g.settleContract(),0);assert.equal(s.money,money);
  const other=start();other.g.selectContract('clean');other.g.chooseBlind();other.s.hand[0].sel=true;other.g.doDiscard();
  other.g.beatBlind();assert.equal(other.s.payout.find(([label])=>label.startsWith('悬赏'))[1],0);
  assert(other.s.contract.settled);
});

test('连招纯预览、当手计分、断连、倍率上限与新盲清零',async()=>{
  const {g,s}=start();g.selectRhythm('focus');g.chooseBlind();s.target=100000;
  const pair=s.deckAll.slice(0,2);pair.forEach(c=>Object.assign(c,{rank:2,sel:true}));
  s.hand=[...pair,s.deckAll[30]];s.hand.at(-1).sel=false;s.drawPile=[];
  s.rhythm={lastKey:'pair',chain:1};
  const before=JSON.stringify(s),preview=g.scoreHand(s,pair);assert.equal(preview.total,56);assert.equal(JSON.stringify(s),before);
  await g.doPlay();assert.equal(s.lastResult.total,56);assert.equal(s.rhythm.chain,2);
  assert.equal(g.scoreHand(s,[s.hand[0]]).rhythm.bonus,0);
  s.rhythm={lastKey:'pair',chain:5};assert.equal(g.scoreHand(s,pair).rhythm.bonus,8);
  s.rhythmMode='flow';assert.equal(g.scoreHand(s,pair).rhythm.bonus,0);assert.equal(g.scoreHand(s,[s.hand[0]]).rhythm.bonus,8);
  g.startBlind();assert.equal(s.rhythm.chain,0);assert.equal(s.rhythm.lastKey,null);
});

test('中途续局保留连招与悬赏进度，恢复检查点重新下注而不复制收益',async()=>{
  const {g,s,load}=start();g.selectRhythm('flow');g.selectContract('clean');g.chooseBlind();
  s.hand[0].sel=true;s.target=100000;await g.doPlay();
  load('session');g.persistRun();g.resumeGame();const state=g.getState();
  assert.equal(state.rhythmMode,'flow');assert.equal(state.rhythm.chain,1);assert.equal(state.contract.discards,0);
  assert.equal(state.money,2);g.restoreCheckpoint();const restored=g.getState();
  assert.equal(restored.money,4);assert.equal(restored.contractChoice,'clean');g.chooseBlind();assert.equal(restored.money,2);
});

test('满足不弃牌但未打败盲注不发悬赏，失败仍失去押金',async()=>{
  const {g,s}=start();g.selectContract('clean');g.chooseBlind();s.target=100000;
  while(s.screen==='play') {
    s.hand.forEach(c=>c.sel=false);s.hand[0].sel=true;await g.doPlay();
  }
  assert.equal(s.screen,'over');assert.equal(s.contract.discards,0);assert.equal(s.contract.settled,false);
  assert.equal(s.money,2);assert.equal(s.payout,undefined);assert.equal(s.bossReward,null);
});
