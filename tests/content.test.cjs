const {test}=require('node:test');
const assert=require('node:assert/strict');
const {harness}=require('./game-harness.cjs');
test('五种牌组与难度只改变明示规则，旧版默认和多人保持原始起手',()=>{
  const {game:g}=harness();
  for(const [id,money,hands,disc,slots] of [['classic',4,4,3,5],['red',4,4,4,5],['blue',0,5,3,5],['yellow',10,4,3,5],['green',4,4,3,5],['black',4,3,3,6]]){
    g.newGame(false,id);const s=g.getState();assert.deepEqual([s.money,s.baseHands,s.baseDisc,s.jokerSlots],[money,hands,disc,slots]);
  }
  g.newGame(false,'red','gold');const s=g.getState();assert.equal(s.baseDisc,3);assert.equal(g.blindMetaFor(0).target,300);
  s.ante=2;assert.equal(g.blindMetaFor(0).target,1120);
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
