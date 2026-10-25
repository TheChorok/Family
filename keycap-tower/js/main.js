// 키캡 타워: 딸깍 등반 — 메인 (초기화, 게임 루프, 상태 관리)
import * as THREE from 'three';
import { generateTower, KEY_TYPES, STAGES } from './layout.js';
import { createWorld, createPlayer, stepPlayer, updateMovers, FIXED_DT } from './physics.js';
import { TowerView } from './tower.js';
import { PlayerView } from './player.js';
import { FollowCamera } from './camera.js';
import { Input } from './input.js';
import { Quality, QUALITY_NAMES } from './quality.js';
import * as audio from './audio.js';
import * as store from './storage.js';
import { Hud, showOverlay, formatTime } from './hud.js';

const $ = (id) => document.getElementById(id);
const FALL_DIST = 12;      // 마지막 체크포인트보다 이만큼 아래로 떨어지면 부활
const FALL_TIME = 1.5;     // 이만큼 넘게 계속 떨어지면 바닥에 닿기 전이라도 부활 (통로 가운데 낙하 지루함 방지)
const RUN_VERSION = 2;     // 저장 형식 버전 (2 = 네모 통로 탑). 다른 버전·형태의 진행은 이어하지 않음
const TAUNT_COOLDOWN = 10; // 놀림 팝업 최소 간격(초)
const MAX_STEPS = 12;      // 프레임당 최대 물리 스텝 (느린 프레임에서 폭주 방지)

// ── 렌더러 / 씬 ──
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene();
// 하늘은 단색 배경(화면 지우기 색)으로 처리: 그라데이션 텍스처 배경은 매 프레임 화면 전체를 한 번 더 그려
// 통로 벽과 겹쳐 픽셀 비용이 크다 (헤드리스 측정: 저사양 단계에서 프레임당 약 10ms 차이)
scene.background = new THREE.Color(0x9fd0ff);
scene.fog = new THREE.Fog(0xdbe7ff, 40, 120);
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 260);

