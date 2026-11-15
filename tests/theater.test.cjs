const {test}=require('node:test');
const assert=require('node:assert/strict');
const {harness}=require('./game-harness.cjs');

function theater() {
  const h=harness(39);
  h.load('theater-rules');
  return {g:h.game,bills:h.run('THEATER_BILLS')};
}
function select(run,codes) {run.hand.forEach(c=>{c.sel=codes.includes(c.code);});}

// Enumerate the legal first moves when a puzzle has a refill or a second hand.
// The shared production solver handles the remaining single play.
function highestFinish(g,run) {
  const orders=[run.jokers];
  if (run.bill.canSwap) orders.push([...run.jokers].reverse());
  let best=0;
  for (const jokers of orders) {
    best=Math.max(best,run.score+g.bestSelection({...run,jokers}).total);
    if (run.handsLeft===1 && !run.discLeft) continue;
    const action=run.discLeft?'discard':'play';
    for (let mask=1;mask<2**run.hand.length;mask++) {
      const attempt={...run,jokers,hand:run.hand.map((c,i)=>({...c,sel:!!(mask&(1<<i))})),
        stock:[...run.stock],history:[],blindPlayed:[],playCounts:{}};
      if (!g.actInTheater(attempt,action) || !attempt.hand.length) continue;
      best=Math.max(best,attempt.score+g.bestSelection(attempt).total);
    }
  }
  return best;
}

test('六个残局的满堂彩均为全部合法打法中的最高分',()=>{
  const {g,bills}=theater();
  assert.equal(new Set(bills.map(b=>b.id)).size,6);
  for (const bill of bills) {
    const run=g.createTheaterRun(bill);
    assert.equal(new Set([...run.hand,...run.stock].map(c=>c.code)).size,run.hand.length+run.stock.length);
    assert.equal(highestFinish(g,run),bill.encore,bill.title);
    assert(bill.goal>0 && bill.goal<=bill.encore);
  }
});

test('同一手葫芦调序前后分数不同，预览、出牌及重演一致',()=>{
  const {g,bills}=theater(),bill=bills.find(b=>b.id==='duet'),run=g.createTheaterRun(bill);
  select(run,['♠8','♥8','♣8','♦4','♠4']);
  assert.equal(g.theaterPreview(run).total,1440);
  run.jokers.reverse();
  assert.equal(g.theaterPreview(run).total,2592);
  assert(g.actInTheater(run,'play'));assert.equal(run.score,2592);
  assert(run.finished);assert.equal(g.actInTheater(run,'play'),false);
  assert.deepEqual(Array.from(g.createTheaterRun(bill).jokers,j=>j.id),['trio','jolly']);
});

test('换牌保留顺序、收回选中状态，只花一次弃牌，超选五张不消耗动作',()=>{
  const {g,bills}=theater(),run=g.createTheaterRun(bills.find(b=>b.id==='sleeve'));
  run.hand.forEach(c=>c.sel=true);assert(!g.actInTheater(run,'discard'));assert.equal(run.discLeft,1);
  select(run,['♠4','♦2']);assert(g.actInTheater(run,'discard'));
  assert.equal(run.discLeft,0);assert.equal(run.handsLeft,1);assert.equal(run.stock.length,0);
  assert.deepEqual(Array.from(run.hand.slice(-2),c=>c.code),['♦K','♠A']);
  assert(!run.hand.some(c=>c.sel));assert(!g.actInTheater(run,'play'));
  select(run,['♣A','♦A','♠A','♠K','♥K']);
  assert(!g.actInTheater(run,'discard'));assert(g.actInTheater(run,'play'));
  assert.equal(run.score,2448);
});

test('黄昏最后一手生效，相同八张牌两种顺序得到不同总分',()=>{
  const {g,bills}=theater(),bill=bills.find(b=>b.id==='dusk');
  const hearts=bill.cards.slice(0,5),kings=bill.cards.slice(5);
  function play(order) {
    const run=g.createTheaterRun(bill);
    for(const codes of order){select(run,codes);assert(g.actInTheater(run,'play'));}
    assert(run.finished);return run.score;
  }
  assert.equal(play([kings,hearts]),3886);assert.equal(play([hearts,kings]),1638);
});

test('每日加演按本地日期生成，重试确定、不同日期有变化、两种顺序都纳入最高分',()=>{
  const {g}=theater();
  assert.equal(g.theaterDayKey(new Date(2026,0,2,0,3)),'2026-01-02');
  g.Math.random=()=>{throw Error('daily puzzle used external randomness');};
  const deals=new Set();
  for(let i=1;i<=93;i++){
    const day=g.theaterDayKey(new Date(2026,0,i)),bill=g.dailyTheaterBill(day);
    assert.equal(JSON.stringify(g.dailyTheaterBill(day)),JSON.stringify(bill));
    assert.equal(new Set(bill.cards).size,8);assert(bill.goal>0&&bill.goal<=bill.encore);
    assert.equal(highestFinish(g,g.createTheaterRun(bill)),bill.encore);
    deals.add(bill.cards.join(' '));
  }
  assert.equal(deals.size,93);
});
