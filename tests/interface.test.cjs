const {test}=require('node:test');
const assert=require('node:assert/strict');
const {harness}=require('./game-harness.cjs');
function reward(){const h=harness(37),g=h.game;g.newGame(false);const s=g.getState();s.blindIdx=2;g.startBlind();s.score=s.target;g.beatBlind();return {...h,g,s};}

test('升级选项列出真实前后值、默认隐藏特殊牌型且生成不改变状态',()=>{
  const {g,s}=reward();s.levels.pair=5;const before=JSON.stringify(s);
  const options=g.rewardHandOptions(),pair=options.find(o=>o.key==='pair');
  assert.equal(JSON.stringify(s),before);assert.equal(options.length,9);
  for(const [key,value] of Object.entries({level:5,nextLevel:7,chips:70,nextChips:100,mult:6,nextMult:8}))assert.equal(pair[key],value);
  assert(!options.some(o=>o.key==='five'));s.playCounts.five=1;
  assert(g.rewardHandOptions().some(o=>o.key==='five'));
});

test('选择和返回升级列表不领取奖励，续局保留选择，领取只升两级一次',()=>{
  const {g,s,load,run}=reward();s.levels.pair=5;const money=s.money,credits=s.workshopCredits;
  assert(g.openRewardHands());assert(g.selectRewardHand('pair'));g.closeRewardHands();
  assert.equal(s.money,money);assert.equal(s.levels.pair,5);assert.equal(s.workshopCredits,credits);
  assert(!g.selectRewardHand('five'));run('MP.on=true');assert(!g.selectRewardHand('high'));assert(!g.openRewardHands());run('MP.on=false');
  load('session');g.persistRun();g.resumeGame();const state=g.getState();assert.equal(state.bossReward.handKey,'pair');
  assert(g.chooseBossReward('level'));assert.equal(state.levels.pair,7);assert.equal(state.money,money);
  assert(!g.chooseBossReward('level'));assert.equal(state.levels.pair,7);assert(!g.openRewardHands());
});

test('切换工坊花色时清除隐藏选择，不能误改此前选牌，也不消费金币',()=>{
  const h=harness(17),g=h.game;g.newGame(false);const s=g.getState();s.screen='cash';g.openShop();s.money=20;
  assert(g.openWorkshop('copy'));h.run('workshopDraft.cardId=S.deckAll[0].id');
  assert(g.selectWorkshopSuit('1'));assert.equal(h.run('workshopDraft.cardId'),null);
  assert(!g.confirmWorkshop());assert.equal(s.money,20);assert.equal(s.deckAll.length,52);
  assert(!g.selectWorkshopSuit('invalid'));assert.equal(h.run('workshopFilter'),'1');
});
