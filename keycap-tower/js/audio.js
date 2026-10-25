// Web Audio 합성 효과음 (음원 파일 없음)
// 키캡 종류별 타건음 3종 + 점프/체크포인트/클리어 효과음
let ctx = null;
let master = null;
let noiseBuf = null;
let muted = false;

// 첫 터치(사용자 제스처)에서 호출해 AudioContext 생성·활성화
export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.8;
      // 과도한 피크 방지
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp);
      comp.connect(ctx.destination);
      // 노이즈 버퍼 1회 생성 (0.5초)
      noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch (e) { /* 오디오 미지원 기기: 무음으로 진행 */ }
}

export function audioState() {
  return ctx ? ctx.state : 'none';
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.8;
}
export function isMuted() { return muted; }

function ready() {
  return ctx && ctx.state === 'running' && !muted;
}

// 노이즈 버스트 (필터 + 지수 감쇠)
function noise(t, dur, type, freq, q, vol) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t, Math.random() * 0.3, dur + 0.02);
}

// 짧은 음정 (피치 하강 + 감쇠)
function tone(t, dur, type, f0, f1, vol) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

// 키캡 타건음: kind 0=일반(딸깍), 1=기능키(둔탁한 톡), 2=스페이스바(묵직한 덜컥)
// strength 0~1 (착지 속도 반영)
export function playKey(kind, strength = 0.7) {
  if (!ready()) return;
  const t = ctx.currentTime + 0.005;
  const v = 0.25 + 0.75 * Math.min(1, Math.max(0, strength));
  const det = 0.94 + Math.random() * 0.12; // 매번 조금씩 다른 음색
  if (kind === 0) {
    noise(t, 0.035, 'bandpass', 3800 * det, 1.2, 0.55 * v);
    tone(t, 0.045, 'triangle', 1900 * det, 1200, 0.22 * v);
    noise(t + 0.018, 0.03, 'highpass', 5000, 0.7, 0.18 * v); // 바닥 치는 소리
  } else if (kind === 1) {
    noise(t, 0.07, 'lowpass', 1100 * det, 0.9, 0.7 * v);
    tone(t, 0.09, 'sine', 260 * det, 150, 0.4 * v);
    noise(t + 0.012, 0.04, 'bandpass', 2200, 2, 0.15 * v);
  } else {
    tone(t, 0.18, 'sine', 140 * det, 70, 0.55 * v);
    noise(t, 0.12, 'lowpass', 700, 0.8, 0.6 * v);
    // 스태빌라이저 덜컥거림 (짧은 2연타)
    noise(t + 0.03, 0.03, 'bandpass', 1600 * det, 3, 0.3 * v);
    noise(t + 0.055, 0.025, 'bandpass', 1300 * det, 3, 0.2 * v);
  }
}

export function playJump() {
  if (!ready()) return;
  const t = ctx.currentTime + 0.005;
  tone(t, 0.12, 'sine', 380, 720, 0.08);
}

export function playCheckpoint() {
  if (!ready()) return;
  const t = ctx.currentTime + 0.01;
  [660, 880, 1320].forEach((f, i) => tone(t + i * 0.09, 0.25, 'triangle', f, f * 0.995, 0.18));
}

export function playFall() {
  if (!ready()) return;
  const t = ctx.currentTime + 0.01;
  tone(t, 0.45, 'sawtooth', 500, 90, 0.07);
}

export function playClear() {
  if (!ready()) return;
  const t = ctx.currentTime + 0.02;
  const notes = [523, 659, 784, 1047, 784, 1047];
  notes.forEach((f, i) => tone(t + i * 0.12, i === notes.length - 1 ? 0.6 : 0.2, 'triangle', f, f, 0.2));
}
