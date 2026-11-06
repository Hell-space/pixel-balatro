const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const sourceCache=new Map();
function source(root,name){const file=path.join(root,'src/js',name+'.js');if(!sourceCache.has(file))sourceCache.set(file,fs.readFileSync(file,'utf8'));return sourceCache.get(file);}
function harness(seed=1,root=path.join(__dirname,'..')) {
  let rng=seed>>>0;
  const random=()=>{rng+=0x6D2B79F5;let t=rng;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};
  const element=()=>({style:{},dataset:{},children:[],querySelector(){return null;},classList:{add(){},remove(){},toggle(){},contains(){return false;}},appendChild(){},append(){},replaceChildren(){},setAttribute(){},addEventListener(){},remove(){}});
  const nodes=new Map();
  const storage=new Map();
  const context=vm.createContext({Math:Object.create(Math),document:{hidden:true,createElement:element,
    addEventListener(){},getElementById(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);}},
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)},
    addEventListener(){},setTimeout:()=>0,clearTimeout(){},queueMicrotask(){},matchMedia:()=>({matches:true}),console});
  context.Math.random=random;
  for(const name of ['cards','game','score-engine','scoring','shop'])
    vm.runInContext(source(root,name),context,{filename:name+'.js'});
  vm.runInContext(`
    const settings={speed:0};
    for(const key of ['initAudio','sfxDeal','sfxCash','sfxUp','sfxBad','sfxWin','sfxTick','sfxJok','sfxTarot',
      'renderStats','renderJokers','renderCons','renderHand','renderAll','renderInventory','hideTip','bindTip',
      'mpSendState','persistRun','tutStart','syncDialogs','updatePreview','feedback','handPositions',
      'animatePlayed','animateDiscard','totalFeedback','scoreFeedback','moneyFeedback','acquireFeedback']) globalThis[key]=()=>{};
    renderShop=()=>{}; popAt=()=>{}; jokerPop=()=>{}; globalThis.cardEl=()=>document.createElement('div');globalThis.cardTipHTML=()=>'';
    globalThis.sellPrice=j=>j.sell??Math.max(1,Math.ceil(j.price/2));
    globalThis.getState=()=>S;
    globalThis.getDefinitions=()=>({JDEFS,HANDS,HORDER,BOSSES,PLANETS,TAROTS});
    globalThis.selectCards=ids=>S.hand.forEach(c=>c.sel=ids.includes(c.id));
  `,context);
  return {game:context,run:code=>vm.runInContext(code,context),random,storage,
    load:name=>vm.runInContext(source(root,name),context,{filename:name+'.js'})};
}
module.exports={harness};
