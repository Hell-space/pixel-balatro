// ================= 音频（全部合成） =================
let actx = null, muted = false, musTimer = null;
function initAudio() {
  if (actx) return;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    startMusic();
  } catch (e) {}
}
function blip(f, dur, type, vol, when, slide) {
  if (!actx) return;
  const t = when || actx.currentTime;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(actx.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
// 轻爵士感背景循环
const CHORDS = [[220,261.6,329.6],[174.6,220,261.6],[196,246.9,293.7],[164.8,207.7,246.9]];
let mIdx = 0, mNext = 0;
function startMusic() {
  mNext = actx.currentTime + 0.2;
  musTimer = setInterval(() => {
    if (!actx || muted || document.hidden) return;
    mNext = Math.max(mNext,actx.currentTime);
    while (mNext < actx.currentTime + 0.5) {
      const ch = CHORDS[mIdx % 4];
      ch.forEach(f => blip(f, 2.2, 'sine', 0.016, mNext));
      blip(ch[0] / 2, 1.4, 'triangle', 0.03, mNext);
      if (Math.random() < 0.7) blip(ch[Math.floor(Math.random()*3)] * 2, 0.5, 'triangle', 0.014, mNext + 1 + Math.random());
      mIdx++; mNext += 2.4;
    }
  }, 300);
}
function toggleMute() {
  muted = !muted;
  document.getElementById('muteBtn').textContent = muted ? '🔇 音乐：关' : '🔊 音乐：开';
}
const sfxSel  = () => blip(500, 0.05, 'square', 0.03, 0, 700);
const sfxDeal = () => blip(300, 0.04, 'square', 0.02, 0, 500);
const sfxTick = n => blip(600 + Math.min(1200, n * 2), 0.06, 'sine', 0.04);
const sfxJok  = () => blip(880, 0.1, 'square', 0.04, 0, 1100);
const sfxCash = () => { blip(1050, 0.09, 'sine', 0.06); blip(1560, 0.12, 'sine', 0.05, actx ? actx.currentTime + 0.07 : 0); };
const sfxBad  = () => blip(150, 0.25, 'sawtooth', 0.08, 0, 60);
const sfxUp   = () => { if (!actx) return; const t = actx.currentTime; [523,659,784].forEach((f,i)=>blip(f,0.12,'square',0.05,t+i*0.07)); };
const sfxWin  = () => { if (!actx) return; const t = actx.currentTime; [523,659,784,1047,1319].forEach((f,i)=>blip(f,0.18,'square',0.055,t+i*0.1)); };
const sfxTarot= () => { if (!actx) return; const t = actx.currentTime; [660,880,1100].forEach((f,i)=>blip(f,0.2,'triangle',0.045,t+i*0.08)); };
