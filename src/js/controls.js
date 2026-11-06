const SETTINGS_KEY='pixel-balatro.settings.v1';
const settings={speed:1,music:true,sound:true};
try {
  const saved=JSON.parse(localStorage.getItem(SETTINGS_KEY));
  if(saved) {
    if([0,1,2,4].includes(saved.speed)) settings.speed=saved.speed;
    for(const key of ['music','sound']) if(typeof saved[key]==='boolean') settings[key]=saved[key];
  }
} catch {}
function applySettings() {
  muted=!settings.music;
  if(musicGain) musicGain.gain.value=settings.music?1:0;
  if(soundGain) soundGain.gain.value=settings.sound?1:0;
  $('muteBtn').textContent=settings.music?'音乐：开':'音乐：关';
  $('soundBtn').textContent=settings.sound?'音效：开':'音效：关';
  $('speedSelect').value=String(settings.speed);
}
function changeSetting(key,value) {
  settings[key]=value;
  try { localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings)); } catch {}
  applySettings();
}
function visibleDialogs() {
  return [...document.querySelectorAll('.ov')].filter(e=>e.style.display==='flex')
    .sort((a,b)=>Number(a.dataset.order||0)-Number(b.dataset.order||0));
}
function activeDialog() { return visibleDialogs().pop(); }
let previousDialog=null, returnFocus=null, animatedDialogOrder=0;
function focusables(root) {
  return [...root.querySelectorAll('button,input,select,a[href],[tabindex]')]
    .filter(e=>!e.disabled&&!e.hidden&&e.tabIndex>=0&&e.getClientRects().length);
}
function syncDialogs() {
  const stack=visibleDialogs(), top=stack[stack.length-1];
  // Painting, pointer input and keyboard focus must use the same stack.
  // Explicit pointer handling also covers Android WebViews without inert support.
  stack.forEach((el,i)=>el.style.zIndex=String(50+i*2));
  for(const el of document.querySelectorAll('.ov')) {
    el.inert=el!==top;
    el.style.pointerEvents=el===top?'auto':'none';
    el.setAttribute('role','dialog');
    el.setAttribute('aria-modal',String(el===top));
    const title=el.querySelector('h1,h2');
    if(title) { title.id ||= el.id+'Title'; el.setAttribute('aria-labelledby',title.id); }
  }
  $('game').inert=!!top;
  if(top!==previousDialog) {
    if(top) {
      if(!previousDialog) returnFocus=document.activeElement;
      (focusables(top)[0]||top).focus({preventScroll:true});
      if(Number(top.dataset.order)>animatedDialogOrder) {
        feedback(top.querySelector('.box'),[{transform:'scale(.97)'},{transform:'scale(1)'}],150);
        animatedDialogOrder=Number(top.dataset.order);
      }
    } else if(returnFocus?.isConnected) returnFocus.focus({preventScroll:true});
    previousDialog=top;
  }
}
addEventListener('keydown',e=>{
  const top=activeDialog();
  if(!top) return;
  if(e.key==='Tab') {
    const controls=focusables(top), i=controls.indexOf(document.activeElement);
    if(!controls.length) return e.preventDefault();
    if(i<0 || (e.shiftKey&&i===0) || (!e.shiftKey&&i===controls.length-1)) {
      e.preventDefault(); controls[e.shiftKey?controls.length-1:0].focus();
    }
  }
  if(e.key==='Escape'&&['ovMenu','ovChart','ovDeck','ovInfo','ovOwned','ovScore','ovCollection'].includes(top.id)) hide(top.id);
  if(e.key==='Escape'&&top.id==='ovSetup'){hide('ovSetup');show('ovStart');}
});
let owned=null, sellConfirm=false;
function openMenu() {
  $('lastScoreBtn').disabled=!S?.lastResult;
  $('returnTitleBtn').disabled=!!S?.busy&&!MP.over;
  show('ovMenu');
}
function openOwned(kind,key) {
  if(S.busy) return;
  const item=kind==='joker'?S.jokers.find(j=>j.uid===key):S.cons[key];
  if(!item) return;
  owned={kind,item}; sellConfirm=false; renderOwned(); show('ovOwned');
}
function renderOwned() {
  const {kind,item}=owned;
  $('ownedTitle').textContent=item.name;
  $('ownedArt').textContent=item.ic; $('ownedArt').dataset.kind=kind;
  $('ownedDesc').innerHTML=kind==='joker'?'<span class="ownedRarity">'+RARNAME[item.rar||0]+(item.ed?' · '+EDNAME[item.ed]:'')+'</span><p>'+jokerDesc(item)+'</p>':
    (item.kind==='planet'?HANDS[item.key].name+' 牌型升 1 级':item.desc);
  const availability=kind==='cons'?consumableUseState(item):{ok:false,label:'使用'};
  $('useOwned').hidden=kind!=='cons'; $('useOwned').disabled=!availability.ok&&!availability.select;
  $('useOwned').textContent=availability.label;
  $('sellOwned').textContent=(sellConfirm?'确认卖出 $':'卖出 $')+sellPrice(item);
  $('sellOwned').classList.toggle('confirmSale',sellConfirm);
  const i=S.jokers.indexOf(item);
  $('moveLeft').hidden=$('moveRight').hidden=kind!=='joker';
  $('moveLeft').disabled=i<=0; $('moveRight').disabled=i===S.jokers.length-1;
}
function useOwned() {
  if(!owned||S.busy||owned.kind!=='cons') return;
  const index=S.cons.indexOf(owned.item);
  if(index<0) return;
  const availability=consumableUseState(owned.item);
  if(availability.select) {hide('ovOwned');msg(availability.label);return;}
  useCons(index);
  if(!S.cons.includes(owned.item)) hide('ovOwned');
}
function sellOwned() {
  if(!owned||S.busy||activeDialog()?.id!=='ovOwned') return;
  if(!sellConfirm) { sellConfirm=true; renderOwned(); return; }
  const list=owned.kind==='joker'?S.jokers:S.cons, index=list.indexOf(owned.item);
  if(index<0) return;
  S.money+=sellPrice(owned.item); list.splice(index,1); sfxCash();
  owned=null; hide('ovOwned');
  if(S.screen==='shop') renderShop(); else renderAll();
  persistRun();
}
function moveOwned(direction) {
  if(!owned||S.busy||owned.kind!=='joker') return;
  const i=S.jokers.indexOf(owned.item), target=i+direction;
  if(i<0||target<0||target>=S.jokers.length) return;
  [S.jokers[i],S.jokers[target]]=[S.jokers[target],S.jokers[i]];
  if(S.screen==='shop') renderShop(); else {renderJokers();updatePreview();}
  renderOwned(); persistRun();
}
function renderInventory(container) {
  container.replaceChildren();
  for(const [kind,list] of [['joker',S.jokers],['cons',S.cons]]) {
    const row=document.createElement('div'); row.className='ownedRow'; row.dataset.kind=kind;
    row.setAttribute('aria-label',kind==='joker'?'持有的小丑':'持有的消耗牌');
    for(let i=0;i<list.length;i++) {
      const item=list[i], button=document.createElement('button'); button.className='sbtn ownedItem';
      const icon=document.createElement('span'), name=document.createElement('span');
      icon.className='ownedIcon'; icon.textContent=item.ic; name.textContent=item.name;
      button.append(icon,name); button.setAttribute('aria-label',item.name+'，查看与管理');
      button.dataset.kind=kind;
      button.onclick=()=>openOwned(kind,kind==='joker'?item.uid:i);
      row.append(button);
    }
    container.append(row);
  }
}
function openScore() {
  if(!S?.lastResult) return;
  const result=S.lastResult; $('scoreTitle').textContent=result.name+' · '+fmt(result.total)+' 分';
  const body=$('scoreRows'); body.replaceChildren();
  for(const event of result.events) {
    const p=document.createElement('p');
    p.textContent=event.text+'　'+fmt(event.chips)+' × '+fmtM(event.mult); body.append(p);
  }
  show('ovScore');
}
function returnToTitle() {
  if(S?.busy&&!MP.over) return msg('正在计分，请等这次出牌完成。',1);
  if(MP.on&&!MP.over) return show('ovLeave');
  exitToTitle();
}
function exitToTitle() {
  persistRun(); mpLeave();
  S=null; MP.on=false; MP.over=false;
  for(const el of document.querySelectorAll('.ov')) el.style.display='none';
  $('oppBox').style.display='none'; $('livesRow').style.display='none';
  tutEnd(); refreshTitle(); show('ovStart');
}
document.querySelector('.shopTabs').addEventListener('keydown',e=>{
  const i=SHOP_TABS.findIndex(([,id])=>id===e.target.id);
  if(i<0||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
  e.preventDefault();
  const count=SHOP_TABS.length;
  const next=e.key==='Home'?0:e.key==='End'?count-1:(i+(e.key==='ArrowRight'?1:count-1))%count;
  selectShopTab(SHOP_TABS[next][0]); $(SHOP_TABS[next][1]).focus();
});
applySettings(); syncDialogs();
