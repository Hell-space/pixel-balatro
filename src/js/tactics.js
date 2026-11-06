const CONTRACTS=[
  {id:'first',name:'一手过关',payout:8,desc:'只出一手牌就击败盲注'},
  {id:'clean',name:'不弃一牌',payout:6,desc:'不使用弃牌，击败盲注'},
  {id:'variety',name:'三路出击',payout:9,desc:'打出至少三种不同牌型，再击败盲注'},
];
const RHYTHMS=[
  {id:'none',name:'常规',desc:'沿用普通计分'},
  {id:'focus',name:'专注',desc:'连续同牌型，每次 +2 倍率，最多 +8'},
  {id:'flow',name:'变奏',desc:'连续换牌型，每次 +2 倍率，最多 +8'},
];
function contractAvailable(contract) {
  if(contract.id==='variety'&&S.blindIdx===2&&S.anteBoss?.id==='needle')return false;
  if(contract.id==='clean'&&((S.blindIdx===2&&S.anteBoss?.id==='water')||S.baseDisc===0))return false;
  return true;
}
function renderTacticsEntry() {
  $('tacticsEntry').hidden=MP.on;
  const rhythm=RHYTHMS.find(r=>r.id===S.rhythmMode)||RHYTHMS[0],contract=CONTRACTS.find(c=>c.id===S.contractChoice);
  $('tacticsEntry').textContent='备战 · '+rhythm.name+(contract?' · '+contract.name+' 押 $2':' · 选择悬赏');
}
function openTactics() {
  if(S.screen!=='select'||MP.on) return;
  renderTactics();show('ovTactics');
}
function renderTactics() {
  const modes=$('rhythmChoices');modes.replaceChildren();
  for(const rhythm of RHYTHMS) {
    const button=document.createElement('button');button.className='tacticChoice';button.dataset.rhythm=rhythm.id;
    button.setAttribute('aria-pressed',String(S.rhythmMode===rhythm.id));
    button.innerHTML='<b>'+rhythm.name+'</b><span>'+rhythm.desc+'</span>';
    button.onclick=()=>selectRhythm(rhythm.id);modes.append(button);
  }
  const offers=$('contractChoices');offers.replaceChildren();
  const skip=document.createElement('button');skip.className='tacticChoice';skip.dataset.contract='none';
  skip.setAttribute('aria-pressed',String(!S.contractChoice));skip.textContent='不接悬赏';skip.onclick=()=>selectContract(null);offers.append(skip);
  for(const contract of CONTRACTS) {
    const button=document.createElement('button');button.className='tacticChoice';button.dataset.contract=contract.id;
    button.disabled=!contractAvailable(contract)||S.money<2;
    button.setAttribute('aria-pressed',String(S.contractChoice===contract.id));
    button.innerHTML='<b>'+contract.name+' · 返 $'+contract.payout+'</b><span>'+contract.desc+'</span>'+
      (button.disabled?'<small>'+(!contractAvailable(contract)?'本盲注不适用':'需要 $2 押金')+'</small>':'');
    button.onclick=()=>selectContract(contract.id);offers.append(button);
  }
}
function selectRhythm(mode) {
  if(S.screen!=='select'||MP.on||!RHYTHMS.some(r=>r.id===mode))return false;
  S.rhythmMode=mode;renderTactics();renderTacticsEntry();saveCheckpoint();persistRun();return true;
}
function selectContract(id) {
  const def=CONTRACTS.find(c=>c.id===id);
  if(S.screen!=='select'||MP.on||(id!==null&&(!def||!contractAvailable(def)||S.money<2)))return false;
  S.contractChoice=id;renderTactics();renderTacticsEntry();saveCheckpoint();persistRun();return true;
}
function startTactics() {
  S.rhythm={lastKey:null,chain:0};S.contract=null;
  if(!MP.on&&S.contractChoice) {
    const def=CONTRACTS.find(c=>c.id===S.contractChoice);
    if(def&&contractAvailable(def)&&S.money>=2) {
      S.money-=2;S.contract={id:def.id,discards:0,settled:false};
    }
  }
  S.contractChoice=null;
}
function contractResult() {
  if(!S.contract)return null;
  const def=CONTRACTS.find(c=>c.id===S.contract.id);
  const count=S.blindPlayed.length,distinct=new Set(S.blindPlayed).size;
  const met=def.id==='first'?count===1:def.id==='clean'?S.contract.discards===0:distinct>=3;
  return {def,met,detail:def.id==='first'?(count>1?'已失约':count+' / 1 手'):def.id==='clean'?(S.contract.discards?'已失约':'尚未弃牌'):distinct+' / 3 牌型'};
}
function settleContract() {
  if(MP.on||!S.contract||S.contract.settled)return 0;
  const result=contractResult();S.contract.settled=true;
  S.payout.push(['悬赏 · '+result.def.name+(result.met?'':'（未完成）'),result.met?result.def.payout:0]);
  return result.met?result.def.payout:0;
}
function tacticsStatus() {
  if(MP.on||S.screen!=='play')return '';
  const rhythm=RHYTHMS.find(r=>r.id===S.rhythmMode),parts=[];
  if(rhythm&&rhythm.id!=='none')parts.push(rhythm.name+' '+(S.rhythm?.chain||0)+' 连');
  const contract=contractResult();if(contract)parts.push(contract.def.name+' · '+contract.detail);
  return parts.join(' ｜ ');
}
