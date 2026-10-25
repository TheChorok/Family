// Web Audio 합성 효과음 (음원 파일 없음)
// 키캡 종류별 타건음 3종 + 점프/체크포인트/클리어 효과음
// 신호 흐름: 각 효과음 → master(효과음 볼륨) ─┐
//           배경음악(bgm.js) → bgmBus(BGM 볼륨) ─┴→ DynamicsCompressor(리미터, 클리핑 방지) → 출력
import * as bgm from './bgm.js';

let ctx = null;
let master = null;
let bgmBus = null;
let noiseBuf = null;

// 효과음 볼륨 4단계 (master 게인). 컴프레서 통과 후 최종 출력 기준으로 맞춘 값:
// 작게 ≈ 이전 버전 -6dB, 보통 ≈ 이전 버전과 비슷, 크게(기본) ≈ 이전 버전 +6dB(진폭 약 2배)
export const VOLUME_LEVELS = [
  { name: '끄기', gain: 0 },
  { name: '작게', gain: 0.5 },
  { name: '보통', gain: 0.9 },
  { name: '크게', gain: 2.0 },
];
export const DEFAULT_VOLUME = 3;
let volume = DEFAULT_VOLUME;
// 배경음악 볼륨 4단계 (효과음과 별도 저장, 기본 '보통'). 효과음(타건음)이 묻히지 않도록 낮게 잡음
export const BGM_LEVELS = [
  { name: '끄기', gain: 0 },
  { name: '작게', gain: 0.35 },
  { name: '보통', gain: 0.7 },
  { name: '크게', gain: 1.2 },
];
export const DEFAULT_BGM = 2;
let bgmLevel = DEFAULT_BGM;
let offsetT = 0; // 오프라인 검증 시 예약 시작 시간 오프셋

// master → 컴프레서 → 출력 체인 구성 (실제 재생과 오프라인 검증에서 공통 사용)
function buildChain(c) {
  const m = c.createGain();
  m.gain.value = VOLUME_LEVELS[volume].gain;
  const b = c.createGain();
  b.gain.value = BGM_LEVELS[bgmLevel].gain;
  // 리미터처럼 동작하도록 빠른 어택·높은 비율로 설정 (게인을 올려도 출력이 0dBFS를 넘지 않게)
  const comp = c.createDynamicsCompressor();
  // threshold를 높게(-3dB) 두어 평소 소리는 거의 건드리지 않고 겹친 피크만 눌러 준다
  comp.threshold.value = -3;
  comp.knee.value = 0;
  comp.ratio.value = 20;
  comp.attack.value = 0.001;
  comp.release.value = 0.1;
  m.connect(comp);
  b.connect(comp);
  comp.connect(c.destination);
  return { m, b };
}

