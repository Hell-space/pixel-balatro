// Compatible with 1.1.0 saves. A previous valid snapshot protects against a damaged latest write.
const RUN_KEY='pixel-balatro.run.v1', BACKUP_KEY=RUN_KEY+'.backup';
let lastWrite='', storageUnavailable=false;
function normalizeRunState(input) {
  if(!input || !Array.isArray(input.deckAll) || !Array.isArray(input.hand) || !Array.isArray(input.drawPile)) throw Error('牌组格式');
  const s=input, finite=n=>Number.isFinite(n)&&n>=0;
  s.deckId??='classic'; s.stakeId??='white'; s.tarotsUsed??=0; s.blindPlayed??=[];s.bossHistory??=[];
  s.workshopCredits??=0; s.bossReward??=null;
  s.rhythmMode??='none'; s.rhythm??={lastKey:null,chain:0};s.contractChoice??=null;s.contract??=null;
  s.reserve??={cardId:null,used:false};
  if(typeof s.reserve.used!=='boolean'||(s.reserve.cardId!==null&&!Number.isSafeInteger(s.reserve.cardId))||
    (s.reserve.used&&s.reserve.cardId!==null))throw Error('底牌状态损坏');
  if(!RHYTHMS.some(r=>r.id===s.rhythmMode)||!Number.isInteger(s.rhythm.chain)||s.rhythm.chain<0||s.rhythm.chain>5||
    (s.rhythm.lastKey!==null&&!HORDER.includes(s.rhythm.lastKey))||
    (s.contractChoice!==null&&!CONTRACTS.some(c=>c.id===s.contractChoice))||
    (s.contract&&(!CONTRACTS.some(c=>c.id===s.contract.id)||!Number.isInteger(s.contract.discards)||s.contract.discards<0||typeof s.contract.settled!=='boolean')))
    throw Error('备战规则损坏');
  if(!Number.isSafeInteger(s.workshopCredits)||s.workshopCredits<0) throw Error('工坊次数损坏');
  if(s.bossReward && (s.screen!=='cash'||s.blindIdx!==2||s.bossReward.ante!==s.ante||
    !HORDER.includes(s.bossReward.handKey))) throw Error('成长奖励损坏');
  if(!['classic',...DECKS.map(d=>d.id)].includes(s.deckId)||!STAKES.some(t=>t.id===s.stakeId)||
    !Number.isInteger(s.tarotsUsed)||s.tarotsUsed<0||!Array.isArray(s.blindPlayed)||
    s.blindPlayed.some(k=>!HORDER.includes(k))||!Array.isArray(s.bossHistory)||
    s.bossHistory.some(id=>!BOSSES.some(b=>b.id===id)))throw Error('局内规则损坏');
  for(const key of ['money','ante','blindIdx','handsLeft','discLeft','target','score','baseHands','baseDisc',
    'handSize','jokerSlots','consSlots','interestCap','rerollBase','discount','totHands','bestHand','planetsUsed','cardsAdded','investN'])
    if(!finite(s[key])) throw Error('数值损坏');
  if(!Number.isInteger(s.ante)||s.ante<1||![0,1,2].includes(s.blindIdx)||!['select','play','shop','cash','over'].includes(s.screen)) throw Error('关卡损坏');
  const ids=new Set();
  for(const c of s.deckAll) {
    if(!Number.isSafeInteger(c.id)||ids.has(c.id)||!Number.isInteger(c.rank)||c.rank<2||c.rank>14||
      ![0,1,2,3].includes(c.suit)||!finite(c.bonus)||!finite(c.multB)||![0,1,2,3].includes(c.ed)||
      ![null,'red','gold'].includes(c.seal)) throw Error('卡牌损坏');
    ids.add(c.id);
  }
  const refs=[...s.hand,...s.drawPile,...(s.reserve.cardId===null?[]:[s.reserve.cardId])];
  if(new Set(refs).size!==refs.length || refs.some(id=>!ids.has(id))) throw Error('卡牌引用损坏');
  const catalog=(list,id)=>{ const def=list.find(x=>(x.id||x.key)===id); if(!def) throw Error('未知效果'); return def; };
  const joker=j=>{
    j.ed ??= 0;
    if(!Number.isSafeInteger(j.uid)||!finite(j.state)||!finite(j.price)||!finite(j.sell)||![0,1,2,3].includes(j.ed)) throw Error('小丑损坏');
    return {...catalog(JDEFS,j.id),uid:j.uid,state:j.state,price:j.price,sell:j.sell,ed:j.ed};
  };
  const consumable=c=>{
    const def=c.kind==='planet'?catalog(PLANETS,c.key):catalog(TAROTS,c.id);
    return {...def,kind:c.kind==='planet'?'planet':'tarot',price:3};
  };
  s.jokers=s.jokers.map(joker); s.cons=s.cons.map(consumable);
  s.anteBoss={...catalog(BOSSES,s.anteBoss.id)};
  s.boss=s.boss?{...catalog(BOSSES,s.boss.id)}:null;
  s.anteVoucher=s.anteVoucher?{...catalog(VOUCHERS,s.anteVoucher.id)}:null;
  s.skipTags=s.skipTags.map(t=>({...catalog(TAGS,t.id)}));
  if(s.skipTags.length!==2 || !Array.isArray(s.vouchers)||s.vouchers.some(v=>!VOUCHERS.some(x=>x.id===v))) throw Error('标签损坏');
  for(const key of HORDER) {
    s.levels[key]=s.levels[key]??1; s.playCounts[key]=s.playCounts[key]??0;
    if(!Number.isInteger(s.levels[key])||s.levels[key]<1||!Number.isInteger(s.playCounts[key])||s.playCounts[key]<0) throw Error('等级损坏');
  }
  if(s.screen==='shop' && !s.shop) throw Error('商店损坏');
  if(s.shop) {
    s.shop.workshopUsed=!!s.shop.workshopUsed;
    if(s.shop.workshopReceipt!==undefined&&typeof s.shop.workshopReceipt!=='string') throw Error('工坊记录损坏');
    if(!finite(s.shop.disc)||!finite(s.shop.rerollCost)) throw Error('价格损坏');
    s.shop.jokers=s.shop.jokers.map(j=>{
      if(!finite(j.price)||![0,1,2,3].includes(j.ed??0)) throw Error('商品损坏');
      return {...catalog(JDEFS,j.id),price:j.price,ed:j.ed??0,sold:!!j.sold};
    });
    s.shop.cons=s.shop.cons.map(c=>({...consumable(c),sold:!!c.sold}));
    s.shop.packs=s.shop.packs.map(p=>{
      const definition=catalog(PACKS,p.id);
      if(p.options) {
        if(!Array.isArray(p.options)) throw Error('候选损坏');
        p.options=p.options.map(option=>{
          if(p.id==='standard') {
            if(!Number.isSafeInteger(option.id)||!Number.isInteger(option.rank)||option.rank<2||option.rank>14||
              ![0,1,2,3].includes(option.suit)||!finite(option.bonus)||!finite(option.multB)||
              ![0,1,2,3].includes(option.ed)||![null,'red','gold'].includes(option.seal)) throw Error('卡包牌损坏');
            return option;
          }
          if(p.id==='buffoon') {
            if(!finite(option.price)||![0,1,2,3].includes(option.ed??0)) throw Error('卡包小丑损坏');
            return {...catalog(JDEFS,option.id),price:option.price,ed:option.ed??0};
          }
          return {...catalog(p.id==='arcana'?TAROTS:p.id==='celestial'?PLANETS:SPECTRALS,option.id||option.key)};
        });
      }
      return {...definition,sold:!!p.sold,options:p.options};
    });
  }
  if(s.pack) {
    if(s.screen!=='shop'||!s.shop.packs[s.pack.index]||!finite(s.pack.cost)||!Array.isArray(s.pack.options)) throw Error('卡包损坏');
    s.pack.type=s.shop.packs[s.pack.index].id;
    s.pack.options=s.shop.packs[s.pack.index].options;
    if(!s.pack.options?.length) throw Error('候选缺失');
  }
  s.shop?.packs.forEach((p,i)=>{
    if(p.id==='standard'&&p.options&&(!p.sold||s.pack?.index===i)) ensurePackEnhancements(p.options);
  });
  s.busy=false; s.sellId=null;
  return s;
}
function decodeRun(raw) {
  try {
    const data=JSON.parse(raw);
    if(!data || ![1,2,3,4,5].includes(data.version)||!Number.isSafeInteger(data.cid)||!data.checkpoint) return null;
    data.state=normalizeRunState(data.state);
    const checkpoint=normalizeRunState(JSON.parse(data.checkpoint));
    data.checkpoint=JSON.stringify(checkpoint);
    data.meta={ante:checkpoint.ante,blind:checkpoint.blindIdx};
    data.cid=Math.max(data.cid,...data.state.deckAll.map(c=>c.id),...data.state.jokers.map(j=>j.uid));
    return data;
  } catch { return null; }
}
function readRun() {
  try {
    const main=decodeRun(localStorage.getItem(RUN_KEY));
    if(main) return main;
    const backup=decodeRun(localStorage.getItem(BACKUP_KEY));
    return backup?{...backup,recovered:true}:null;
  } catch { return null; }
}
function persistRun() {
  if(!S||MP.on||S.busy||!saveStr) return;
  const state={...S,hand:S.hand.map(c=>c.id),drawPile:S.drawPile.map(c=>c.id),played:[],sellId:null};
  const raw=JSON.stringify({version:5,cid,state,checkpoint:saveStr,meta:saveMeta});
  if(raw===lastWrite) return;
  try {
    const previous=localStorage.getItem(RUN_KEY);
    if(previous && decodeRun(previous)) localStorage.setItem(BACKUP_KEY,previous);
    localStorage.setItem(RUN_KEY,raw); lastWrite=raw; storageUnavailable=false;
  } catch {
    if(!storageUnavailable) msg('浏览器未允许存档；关闭后可能无法续局。',true);
    storageUnavailable=true;
  }
}
function refreshTitle() {
  const slot=readRun();
  $('resumeBtn').hidden=!slot;
  if(slot) $('resumeBtn').textContent='继续游戏 · 底注 '+slot.state.ante+(slot.recovered?' · 备份':'');
}
function startSolo(tutorial) {
  if(!tutorial){openSetup();return;}
  if(readRun()) {
    hide('ovStart'); show('ovRestart');
    $('confirmNew').onclick=()=>{ hide('ovRestart'); newGame(true,'red'); };
  } else newGame(true,'red');
}
function resumeGame() {
  const slot=readRun();
  if(!slot) { refreshTitle(); msg('没有可用存档，可以重新开局。',true); return; }
  const state=slot.state, byId=new Map(state.deckAll.map(c=>[c.id,c]));
  state.hand=state.hand.map(id=>byId.get(id)); state.drawPile=state.drawPile.map(id=>byId.get(id));
  S=state; cid=slot.cid; saveStr=slot.checkpoint; saveMeta=slot.meta;
  workshopDraft=null;
  reserveDraft=null;
  initAudio(); hide('ovStart'); renderAll();
  switch(S.screen) {
    case 'select': showBlindSelect(); break;
    case 'play': break;
    case 'shop': renderShop(); show('ovShop'); if(S.pack) openPackUI(); break;
    case 'cash':
      renderPayout();
      if(S.winPending) {
        $('winStats').textContent='最高单次得分：'+fmt(S.bestHand)+'　总出牌数：'+S.totHands;
        show('ovWin');
      } else if(S.bossReward) openBossReward();
      else show('ovCash');
      break;
    case 'over': gameLost(true); break;
  }
  if(slot.recovered) msg('已从上一份有效备份恢复。');
}
refreshTitle();
document.addEventListener('click',()=>queueMicrotask(persistRun));
addEventListener('pagehide',persistRun);
document.addEventListener('visibilitychange',()=>{ if(document.hidden) persistRun(); });
addEventListener('keydown',e=>{
  if(!S || S.busy || S.screen!=='play' || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
  if(activeDialog() || $('tutBox').style.display==='block' || e.target.closest('input,textarea,select')) return;
  if(e.key==='Enter'&&!e.target.closest('button,[role=button]')) { e.preventDefault(); doPlay(); }
  if(e.key.toLowerCase()==='x') { e.preventDefault(); doDiscard(); persistRun(); }
});
