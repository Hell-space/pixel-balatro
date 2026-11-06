// Pure scoring: animation, previews and tests consume the same calculation.
function scoreHand(state, cards, random = Math.random) {
  const hand = evalHand(cards);
  if (!hand.key) return {hand, chips:0, mult:0, total:0, money:0, events:[]};
  const base = handBase(hand.key, state);
  let chips = base.chips, mult = base.mult, money = 0;
  const events = [];
  const emit = (kind, id, text) => events.push({kind, id, text, chips, mult});
  const cardEffect = (card, count) => {
    if (count > 1) emit('card', card.id, '重复触发');
    chips += chipVal(card) + card.bonus;
    emit('card', card.id, '+' + (chipVal(card) + card.bonus) + ' 筹码');
    if (card.multB) { mult += card.multB; emit('card',card.id,'+'+card.multB+' 倍率'); }
    if (card.glass) { mult *= 2; emit('card',card.id,'×2 玻璃'); }
    if (card.ed === 1) { chips += 50; emit('card',card.id,'+50 闪箔'); }
    if (card.ed === 2) { mult += 10; emit('card',card.id,'+10 全息'); }
    if (card.ed === 3) { mult *= 1.5; emit('card',card.id,'×1.5 多彩'); }
    if (card.goldc) { money += 3; emit('card',card.id,'+$3 黄金'); }
    if (card.seal === 'gold') { money += 3; emit('card',card.id,'+$3 金封'); }
    for (const j of state.jokers) {
      const suitHit = suit => card.wild || card.suit === suit;
      let addC=0, addM=0, factor=1;
      if ((j.id==='greedy' && suitHit(3)) || (j.id==='lusty' && suitHit(1)) ||
          (j.id==='wrath' && suitHit(0)) || (j.id==='glut' && suitHit(2))) addM=3;
      if (j.id==='photo' && card.id===firstFace?.id) factor=2;
      if (j.id==='fib' && [14,2,3,5,8].includes(card.rank)) addM=8;
      if (j.id==='scary' && card.rank>=11 && card.rank<=13) addC=30;
      if (j.id==='even' && card.rank<=10 && card.rank%2===0) addM=4;
      if (j.id==='odd' && (card.rank===14 || (card.rank<=9 && card.rank%2===1))) addC=31;
      if (addC || addM || factor!==1) {
        chips+=addC; mult=(mult+addM)*factor;
        emit('joker',j.uid,addC?'+'+addC+' 筹码':addM?'+'+addM+' 倍率':'×'+factor+' 倍率');
      }
    }
  };
  const firstFace=hand.scoring.find(c=>c.rank>=11 && c.rank<=13 && !isDebuffed(c,state));
  for (const c of hand.scoring) {
    if (isDebuffed(c,state)) { emit('card',c.id,'禁用'); continue; }
    const repeats=(c.seal==='red'?1:0) + state.jokers.filter(j=>
      (j.id==='hack' && c.rank>=2 && c.rank<=5) || (j.id==='dusk' && state.handsLeft===0)).length;
    for (let n=0;n<=repeats;n++) cardEffect(c,n+1);
  }
  const selected=new Set(cards.map(c=>c.id));
  const held=state.hand.filter(c=>!selected.has(c.id) && !isDebuffed(c,state));
  for (const c of held) if (c.steel) {
    const times=c.seal==='red'?2:1;
    mult*=Math.pow(1.5,times); emit('held',c.id,times===2?'×2.25 钢铁 + 红封':'×1.5 钢铁');
  }
  for (const j of state.jokers) {
    let c=0,m=0,x=1;
    switch (j.id) {
      case 'joker': m=4; break;
      case 'jolly': if(hand.contains.pair) m=8; break;
      case 'zany': if(hand.contains.trips) m=12; break;
      case 'mad': if(hand.contains.twopair) m=10; break;
      case 'crazy': if(hand.contains.straight) m=12; break;
      case 'droll': if(hand.contains.flush) m=10; break;
      case 'sly': if(hand.contains.pair) c=50; break;
      case 'clever': if(hand.contains.twopair) c=80; break;
      case 'devious': if(hand.contains.straight) c=100; break;
      case 'crafty': if(hand.contains.flush) c=80; break;
      case 'half': if(cards.length<=3) m=20; break;
      case 'ice': case 'runner': c=j.state||0; break;
      case 'green': case 'bus': m=j.state||0; break;
      case 'abstract': m=state.jokers.length*3; break;
      case 'trio': if(hand.contains.trips) x=3; break;
      case 'family': if(hand.contains.quads) x=4; break;
      case 'misprint': m=Math.floor(random()*24); break;
      case 'gros': m=15; break;
      case 'nova': m=(state.playCounts[hand.key]||0)+1; break;
      case 'stencil': x=Math.max(1,state.jokerSlots-state.jokers.length+1); break;
      case 'constel': x=1+.1*state.planetsUsed; break;
      case 'holog': x=1+.25*state.cardsAdded; break;
      case 'baseball': x=Math.pow(1.5,state.jokers.filter(k=>k.rar===1 && k.uid!==j.uid).length); break;
      case 'baron': x=Math.pow(1.5,held.filter(k=>k.rank===13).reduce((n,k)=>n+(k.seal==='red'?2:1),0)); break;
      case 'moon': m=13*held.filter(k=>k.rank===12).reduce((n,k)=>n+(k.seal==='red'?2:1),0); break;
    }
    if(c || m || x!==1) {
      chips+=c; mult=(mult+m)*x;
      emit('joker',j.uid,c?'+'+c+' 筹码':m?'+'+m+' 倍率':'×'+(Math.round(x*100)/100)+' 倍率');
    }
    if(j.ed===1) { chips+=50; emit('joker',j.uid,'+50 闪箔'); }
    if(j.ed===2) { mult+=10; emit('joker',j.uid,'+10 全息'); }
    if(j.ed===3) { mult*=1.5; emit('joker',j.uid,'×1.5 多彩'); }
  }
  return {hand,base,chips,mult,total:Math.floor(chips*mult),money,events};
}
