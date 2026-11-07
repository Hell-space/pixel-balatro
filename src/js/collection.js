const PROFILE_KEY='pixel-balatro.profile.v1';
let profile={wins:{}};
try {
  const saved=JSON.parse(localStorage.getItem(PROFILE_KEY));
  if(saved?.wins&&typeof saved.wins==='object')profile.wins=saved.wins;
} catch {}
let setupDeck='red',setupStake='white',collectionTab='jokers';
function openSetup(){hide('ovStart');renderSetup();show('ovSetup');}
function renderSetup(){
  const decks=$('deckChoices');decks.replaceChildren();
  for(const deck of DECKS){
    const b=document.createElement('button');b.className='deckChoice';
    b.style.setProperty('--deck-color',deck.color);b.setAttribute('aria-pressed',String(setupDeck===deck.id));
    b.innerHTML='<span class="deckMini" aria-hidden="true">✦</span><b>'+deck.name+'</b><span>'+deck.desc+'</span>';
    b.onclick=()=>{setupDeck=deck.id;renderSetup();};decks.append(b);
  }
  const stakes=$('stakeChoices');stakes.replaceChildren();
  for(const stake of STAKES){
    const b=document.createElement('button');b.className='sbtn';b.textContent=stake.name;
    b.setAttribute('aria-pressed',String(setupStake===stake.id));
    b.onclick=()=>{setupStake=stake.id;renderSetup();};stakes.append(b);
  }
  $('stakeRule').textContent=STAKES.find(s=>s.id===setupStake).desc;
  $('setupRecord').textContent=profile.wins[setupDeck+':'+setupStake]?'已通关 ✓':'';
}
function beginConfiguredRun(){
  const begin=()=>{hide('ovRestart');hide('ovSetup');newGame(false,setupDeck,setupStake);};
  if(readRun()){hide('ovSetup');show('ovRestart');$('confirmNew').onclick=begin;}
  else begin();
}
function recordVictory(){
  const key=(S.deckId||'classic')+':'+(S.stakeId||'white');
  profile.wins[key]={best:Math.max(S.bestHand,Number(profile.wins[key]?.best)||0)};
  try{localStorage.setItem(PROFILE_KEY,JSON.stringify(profile));}catch{msg('通关记录未能保存，请检查存储权限。',true);}
}
function openCollection(){renderCollection();show('ovCollection');}
function renderCollection(){
  const tabs=$('collectionTabs');tabs.replaceChildren();
  for(const [id,name] of [['jokers','小丑'],['tarots','塔罗'],['planets','星球'],['bosses','Boss'],['records','通关']]){
    const b=document.createElement('button');b.className='sbtn';b.textContent=name;b.setAttribute('aria-pressed',String(collectionTab===id));
    b.onclick=()=>{collectionTab=id;$('collectionSearch').value='';renderCollection();};tabs.append(b);
  }
  const search=$('collectionSearch');search.hidden=collectionTab==='records';
  const body=$('collectionBody');body.replaceChildren();
  if(collectionTab==='records'){
    const table=document.createElement('table');table.className='recordTable';
    table.innerHTML='<thead><tr><th>牌组</th>'+STAKES.map(s=>'<th>'+s.name+'</th>').join('')+'</tr></thead><tbody>'+DECKS.map(d=>
      '<tr><th>'+d.name+'</th>'+STAKES.map(s=>'<td>'+ (profile.wins[d.id+':'+s.id]?'✓':'—')+'</td>').join('')+'</tr>').join('')+'</tbody>';
    body.append(table);return;
  }
  const pool=collectionTab==='jokers'?JDEFS:collectionTab==='tarots'?TAROTS:collectionTab==='bosses'?BOSSES:PLANETS;
  const query=search.value.trim().toLowerCase();
  for(const item of pool){
    const desc=collectionTab==='planets'?HANDS[item.key].name+'：每级 +'+HANDS[item.key].incC+' 筹码 / +'+HANDS[item.key].incM+' 倍率':
      collectionTab==='bosses'?item.desc+'。'+bossWeakLabel(item):item.desc;
    if(query&&!(item.name+' '+desc).toLowerCase().includes(query))continue;
    const row=document.createElement('article');row.className='catalogEntry';
    const name=document.createElement('h3');name.textContent=(item.ic?item.ic+' ':'')+item.name;
    const p=document.createElement('p');p.textContent=desc;
    row.append(name,p);
    if(collectionTab==='jokers'){const cost=document.createElement('span');cost.textContent=RARNAME[item.rar]+' · $'+item.price;row.append(cost);}
    body.append(row);
  }
  if(!body.children.length)body.textContent='没有匹配的卡牌';
}
// Called only by the trusted native wrapper. Returns whether Android should leave the activity.
function nativeBack(){
  if($('tutBox').style.display==='block'){tutEnd();return false;}
  const top=activeDialog();
  if(top?.id==='ovStart')return true;
  if(top?.id==='ovSetup'){hide('ovSetup');show('ovStart');return false;}
  if(top?.id==='ovMpLobby'){mpCancel();return false;}
  if(top?.id==='ovRestart'){hide('ovRestart');show('ovStart');return false;}
  if(top&&['ovMenu','ovChart','ovDeck','ovInfo','ovOwned','ovScore','ovCollection','ovLeave','ovTactics'].includes(top.id)){hide(top.id);return false;}
  if(top?.id==='ovPack'){closePack();return false;}
  if(top?.id==='ovWorkshop'){closeWorkshop();return false;}
  if(top?.id==='ovReserve'){closeReserve();return false;}
  if(top?.id==='ovRewardHands'){closeRewardHands();return false;}
  openMenu();return false;
}
