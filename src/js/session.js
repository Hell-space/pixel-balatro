// One stable, resumable solo run. Card IDs preserve shared references to the deck.
const RUN_KEY = 'pixel-balatro.run.v1';
let lastWrite = '', storageUnavailable = false;
function readRun() {
  try {
    const raw=localStorage.getItem(RUN_KEY);
    if (!raw) return null;
    const data=JSON.parse(raw), state=data.state;
    if (data.version!==1 || !state || !Array.isArray(state.deckAll) || !Array.isArray(state.hand) ||
        !Array.isArray(state.drawPile) || !['select','play','shop','cash','over'].includes(state.screen) ||
        !Number.isSafeInteger(data.cid) || !data.checkpoint) return null;
    return data;
  } catch { return null; }
}
function persistRun() {
  // The last stable action is the restore point if the tab closes during scoring or while choosing a pack.
  if (!S || MP.on || S.busy || $('ovPack').style.display==='flex' || !saveStr || storageUnavailable) return;
  const state={...S, hand:S.hand.map(c=>c.id),drawPile:S.drawPile.map(c=>c.id),played:[],sellId:null};
  const raw=JSON.stringify({version:1,cid,state,checkpoint:saveStr,meta:saveMeta});
  if (raw===lastWrite) return;
  try { localStorage.setItem(RUN_KEY,raw); lastWrite=raw; }
  catch { storageUnavailable=true; msg('浏览器未允许存档；本次关闭后无法续局。',true); }
}
function startSolo(tutorial) {
  if (readRun()) {
    hide('ovStart'); show('ovRestart');
    $('confirmNew').onclick=()=>{ hide('ovRestart'); newGame(tutorial); };
  } else newGame(tutorial);
}
function resumeGame() {
  const slot=readRun();
  if (!slot) { $('resumeBtn').hidden=true; msg('当前浏览器没有可用存档。',true); return; }
  const state=slot.state, byId=new Map(state.deckAll.map(c=>[c.id,c]));
  try {
    state.hand=state.hand.map(id=>byId.get(id));
    state.drawPile=state.drawPile.map(id=>byId.get(id));
    if (state.hand.includes(undefined) || state.drawPile.includes(undefined)) throw Error('missing card');
    S=state; cid=slot.cid; saveStr=slot.checkpoint; saveMeta=slot.meta;
    initAudio(); hide('ovStart'); renderAll();
    switch (S.screen) {
      case 'select': showBlindSelect(); break;
      case 'play': break;
      case 'shop': renderShop(); show('ovShop'); break;
      case 'cash':
        renderPayout();
        if (S.winPending) {
          $('winStats').textContent='最高单次得分：'+fmt(S.bestHand)+'　总出牌数：'+S.totHands;
          show('ovWin');
        } else show('ovCash');
        break;
      case 'over': gameLost(); break;
    }
  } catch {
    S=null; saveStr=null; saveMeta=null;
    document.querySelectorAll('.ov').forEach(el=>hide(el.id));
    show('ovStart'); $('resumeBtn').hidden=true; msg('存档无法读取，可以重新开局。',true);
  }
}
const existingRun=readRun();
if (existingRun) {
  $('resumeBtn').hidden=false;
  $('resumeBtn').textContent='继续游戏 · 底注 '+existingRun.state.ante;
}
document.addEventListener('click',()=>queueMicrotask(persistRun));
addEventListener('pagehide',persistRun);
document.addEventListener('visibilitychange',()=>{ if (document.hidden) persistRun(); });
addEventListener('keydown',e=>{
  if (!S || S.busy || S.screen!=='play' || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
  const covered=[...document.querySelectorAll('.ov')].some(o=>o.style.display==='flex') || $('tutBox').style.display==='block';
  if (covered || e.target.closest('input,textarea')) return;
  if (e.key==='Enter' && !e.target.closest('button,[role=button]')) { e.preventDefault(); doPlay(); }
  if (e.key.toLowerCase()==='x') { e.preventDefault(); doDiscard(); persistRun(); }
});
