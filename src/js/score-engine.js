// Pure scoring: animation, previews and tests consume the same calculation.
const WEAK_MULT=1.5;
function rhythmForHand(state,key) {
  const mode=state.rhythmMode,previous=state.rhythm||{lastKey:null,chain:0};
  if(!['focus','flow'].includes(mode))return {lastKey:null,chain:0,bonus:0};
  const continues=previous.lastKey&&(mode==='focus'?previous.lastKey===key:previous.lastKey!==key);
  const chain=continues?Math.min(5,previous.chain+1):1;
  const step=(state.jokers||[]).some(j=>j.id==='metronome')?4:2;
  return {lastKey:key,chain,bonus:(chain-1)*step};
}
// Each Boss shows one hand type it is weak against; the same hand gets ×1.5 in that Boss blind.
function bossWeakKey(boss) { return boss&&HANDS[boss.weak]?boss.weak:null; }
function bossWeakLabel(boss) {
  const key=bossWeakKey(boss);
  return key?'破绽：'+HANDS[key].name+' ×'+WEAK_MULT:'';
}
// Beating a blind with at least twice the target pays $1 per full extra multiple.
function overkillBonus(state) {
  if(!state.target||state.score<state.target*2)return {ratio:state.target?state.score/state.target:0,money:0};
  const crushers=(state.jokers||[]).filter(j=>j.id==='crusher').length;
  const cap=crushers?6:3,ratio=state.score/state.target;
  return {ratio,money:Math.min(cap,(Math.floor(ratio)-1)*(crushers?2:1))};
}
// Picks the selection with the best guaranteed score, respecting Boss restrictions.
function bestSelection(state) {
  const hand=state.hand||[],n=hand.length,scoringState={...state,handsLeft:state.handsLeft-1};
  let best=null;
  const consider=cards=>{
    if(state.boss?.id==='psychic'&&cards.length!==5)return;
    const result=scoreHand(scoringState,cards,()=>0);
    if(state.boss?.id==='eye'&&(state.blindPlayed||[]).includes(result.hand.key))return;
    if(!best||result.total>best.total||(result.total===best.total&&cards.length<best.cards.length))
      best={total:result.total,cards:cards.slice(),key:result.hand.key};
  };
  const pick=[];
  const walk=start=>{
    if(pick.length)consider(pick);
    if(pick.length===5)return;
    for(let i=start;i<n;i++){pick.push(hand[i]);walk(i+1);pick.pop();}
  };
  walk(0);
  return best?{ids:best.cards.map(c=>c.id),total:best.total,key:best.key}:null;
}
function jokerStateForHand(joker, hand, cards) {
  const value=joker.state||0;
  if(joker.id==='green') return value+1;
  if(joker.id==='runner') return value+(hand.contains.straight?15:0);
  if(joker.id==='bus') return cards.some(c=>c.rank>=11&&c.rank<=13)?0:value+1;
  return value;
}
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
      if (j.id==='scholar' && card.rank===14) { addC=20; addM=4; }
      if (j.id==='prism' && card.wild) factor=1.5;
      if (addC || addM || factor!==1) {
        chips+=addC; mult=(mult+addM)*factor;
        emit('joker',j.uid,addC?'+'+addC+' 筹码'+(addM?' / +'+addM+' 倍率':''):addM?'+'+addM+' 倍率':'×'+factor+' 倍率');
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
  const rhythm=rhythmForHand(state,hand.key);
  if(rhythm.bonus) {
    mult+=rhythm.bonus;
    emit('rhythm',null,(state.rhythmMode==='focus'?'专注':'变奏')+' '+rhythm.chain+' 连 · +'+rhythm.bonus+' 倍率');
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
      case 'ice': c=j.state||0; break;
      case 'runner': c=jokerStateForHand(j,hand,cards); break;
      case 'green': case 'bus': m=jokerStateForHand(j,hand,cards); break;
      case 'abstract': m=state.jokers.length*3; break;
      case 'trio': if(hand.contains.trips) x=3; break;
      case 'family': if(hand.contains.quads) x=4; break;
      case 'duo': if(hand.contains.pair) x=2; break;
      case 'tribe': if(hand.contains.flush) x=2; break;
      case 'order': if(hand.contains.straight) x=3; break;
      case 'blackboard': {
        const remaining=state.hand.filter(k=>!selected.has(k.id));
        if(remaining.length&&remaining.every(k=>!isDebuffed(k,state)&&(k.wild||k.suit===0||k.suit===2)))x=3;
        break;
      }
      case 'boots': m=2*Math.floor(state.money/5); break;
      case 'fortune': m=state.tarotsUsed||0; break;
      case 'compass': c=25*new Set([...Object.keys(state.playCounts).filter(k=>state.playCounts[k]>0),hand.key]).size; break;
      case 'misprint': m=Math.floor(random()*24); break;
      case 'gros': m=15; break;
      case 'nova': m=(state.playCounts[hand.key]||0)+1; break;
      case 'stencil': x=Math.max(1,state.jokerSlots-state.jokers.length+1); break;
      case 'constel': x=1+.1*state.planetsUsed; break;
      case 'holog': x=1+.25*state.cardsAdded; break;
      case 'baseball': x=Math.pow(1.5,state.jokers.filter(k=>k.rar===1 && k.uid!==j.uid).length); break;
      case 'baron': x=Math.pow(1.5,held.filter(k=>k.rank===13).reduce((n,k)=>n+(k.seal==='red'?2:1),0)); break;
      case 'moon': m=13*held.filter(k=>k.rank===12).reduce((n,k)=>n+(k.seal==='red'?2:1),0); break;
      case 'weakspot': if(bossWeakKey(state.anteBoss)===hand.key) m=10; break;
      case 'finale': if(state.handsLeft===0) m=20; break;
      case 'twins': {
        const colors=new Set(cards.filter(k=>!k.wild).map(k=>RED(k.suit)));
        if(cards.length>=3&&colors.size<=1){c=40;m=6;}
        break;
      }
    }
    if(c || m || x!==1) {
      chips+=c; mult=(mult+m)*x;
      emit('joker',j.uid,c?'+'+c+' 筹码'+(m?' / +'+m+' 倍率':''):m?'+'+m+' 倍率':'×'+(Math.round(x*100)/100)+' 倍率');
    }
    if(j.ed===1) { chips+=50; emit('joker',j.uid,'+50 闪箔'); }
    if(j.ed===2) { mult+=10; emit('joker',j.uid,'+10 全息'); }
    if(j.ed===3) { mult*=1.5; emit('joker',j.uid,'×1.5 多彩'); }
  }
  if(state.boss&&bossWeakKey(state.boss)===hand.key) {
    mult*=WEAK_MULT; emit('weak',null,'破绽 · '+HANDS[hand.key].name+' ×'+WEAK_MULT);
  }
  return {hand,base,chips,mult,total:Math.floor(chips*mult),money,events,rhythm};
}