function makeNoise(c) {
  // 노이즈 버퍼 1회 생성 (0.5초)
  const b = c.createBuffer(1, Math.floor(c.sampleRate * 0.5), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

// 첫 터치(사용자 제스처)에서 호출해 AudioContext 생성·활성화
export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      ({ m: master, b: bgmBus } = buildChain(ctx));
      noiseBuf = makeNoise(ctx);
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch (e) { /* 오디오 미지원 기기: 무음으로 진행 */ }
}

export function audioState() {
  return ctx ? ctx.state : 'none';
}

// 볼륨 단계 설정 (0=끄기 ~ 3=크게)
export function setVolume(level) {
  volume = Math.max(0, Math.min(VOLUME_LEVELS.length - 1, level | 0));
  if (master) master.gain.value = VOLUME_LEVELS[volume].gain;
}
export function getVolume() { return volume; }

// 배경음악 볼륨 단계 (0=끄기 ~ 3=크게). 끄기면 재생 자체를 멈춤
export function setBgmVolume(level) {
  bgmLevel = Math.max(0, Math.min(BGM_LEVELS.length - 1, level | 0));
  if (bgmBus) bgmBus.gain.value = BGM_LEVELS[bgmLevel].gain;
  if (bgmLevel === 0) bgm.stop();
}
export function getBgmVolume() { return bgmLevel; }

// 배경음악 재생/정지 (게임 상태에 맞춰 main.js가 호출). stage: 템포용 현재 스테이지
export function setBgm(on, stage = 1) {
  bgm.setStage(stage);
  if (on && ctx && bgmLevel > 0) bgm.start(ctx, bgmBus);
  else bgm.stop();
}
export function bgmPlaying() { return bgm.isPlaying(); }

function ready() {
  return ctx && ctx.state === 'running' && volume > 0;
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
  if (ready()) keySound(kind, strength);
}
function keySound(kind, strength) {
  const t = ctx.currentTime + 0.005 + offsetT;
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

// 기믹 효과음: bounce(튕김), ice(유리 같은 딸깍), vanish(키캡 사라짐), small(작아짐), big(커짐),
// sizeEnd(원래 크기), reverse(반전 경고), crumble(금 가는 소리)
export function playGimmick(kind) {
  if (ready()) gimmickSound(kind);
}
function gimmickSound(kind) {
  const t = ctx.currentTime + 0.005 + offsetT;
  switch (kind) {
    case 'bounce':
      tone(t, 0.28, 'sine', 180, 720, 0.35);
      tone(t + 0.02, 0.2, 'triangle', 360, 1100, 0.12);
      break;
    case 'ice':
      tone(t, 0.12, 'triangle', 2600, 2400, 0.16);
      noise(t, 0.05, 'highpass', 6000, 0.7, 0.2);
      break;
    case 'crumble':
      noise(t, 0.06, 'bandpass', 900, 2, 0.4);
      noise(t + 0.05, 0.05, 'bandpass', 700, 2, 0.3);
      break;
    case 'vanish':
      noise(t, 0.25, 'lowpass', 600, 0.7, 0.45);
      tone(t, 0.3, 'sine', 300, 80, 0.2);
      break;
    case 'small':
      tone(t, 0.35, 'square', 900, 300, 0.07);
      break;
    case 'big':
      tone(t, 0.35, 'square', 250, 800, 0.07);
      break;
    case 'sizeEnd':
      tone(t, 0.15, 'triangle', 600, 600, 0.12);
      tone(t + 0.1, 0.18, 'triangle', 800, 800, 0.12);
      break;
    case 'reverse':
      [0, 0.16, 0.32].forEach((d, i) => tone(t + d, 0.12, 'square', i % 2 ? 520 : 780, i % 2 ? 520 : 780, 0.08));
      break;
    default:
      break;
  }
}

export function playJump() {
  if (ready()) jumpSound();
}
function jumpSound() {
  const t = offsetT + ctx.currentTime + 0.005;
  tone(t, 0.12, 'sine', 380, 720, 0.08);
}

export function playCheckpoint() {
  if (ready()) checkpointSound();
}
function checkpointSound() {
  const t = offsetT + ctx.currentTime + 0.01;
  [660, 880, 1320].forEach((f, i) => tone(t + i * 0.09, 0.25, 'triangle', f, f * 0.995, 0.18));
}

export function playFall() {
  if (ready()) fallSound();
}
function fallSound() {
  const t = offsetT + ctx.currentTime + 0.01;
  tone(t, 0.45, 'sawtooth', 500, 90, 0.07);
}

export function playClear() {
  if (ready()) clearSound();
}
function clearSound() {
  const t = offsetT + ctx.currentTime + 0.02;
  const notes = [523, 659, 784, 1047, 784, 1047];
  notes.forEach((f, i) => tone(t + i * 0.12, i === notes.length - 1 ? 0.6 : 0.2, 'triangle', f, f, 0.2));
}

// 검증용: 볼륨 단계별로 효과음을 OfflineAudioContext에 렌더링해 최대 출력과 클리핑 샘플 수를 측정
// sounds: [[이름, 시작시간(초)], ...] 이름 = key0|key1|key2|jump|checkpoint|fall|clear
// legacy: 이전 버전 체인(게인 0.8 + 기본값 컴프레서) 비교용
// bgmLvl: 배경음악을 함께 렌더링할 BGM 볼륨 단계 (null이면 효과음만), seconds: 렌더링 길이
export async function renderTest(level, sounds, { bypassCompressor = false, legacy = false, bgmLvl = null, seconds = 2, stage = 10 } = {}) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const off = new OAC(1, Math.floor(44100 * seconds), 44100);
  const saved = [ctx, master, noiseBuf, volume, bgmBus, bgmLevel];
  volume = level;
  if (bgmLvl !== null) bgmLevel = bgmLvl;
  ctx = off;
  noiseBuf = makeNoise(off);
  if (legacy) {
    master = off.createGain();
    master.gain.value = 0.8;
    const comp = off.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(off.destination);
  } else if (bypassCompressor) {
    master = off.createGain();
    master.gain.value = VOLUME_LEVELS[level].gain;
    master.connect(off.destination);
  } else {
    ({ m: master, b: bgmBus } = buildChain(off));
    if (bgmLvl) bgm.renderInto(off, bgmBus, seconds, stage);
  }
  // 오프라인 컨텍스트는 state가 'suspended'라 ready()를 우회해 합성 함수를 직접 예약 (타건음은 최대 세기)
  const synth = {
    key0: () => keySound(0, 1), key1: () => keySound(1, 1), key2: () => keySound(2, 1),
    jump: jumpSound, checkpoint: checkpointSound, fall: fallSound, clear: clearSound,
    bounce: () => gimmickSound('bounce'), vanish: () => gimmickSound('vanish'), reverse: () => gimmickSound('reverse'),
    big: () => gimmickSound('big'), ice: () => gimmickSound('ice'), crumble: () => gimmickSound('crumble'),
  };
  try {
    for (const [name, at] of sounds) {
      offsetT = at;
      synth[name]();
    }
  } finally {
    offsetT = 0;
    [ctx, master, noiseBuf, volume, bgmBus, bgmLevel] = saved;
  }
  const buf = await off.startRendering();
  const d = buf.getChannelData(0);
  let peak = 0, clipped = 0, sq = 0;
  for (let i = 0; i < d.length; i++) {
    const a = Math.abs(d[i]);
    if (a > peak) peak = a;
    if (a >= 1) clipped++;
    sq += a * a;
  }
  const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
  // RMS는 앞쪽 0.25초(타건음 길이) 기준 에너지로 비교
  let sq25 = 0; const n25 = Math.floor(off.sampleRate * 0.25);
  for (let i = 0; i < n25; i++) sq25 += d[i] * d[i];
  return { gain: VOLUME_LEVELS[level].gain, bgmGain: bgmLvl === null ? null : BGM_LEVELS[bgmLvl].gain, peak, peakDb: db(peak), rmsDb: db(Math.sqrt(sq25 / n25)), rmsAllDb: db(Math.sqrt(sq / d.length)), clipped };
}