const hemi = new THREE.HemisphereLight(0xe6f2ff, 0x7a7090, 2.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.shadow.mapSize.set(1024, 1024);
const sc = sun.shadow.camera;
sc.left = -18; sc.right = 18; sc.top = 18; sc.bottom = -18; sc.near = 1; sc.far = 70;
sun.shadow.bias = -0.0008;
scene.add(sun, sun.target);

// ── 월드 ──
const tower = generateTower();
const world = createWorld(tower.boxes, tower.statics);
const BEST_KEY = 'best_' + tower.shape;          // 탑 형태별 최고 기록 (나선 시절 기록은 best_spiral)
const LEGACY_BEST_KEY = 'best_spiral';
// 1단계(나선) 최고 기록 'best' → '이전 탑 기록'으로 옮겨 보관
{
  const old = store.load('best', null);
  if (old && !store.load(LEGACY_BEST_KEY, null)) store.save(LEGACY_BEST_KEY, old);
  if (old) store.remove('best');
}
const towerView = new TowerView(scene, tower);
const playerView = new PlayerView(scene);
const follow = new FollowCamera(camera);
follow.setView(tower.view);
const hud = new Hud();
const input = new Input({ layer: $('touch'), joyBase: $('joy'), joyKnob: $('joyKnob'), jumpBtn: $('jump') });

// ── 그래픽 품질 ──
const PIXEL_RATIO = [1, 1.5, 2];
function applyQuality(level) {
  const pr = Math.min(window.devicePixelRatio || 1, PIXEL_RATIO[level]);
  renderer.setPixelRatio(pr);
  const shadows = level === 2;
  if (renderer.shadowMap.enabled !== shadows) {
    renderer.shadowMap.enabled = shadows;
    // 그림자 설정 변경 시 셰이더 재컴파일 필요
    scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  }
  sun.castShadow = shadows;
  playerView.setShadows(shadows);
  scene.fog.far = level === 0 ? 75 : 120;
  camera.far = level === 0 ? 90 : 260;
  camera.updateProjectionMatrix();
  resize();
  const el = $('qualityName');
  if (el) el.textContent = QUALITY_NAMES[level];
}
const quality = new Quality(applyQuality);
quality.onResult = (level, ms) => hud.toast(`그래픽 자동 설정: ${QUALITY_NAMES[level]} (${ms.toFixed(1)}ms/프레임)`, 2600);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < h ? 72 : 60;   // 세로 화면은 시야를 넓혀 주변이 보이게
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

// ── 게임 상태 ──
// state: 'title' | 'playing' | 'paused' | 'clear'
let state = 'title';
let respawnT = 0;                // >0 이면 부활 연출 중
const run = { cp: 0, time: 0, falls: 0 };
const player = createPlayer(0, 0, 0);
let simTime = 0;
let acc = 0;
let fallT = 0;          // 연속 낙하 시간
let leaveY = 0;         // 마지막으로 발판을 떠난 높이

function saveRun() {
  store.save('run', { v: RUN_VERSION, shape: tower.shape, cp: run.cp, time: Math.round(run.time * 1000) / 1000, falls: run.falls });
}
// 현재 탑에서 이어할 수 있는 저장인지 (예전 나선 버전 진행은 새로 시작)
function validRun(saved) {
  return saved && saved.v === RUN_VERSION && saved.shape === tower.shape;
}

function placeAtCheckpoint(index) {
  const cp = tower.checkpoints[index];
  Object.assign(player, createPlayer(cp.x, cp.y + 0.05, cp.z));
  playerView.yaw = cp.yaw;
  follow.setBehind(cp.yaw, cp.normal);
  fallT = 0;
  leaveY = cp.y;
}

function startRun(cont) {
  const saved = cont ? store.load('run', null) : null;
  if (validRun(saved)) {
    run.cp = Math.min(STAGES - 1, Math.max(0, saved.cp | 0));
    run.time = +saved.time || 0;     // 저장된 누적 플레이 시간부터 타이머 이어서 진행
    run.falls = saved.falls | 0;
  } else {
    run.cp = 0; run.time = 0; run.falls = 0;
    store.remove('run');
  }
  towerView.setCheckpoints(run.cp);
  placeAtCheckpoint(run.cp);
  respawnT = 0; hud.fade(false);
  input.reset();
  resume();
  if (cont && run.cp > 0) hud.toast(`스테이지 ${run.cp + 1}부터 이어서 시작!`);
}

function resume() {
  state = 'playing';
  showOverlay(null);
  input.enabled = true;
  acc = 0;
  requestWakeLock();
}

function pause() {
  if (state !== 'playing') return;
  state = 'paused';
  input.enabled = false;
  input.reset();
  saveRun();
  releaseWakeLock();
  showOverlay('pauseMenu');
}

function restart() {
  store.remove('run');
  startRun(false);
}

function onCheckpoint(index) {
  if (index <= run.cp) return;
  run.cp = index;
  saveRun();
  towerView.setCheckpoints(run.cp);
  audio.playCheckpoint();
  hud.toast(`✅ 체크포인트! 스테이지 ${index} 완료`);
}

function onClear() {
  state = 'clear';
  input.enabled = false;
  input.reset();
  releaseWakeLock();
  audio.playClear();
  const best = store.load(BEST_KEY, null);
  const isNew = !best || run.time < best.time;
  if (isNew) store.save(BEST_KEY, { time: run.time, falls: run.falls, at: Date.now() });
  store.remove('run');
  $('clearTime').textContent = formatTime(run.time);
  $('clearFalls').textContent = `${run.falls}회`;
  const b = isNew ? { time: run.time, falls: run.falls } : best;
  $('clearBest').textContent = `${formatTime(b.time)} (낙하 ${b.falls}회)`;
  const legacy = store.load(LEGACY_BEST_KEY, null);
  $('clearLegacyRow').style.display = legacy ? '' : 'none';
  if (legacy) $('clearLegacy').textContent = `${formatTime(legacy.time)} (낙하 ${legacy.falls}회)`;
  $('clearNew').style.display = isNew ? '' : 'none';
  showOverlay('clearMenu');
}

function onFall() {
  run.falls++;
  audio.playFall();
  respawnT = 0.55;
  tauntAfterRespawn = true;
  hud.fade(true);
}

// ── 놀림 팝업 ──
const TAUNTS = [
  '또 제자리야? ㅋㅋㅋㅋ 긁? ㅋㅋㅋㅋ',
  '중력이 너 좋아하나 봐 ㅋㅋ',
  '키캡이 미끄러웠던 거지? 그치?',
  '방금 그거 연습이었지? ㅎㅎ',
  '다시 올라가면 되지 뭐~ 딸깍!',
  '엘리베이터 타고 내려오셨어요?',
  '괜찮아, 아무도 못 봤어… 아마도 ㅋ',
];
let tauntAfterRespawn = false;
let lastTauntAt = -Infinity;
let lastTauntIdx = -1;
function taunt() {
  const now = performance.now() / 1000;
  if (now - lastTauntAt < TAUNT_COOLDOWN) return;   // 연속 표시 방지
  lastTauntAt = now;
  let i;
  do { i = Math.floor(Math.random() * TAUNTS.length); } while (i === lastTauntIdx && TAUNTS.length > 1);
  lastTauntIdx = i;
  hud.taunt(TAUNTS[i]);
}
// 현재 스테이지 한 층 높이 (이만큼 이상 떨어져 착지하면 놀림)
function stageHeight() {
  const s = Math.min(STAGES, run.cp + 1);
  return tower.checkpoints[s].y - tower.checkpoints[s - 1].y;
}


// ── 메인 루프 ──
let lastT = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;

  if (state === 'playing') {
    quality.tick(dt);
    run.time += dt;

    // 카메라 회전 입력
    const look = input.consumeLook();
    follow.rotate(look.dx, look.dy);

    if (respawnT > 0) {
      // 부활 연출: 화면 어두워진 상태에서 체크포인트로 이동
      respawnT -= dt;
      if (respawnT <= 0.25 && !player._respawned) {
        placeAtCheckpoint(run.cp);
        player._respawned = true;
      }
      if (respawnT <= 0) {
        respawnT = 0; hud.fade(false);
        if (tauntAfterRespawn) { tauntAfterRespawn = false; taunt(); }   // 부활 직후 놀림
      }
      updateMovers(world, simTime);
    } else {
      const mv = input.getMove();
      const dir = follow.moveDir(mv.x, mv.y);
      let jump = input.consumeJump();
      acc += dt;
      let steps = 0;
      while (acc >= FIXED_DT && steps < MAX_STEPS) {
        updateMovers(world, simTime);
        const wasGrounded = player.grounded;
        const ev = stepPlayer(player, { mx: dir.x, mz: dir.z, jumpPressed: jump }, world, FIXED_DT);
        if (wasGrounded && !player.grounded) leaveY = player.y;
        fallT = !player.grounded && player.vy < 0 ? fallT + FIXED_DT : 0;
        jump = false;
        simTime += FIXED_DT;
        acc -= FIXED_DT;
        steps++;
        if (ev.jumped) audio.playJump();
        if (ev.landed) {
          const b = ev.landBox;
          const kind = b.type === KEY_TYPES.NORMAL ? 0 : b.type === KEY_TYPES.WIDE ? 1 : 2;
          const strength = Math.min(1, ev.landSpeed / 16);
          audio.playKey(kind, strength);
          playerView.onLand(strength);
          if (leaveY - player.y >= stageHeight()) taunt();   // 한 번에 1스테이지 이상 떨어짐
          if (b === tower.goal) { onClear(); break; }
          if (b.cpIndex) onCheckpoint(b.cpIndex);
        }
        // 낙하 판정
        const cp = tower.checkpoints[run.cp];
        if (player.y < cp.y - FALL_DIST || fallT > FALL_TIME ||
          (run.cp > 0 && player.grounded && player.groundBox === tower.boxes[0])) {
          player._respawned = false;
          onFall();
          break;
        }
      }
      if (steps >= MAX_STEPS) acc = 0;
      // 이번 프레임에 물리 스텝이 없었다면(고주사율 화면) 점프 입력을 다음 프레임으로 넘김
      if (jump) input.jumpQueued = true;
    }

    hud.update({
      height: player.y, stage: Math.min(STAGES, run.cp + 1), stages: STAGES,
      time: run.time, falls: run.falls,
    });
  } else if (state === 'title') {
    // 타이틀 화면: 타워 주변을 천천히 도는 카메라
    follow.yaw += dt * 0.15;
  }

  towerView.update(dt);
  playerView.update(dt, player, world);
  follow.update(dt, player, world, state === 'title');
  towerView.updateWalls(dt, camera.position);
  // 그림자용 태양광은 캐릭터를 따라다님
  sun.position.set(player.x + 12, player.y + 26, player.z + 8);
  sun.target.position.set(player.x, player.y, player.z);
  renderer.render(scene, camera);
}

