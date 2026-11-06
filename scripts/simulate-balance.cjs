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
function shop(g,s,random){
  g.openShop();
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
  g.leaveShop();
}
async function simulate(seed,options={}){
  const {game:g,random}=harness(seed,options.root);g.newGame(false,options.deck||'red',options.stake||'white');
  const s=g.getState(),rounds=[];
  for(let round=0;round<24;round++){
    g.chooseBlind();let actions=0;
    while(s.screen==='play'&&actions++<32){
      const best=chooser(g,s);if(!best.cards.length)break;
      let discard=null;
      if(s.score+best.total<s.target&&s.discLeft>0&&s.drawPile.length)discard=discardChoice(g,s,random,best);
      g.selectCards(discard||best.cards.map(c=>c.id));
      if(discard)g.doDiscard();else await g.doPlay();
    }
    rounds.push({ante:s.ante,blind:s.blindIdx,boss:s.anteBoss.id,win:s.screen==='cash',score:s.score,target:s.target,money:s.money});
    if(s.screen!=='cash')return {seed,win:false,rounds,jokers:s.jokers.map(j=>j.id)};
    if(s.ante===8&&s.blindIdx===2)return {seed,win:true,rounds,jokers:s.jokers.map(j=>j.id)};
    shop(g,s,random);
  }
}
async function main(){
  const count=Number(process.argv[2]||32),deck=process.argv[3]||'red',stake=process.argv[4]||'white';
  const runs=[];for(let seed=1;seed<=count;seed++){runs.push(await simulate(seed,{deck,stake}));if(seed%8===0)console.log(`${deck}/${stake}: ${seed}/${count}`);}
  const report={version:require('../package.json').version,deck,stake,count,wins:runs.filter(r=>r.win).length,
    reached:Array.from({length:8},(_,i)=>runs.filter(r=>r.rounds.some(x=>x.ante===i+1)).length),
    failures:Object.fromEntries([...new Set(runs.filter(r=>!r.win).map(r=>r.rounds.at(-1).boss))].map(id=>[id,runs.filter(r=>!r.win&&r.rounds.at(-1).boss===id).length])),
    limits:'Greedy bot, three discard samples, no tarot or skip optimisation. Not a human win-rate estimate.',runs};
  const out=process.env.BALANCE_OUTPUT||`.qa/balance-${report.version}-${deck}-${stake}.json`;fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,runs:undefined}));
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={simulate,chooser};
