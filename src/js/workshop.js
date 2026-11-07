// Deterministic deck building: the player chooses both the service and the card.
const WORKSHOP = [
  {id:'remove',name:'删去一张牌',price:4,icon:'✂',desc:'永久移出牌组，至少保留 5 张'},
  {id:'copy',name:'复制一张牌',price:6,icon:'▣',desc:'保留原牌，并复制全部强化、版本和蜡封'},
  {id:'polish',name:'强化一张牌',price:5,icon:'✦',desc:'计分时额外 +30 筹码，可叠加'},
];
let workshopDraft=null,workshopFilter='all';
let shopClickUntil=0,rewardClickUntil=0;
function workshopCost(service) { return S.workshopCredits>0?0:shopPrice(service.price); }
function workshopIssue(service,cardId) {
  if(!service||S.screen!=='shop'||!S.shop||S.busy||S.pack) return '当前无法改造';
  if(S.shop.workshopUsed) return '本店已完成改造';
  if(service.id==='remove'&&S.deckAll.length<=5) return '牌组至少保留 5 张';
  if(S.money<workshopCost(service)) return '金币不足';
  if(cardId!==undefined&&!S.deckAll.some(c=>c.id===cardId)) return '请选择一张牌';
  return '';
}
function renderWorkshop() {
  const box=$('shopWorkshop'); box.replaceChildren();
  const status=document.createElement('p'); status.className='workshopStatus';
  status.setAttribute('role','status');
  status.textContent=S.shop.workshopUsed?S.shop.workshopReceipt||'本店已完成改造':
    '每店一次 · 牌组 '+S.deckAll.length+' 张';
  if(S.workshopCredits)status.textContent+=' · 余 '+S.workshopCredits+' 次免费';
  box.append(status);
  for(const service of WORKSHOP) {
    const button=document.createElement('button'),issue=workshopIssue(service);
    button.className='workshopService'; button.dataset.service=service.id; button.disabled=!!issue;
    button.innerHTML='<span class="serviceIcon" aria-hidden="true">'+service.icon+'</span><b>'+service.name+'</b><small>'+service.desc+'</small><strong>'+
      (S.shop.workshopUsed?'已完成':issue|| (workshopCost(service)?'$'+workshopCost(service):'免费'))+'</strong>';
    button.onclick=()=>openWorkshop(service.id); box.append(button);
  }
}
function openWorkshop(serviceId) {
  const service=WORKSHOP.find(w=>w.id===serviceId);
  if(workshopIssue(service)) return false;
  workshopDraft={service:serviceId,cardId:null};
  $('workshopTitle').textContent=service.name;
  $('workshopRule').textContent=service.desc;
  workshopFilter='all';renderWorkshopFilters();
  renderWorkshopCards(); show('ovWorkshop'); return true;
}
function renderWorkshopFilters() {
  const filters=$('workshopSuit');filters.replaceChildren();
  for(const [value,label] of [['all','全部'],['0','♠'],['1','♥'],['2','♣'],['3','♦']]) {
    const button=document.createElement('button');button.innerHTML=value==='all'?label:suitSVG({suit:Number(value)});button.dataset.suit=value;
    button.setAttribute('aria-label',value==='all'?'全部花色':['黑桃','红桃','梅花','方块'][Number(value)]);
    button.setAttribute('aria-pressed',String(workshopFilter===value));
    if(value==='1'||value==='3')button.className='suitRed';
    button.onclick=()=>selectWorkshopSuit(value);filters.append(button);
  }
}
function selectWorkshopSuit(value) {
  if(!workshopDraft||!['all','0','1','2','3'].includes(value))return false;
  workshopFilter=value;workshopDraft.cardId=null;
  renderWorkshopFilters();renderWorkshopCards();return true;
}
function renderWorkshopCards() {
  if(!workshopDraft) return;
  const grid=$('workshopCards'),filter=workshopFilter;
  grid.replaceChildren();
  const cards=S.deckAll.filter(c=>filter==='all'||c.suit===Number(filter)||c.wild)
    .slice().sort((a,b)=>b.rank-a.rank||a.suit-b.suit||a.id-b.id);
  $('workshopCount').textContent=cards.length+' / '+S.deckAll.length+' 张';
  for(const card of cards) {
    const el=cardEl({...card,sel:false,justDealt:false},true);
    el.setAttribute('aria-label',cardLabel(card));
    el.setAttribute('aria-pressed',String(card.id===workshopDraft.cardId));
    el.classList.toggle('sel',card.id===workshopDraft.cardId);
    el.onclick=()=>{
      workshopDraft.cardId=card.id;
      for(const other of grid.children) {
        const selected=other.dataset.cardId===String(card.id);
        other.classList.toggle('sel',selected);other.setAttribute('aria-pressed',String(selected));
      }
      hideTip();renderWorkshopPreview();
    };
    grid.append(el);
  }
  renderWorkshopPreview();
}
function cardLabel(card) { return (card.wild?'百搭花色 ':['黑桃 ','红桃 ','梅花 ','方块 '][card.suit])+rankName(card.rank); }
function renderWorkshopPreview() {
  const service=WORKSHOP.find(w=>w.id===workshopDraft.service),card=S.deckAll.find(c=>c.id===workshopDraft.cardId);
  const confirm=$('workshopConfirm'); confirm.disabled=!card||!!workshopIssue(service,card?.id);
  $('workshopPreview').innerHTML=card?cardTipHTML(card):'选择要'+({remove:'删去',copy:'复制',polish:'强化'}[service.id])+'的牌';
  const result=card?(service.id==='remove'?'删去 '+cardLabel(card):service.id==='copy'?'复制 '+cardLabel(card):cardLabel(card)+' · +30 筹码'):'确认改造';
  confirm.textContent=result+' · '+(workshopCost(service)?'$'+workshopCost(service):'免费');
}
function closeWorkshop() { workshopDraft=null;shopClickUntil=Date.now()+350;hideTip();hide('ovWorkshop'); }
function confirmWorkshop() { if(workshopDraft) return applyWorkshop(workshopDraft.service,workshopDraft.cardId); return false; }
function applyWorkshop(serviceId,cardId) {
  const service=WORKSHOP.find(w=>w.id===serviceId);
  if(workshopIssue(service,cardId)) return false;
  const card=S.deckAll.find(c=>c.id===cardId);
  if(!card) return false;
  const cost=workshopCost(service);
  // Validate before changing money or references; one synchronous commit prevents double taps.
  if(S.workshopCredits>0) S.workshopCredits--; else S.money-=cost;
  if(serviceId==='remove') {
    S.deckAll=S.deckAll.filter(c=>c!==card);
    S.hand=S.hand.filter(c=>c!==card); S.drawPile=S.drawPile.filter(c=>c!==card);
  } else if(serviceId==='copy') {
    S.deckAll.push({...card,id:++cid,sel:false,justDealt:false}); S.cardsAdded++;
  } else card.bonus+=30;
  S.shop.workshopUsed=true;
  S.shop.workshopReceipt=({remove:'已删去 ',copy:'已复制 ',polish:'已强化 '}[serviceId])+cardLabel(card)+' · 牌组 '+S.deckAll.length+' 张';
  closeWorkshop(); sfxUp(); renderShop(); persistRun(); mpSendState(); return true;
}