// ── 화면 꺼짐 방지 (Wake Lock, 실패해도 무시) ──
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && !wakeLock && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch (e) { wakeLock = null; }
}
function releaseWakeLock() {
  try { if (wakeLock) wakeLock.release(); } catch (e) { /* 무시 */ }
  wakeLock = null;
}

// 앱 전환·화면 끄기 등으로 숨겨지면 자동 일시정지
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    if (state === 'playing') pause();
    else if (state === 'paused') saveRun();
  }
});
window.addEventListener('pagehide', () => { if (state === 'playing' || state === 'paused') saveRun(); });

// ── 첫 터치에서 오디오 활성화 ──
const unlock = () => audio.unlockAudio();
input.onGesture(unlock);
document.addEventListener('pointerdown', unlock, { capture: true });

// ── 전체화면 (브라우저 탭 실행 시 시도, 설치 앱은 manifest로 전체화면) ──
function tryFullscreen() {
  const standalone = matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: standalone)').matches;
  if (standalone || document.fullscreenElement) return;
  const el = document.documentElement;
  try {
    const r = el.requestFullscreen && el.requestFullscreen({ navigationUI: 'hide' });
    if (r && r.catch) r.catch(() => {});
  } catch (e) { /* 무시 */ }
}

// ── 버튼 연결 ──
function btn(id, fn) {
  $(id).addEventListener('click', (e) => { e.preventDefault(); unlock(); fn(); });
}
btn('btnContinue', () => { tryFullscreen(); startRun(true); });
btn('btnNew', () => { tryFullscreen(); startRun(false); });
btn('btnPause', () => pause());
btn('btnRestartHud', () => { if (state === 'playing') { pause(); } showOverlay('confirmMenu'); });
btn('btnResume', () => resume());
btn('btnRestart', () => showOverlay('confirmMenu'));
btn('btnConfirmYes', () => restart());
btn('btnConfirmNo', () => { if (state === 'paused') showOverlay('pauseMenu'); else showOverlay(null); });
btn('btnRemeasure', () => {
  resume();
  quality.remeasure();
  hud.toast('그래픽 재측정 중… 잠시 그대로 플레이하세요', 3200);
});
btn('btnAgain', () => { startRun(false); });

