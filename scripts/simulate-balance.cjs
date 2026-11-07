// Uses production gameplay and economy. No forced wins, free money or hidden deck-order lookahead.
const {harness}=require('../tests/game-harness.cjs');
const fs=require('node:fs');
const path=require('node:path');
function subsets(cards,max=5) {
  const result=[];
  function walk(at,chosen){if(chosen.length)result.push(chosen);if(chosen.length===max)return;
    for(let i=at;i<cards.length;i++)walk(i+1,[...chosen,cards[i]]);}
  walk(0,[]);return result;
}
function chooser(g,s,cards=s.hand) {
  let best={total:-1,cards:[]};
  for(const chosen of subsets(cards)) {
    if(s.boss?.id==='psychic'&&chosen.length!==5)continue;
    if(s.boss?.id==='eye'&&s.blindPlayed?.includes(g.evalHand(chosen).key))continue;
    const result=g.scoreHand({...s,hand:cards,handsLeft:s.handsLeft-1},chosen,()=>.5);
    if(result.total>best.total)best={...result,cards:chosen};
  }return best;
}
function sample(pool,n,random){const a=pool.slice();for(let i=0;i<n&&i<a.length;i++){const j=i+Math.floor(random()*(a.length-i));[a[i],a[j]]=[a[j],a[i]];}return a.slice(0,n);}
function tryReserve(g,s,best,log) {
  if(typeof g.applyReserve!=='function'||s.reserve.used)return false;
  const stored=s.deckAll.find(c=>c.id===s.reserve.cardId);
  if(stored) {
    let choice=null,value=best.total;
    for(const card of s.hand) {
      const next=s.hand.filter(c=>c!==card).concat(stored),score=chooser(g,s,next).total;
      if(score>value){value=score;choice=card;}
    }
    if(choice&&g.applyReserve('retrieve',choice.id)) {
      log.push({kind:'reserve',action:'retrieve',ante:s.ante,blind:s.blindIdx,stored:stored.id,out:choice.id,before:best.total,after:value});return true;
    }
  } else if(s.handsLeft>=2&&s.drawPile.length&&s.score+best.total<s.target) {
    // Keep a useful spare outside the current scoring hand; never inspect the next draw.
    const spare=s.hand.filter(c=>!best.cards.includes(c)&&!c.steel).sort((a,b)=>(b.bonus+b.multB*5+b.rank)-(a.bonus+a.multB*5+a.rank))[0];
    if(spare&&g.applyReserve('store',spare.id)) {
      log.push({kind:'reserve',action:'store',ante:s.ante,blind:s.blindIdx,card:spare.id});return true;
    }
  }
  return false;
}
function discardChoice(g,s,random,best){
  const candidates=new Map(),put=keep=>{const ids=s.hand.filter(c=>!keep.includes(c)).slice(0,5).map(c=>c.id);if(ids.length)candidates.set(ids.join(','),ids);};
  for(let suit=0;suit<4;suit++)put(s.hand.filter(c=>c.suit===suit||c.wild));
  const counts={};s.hand.forEach(c=>counts[c.rank]=(counts[c.rank]||0)+1);
  put(s.hand.filter(c=>counts[c.rank]>1));
  for(let low=1;low<=10;low++)put(s.hand.filter((c,i,a)=>{const r=c.rank===14&&low===1?1:c.rank;return r>=low&&r<low+5&&a.findIndex(x=>x.rank===c.rank)===i;}));
  put(best.cards);
  let winner=null,value=best.total*1.12;
  const samples=Array.from({length:3},()=>sample(s.drawPile,5,random));
  for(const ids of candidates.values()){
    const keep=s.hand.filter(c=>!ids.includes(c.id));let avg=0;
    for(const draw of samples)avg+=chooser(g,s,[...keep,...draw.slice(0,ids.length)]).total/samples.length;
    if(avg>value){value=avg;winner=ids;}
  }return winner;
}
function portfolio(g,s,random){
  const hands=Array.from({length:4},()=>sample(s.deckAll,s.handSize,random));
  const groups=hands.map(h=>subsets(h));
  // Same samples for every candidate; considers the next few levels for scaling cards.
  return js=>{let sum=0;const next={...s,boss:null,handsLeft:2,jokers:js};
    for(let i=0;i<hands.length;i++){let best=0;for(const c of groups[i])best=Math.max(best,g.scoreHand({...next,hand:hands[i]},c,()=>.5).total);sum+=Math.log(1+best);}
    for(const j of js){if(['green','bus','runner','nova','constel','holog','fortune'].includes(j.id))sum+=.25;
      if(['golden','bounty','egg'].includes(j.id)&&s.ante<5)sum+=.8;}
    return sum/hands.length;};
}
function improveDeck(g,s,route,log){
  if(typeof g.applyWorkshop!=='function'||s.shop.workshopUsed)return;
  const fav=Object.keys(s.playCounts).sort((a,b)=>s.playCounts[b]-s.playCounts[a])[0];
  const ranks={},suits={};s.deckAll.forEach(c=>{ranks[c.rank]=(ranks[c.rank]||0)+1;suits[c.suit]=(suits[c.suit]||0)+1;});
  const rank=Number(Object.keys(ranks).sort((a,b)=>ranks[b]-ranks[a]||b-a)[0]);
  const suit=Number(Object.keys(suits).sort((a,b)=>suits[b]-suits[a])[0]);
  const value=c=>c.rank+c.bonus+c.multB*5+c.ed*20+(c.seal?30:0)+(c.steel?35:0)+(c.glass?25:0)+
    (['pair','trips','four','five','twopair','fh'].includes(fav)&&c.rank===rank?40:0)+(fav==='flush'&&(c.suit===suit||c.wild)?45:0);
  const cards=s.deckAll.slice().sort((a,b)=>value(b)-value(a));
  const service=route==='workshop'?'copy':route==='level'?'polish':s.deckAll.length>38?'remove':'polish';
  const card=service==='remove'?cards.at(-1):cards[0];
  const cost={remove:4,copy:6,polish:5}[service];
  if(!s.workshopCredits&&s.money<g.shopPrice(cost)+10)return;
  const before={money:s.money,size:s.deckAll.length,credits:s.workshopCredits};
  if(g.applyWorkshop(service,card.id))log.push({kind:'workshop',ante:s.ante,blind:s.blindIdx,service,card:card.id,before,after:{money:s.money,size:s.deckAll.length,credits:s.workshopCredits}});
}
function shop(g,s,random,options,log){
  g.openShop();
  if(s.bossReward){
    const route=options.route||'balanced',choice=route==='balanced'?['level','workshop','cash'][(s.ante-1)%3]:route;
    const key=s.bossReward.handKey;g.chooseBossReward(choice);log.push({kind:'reward',ante:s.ante,choice,key});
  }
  for(let pass=0;pass<3;pass++){
    const value=portfolio(g,s,random);let current=value(s.jokers),choice=null,gain=.035;
    s.shop.jokers.forEach((j,i)=>{
      if(j.sold||g.shopPrice(j.price)>s.money)return;
      if(s.jokers.length<s.jokerSlots){const v=value([...s.jokers,{...j,uid:9999}])-current;if(v>gain){gain=v;choice={i};}}
      else s.jokers.forEach((old,k)=>{const next=s.jokers.slice();next[k]={...j,uid:9999};const v=value(next)-current;if(v>gain){gain=v;choice={i,k};}});
    });
    if(!choice)break;
    if(choice.k!==undefined){s.money+=g.sellPrice(s.jokers[choice.k]);s.jokers.splice(choice.k,1);}
    g.buyJoker(choice.i);
  }
  // Put additive jokers before multiplicative ones, then compare adjacent orders.
  const value=portfolio(g,s,random);let improved=true;
  for(let pass=0;pass<3&&improved;pass++){improved=false;for(let i=0;i<s.jokers.length-1;i++){
    const a=value(s.jokers);[s.jokers[i],s.jokers[i+1]]=[s.jokers[i+1],s.jokers[i]];
    if(value(s.jokers)>a+.001)improved=true;else [s.jokers[i],s.jokers[i+1]]=[s.jokers[i+1],s.jokers[i]];
  }}
  const fav=Object.keys(s.playCounts).sort((a,b)=>s.playCounts[b]-s.playCounts[a])[0];
  s.shop.cons.forEach((t,i)=>{if(t.kind==='planet'&&(t.key===fav||s.money>=30)&&s.money>=g.shopPrice(t.price)&&s.cons.length<s.consSlots){g.buyCons(i);g.useCons(s.cons.length-1);}});
  for(let i=0;i<s.shop.packs.length;i++)if(s.shop.packs[i].id==='celestial'&&s.money>=g.shopPrice(s.shop.packs[i].price)+5){
    g.buyPack(i);const n=s.pack.options.findIndex(p=>p.key===fav);g.pickPack(n>=0?n:0);
  }
  if(s.anteVoucher&&['grabber','paint','anti','seed','sale'].includes(s.anteVoucher.id)&&s.money>=g.shopPrice(10)+10)g.buyVoucher();
  improveDeck(g,s,options.route||'balanced',log);
  g.leaveShop();
}
async function simulate(seed,options={}){
  const {game:g,random}=harness(seed,options.root);g.newGame(false,options.deck||'red',options.stake||'white');
  const s=g.getState(),rounds=[],choices=[];
  for(let round=0;round<24;round++){
    if(typeof g.selectRhythm==='function'){
      g.selectRhythm(options.rhythm||'none');
      if(options.contract&&options.contract!=='none')g.selectContract(options.contract);
    }
    g.chooseBlind();let actions=0;
    while(s.screen==='play'&&actions++<32){
      let best=chooser(g,s);if(!best.cards.length)break;
      if(options.reserve==='pocket'&&tryReserve(g,s,best,choices))best=chooser(g,s);
      let discard=null;
      if(s.score+best.total<s.target&&s.discLeft>0&&s.drawPile.length)discard=discardChoice(g,s,random,best);
      g.selectCards(discard||best.cards.map(c=>c.id));
      if(discard)g.doDiscard();else await g.doPlay();
    }
    rounds.push({ante:s.ante,blind:s.blindIdx,boss:s.anteBoss.id,win:s.screen==='cash',score:s.score,target:s.target,money:s.money,
      contract:s.contract?.id,contractPaid:s.contract?.settled?s.payout?.find(([label])=>label.startsWith('悬赏'))?.[1]:0,rhythm:s.rhythmMode,deckSize:s.deckAll.length});
    if(s.screen!=='cash')return {seed,win:false,rounds,choices,jokers:s.jokers.map(j=>j.id)};
    if(s.ante===8&&s.blindIdx===2)return {seed,win:true,rounds,choices,jokers:s.jokers.map(j=>j.id)};
    shop(g,s,random,options,choices);
  }
}
async function main(){
  const count=Number(process.argv[2]||32),deck=process.argv[3]||'red',stake=process.argv[4]||'white',route=process.argv[5]||'balanced',rhythm=process.argv[6]||'none',contract=process.argv[7]||'none',reserve=process.argv[8]||'off';
  const root=process.env.BALANCE_ROOT;
  const runs=[];for(let seed=1;seed<=count;seed++){runs.push(await simulate(seed,{deck,stake,route,rhythm,contract,reserve,root}));if(seed%8===0)console.log(`${deck}/${stake}/${route}/${reserve}: ${seed}/${count}`);}
  const report={version:root?JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version:require('../package.json').version,deck,stake,route,rhythm,contract,reserve,count,wins:runs.filter(r=>r.win).length,
    reached:Array.from({length:8},(_,i)=>runs.filter(r=>r.rounds.some(x=>x.ante===i+1)).length),
    failures:Object.fromEntries([...new Set(runs.filter(r=>!r.win).map(r=>r.rounds.at(-1).boss))].map(id=>[id,runs.filter(r=>!r.win&&r.rounds.at(-1).boss===id).length])),
    limits:'Greedy bot, three discard samples, no tarot or skip optimisation; reserve keeps a spare and retrieves only for an immediate score gain. Not a human win-rate estimate.',runs};
  const out=process.env.BALANCE_OUTPUT||`.qa/balance-${report.version}-${deck}-${stake}-${route}-${rhythm}-${contract}-${reserve}.json`;fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,runs:undefined}));
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={simulate,chooser};
