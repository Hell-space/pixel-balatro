const {test}=require('node:test');
const assert=require('node:assert/strict');
const {harness}=require('./game-harness.cjs');
function start(){const h=harness(19);h.game.newGame(false,'red');h.game.chooseBlind();return {...h,g:h.game,s:h.game.getState()};}
const ids=s=>[...s.hand,...s.drawPile].map(c=>c.id).concat(s.reserve.cardId===null?[]:[s.reserve.cardId]);

test('藏牌只补一张，取消和重复确认不改变资源或牌组身份',()=>{
  const {g,s}=start(),card=s.hand[0],next=s.drawPile.at(-1),deck=s.deckAll.slice();
  const before={money:s.money,hands:s.handsLeft,discards:s.discLeft,draw:s.drawPile.length,size:s.hand.length};
  assert(g.openReserve());g.closeReserve();assert.equal(s.reserve.cardId,null);
  assert(!g.confirmReserve());assert(g.applyReserve('store',card.id));
  assert.equal(s.reserve.cardId,card.id);assert(!s.hand.includes(card));assert(s.hand.includes(next));
  assert.equal(s.hand.length,before.size);assert.equal(s.drawPile.length,before.draw-1);
  assert.equal(s.money,before.money);assert.equal(s.handsLeft,before.hands);assert.equal(s.discLeft,before.discards);
  assert.equal(s.cardsAdded,0);assert.equal(s.totHands,0);
  assert.equal(new Set(ids(s)).size,52);assert.deepEqual(s.deckAll,deck);
  assert(!g.applyReserve('store',s.hand[0].id));assert(!g.confirmReserve());
});

test('换回保留全部强化，替换牌本盲不再抽到，新盲次数与牌组恢复',()=>{
  const {g,s}=start(),card=s.hand[0];
  Object.assign(card,{bonus:90,multB:4,ed:3,seal:'red',wild:true,steel:true,glass:true});
  assert(g.applyReserve('store',card.id));const out=s.hand[0],draw=s.drawPile.length;
  assert(g.applyReserve('retrieve',out.id));assert.equal(s.reserve.used,true);assert.equal(s.reserve.cardId,null);
  assert(s.hand.includes(card));assert(!s.hand.includes(out));assert(!s.drawPile.includes(out));
  assert.equal(s.drawPile.length,draw);assert.equal(s.deckAll.length,52);assert.equal(new Set(ids(s)).size,51);
  for(const [key,value] of Object.entries({bonus:90,multB:4,ed:3,seal:'red',wild:true,steel:true,glass:true}))assert.equal(card[key],value);
  assert(!g.applyReserve('retrieve',s.hand[0].id));assert(!g.openReserve());
  g.startBlind();assert.equal(s.reserve.used,false);assert.equal(new Set(ids(s)).size,52);
  assert([...s.hand,...s.drawPile].includes(card));assert([...s.hand,...s.drawPile].includes(out));
});

test('藏起的钢铁红封牌不触发留手效果、金币或节奏，真实出牌仍按预览计分',async()=>{
  const {g,s}=start(),two=s.deckAll[0],steel=s.deckAll[1];
  Object.assign(steel,{steel:true,seal:'red',goldc:true});
  s.hand=[two,steel,...s.deckAll.slice(10,16)];s.drawPile=s.deckAll.filter(c=>!s.hand.includes(c));
  assert.equal(g.scoreHand(s,[two]).total,15);
  assert(g.applyReserve('store',steel.id));const preview=g.scoreHand(s,[two]);
  assert.equal(preview.total,7);assert.equal(preview.money,0);assert(!preview.events.some(e=>e.kind==='held'));
  const money=s.money;s.target=1e6;g.selectCards([two.id]);await g.doPlay();
  assert.equal(s.lastResult.total,7);assert.equal(s.money,money);assert.equal(s.reserve.cardId,steel.id);
  assert(!s.hand.includes(steel));assert(g.applyReserve('retrieve',s.hand[0].id));
  const scored=s.hand.find(c=>c!==steel),result=g.scoreHand(s,[scored]);
  assert(result.events.some(e=>e.kind==='held'&&e.id===steel.id));
});

test('藏牌与换回均可冷恢复，原牌引用唯一，检查点回溯不复制底牌',()=>{
  const {g,s,load}=start(),card=s.hand[0];assert(g.applyReserve('store',card.id));
  load('session');g.persistRun();g.resumeGame();let state=g.getState();
  assert.equal(state.reserve.cardId,card.id);assert.equal(new Set(ids(state)).size,52);
  assert(state.hand.every(c=>state.deckAll.includes(c)));assert(!state.hand.some(c=>c.id===card.id));
  assert(g.applyReserve('retrieve',state.hand[0].id));g.persistRun();g.resumeGame();state=g.getState();
  assert(state.reserve.used);assert(state.hand.includes(state.deckAll.find(c=>c.id===card.id)));
  g.restoreCheckpoint();state=g.getState();assert.equal(state.reserve.cardId,null);assert(!state.reserve.used);
  g.chooseBlind();assert.equal(new Set(ids(state)).size,52);assert(g.applyReserve('store',state.hand[0].id));
});

