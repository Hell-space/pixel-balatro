const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const context=vm.createContext({});
for(const name of ['cards','game','score-engine'])
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/js',name+'.js'),'utf8'),context);
const definitions=vm.runInContext('JDEFS',context);
const keys=vm.runInContext('HORDER',context);
const card=(rank,suit=3,id=rank)=>({id,rank,suit,bonus:0,multB:0,wild:false,steel:false,glass:false,goldc:false,ed:0,seal:null});
const hand=ranks=>ranks.map((rank,i)=>card(rank,i%4,i+1));
const joker=(id,more={})=>({...definitions.find(j=>j.id===id),uid:100,ed:0,state:0,...more});
const state=more=>({levels:Object.fromEntries(keys.map(k=>[k,1])),playCounts:{high:0},jokers:[],hand:[],
  boss:null,screen:'play',handsLeft:3,jokerSlots:5,planetsUsed:0,cardsAdded:0,money:0,tarotsUsed:0,...more});
const score=(cards,jokers=[],more={},random=()=>0)=>context.scoreHand(state({hand:cards,jokers,...more}),cards,random);

test('复制牌产生的三种牌型有独立分数与优先级',()=>{
  for(const [cards,key,total] of [
    [hand([9,9,9,9,9]),'five',1980],
    [hand([9,9,9,7,7]).map(c=>({...c,suit:1})),'flushhouse',2534],
    [hand([9,9,9,9,9]).map(c=>({...c,suit:1})),'flushfive',3280]]) {
    const result=score(cards); assert.equal(result.hand.key,key);assert.equal(result.total,total);
  }
});
test('每张小丑的独立效果都有明确的数值样例',()=>{
  const pairs=hand([2,2]), trips=hand([2,2,2]), four=hand([2,2,2,2]);
  const two=hand([2,2,3,3]),straight=hand([2,3,4,5,6]);
  const flush=hand([2,4,6,8,10]).map(c=>({...c,suit:3}));
  const tests=[
    ['joker',35],['greedy',28],['lusty',28,[card(2,1)]],['wrath',28,[card(2,0)]],['glut',28,[card(2,2)]],
    ['jolly',140,pairs],['zany',540,trips],['mad',360,two],['crazy',800,straight],['droll',910,flush],
    ['sly',128,pairs],['clever',220,two],['devious',600,straight],['crafty',580,flush],
    ['half',147],['ice',107,undefined,{state:100}],['green',49,undefined,{state:6}],
    ['runner',37,undefined,{state:30}],['photo',30,[card(13)]],['abstract',28],['bounty',7],
    ['trio',324,trips],['family',1904,four],['misprint',7],['fib',63],['scary',45,[card(13)]],
    ['even',35],['odd',39,[card(3)]],['hack',9],['dusk',9,undefined,{}, {handsLeft:0}],
    ['baron',10,undefined,{}, {hand:[card(2),card(13)]}],
    ['moon',98,undefined,{}, {hand:[card(2),card(12)]}],
    ['golden',7],['egg',7],['gros',112],['stencil',35],
    ['nova',28,undefined,{}, {playCounts:{high:2}}],['bus',28,undefined,{state:3}],
    ['constel',10,undefined,{}, {planetsUsed:5}],['holog',14,undefined,{}, {cardsAdded:4}],
    ['baseball',10,undefined,{}, {jokers:[joker('baseball'),joker('green',{uid:101,rar:1})]}],
    ['scholar',180,[card(14)]],['duo',56,pairs],['tribe',520,flush],['order',600,straight],
    ['blackboard',21,undefined,{}, {hand:[card(2),card(3,0)]}],
    ['boots',77,undefined,{}, {money:25}],['fortune',35,undefined,{}, {tarotsUsed:4}],['compass',32],
  ];
  assert.deepEqual(tests.map(x=>x[0]).sort(),Array.from(definitions,j=>j.id).sort());
  for(const [id,total,cards=[card(2)],dynamic={},extra={}] of tests)
    assert.equal(score(cards,[joker(id,dynamic)],extra).total,total,id);
});
test('黑板需要真实留牌，面具禁用人头与红封；学者重复触发两种加成',()=>{
  assert.equal(score([card(2)],[joker('blackboard')]).total,7);
  assert.equal(score([card(2)],[joker('blackboard')],{hand:[card(2),card(13,0)],boss:{id:'mark'}}).total,7);
  assert.equal(score([{...card(13),seal:'red'}],[joker('photo')],{boss:{id:'mark'}}).total,5);
  assert.equal(score([{...card(14),seal:'red'}],[joker('scholar')]).total,603);
});
test('摄影师与黑客/黄昏支持多张叠加和红蜡封重复',()=>{
  assert.equal(score([{...card(13),seal:'red'}],[joker('photo'),joker('photo',{uid:101})]).total,400);
  assert.equal(score([{...card(2),seal:'red'}],[joker('hack'),joker('hack',{uid:101}),
    joker('dusk',{uid:102}),joker('dusk',{uid:103})],{handsLeft:0}).total,17);
});
test('同样小丑换序影响乘法顺序，且计算不修改牌组',()=>{
  const cards=hand([2,2,2]), add=joker('jolly'), multiply=joker('trio',{uid:101});
  assert.equal(score(cards,[add,multiply]).total,1188);
  assert.equal(score(cards,[multiply,add]).total,612);
  const input=state({hand:cards,jokers:[add,multiply]});
  const before=JSON.stringify(input);context.scoreHand(input,cards);assert.equal(JSON.stringify(input),before);
});
test('钢铁红封、黄金及禁用万能牌，随机预览不会消费随机源',()=>{
  const selected=[card(2)],held={...card(8),steel:true,seal:'red'};
  assert.equal(score(selected,[],{hand:[...selected,held]}).total,15);
  const gold={...card(2),goldc:true,seal:'red'};
  assert.equal(score([gold]).money,6);
  assert.equal(score([{...card(14),wild:true}],[],{boss:{id:'hearts'}}).total,5);
  assert.equal(score([card(2)],[joker('misprint')],{},()=>.999999).total,168);
});
