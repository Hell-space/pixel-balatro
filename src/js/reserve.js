// A single extra card can be kept outside the hand, then exchanged once per blind.
let reserveDraft=null, tableClickUntil=0;
function reserveCard(state=S) { return state.deckAll.find(c=>c.id===state.reserve?.cardId); }
function reserveIssue(action,cardId) {
  if(!S||MP.on||S.screen!=='play'||S.busy) return '当前无法使用底牌';
  if(S.reserve.used) return '本盲底牌已用完';
  const expected=S.reserve.cardId===null?'store':'retrieve';
  if(action!==expected) return '底牌状态已变化';
  if(action==='store'&&!S.drawPile.length) return '牌库已空，无法藏牌补牌';
  if(action==='retrieve'&&!reserveCard()) return '底牌不可用';
  if(cardId!==undefined&&!S.hand.some(c=>c.id===cardId)) return '请选择一张手牌';
  return '';
}
function renderReserveEntry() {
  const button=$('reserveBtn');
  button.hidden=MP.on||S.screen!=='play';
  const card=reserveCard(),action=card?'retrieve':'store';
  button.disabled=!!reserveIssue(action);
  button.textContent=S.reserve.used?'底牌 · 已用':card?'底牌 · '+cardLabel(card):!S.drawPile.length?'底牌 · 牌库已空':'底牌 · 藏入';
  button.setAttribute('aria-label',card?'换回底牌 '+cardLabel(card):button.textContent);
}
function openReserve() {
  const action=S?.reserve?.cardId===null?'store':'retrieve';
  if(reserveIssue(action))return false;
  const selected=S.hand.filter(c=>c.sel);
  reserveDraft={action,cardId:selected.length===1?selected[0].id:null};
  const held=reserveCard(),pocket=$('reservePocket');pocket.replaceChildren();
  if(held) {
    pocket.append(cardEl({...held,sel:false,justDealt:false}));
    const desc=document.createElement('div');desc.innerHTML=cardTipHTML(held);pocket.append(desc);
  } else pocket.innerHTML='<div class="emptyPocket" aria-hidden="true">底牌</div>';
  $('reserveRule').textContent=held?'选一张手牌换回底牌；换出的牌本盲不再抽到。':'选一张手牌藏入并补一张，本盲可再换回一次。';
  $('reserveRuleDetail').textContent='不耗出牌、弃牌或金币；底牌不触发留手效果。';
  const grid=$('reserveHand');grid.replaceChildren();
  for(const card of S.hand) {
    const el=cardEl({...card,sel:false,justDealt:false},true);
    el.setAttribute('aria-label',cardLabel(card));
    el.setAttribute('aria-pressed',String(card.id===reserveDraft.cardId));
    el.classList.toggle('sel',card.id===reserveDraft.cardId);
    el.onclick=()=>{
      reserveDraft.cardId=card.id;
      for(const other of grid.children) {
        const active=other.dataset.cardId===String(card.id);
        other.classList.toggle('sel',active);other.setAttribute('aria-pressed',String(active));
      }
      hideTip();renderReservePreview();
    };
    grid.append(el);
  }
  renderReservePreview();show('ovReserve');return true;
}
function renderReservePreview() {
  if(!reserveDraft)return;
  const card=S.hand.find(c=>c.id===reserveDraft.cardId),stored=reserveCard();
  $('reservePreview').innerHTML=card?cardTipHTML(card):'选择一张手牌';
  const button=$('reserveConfirm');button.disabled=!card||!!reserveIssue(reserveDraft.action,card?.id);
  button.textContent=!card?'选择一张手牌':stored?'换回 '+cardLabel(stored):'藏入 '+cardLabel(card);
}
function closeReserve() {
  reserveDraft=null;tableClickUntil=Date.now()+350;hideTip();hide('ovReserve');
}
function confirmReserve() { return reserveDraft?applyReserve(reserveDraft.action,reserveDraft.cardId):false; }
function applyReserve(action,cardId) {
  if(reserveIssue(action,cardId))return false;
  const card=S.hand.find(c=>c.id===cardId);
  if(!card)return false;
  const stored=reserveCard();
  S.hand=S.hand.filter(c=>c!==card);card.sel=false;
  if(action==='store') {
    S.reserve.cardId=card.id;
    const next=S.drawPile.pop();next.sel=false;next.justDealt=true;S.hand.push(next);sfxDeal();
  } else {
    stored.sel=false;stored.justDealt=true;S.hand.push(stored);
    S.reserve={cardId:null,used:true};sfxSel();
  }
  sortHand();closeReserve();renderAll();
  msg(action==='store'?'已藏入 '+cardLabel(card)+'，本盲还可换回一次。':'已换回 '+cardLabel(stored));
  persistRun();return true;
}
