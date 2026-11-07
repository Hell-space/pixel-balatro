const {test}=require('node:test');
const assert=require('node:assert/strict');
const {harness}=require('./game-harness.cjs');
const card=(rank,suit=3,id=rank)=>({id,rank,suit,bonus:0,multB:0,wild:false,steel:false,glass:false,goldc:false,ed:0,seal:null});
const ids=cards=>cards.map(c=>c.id);
function playing(seed=1){
  const {game:g,run}=harness(seed);g.newGame(false);const s=g.getState();g.startBlind();return {g,run,s};
}
test('每个 Boss 都有一个有效破绽，只在该 Boss 盲注以该牌型 ×1.5，并显示在说明中',()=>{
  const {g,run}=playing();const {BOSSES,HANDS}=g.getDefinitions();
  for(const boss of BOSSES){assert(HANDS[boss.weak],boss.id);assert.match(g.bossWeakLabel(boss),/破绽：.+ ×1\.5/);}
  for(const id of ['psychic'])assert(['straight','flush','fh'].includes(BOSSES.find(b=>b.id===id).weak));
  const s=g.getState();const pair=[card(9,0,1),card(9,1,2)],weak={id:'arm',weak:'pair'};
  const normal=g.scoreHand({...s,boss:null,jokers:[],hand:pair},pair,()=>0).total;
  const boss=g.scoreHand({...s,boss:weak,jokers:[],hand:pair},pair,()=>0);
  assert.equal(normal,56);assert.equal(boss.total,84);assert.equal(boss.events.at(-1).kind,'weak');
  const other=g.scoreHand({...s,boss:{id:'arm',weak:'trips'},jokers:[],hand:pair},pair,()=>0);
  assert.equal(other.total,56);assert(!other.events.some(e=>e.kind==='weak'));
  assert.equal(run('bossWeakKey({id:"x",weak:"nope"})'),null);
});
test('破绽猎手在同底注小盲也生效；Boss 中与 ×1.5 叠加且先加后乘',()=>{
  const {g}=playing();const s=g.getState();const pair=[card(9,0,1),card(9,1,2)];
  const jokers=[{id:'weakspot',uid:7,ed:0,state:0}];
  const small=g.scoreHand({...s,boss:null,anteBoss:{id:'arm',weak:'pair'},jokers,hand:pair},pair,()=>0);
  assert.equal(small.total,28*12);
  const boss=g.scoreHand({...s,boss:{id:'arm',weak:'pair'},anteBoss:{id:'arm',weak:'pair'},jokers,hand:pair},pair,()=>0);
  assert.equal(boss.total,Math.floor(28*12*1.5));
});
test('碾压奖励按完整倍数发放并有上限，碾压锤翻倍；结算明细列出并计入合计',()=>{
  const {g}=playing();
  for(const [score,money,crush] of [[599,0,0],[600,1,0],[899,1,0],[900,2,0],[5000,3,0],[600,2,1],[1200,6,1],[9999,6,1]]){
    const st={target:300,score,jokers:crush?[{id:'crusher'}]:[]};
    assert.equal(g.overkillBonus(st).money,money,score+'/'+crush);
  }
  const s=g.getState();s.score=s.target*3;const before=s.money;g.beatBlind();
  const row=s.payout.find(([label])=>label.startsWith('碾压'));assert(row);assert.equal(row[1],2);
  assert.equal(s.payout.at(-1)[1],s.money-before);
});
test('节拍器让节奏连招倍率翻倍，上限同步翻倍',()=>{
  const {g}=playing();const s=g.getState();s.rhythmMode='focus';
  assert.equal(g.rhythmForHand({...s,rhythm:{lastKey:'pair',chain:2},jokers:[]},'pair').bonus,4);
  assert.equal(g.rhythmForHand({...s,rhythm:{lastKey:'pair',chain:2},jokers:[{id:'metronome'}]},'pair').bonus,8);
  assert.equal(g.rhythmForHand({...s,rhythm:{lastKey:'pair',chain:5},jokers:[{id:'metronome'}]},'pair').bonus,16);
});
test('同心结需要至少三张同色，百搭牌可配合任一颜色',()=>{
  const {g}=playing();const s=g.getState();const j=[{id:'twins',uid:3,ed:0,state:0}];
  const red=[card(2,1,1),card(5,3,2),{...card(9,0,3),wild:true}],mixed=[card(2,1,1),card(5,0,2),card(9,1,3)];
  assert.equal(g.scoreHand({...s,boss:null,jokers:j,hand:red},red,()=>0).total,378);
  assert.equal(g.scoreHand({...s,boss:null,jokers:j,hand:mixed},mixed,()=>0).total,14);
  const two=[card(2,1,1),card(9,1,2)];
  assert.equal(g.scoreHand({...s,boss:null,jokers:j,hand:two},two,()=>0).total,14);
});
test('推荐选出保底最高分组合，并遵守通灵者和独眼的限制，且不改变状态',()=>{
  const {g}=playing();const s=g.getState();
  s.hand=[card(14,0,1),card(14,1,2),card(9,2,3),card(9,3,4),card(4,0,5),card(7,1,6),card(2,2,7),card(3,0,8)];
  s.jokers=[];s.boss=null;const snapshot=JSON.stringify(s);
  const best=g.bestSelection(s);
  assert.equal(best.key,'twopair');assert.deepEqual([...best.ids].sort(),[1,2,3,4]);assert.equal(JSON.stringify(s),snapshot);
  s.boss={id:'psychic',weak:'straight'};assert.equal(g.bestSelection(s).ids.length,5);
  s.boss={id:'eye',weak:'flush'};s.blindPlayed=['twopair'];assert.notEqual(g.bestSelection(s).key,'twopair');
  s.boss={id:'psychic'};s.hand=s.hand.slice(0,4);assert.equal(g.bestSelection(s),null);
});
test('推荐计入小丑：持有偶数小丑时偏好偶数高牌，同分时少出牌',()=>{
  const {g}=playing();const s=g.getState();s.boss=null;
  s.hand=[card(13,0,1),card(4,1,2),card(6,2,3)];s.jokers=[{id:'even',uid:5,ed:0,state:0}];
  const best=g.bestSelection(s);assert.equal(best.total,g.scoreHand({...s,handsLeft:s.handsLeft-1},s.hand.filter(c=>best.ids.includes(c.id)),()=>0).total);
  assert.deepEqual([...best.ids],[3]);assert.equal(best.total,55);
});
test('节拍器只在单人商店出现，多人模式卡池排除',()=>{
  const {game:g,run}=harness(3);g.newGame(false);
  assert.equal(run('jokerOffered({id:"metronome"})'),true);
  run('MP.on=true');assert.equal(run('jokerOffered({id:"metronome"})'),false);assert.equal(run('jokerOffered({id:"finale"})'),true);
  for(let i=0;i<200;i++)assert.notEqual(run('rollJokerItem(false).id'),'metronome');
});
