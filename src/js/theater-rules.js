// Each bill is a small, self-contained deal. The live run and its save slot are never needed.
const THEATER_BILLS = [
  {id:'short', title:'午夜短场', mark:'Ⅲ', theme:'ochre', hands:1, goal:600, encore:1380,
    cards:['♠K','♥K','♣K','♦Q','♠J','♥10','♣9','♦2'], jokers:['half'],
    brief:'三位国王和一条顺子，都赶着上台。',
    hints:['半张小丑看的是你送上台的总张数。','试着只打国王，再加一张杂牌比较预览。']},
  {id:'chalk', title:'黑板擦痕', mark:'♣', theme:'blue', hands:1, goal:300, encore:360,
    cards:['♠A','♣A','♥9','♦9','♥2','♠K','♣Q','♠4'], jokers:['blackboard'],
    brief:'黑板上剩下什么，决定这手两对值多少钱。',
    hints:['先选两对，再看看手里剩下了什么颜色。','有一张红牌自己不计分，却能让整手倍率翻三倍。']},
  {id:'queen', title:'王后留座', mark:'Q', theme:'rose', hands:1, goal:2500, encore:3920,
    cards:['♠Q','♥Q','♣Q','♠K','♠10','♠8','♠5','♠2'], effects:{'♠Q':{seal:'red'}}, jokers:['moon'],
    brief:'六张黑桃里有一张红蜡封王后。给谁留个座位？',
    hints:['射月会数留在手中的 Q。','红蜡封也会重复留手效果。用黑桃 2 换下同花里的 Q 试试。']},
  {id:'duet', title:'错位双簧', mark:'×', theme:'blue', hands:1, goal:2000, encore:2592,
    cards:['♠8','♥8','♣8','♦4','♠4','♣K','♦Q','♠2'], jokers:['trio','jolly'], canSwap:true,
    brief:'两位搭档都会上场，由你决定谁先开口。',
    hints:['同一手葫芦能同时触发这两张小丑。','对调小丑，观察先加倍率再乘倍率的差别。']},
  {id:'sleeve', title:'袖口藏王牌', mark:'A', theme:'rose', hands:1, discards:1, goal:1500, encore:2448,
    cards:['♣A','♦A','♠K','♥K','♣8','♥6','♠4','♦2'], stock:['♦K','♠A'], jokers:['scholar'],
    brief:'袖口里先是 K，再是 A。你只有一次弃牌机会。',
    hints:['一次可以弃多张，补牌区会从左到右发牌。','两个葫芦的牌型相同，学者更喜欢其中一种。']},
  {id:'dusk', title:'黄昏谢幕', mark:'Ⅱ', theme:'ochre', hands:2, goal:3750, encore:3886,
    cards:['♥Q','♥J','♥9','♥6','♥2','♠K','♣K','♦K'], jokers:['dusk','lusty'],
    brief:'八张牌分两幕打完。黄昏只等最后一手。',
    hints:['把两手合起来算。第一手就打出最贵的牌，可能少听一轮掌声。','最后一手的红桃能重复增加筹码和倍率，先把三张 K 打出去。']},
];

function createTheaterRun(bill) {
  const cards = bill.cards.concat(bill.stock || []).map((code,index) => ({
    code, id:index+1, suit:SUITS.indexOf(code[0]),
    rank:Number(code.slice(1)) || {A:14,K:13,Q:12,J:11}[code.slice(1)],
    bonus:0, multB:0, seal:null, ed:0, sel:false, ...bill.effects?.[code],
  }));
  return {
    bill, hand:cards.slice(0,bill.cards.length), stock:cards.slice(bill.cards.length),
    jokers:bill.jokers.map((id,i) => ({...JDEFS.find(j=>j.id===id), uid:i+1})),
    levels:{}, playCounts:{}, blindPlayed:[], boss:null, screen:'play', score:0,
    handsLeft:bill.hands, discLeft:bill.discards || 0, history:[], finished:false,
  };
}

function theaterPreview(run) {
  const cards=run.hand.filter(c=>c.sel);
  return cards.length ? scoreHand({...run,handsLeft:run.handsLeft-1},cards) : null;
}

function actInTheater(run, action) {
  if (run.finished || !['play','discard'].includes(action)) return false;
  const selected=run.hand.filter(c=>c.sel);
  if (!selected.length || selected.length>5) return false;
  if (action==='discard') {
    if (run.discLeft<=0 || !run.stock.length) return false;
    run.discLeft--;
    run.history.push({action,cards:selected.map(c=>c.code)});
  } else {
    const result=theaterPreview(run);
    run.handsLeft--;
    run.score+=result.total;
    run.blindPlayed.push(result.hand.key);
    run.playCounts[result.hand.key]=(run.playCounts[result.hand.key]||0)+1;
    run.history.push({action,name:HANDS[result.hand.key].name,cards:selected.map(c=>c.code),
      chips:result.chips,mult:result.mult,total:result.total});
  }
  run.hand=run.hand.filter(c=>!c.sel);
  if (run.handsLeft>0) run.hand.push(...run.stock.splice(0,selected.length));
  run.finished=run.handsLeft===0 || !run.hand.length;
  return true;
}

function theaterDayKey(date = new Date()) {
  return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
}

function dailyTheaterBill(day) {
  let seed=Number(day.replace(/-/g,''));
  function random() {
    seed=(seed+0x6d2b79f5)>>>0;
    let value=Math.imul(seed^(seed>>>15),seed|1);
    value^=value+Math.imul(value^(value>>>7),value|61);
    return ((value^(value>>>14))>>>0)/4294967296;
  }
  const programs=[
    {jokers:['duo','jolly'], ranks:[8,8], clue:'加倍率和乘倍率都会响应对子。'},
    {jokers:['baron','moon'], ranks:[13,12,12], clue:'试试把 K 和 Q 留在观众席。'},
    {jokers:['blackboard','half'], ranks:[7,7], clue:'上台的张数、留下的颜色都算数。'},
    {jokers:['trio','jolly'], ranks:[6,6,6], clue:'三条同样能触发写着「含对子」的小丑。'},
  ];
  const program=programs[Math.floor(random()*programs.length)];
  const deck=shuffle(SUITS.flatMap(suit=>Array.from({length:13},(_,i)=>suit+rankName(i+2))),random);
  const cards=program.ranks.map(rank=>deck.splice(deck.findIndex(code=>code.slice(1)===String(rankName(rank))),1)[0]);
  cards.push(...deck.slice(0,8-cards.length));
  const bonusCard=cards[Math.floor(random()*cards.length)];
  shuffle(cards,random);
  const bill={id:'daily-'+day,title:'每日加演',mark:'✦',theme:'ochre',day,hands:1,cards,jokers:program.jokers,
    effects:{[bonusCard]:{bonus:30}},canSwap:true,
    brief:'今天有一张牌额外加 30 筹码。你能把它用在最好的一手吗？',
    hints:[program.clue,'先定出牌，再对调两张小丑，对照同一手的分数。']};
  // Score both possible joker orders with the production solver. Each day's top score is attainable.
  const run=createTheaterRun(bill);
  const original=bestSelection(run).total;
  run.jokers.reverse();
  bill.encore=Math.max(original,bestSelection(run).total);
  bill.goal=Math.max(1,Math.floor(bill.encore*0.72/10)*10);
  return bill;
}
