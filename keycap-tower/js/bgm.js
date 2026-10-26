// 배경음악: 러시아 민요 '코로베이니키(Korobeiniki)' 멜로디를 자체 편곡한 8비트 합성음 (음원 파일 없음)
// - 원곡: 1861년 네크라소프의 시에 붙은 19세기 민요 → 퍼블릭 도메인
// - 사용하는 것은 민요 멜로디(앞·뒤 두 악절)뿐. 특정 게임판 편곡(저음부·대선율·느린 중간부)은 쓰지 않고
//   반주(폴카식 쿵-짝 베이스, 화음 찌르기, 2회차 아르페지오, 하이햇)는 직접 만든 것
// - 무한 반복, 스테이지가 오를수록 템포가 조금씩 빨라짐 (반복 경계에서만 바뀌어 박자가 튀지 않음)

// 음이름 → 주파수
const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
function freq(name) {
  const m = /^([A-G]#?)(\d)$/.exec(name);
  const midi = 12 * (+m[2] + 1) + NOTE[m[1]];
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// 멜로디 [음, 박자] (가단조, 4/4박, null = 쉼표) — 8마디 = 32박
const MELODY = [
  ['E5', 1], ['B4', 0.5], ['C5', 0.5], ['D5', 1], ['C5', 0.5], ['B4', 0.5],
  ['A4', 1], ['A4', 0.5], ['C5', 0.5], ['E5', 1], ['D5', 0.5], ['C5', 0.5],
  ['B4', 1.5], ['C5', 0.5], ['D5', 1], ['E5', 1],
  ['C5', 1], ['A4', 1], ['A4', 1], [null, 1],
  ['D5', 1.5], ['F5', 0.5], ['A5', 1], ['G5', 0.5], ['F5', 0.5],
  ['E5', 1.5], ['C5', 0.5], ['E5', 1], ['D5', 0.5], ['C5', 0.5],
  ['B4', 1], ['B4', 0.5], ['C5', 0.5], ['D5', 1], ['E5', 1],
  ['C5', 1], ['A4', 1], ['A4', 1], [null, 1],
];
// 마디별 화음 (자체 화성): [근음, 5음, 화음 구성음]
const CHORDS = [
  ['A2', 'E3', ['A3', 'C4', 'E4']], ['A2', 'E3', ['A3', 'C4', 'E4']],
  ['E2', 'B2', ['G#3', 'B3', 'E4']], ['A2', 'E3', ['A3', 'C4', 'E4']],
  ['D2', 'A2', ['A3', 'D4', 'F4']], ['C3', 'G2', ['G3', 'C4', 'E4']],
  ['E2', 'B2', ['G#3', 'B3', 'E4']], ['A2', 'E3', ['A3', 'C4', 'E4']],
];
const BAR = 4;
const LOOP_BEATS = MELODY_BEATS() * 2;   // 멜로디 2회 (1회차 쿵-짝, 2회차 아르페지오) = 64박
function MELODY_BEATS() { return MELODY.reduce((a, n) => a + n[1], 0); }

// 한 반복(64박)의 음표 목록을 미리 만든다: { beat, dur, kind, f }
const EVENTS = (() => {
  const ev = [];
  const mb = MELODY_BEATS();
  for (let pass = 0; pass < 2; pass++) {
    const base = pass * mb;
    let b = 0;
    for (const [n, d] of MELODY) {
      if (n) ev.push({ beat: base + b, dur: d, kind: 'lead', f: freq(n), pass });
      b += d;
    }
    CHORDS.forEach(([root, fifth, tri], bar) => {
      const t = base + bar * BAR;
      if (pass === 0) {
        // 1회차: 폴카식 쿵-짝 (1·3박 베이스, 2·4박 화음 찌르기)
        ev.push({ beat: t, dur: 0.9, kind: 'bass', f: freq(root) });
        ev.push({ beat: t + 2, dur: 0.9, kind: 'bass', f: freq(fifth) });
        for (const k of [1, 3]) for (const c of tri) ev.push({ beat: t + k, dur: 0.25, kind: 'stab', f: freq(c) });
      } else {
        // 2회차: 8분음표 베이스(근음-옥타브) + 화음 아르페지오로 분위기 변화
        for (let i = 0; i < 8; i++) {
          const f = freq(root) * (i % 2 ? 2 : 1);
          ev.push({ beat: t + i * 0.5, dur: 0.4, kind: 'bass', f });
          ev.push({ beat: t + i * 0.5, dur: 0.22, kind: 'arp', f: freq(tri[i % 3]) * 2 });
        }
      }
      // 하이햇: 엇박(8분음표 뒤)
      for (let i = 0; i < 4; i++) ev.push({ beat: t + i + 0.5, dur: 0.05, kind: 'hat' });
    });
  }
  return ev.sort((a, b) => a.beat - b.beat);
})();

// 음색별 음량 (BGM 버스 게인 이전 값). 리드가 가장 앞에, 반주는 뒤로
const LEVEL = { lead: 0.13, bass: 0.22, stab: 0.035, arp: 0.03, hat: 0.05 };

// 스테이지별 템포: 1스테이지 120 BPM, 한 스테이지마다 2%씩 (10스테이지 약 143 BPM)
export function tempoFor(stage) {
  return 120 * (1 + 0.02 * (Math.max(1, Math.min(10, stage)) - 1));
}

// 컨텍스트별 25% 펄스파 (8비트 느낌의 얇은 사각파)
const pulseCache = new WeakMap();
function pulse(c) {
  let w = pulseCache.get(c);
  if (w) return w;
  const n = 32, re = new Float32Array(n), im = new Float32Array(n);
  for (let k = 1; k < n; k++) im[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * 0.25);
  w = c.createPeriodicWave(re, im);
  pulseCache.set(c, w);
  return w;
}
const noiseCache = new WeakMap();
function noiseBuf(c) {
  let b = noiseCache.get(c);
  if (b) return b;
  b = c.createBuffer(1, Math.floor(c.sampleRate * 0.1), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  noiseCache.set(c, b);
  return b;
}

// 음표 하나 예약 (실제 재생·오프라인 검증 공통)
function play(c, dest, e, t, spb) {
  const len = e.dur * spb;
  const g = c.createGain();
  g.connect(dest);
  if (e.kind === 'hat') {
    const s = c.createBufferSource();
    s.buffer = noiseBuf(c);
    const f = c.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 7000;
    g.gain.setValueAtTime(LEVEL.hat, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.05);
    s.connect(f); f.connect(g);
    s.start(t); s.stop(t + 0.06);
    return;
  }
  const o = c.createOscillator();
  if (e.kind === 'bass') o.type = 'triangle';
  else o.setPeriodicWave(pulse(c));
  o.frequency.value = e.f;
  const v = LEVEL[e.kind] * (e.kind === 'lead' && e.pass ? 0.9 : 1);
  // 짧은 어택 → 지속 → 음 길이의 85% 지점에서 끊음 (8비트식 또렷한 끊김, 클릭 방지용 5ms 램프)
  const gate = Math.max(0.03, len * (e.kind === 'lead' ? 0.85 : 0.9));
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(v, t + 0.005);
  if (e.kind === 'stab' || e.kind === 'arp') g.gain.exponentialRampToValueAtTime(v * 0.2, t + gate);
  g.gain.setValueAtTime(e.kind === 'stab' || e.kind === 'arp' ? v * 0.2 : v, t + gate);
  g.gain.linearRampToValueAtTime(0, t + gate + 0.005);
  o.connect(g);
  o.start(t); o.stop(t + gate + 0.02);
}

// ── 실시간 재생 (앞질러 예약하는 스케줄러) ──
const AHEAD = 0.25;      // 이만큼 앞까지 미리 예약 (초)
const TICK_MS = 40;
let c = null, bus = null, sess = null, timer = 0;
let idx = 0, loopStart = 0, spb = 0.5, stage = 1;

export function setStage(s) { stage = s; }   // 템포는 다음 반복 시작부터 반영
export function isPlaying() { return !!timer; }

// ctx: AudioContext, dest: BGM 버스(볼륨 게인 노드)
export function start(ctx, dest) {
  if (timer || !ctx || !dest) return;
  c = ctx; bus = dest;
  sess = c.createGain();     // 정지할 때 이미 예약된 음까지 바로 끄기 위한 세션 게인
  sess.connect(bus);
  spb = 60 / tempoFor(stage);
  idx = 0;
  loopStart = c.currentTime + 0.08;
  timer = setInterval(tick, TICK_MS);
  tick();
}

export function stop() {
  if (!timer) return;
  clearInterval(timer);
  timer = 0;
  const s = sess, now = c.currentTime;
  s.gain.setValueAtTime(s.gain.value, now);
  s.gain.linearRampToValueAtTime(0, now + 0.04);
  setTimeout(() => { try { s.disconnect(); } catch (e) { /* 무시 */ } }, 300);
  sess = null;
}

function tick() {
  // 화면이 멈췄다 돌아오는 등으로 크게 밀렸으면 지금부터 다시 맞춤 (밀린 음을 한꺼번에 내지 않음)
  if (loopStart + EVENTS[idx].beat * spb < c.currentTime - 0.1) {
    loopStart = c.currentTime + 0.05 - EVENTS[idx].beat * spb;
  }
  while (loopStart + EVENTS[idx].beat * spb < c.currentTime + AHEAD) {
    const e = EVENTS[idx];
    play(c, sess, e, loopStart + e.beat * spb, spb);
    if (++idx >= EVENTS.length) {
      idx = 0;
      loopStart += LOOP_BEATS * spb;
      // 반복 경계에서 현재 스테이지 템포로 갱신
      spb = 60 / tempoFor(stage);
    }
  }
}

// ── 검증용: 오프라인 컨텍스트에 seconds 길이만큼 예약 ──
export function renderInto(ctx, dest, seconds, st = 10) {
  const sp = 60 / tempoFor(st);
  for (let ls = 0; ls < seconds; ls += LOOP_BEATS * sp) {
    for (const e of EVENTS) {
      const t = ls + e.beat * sp;
      if (t >= seconds) break;
      play(ctx, dest, e, t, sp);
    }
  }
}

export const LOOP_INFO = { beats: LOOP_BEATS, notes: EVENTS.length };
