const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const rules = vm.createContext({});
for (const file of ['cards','game']) {
  vm.runInContext(readFileSync(path.join(__dirname,'../src/js',file+'.js'),'utf8'),rules);
}
function deal(ranks,suits=[0,1,2,3,0]) {
  return ranks.map((rank,i)=>({rank,suit:suits[i]}));
}
test('九种基础牌型、踢脚牌与 A2345', () => {
  const fixtures=[
    ['高牌','high',[14,12,9,7,2],1],['对子','pair',[11,11,10,8,6],2],
    ['两对','twopair',[8,8,7,7,2],4],['三条','trips',[9,9,9,8,2],3],
    ['顺子','straight',[14,2,3,4,5],5],['同花','flush',[2,5,6,9,14],5,[1,1,1,1,1]],
    ['葫芦','fh',[9,9,9,4,4],5],['四条','four',[8,8,8,8,14],4],
    ['同花顺','sf',[5,6,7,8,9],5,[2,2,2,2,2]],
  ];
  for (const [name,key,ranks,n,suits] of fixtures) {
    const hand=rules.evalHand(deal(ranks,suits));
    assert.equal(hand.key,key,name); assert.equal(hand.scoring.length,n,name);
  }
  assert.equal(rules.evalHand(deal([13,14,2,3,4])).key,'high');
});
test('万能牌可补同花；不改变点数或让混合花色直接成同花',()=>{
  const cards=deal([2,5,8,10,14],[1,1,1,0,2]);
  cards[3].wild=true;
  assert.equal(rules.evalHand(cards).key,'high');
  cards[4].wild=true;
  assert.equal(rules.evalHand(cards).key,'flush');
});
test('升级与燧石只改变当局基础值；盲注偏移保持 300 / 450 / 600',()=>{
  vm.runInContext("S={ante:1,levels:{pair:2},boss:{id:'flint'},screen:'play'}",rules);
  assert.deepEqual([...Array(3)].map((_,i)=>rules.blindMetaFor(i).target),[300,450,600]);
  assert.equal(rules.handBase('pair').chips,13);
  assert.equal(rules.handBase('pair').mult,2);
  vm.runInContext("S.screen='shop'",rules);
  assert.equal(rules.handBase('pair').chips,25);
  assert.equal(rules.handBase('pair').mult,3);
});