function prepareBossReward() {
  if(MP.on||S.blindIdx!==2) return;
  const keys=availablePlanets().map(p=>p.key);
  // Stable tie break follows the planet list; no reward rerolls or hidden randomness.
  const handKey=keys.slice().sort((a,b)=>S.playCounts[b]-S.playCounts[a])[0];
  S.bossReward={ante:S.ante,handKey};
}
function openBossReward() {
  if(!S.bossReward||S.screen!=='cash'||S.winPending||MP.on) return false;
  hide('ovCash');
  renderBossReward(); show('ovReward');return true;
}
function selectRewardHand(key) {
  if(MP.on||S.screen!=='cash'||S.winPending||!S.bossReward||!availablePlanets().some(p=>p.key===key))return false;
  S.bossReward.handKey=key;renderBossReward();persistRun();return true;
}
function rewardHandOptions() {
  return availablePlanets().map(p=>{
    const h=HANDS[p.key],base=handBase(p.key);
    return {key:p.key,name:h.name,level:base.lv,nextLevel:base.lv+2,chips:base.chips,
      nextChips:base.chips+2*h.incC,mult:base.mult,nextMult:base.mult+2*h.incM};
  });
}
function openRewardHands() {
  if(!S?.bossReward||S.screen!=='cash'||S.winPending||MP.on)return false;
  const list=$('rewardHandChoices');list.replaceChildren();
  for(const option of rewardHandOptions()) {
    const button=document.createElement('button'),selected=option.key===S.bossReward.handKey;
    button.className='handOption';button.dataset.hand=option.key;button.setAttribute('role','option');
    button.setAttribute('aria-selected',String(selected));
    button.innerHTML='<span class="handOptionTitle"><b>'+option.name+'</b><span>'+option.level+' → '+option.nextLevel+' 级</span></span>'+
      '<span class="handOptionValues"><span>筹码 <b>'+fmt(option.chips)+' → '+fmt(option.nextChips)+'</b></span><span>倍率 <b>'+fmtM(option.mult)+' → '+fmtM(option.nextMult)+'</b></span></span>'+
      '<span class="handOptionCheck" aria-hidden="true">'+(selected?'✓':'')+'</span>';
    button.onclick=()=>{if(selectRewardHand(option.key))closeRewardHands();};list.append(button);
  }
  show('ovRewardHands');
  queueMicrotask(()=>{const selected=list.querySelector('[aria-selected=true]');selected?.focus({preventScroll:true});selected?.scrollIntoView({block:'nearest'});});
  return true;
}
function closeRewardHands() {
  rewardClickUntil=Date.now()+350;hide('ovRewardHands');
  queueMicrotask(()=>$('rewardHand').focus({preventScroll:true}));
}
function renderBossReward() {
  const key=S.bossReward.handKey,h=HANDS[key],base=handBase(key);
  $('rewardHand').textContent=h.name+' · '+base.lv+' 级';
  $('rewardLevel').textContent='升至 '+(base.lv+2)+' 级';
  $('rewardLevelDetail').innerHTML='<span>筹码 <b>'+fmt(base.chips)+' → '+fmt(base.chips+2*h.incC)+'</b></span><span>倍率 <b>'+fmtM(base.mult)+' → '+fmtM(base.mult+2*h.incM)+'</b></span>';
  $('rewardCashDetail').textContent='$'+S.money+' → $'+(S.money+8);
  $('rewardWorkshopDetail').textContent='免费次数 '+S.workshopCredits+' → '+(S.workshopCredits+2)+' · 每店用一次';
}
function chooseBossReward(choice) {
  if(MP.on||S.screen!=='cash'||S.winPending||!S.bossReward||!['cash','level','workshop'].includes(choice)) return false;
  const key=S.bossReward.handKey;
  if(choice==='cash') S.money+=8;
  if(choice==='level') S.levels[key]+=2;
  if(choice==='workshop') S.workshopCredits+=2;
  S.bossReward=null;
  shopClickUntil=Date.now()+350;
  hide('ovReward');sfxUp();openShop();persistRun();return true;
}
