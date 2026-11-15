// The theater runs alongside the title screen and keeps each best score in its own slot.
const THEATER_BEST_KEY='pixel-balatro.theater.best.v1.';
const theaterSessionBests=new Map();
let theaterRun=null, theaterDaily=null, theaterView='program', theaterFocusId=null, programScroll=0;
let theaterHintLevel=0, theaterAnimating=false, theaterFromMenu=false;

function theaterBest(id) {
  let best=theaterSessionBests.get(id)||0;
  try {
    const saved=Number(localStorage.getItem(THEATER_BEST_KEY+id));
    if (Number.isSafeInteger(saved) && saved>best) best=saved;
  } catch {}
  return best;
}
function recordTheaterBest(run) {
  const best=Math.max(theaterBest(run.bill.id),run.score);
  theaterSessionBests.set(run.bill.id,best);
  try {localStorage.setItem(THEATER_BEST_KEY+run.bill.id,String(best));return '个人最高 '+fmt(best)+' 分';}
  catch {return '本次最高 '+fmt(best)+' 分 · 本机存储不可用';}
}
function switchTheaterView(view) {
  theaterView=view;
  $('theaterProgram').hidden=view!=='program';
  $('theaterStage').hidden=$('actControls').hidden=view!=='stage';
  $('theaterResult').hidden=$('actResultActions').hidden=view!=='result';
  $('theaterReset').hidden=view!=='stage';
  $('theaterBackBtn').textContent=view!=='program'?'‹ 节目单':theaterFromMenu?'‹ 牌桌菜单':'‹ 返回标题';
  $('ovTheater').dataset.view=view;
  hideTip();
}
function makeTheaterTicket(bill) {
  const ticket=document.createElement('button');
  const best=theaterBest(bill.id);
  ticket.className='programTicket '+bill.theme+(bill.day?' dailyTicket':'');
  ticket.dataset.bill=bill.id;
  const status=best>=bill.encore?'✷ 满堂彩':best>=bill.goal?'✓ 已过关':best?'最高 '+fmt(best):'';
  const mark=bill.day?'<small>'+Number(bill.day.slice(5,7))+' 月</small><b>'+bill.day.slice(8)+'</b>':bill.mark;
  const info=bill.day?'每天一副新牌':bill.hands+' 手'+(bill.discards?' · 可弃牌':'');
  ticket.innerHTML='<span class="ticketMark" aria-hidden="true">'+mark+'</span><span class="ticketText">'+
    '<strong>'+bill.title+'</strong><small>'+info+' · '+fmt(bill.goal)+' 分</small></span>'+
    '<span class="ticketEnd">'+(status||'›')+'</span>';
  ticket.onclick=()=>startTheaterBill(bill);
  return ticket;
}
function renderTheaterProgram(restoreFocus) {
  theaterRun=null;theaterAnimating=false;
  const day=theaterDayKey();
  if (theaterDaily?.day!==day) theaterDaily=dailyTheaterBill(day);
  switchTheaterView('program');
  $('theaterHeading').textContent='残局剧场';
  const cleared=THEATER_BILLS.filter(b=>theaterBest(b.id)>=b.goal).length;
  $('theaterPosition').textContent='已过 '+cleared+' / '+THEATER_BILLS.length+' 幕';
  $('dailyTicket').replaceChildren(makeTheaterTicket(theaterDaily));
  $('theaterBills').replaceChildren(...THEATER_BILLS.map(makeTheaterTicket));
  $('theaterProgram').scrollTop=programScroll;
  if (restoreFocus) {
    const previous=[...$('theaterProgram').querySelectorAll('button')].find(b=>b.dataset.bill===theaterFocusId);
    (previous||$('theaterHeading')).focus({preventScroll:true});
  }
}
function openTheater() {
  const origin=activeDialog()?.id;
  if (origin!=='ovStart' && (origin!=='ovMenu'||MP.on||S?.screen!=='play'||S.busy)) return;
  theaterFromMenu=origin==='ovMenu';
  theaterFocusId=null;programScroll=0;
  renderTheaterProgram(false);show('ovTheater');
}
function startTheaterBill(bill) {
  if (theaterView==='program') {
    programScroll=$('theaterProgram').scrollTop;
    const today=theaterDayKey();
    if (bill.day && bill.day!==today) {
      theaterDaily=dailyTheaterBill(today);
      bill=theaterDaily;
    }
  }
  theaterFocusId=bill.id;
  theaterRun=createTheaterRun(bill);
  theaterHintLevel=0;theaterAnimating=false;
  initAudio();switchTheaterView('stage');
  $('theaterHeading').textContent=bill.title;
  $('theaterPosition').textContent=bill.day?bill.day:'第 '+(THEATER_BILLS.indexOf(bill)+1)+' / '+THEATER_BILLS.length+' 幕';
  $('actGoal').textContent=fmt(bill.goal);$('actEncore').textContent=fmt(bill.encore);
  renderTheaterStage();
  $('theaterStage').scrollTop=0;$('theaterHeading').focus({preventScroll:true});
}
function replayTheater() {
  if (theaterRun) startTheaterBill(theaterRun.bill);
}
function theaterBack() {
  if (theaterView!=='program') {renderTheaterProgram(true);return;}
  hide('ovTheater');
  const trigger=$(theaterFromMenu?'menuTheaterBtn':'theaterBtn');
  queueMicrotask(()=>trigger.focus({preventScroll:true}));
}
function nextTheaterBill() {
  if (!theaterRun || theaterRun.bill.day) return null;
  return THEATER_BILLS[THEATER_BILLS.indexOf(theaterRun.bill)+1] || null;
}
function continueTheater() {
  if (theaterView!=='result') return;
  if (theaterRun.score<theaterRun.bill.goal) {replayTheater();return;}
  const next=nextTheaterBill();
  if (next) startTheaterBill(next); else renderTheaterProgram(true);
}
function renderTheaterClue() {
  const bill=theaterRun.bill;
  $('actClueText').textContent=theaterHintLevel?bill.hints[theaterHintLevel-1]:bill.brief;
  $('actHint').textContent=['看提示','再提示','收起'][theaterHintLevel];
}
function theaterHint() {
  if (theaterView!=='stage' || theaterAnimating) return;
  theaterHintLevel=(theaterHintLevel+1)%3;
  renderTheaterClue();
}
function renderTheaterJokers() {
  const run=theaterRun;
  $('actJokers').replaceChildren(...run.jokers.map((j,i)=>{
    const el=document.createElement('div');el.className='actJoker';
    el.innerHTML='<span class="actJokerIcon" aria-hidden="true">'+j.ic+'</span><span class="actJokerBody"><span class="actJokerName"><strong>'+j.name+
      '</strong><em class="actJokerEffect"></em></span><small>'+j.desc+'</small></span>';
    if (run.bill.canSwap) el.setAttribute('aria-label','第 '+(i+1)+' 张，'+j.name+'，'+j.desc);
    return el;
  }));
  $('actSwap').hidden=!run.bill.canSwap;
}
function swapTheaterJokers() {
  if (theaterView!=='stage' || theaterAnimating || !theaterRun.bill.canSwap) return;
  theaterRun.jokers.reverse();sfxSel();renderTheaterJokers();renderTheaterSelection();
  feedback($('actJokers'),[{opacity:.45},{opacity:1}],180,true);
}
function toggleTheaterCard(card) {
  if (theaterAnimating || theaterView!=='stage' || !theaterRun.hand.includes(card)) return;
  if (!card.sel && theaterRun.hand.filter(c=>c.sel).length>=5) {
    $('actHandInfo').textContent='最多选 5 张，先放回一张';return;
  }
  card.sel=!card.sel;sfxSel();renderTheaterSelection();
}
function renderTheaterStage() {
  const run=theaterRun;
  $('actScore').textContent=fmt(run.score);$('actHands').textContent=run.handsLeft+' 手';
  renderTheaterJokers();renderTheaterClue();
  const stock=$('actStock');
  stock.hidden=!run.bill.stock;
  if (run.bill.stock) stock.textContent=run.stock.length?'补牌顺序　'+run.stock.map(c=>c.code).join(' → '):'补牌区已空';
  $('actHand').replaceChildren(...run.hand.map(card=>{
    const el=cardEl(card,true,run);
    el.setAttribute('aria-label',cardLabel(card)+(card.seal==='red'?'，红蜡封':'')+(card.bonus?'，加 '+card.bonus+' 筹码':''));
    el.onclick=()=>toggleTheaterCard(card);
    return el;
  }));
  $('actDiscard').hidden=!run.bill.discards;
  renderTheaterSelection();
}
function renderTheaterSelection() {
  const run=theaterRun,selected=run.hand.filter(c=>c.sel),preview=theaterPreview(run);
  const scoring=new Set(preview?.hand.scoring || []);
  [...$('actHand').children].forEach((el,i)=>{
    const c=run.hand[i];
    el.setAttribute('aria-pressed',String(c.sel));
    el.classList.toggle('sel',c.sel);el.classList.toggle('actKicker',c.sel&&!scoring.has(c));
  });
  const last=run.history[run.history.length-1];
  const lastMove=last?.action==='play'?'上手 '+fmt(last.total)+' 分':last?'已弃 '+last.cards.length+' 张':'';
  $('actHandInfo').textContent=(lastMove?lastMove+' · ':'')+'已选 '+selected.length+' / 5';
  $('actHandName').textContent=preview?HANDS[preview.hand.key].name:'选 1–5 张牌';
  $('actFormula').textContent=preview?fmt(preview.chips)+' × '+fmtM(preview.mult)+' = '+fmt(preview.total):'';
  $('actPlay').disabled=!selected.length||theaterAnimating;
  $('actDiscard').textContent='弃牌 · '+run.discLeft;
  $('actDiscard').disabled=!selected.length||!run.discLeft||!run.stock.length||theaterAnimating;
  [...$('actJokers').children].forEach((el,i)=>{
    const j=run.jokers[i],hits=preview?.events.filter(e=>e.kind==='joker'&&e.id===j.uid)||[];
    let effect=hits.length>1?hits.length+' 次':hits[0]?.text.replace(/ (倍率|筹码)$/,'')||'';
    if (preview && j.id==='dusk' && run.handsLeft===1) effect='再计一次';
    el.classList.toggle('triggered',!!effect);el.querySelector('.actJokerEffect').textContent=effect;
  });
}
async function submitTheater(action) {
  if (theaterView!=='stage' || theaterAnimating) return;
  const run=theaterRun;
  if (!actInTheater(run,action)) return;
  theaterAnimating=true;$('actPlay').disabled=$('actDiscard').disabled=true;
  const played=action==='play',last=run.history[run.history.length-1];
  if (played) {
    $('actScore').textContent=fmt(run.score);sfxTick(last.chips);
    feedback($('actScore'),[{transform:'scale(1.25)',color:'#ffdd8f'},{transform:'scale(1)'}],300,true);
  } else sfxDeal();
  for (const el of $('actHand').querySelectorAll('.sel')) {
    feedback(el,[{opacity:1},{transform:played?'translateY(-12px)':'translateY(10px)',opacity:.2}],220,true);
  }
  await sleep(260);
  if (theaterRun!==run) return;
  theaterAnimating=false;
  if (run.finished) showTheaterResult();
  else {
    renderTheaterStage();
    $('theaterHeading').focus({preventScroll:true});
  }
}
function showTheaterResult() {
  const run=theaterRun,won=run.score>=run.bill.goal,perfect=run.score>=run.bill.encore;
  const record=recordTheaterBest(run);
  switchTheaterView('result');
  $('ovTheater').dataset.outcome=perfect?'encore':won?'won':'miss';
  $('actVerdict').textContent=perfect?'✷ 满堂彩':won?'✓ 过关':'差一点';
  $('actFinalScore').textContent=fmt(run.score)+' 分';
  $('actMargin').textContent=perfect?'拿到了本场最高分':won?'距满堂彩还差 '+fmt(run.bill.encore-run.score)+' 分':'距过关还差 '+fmt(run.bill.goal-run.score)+' 分';
  $('actHistory').replaceChildren(...run.history.map(step=>{
    const row=document.createElement('div');row.className='actHistoryRow';
    const value=step.action==='play'?fmt(step.chips)+' × '+fmtM(step.mult)+' = '+fmt(step.total):'弃牌';
    row.innerHTML='<span><b>'+(step.name||'换牌')+'</b><small>'+step.cards.join(' ')+'</small></span><strong>'+value+'</strong>';
    return row;
  }));
  $('actRecord').textContent=record;
  $('actRetry').hidden=!won;
  $('actContinue').textContent=won?(nextTheaterBill()?'下一幕 →':'返回节目单'):'↻ 原牌重演';
  $('theaterResult').scrollTop=0;$('actContinue').focus({preventScroll:true});
  if(won) sfxWin(); else sfxBad();
}
document.getElementById('ovTheater').addEventListener('keydown',e=>{
  if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.key==='Escape') {e.preventDefault();e.stopPropagation();theaterBack();return;}
  if (theaterView!=='stage' || theaterAnimating) return;
  const i='12345678'.indexOf(e.key);
  if (i>=0 && theaterRun.hand[i]) {e.preventDefault();toggleTheaterCard(theaterRun.hand[i]);}
  else if (e.key.toLowerCase()==='x') {e.preventDefault();submitTheater('discard');}
  else if (e.key==='Enter' && !e.target.closest('button')) {e.preventDefault();submitTheater('play');}
});
