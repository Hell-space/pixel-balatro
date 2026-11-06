// Decorative feedback never changes the game state or consumes its random sequence.
const feedbackAnimations=new WeakMap();
function motionAllowed(scoring=false) {
  return !document.hidden&&!matchMedia('(prefers-reduced-motion: reduce)').matches&&(!scoring||settings.speed!==0);
}
function feedback(el,frames,duration=180,scoring=false) {
  if(!el||!motionAllowed(scoring)||!el.animate) return;
  feedbackAnimations.get(el)?.cancel();
  const animation=el.animate(frames,{duration:scoring?duration/settings.speed:duration,easing:'cubic-bezier(.2,.75,.25,1)'});
  feedbackAnimations.set(el,animation);
  return animation;
}
function handPositions() {
  return new Map([...$('handRow').children].map(el=>[Number(el.dataset.cardId),el.getBoundingClientRect()]));
}
function animatePlayed(origins) {
  if(!motionAllowed(true)) return;
  for(const el of $('playedRow').querySelectorAll('.card')) {
    const from=origins.get(Number(el.dataset.cardId)),to=el.getBoundingClientRect();
    if(!from) continue;
    feedback(el,[{transform:`translate(${from.x-to.x}px,${from.y-to.y}px) scale(${from.width/to.width}) rotate(-5deg)`,opacity:.8},
      {transform:'translate(0,0) scale(1) rotate(0)',opacity:1}],280,true);
  }
}
function fxLayer() {
  let layer=$('feedbackLayer');
  if(!layer){layer=document.createElement('div');layer.id='feedbackLayer';layer.setAttribute('aria-hidden','true');document.body.append(layer);}
  layer.style.zIndex=String(activeDialog()?Number(activeDialog().style.zIndex)+1:40);
  return layer;
}
function transient(el,frames,duration=300,scoring=false) {
  if(!motionAllowed(scoring)) return;
  const layer=fxLayer();
  if(layer.childElementCount>=24) layer.firstElementChild.remove();
  layer.append(el);
  const animation=feedback(el,frames,duration,scoring);
  if(!animation){el.remove();return;}
  animation.onfinish=animation.oncancel=()=>el.remove();
}
function animateDiscard(cards) {
  if(!motionAllowed(true)) return;
  for(const [i,c] of cards.entries()) {
    const original=[...$('handRow').children].find(el=>Number(el.dataset.cardId)===c.id);
    if(!original) continue;
    const box=original.getBoundingClientRect(),ghost=original.cloneNode(true);
    ghost.removeAttribute('id'); ghost.classList.remove('sel','dealt'); ghost.classList.add('discardGhost'); ghost.tabIndex=-1;
    Object.assign(ghost.style,{left:box.x+'px',top:box.y+'px',width:box.width+'px',height:box.height+'px'});
    transient(ghost,[{transform:'translate(0,0)',opacity:1},{transform:`translate(${-28-i*9}px,-65px) rotate(-15deg) scale(.85)`,opacity:0}],210,true);
  }
}
function scoreFeedback(wrap) {
  if(!wrap||!motionAllowed(true)) return;
  feedback(wrap.querySelector('.card'),[{transform:'translateY(0)'},{transform:'translateY(-9px) rotate(-3deg)',offset:.35},{transform:'translateY(0)'}],220,true);
  const source=wrap.getBoundingClientRect(),target=$('prevChips').getBoundingClientRect();
  for(let i=0;i<3;i++) {
    const chip=document.createElement('i');chip.className='flyingChip';
    Object.assign(chip.style,{left:(source.x+source.width/2)+'px',top:(source.y+source.height/2)+'px'});
    const dx=target.x+target.width/2-source.x-source.width/2,dy=target.y+target.height/2-source.y-source.height/2;
    transient(chip,[{transform:'translate(-50%,-50%) scale(.6)',opacity:0},
      {transform:`translate(${dx*.35+i*7}px,${dy*.25-25}px) scale(1)`,opacity:1,offset:.35},
      {transform:`translate(${dx}px,${dy}px) scale(.4)`,opacity:0}],300+i*25,true);
  }
}
function acquireFeedback(from,item,target) {
  if(!from||!target||!motionAllowed()) return;
  const to=target.getBoundingClientRect(),card=document.createElement('div');
  card.className='acquiredCard';card.textContent=item.ic;
  Object.assign(card.style,{left:(from.x+from.width/2-22)+'px',top:(from.y+from.height/2-28)+'px'});
  transient(card,[{transform:'translate(0,0) rotate(-7deg) scale(1.2)',opacity:1},
    {transform:`translate(${to.x+to.width/2-from.x-from.width/2}px,${to.y+to.height/2-from.y-from.height/2}px) rotate(0) scale(.65)`,opacity:0}],320);
  feedback(target,[{boxShadow:'0 0 0 2px #f3ce72'},{boxShadow:'0 0 0 7px #f3ce7200'}],450);
}
function moneyFeedback() {
  feedback($('shopMoney'),[{transform:'scale(1.14)',color:'#fff0b3'},{transform:'scale(1)',color:'#b8ddaf'}],220);
}
function totalFeedback() {
  if(!motionAllowed(true)) return;
  feedback($('totalPop'),[{transform:'translateX(-50%) scale(.65)',opacity:0},{transform:'translateX(-50%) scale(1.06)',opacity:1,offset:.6},
    {transform:'translateX(-50%) scale(1)',opacity:1}],320,true);
  feedback($('scoreVal'),[{transform:'scale(1.18)',color:'#fff1b8'},{transform:'scale(1)',color:'#f2c769'}],340,true);
}
document.addEventListener('visibilitychange',()=>{if(document.hidden)$('feedbackLayer')?.replaceChildren();});