test('旧 v1–v4 存档补默认底牌，重复/缺失引用拒绝并恢复有效备份',()=>{
  const {g,s,load,storage}=start();load('session');g.persistRun();
  const original=JSON.parse(storage.get('pixel-balatro.run.v1'));
  for(const version of [1,2,3,4]) {
    const old=JSON.parse(JSON.stringify(original));old.version=version;delete old.state.reserve;
    const check=JSON.parse(old.checkpoint);delete check.reserve;old.checkpoint=JSON.stringify(check);
    const decoded=g.decodeRun(JSON.stringify(old));assert(decoded);assert.equal(decoded.state.reserve.cardId,null);assert(!decoded.state.reserve.used);
  }
  for(const reserve of [{cardId:s.hand[0].id,used:false},{cardId:999999,used:false},{cardId:s.hand[0].id,used:true}]) {
    const bad=JSON.parse(JSON.stringify(original));bad.state.reserve=reserve;assert.equal(g.decodeRun(JSON.stringify(bad)),null);
  }
  assert(g.applyReserve('store',s.hand[0].id));g.persistRun();
  const bad=JSON.parse(storage.get('pixel-balatro.run.v1'));bad.state.reserve.cardId=999999;
  storage.set('pixel-balatro.run.v1',JSON.stringify(bad));assert(g.readRun().recovered);
});

test('牌库空、忙碌、非对局和多人不误扣资源；牌库空仍可换回',()=>{
  const {g,s,run}=start(),card=s.hand[0],money=s.money;
  s.busy=true;assert(!g.applyReserve('store',card.id));s.busy=false;
  run('MP.on=true');assert(!g.openReserve());assert(!g.applyReserve('store',card.id));run('MP.on=false');
  s.screen='shop';assert(!g.applyReserve('store',card.id));s.screen='play';
  const pile=s.drawPile;s.drawPile=[];assert(!g.applyReserve('store',card.id));s.drawPile=pile;
  assert(!g.applyReserve('store',-1));assert(g.applyReserve('store',card.id));s.drawPile=[];
  assert(g.applyReserve('retrieve',s.hand[0].id));assert.equal(s.money,money);
});

test('塔罗销毁手牌不碰底牌，换回后的牌可以计分，下一盲重置底牌',async()=>{
  const h=harness(29),g=h.game;g.newGame(false);const s=g.getState();g.chooseBlind();
  const card=s.hand[0];assert(g.applyReserve('store',card.id));
  s.cons=[{id:'tower',kind:'tarot',price:3}];g.selectCards([s.hand[0].id]);g.useCons(0);
  assert(s.deckAll.includes(card));assert.equal(s.reserve.cardId,card.id);assert.equal(s.discLeft,s.baseDisc);
  assert(g.applyReserve('retrieve',s.hand[0].id));s.target=1;g.selectCards([card.id]);await g.doPlay();
  assert.equal(s.screen,'cash');
  g.openShop();g.leaveShop();assert.equal(s.reserve.cardId,null);assert(!s.reserve.used);
});

test('陈旧商店操作及弹层中的购买、刷新不崩溃也不扣钱',()=>{
  const {g,s}=start();
  for(const fn of [()=>g.buyJoker(0),()=>g.buyCons(0),()=>g.buyVoucher(),()=>g.buyPack(0),()=>g.doReroll()])assert.equal(fn(),false);
  g.beatBlind();g.openShop();s.money=100;const before=s.money;
  for(const flag of ['pack','busy']) {
    s[flag]=true;assert.equal(g.buyPack(0),false);assert.equal(g.buyJoker(0),false);assert.equal(g.doReroll(),false);s[flag]=false;
  }
  assert(g.openWorkshop('copy'));assert.equal(g.buyCons(0),false);assert.equal(g.buyVoucher(),false);g.closeWorkshop();
  assert.equal(s.money,before);g.leaveShop();assert.equal(g.doReroll(),false);assert.equal(g.buyPack(0),false);
});

test('藏牌后的计分中断恢复出牌前稳定状态，不丢底牌或重复得分',async()=>{
  const {g,s,load}=start();load('session');const stored=s.hand[0];
  assert(g.applyReserve('store',stored.id));g.selectCards([s.hand[0].id]);g.persistRun();
  const hand=[...s.hand].map(c=>c.id),hands=s.handsLeft,score=s.score,money=s.money;
  const pending=g.doPlay();assert(s.busy);g.resumeGame();await pending;
  const state=g.getState();assert.equal(state.reserve.cardId,stored.id);assert.equal(state.handsLeft,hands);
  assert.equal(state.score,score);assert.equal(state.money,money);assert.deepEqual([...state.hand.map(c=>c.id)],hand);
  assert.equal(new Set(ids(state)).size,52);assert(!state.busy);
});