// ── 효과음 볼륨 4단계 (끄기/작게/보통/크게, 기본 크게) ──
function applyVolume(level, preview) {
  audio.setVolume(level);
  for (const b of document.querySelectorAll('#volSeg button')) {
    const on = +b.dataset.vol === audio.getVolume();
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
  }
  if (preview) audio.playKey(0, 0.8);   // 선택한 크기로 미리 듣기
}
for (const b of document.querySelectorAll('#volSeg button')) {
  b.addEventListener('click', (e) => {
    e.preventDefault();
    unlock();
    applyVolume(+b.dataset.vol, true);
    store.save('volume', audio.getVolume());
  });
}
{
  // 저장값 우선, 없으면 이전 버전의 '소리 끄기' 설정을 이어받음
  let v = store.load('volume', null);
  if (typeof v !== 'number') v = store.load('muted', false) ? 0 : audio.DEFAULT_VOLUME;
  applyVolume(v, false);
}

// ── 홈 화면 설치 버튼 (Chrome beforeinstallprompt) ──
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvt = e;
  for (const b of document.querySelectorAll('.btnInstall')) b.style.display = '';
});
for (const b of document.querySelectorAll('.btnInstall')) {
  b.addEventListener('click', async () => {
    if (!installEvt) return;
    installEvt.prompt();
    try { await installEvt.userChoice; } catch (e) { /* 무시 */ }
    installEvt = null;
    for (const x of document.querySelectorAll('.btnInstall')) x.style.display = 'none';
  });
}

// ── 타이틀 화면 정보 ──
function refreshTitle() {
  const saved = store.load('run', null);
  if (saved && !validRun(saved)) store.remove('run');   // 예전 나선 탑 진행은 새로 시작
  const canContinue = validRun(saved) && (saved.cp > 0 || saved.time > 5);
  $('btnContinue').style.display = canContinue ? '' : 'none';
  if (canContinue) $('btnContinue').textContent = `▶ 이어하기 (스테이지 ${Math.min(STAGES, (saved.cp | 0) + 1)} · ${formatTime(saved.time)})`;
  const best = store.load(BEST_KEY, null);
  $('titleBest').textContent = best ? `🏆 최고 기록 ${formatTime(best.time)} · 낙하 ${best.falls}회` : '🏆 최고 기록 없음 — 첫 등반에 도전!';
  const legacy = store.load(LEGACY_BEST_KEY, null);
  $('titleLegacy').style.display = legacy ? '' : 'none';
  if (legacy) $('titleLegacy').textContent = `이전 탑(나선) 기록 ${formatTime(legacy.time)} · 낙하 ${legacy.falls}회`;
}
refreshTitle();
placeAtCheckpoint(0);
follow.pitch = 0.3;
showOverlay('titleMenu');
resize();
$('loading').remove();
requestAnimationFrame(frame);

// ── 서비스 워커 (오프라인 실행 + 설치) ──
if ('serviceWorker' in navigator) {
  const reg = () => navigator.serviceWorker.register('./sw.js').catch(() => {});
  if (document.readyState === 'complete') reg();
  else window.addEventListener('load', reg);
}

// 테스트·디버그용 핸들 (자동화 검증에서 사용)
window.__kt = { tower, world, player, run, get state() { return state; }, quality, audio, follow, input, onFall, placeAtCheckpoint, scene, camera, towerView, playerView };
