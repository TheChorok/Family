// 자동 플레이 봇 공용 로직: 완주 봇과 지름길 봇이 같은 조종 방식을 쓴다
// 조종 방식: 발판 뒤쪽으로 물러나 도움닫기 → 가장자리에서 코요테 점프 → 공중에서 착지점에 맞춰 탄도 제어
import {
  createWorld, createPlayer, stepPlayer, updateMovers, FIXED_DT,
  GRAVITY, MOVE_SPEED, COYOTE_TIME,
} from '../js/physics.js';
import { createRules, tickRules, onLand, transformInput, resetRules, trySetScale } from '../js/rules.js';
import { G, BIG } from '../js/gimmicks.js';

// 오래 서 있으면 안 되거나(꺼짐·줄어듦), 멈추기 어려운(얼음·컨베이어) 발판: 물러나지 않고 바로 달려 점프
const RUSH = new Set([G.ICE, G.CONVEYOR, G.CRUMBLE, G.SHRINK]);

export const FALL_DIST = 12;       // 게임과 동일: 마지막 체크포인트보다 12m 아래면 부활
export const FALL_TIME = 1.5;      // 게임과 동일: 1.5초 넘게 떨어지면 부활

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function posAt(b, t) {
  if (!b.moving) return [b.x, b.z];
  const m = b.moving, off = Math.sin(t * m.speed + m.phase) * m.amp;
  return [m.ox + m.ax * off, m.oz + m.az * off];
}
// 사각형 안쪽(inset) 기준 가장 가까운 점
function nearestIn(cx, cz, hx, hz, inset, px, pz) {
  return [clamp(px, cx - hx + inset, cx + hx - inset), clamp(pz, cz - hz + inset, cz + hz - inset)];
}
// 현재 vy 기준, 높이 y가 targetTop 까지 하강하는 시간
function timeToLand(y, vy, top) {
  const a = -GRAVITY / 2, b = vy, c = y - top;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  return (-b - Math.sqrt(disc)) / (2 * a);
}

export function makeWorld(tower) {
  return createWorld(tower.boxes, tower.statics || []);
}

// 봇 조종기: 매 스텝 목표 키캡 B를 향한 입력을 계산
export function createController() {
  return { mode: 'prep', prepPt: null, ungrounded: 0, coyoteJumps: 0 };
}

// B2: B 다음 키캡. B가 점프대면 B2 쪽 가장자리에 착지해야 튕김 거리가 충분하다 (사람도 그렇게 노림)
export function controlStep(c, p, B, time, B2 = null) {
  const input = { mx: 0, mz: 0, jumpPressed: false };
  if (p.grounded) {
    const A = p.groundBox;
    // 예측: 달리기+비행 대략 1초 뒤 위치
    const v0 = p.jumpV;
    const tl = (v0 + Math.sqrt(Math.max(0, v0 * v0 - 2 * GRAVITY * (B.top - p.y)))) / GRAVITY;
    if (c.mode === 'prep' && RUSH.has(A.g)) c.mode = 'run';
    const [bx, bz] = posAt(B, time + tl + 0.25);
    const [tx, tz] = nearestIn(bx, bz, B.hx, B.hz, 0.5, p.x, p.z);
    const overlapAB = Math.abs(A.x - bx) < A.hx + B.hx && Math.abs(A.z - bz) < A.hz + B.hz;
    if (c.mode === 'prep') {
      // 발판에서 목표 반대쪽 가장자리 근처로 물러나 도움닫기 준비
      const [lx, lz] = nearestIn(A.x, A.z, A.hx, A.hz, 0.35, tx, tz);
      let dx = tx - lx, dz = tz - lz;
      if (Math.hypot(dx, dz) < 0.3) { dx = tx - p.x; dz = tz - p.z; } // B가 A 위에 겹친 경우: 현재 위치 기준
      const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
      const back = overlapAB ? 4 : 1.3;
      if (!c.prepPt) {
        const q = overlapAB
          ? nearestIn(A.x, A.z, A.hx, A.hz, 0.4, tx - dx * back, tz - dz * back)
          : nearestIn(A.x, A.z, A.hx, A.hz, 0.4, lx - dx * back, lz - dz * back);
        c.prepPt = [q[0] - A.x, q[1] - A.z]; // 발판 기준 상대 좌표 (움직이는 발판 대응)
      }
      const kx = A.x + c.prepPt[0], kz = A.z + c.prepPt[1];
      const ex = kx - p.x, ez = kz - p.z, el = Math.hypot(ex, ez);
      // 움직이는 키캡이면 도착 시점 간격이 평균 이하가 되는 타이밍까지 대기
      let goodPhase = true;
      if ((B.moving || A.moving) && B.gapInfo) {
        const tArr = time + 0.3 + tl;
        const [px, pz] = posAt(B, tArr), [ax, az] = posAt(A, tArr);
        const g = Math.hypot(Math.max(0, Math.abs(px - ax) - A.hx - B.hx), Math.max(0, Math.abs(pz - az) - A.hz - B.hz));
        goodPhase = g <= (B.gapInfo.worst + B.gapInfo.best) / 2 + 0.05;   // 간격 변화가 없으면 바로 출발
      }
      // '－' 효과로 작은데 다음 계단이 축소 기준으로 배치되지 않았으면 원래 크기로 돌아올 때까지 대기
      const waitSize = p.scale < 1 && B.gapInfo && !B.gapInfo.small;
      if (el < 0.15 && Math.hypot(p.vx, p.vz) < 0.5 && goodPhase && !waitSize) c.mode = 'run';
      else { const s = Math.min(1, el * 3); input.mx = (ex / (el || 1)) * s; input.mz = (ez / (el || 1)) * s; }
    }
    if (c.mode === 'run') {
      const ex = tx - p.x, ez = tz - p.z, el = Math.hypot(ex, ez) || 1;
      input.mx = ex / el; input.mz = ez / el;
      // B가 A 위쪽에 겹쳐 있으면 가장자리 대신 거리 기준으로 점프
      const d = Math.hypot(Math.max(0, Math.abs(p.x - bx) - B.hx), Math.max(0, Math.abs(p.z - bz) - B.hz));
      // 목표가 바로 앞(1m 이내)에 더 높이 있으면 가장자리까지 못 가므로 그 자리에서 점프
      if ((overlapAB && d < 1.4) || (d < 1.0 && B.top > p.y + 0.3)) input.jumpPressed = true;
    }
    c.ungrounded = 0;
  } else {
    c.ungrounded++;
    // 발판을 벗어난 직후(코요테 타임 안) 점프 입력
    if (c.mode === 'run' && p.vy <= 0 && c.ungrounded * FIXED_DT < COYOTE_TIME * 0.8) {
      input.jumpPressed = true; c.coyoteJumps++; c.mode = 'air';
    }
    // 공중: 착지 시점에 목표점에 닿도록 탄도 제어
    let tl = timeToLand(p.y, p.vy, B.top);
    if (tl < 0) tl = 0.3;
    tl = Math.max(tl, 0.05);
    const [bx, bz] = posAt(B, time + tl);
    let [tx, tz] = nearestIn(bx, bz, B.hx, B.hz, 0.45, p.x, p.z);
    if (B.g === G.BOUNCE && B2) {
      const [nx, nz] = posAt(B2, time + tl + 0.5);
      [tx, tz] = nearestIn(bx, bz, B.hx, B.hz, 0.45, nx, nz);
    }
    let vx = (tx - p.x) / tl, vz = (tz - p.z) / tl;
    const vl = Math.hypot(vx, vz);
    if (vl > MOVE_SPEED) { vx *= MOVE_SPEED / vl; vz *= MOVE_SPEED / vl; }
    input.mx = vx / MOVE_SPEED; input.mz = vz / MOVE_SPEED;
  }
  return input;
}

// 게임과 같은 순서로 한 스텝: 규칙 → (반전이면 입력을 미리 뒤집어 넣음) → 물리 → 착지 처리
function botStep(r, p, input, world) {
  tickRules(r, p, FIXED_DT);
  const m = transformInput(r, input.mx, input.mz);   // 반전 중이면 뒤집힌 값 → 봇은 원하는 방향을 얻으려고 한 번 더 뒤집음
  const inv = r.reverseT > 0;
  const ev = stepPlayer(p, { mx: inv ? -m.mx : m.mx, mz: inv ? -m.mz : m.mz, jumpPressed: input.jumpPressed }, world, FIXED_DT);
  if (ev.landed) onLand(r, p, ev.landBox);
  r.events.length = 0;   // 봇은 화면 알림을 쓰지 않음
  return ev;
}

// 완주 봇: 시작 지점에서 정상까지 순서대로 오른다
export function runFull(tower, { maxTime = 60 * 40, trace = null } = {}) {
  const world = makeWorld(tower);
  const r = createRules(world);
  const seq = tower.boxes.slice(1); // 오를 순서 (바닥 제외)
  const idxOf = new Map(seq.map((b, i) => [b, i]));
  const cp0 = tower.checkpoints[0];
  const p = createPlayer(cp0.x, cp0.y, cp0.z);
  const c = createController();
  let time = 0, target = 0, falls = 0, failsOnTarget = 0, jumps = 0, fallT = 0, timeoutFalls = 0;
  let lastCp = cp0, ok = false, stuck = null;
  const fallByStage = {};
  while (time < maxTime) {
    updateMovers(world, time);
    const B = seq[target];
    const input = controlStep(c, p, B, time, seq[target + 1]);
    const ev = botStep(r, p, input, world);
    if (ev.jumped) { jumps++; if (c.mode === 'run') c.mode = 'air'; }
    time += FIXED_DT;
    if (trace) trace({ time, target, p, ev, c, r, idxOf });
    fallT = !p.grounded && p.vy < 0 ? fallT + FIXED_DT : 0;

    if (ev.landed) {
      const i = idxOf.get(ev.landBox);
      if (i !== undefined && i < target - 1) target = i + 1; // 아래 키캡으로 떨어지면 거기서 다시 오름
      else if (i !== undefined && i >= target) {
        if (ev.landBox.cpIndex) lastCp = tower.checkpoints[ev.landBox.cpIndex];
        if (ev.landBox === tower.goal) { ok = true; break; }
        target = i + 1; failsOnTarget = 0;
      }
      c.mode = 'prep'; c.prepPt = null;
    }
    // 낙하 판정 (게임과 동일한 기준)
    const fell = p.y < lastCp.y - FALL_DIST || fallT > FALL_TIME ||
      (lastCp.stage > 0 && p.grounded && p.groundBox === tower.boxes[0]);
    if (fell) {
      if (fallT > FALL_TIME) timeoutFalls++;
      falls++; failsOnTarget++;
      fallByStage[B.stage] = (fallByStage[B.stage] || 0) + 1;
      if (failsOnTarget > 6) { stuck = { target, stage: B.stage, g: B.g, from: seq[target - 1] && seq[target - 1].g, gap: B.gapInfo }; break; }
      Object.assign(p, createPlayer(lastCp.x, lastCp.y, lastCp.z));
      resetRules(r, p);                       // 게임과 같이 부활 시 키캡·효과 초기화
      fallT = 0;
      target = lastCp.stage === 0 ? 0 : idxOf.get(lastCp.box) + 1;
      c.mode = 'prep'; c.prepPt = null;
    }
  }
  return { ok, time, falls, timeoutFalls, jumps, coyoteJumps: c.coyoteJumps, target, total: seq.length, fallByStage, stuck };
}

// 지름길 봇: from 키캡에서 to 키캡으로 바로 점프를 시도 (성공하면 true)
// 출발 키캡에서 커진 상태일 수 있으면(＋ 효과 구간) 커진 상태로 시험 — 가장 멀리 뛸 수 있는 조건
export function tryJump(tower, world, from, to, t0, { big = from.big } = {}) {
  const r = createRules(world);
  const [fx, fz] = posAt(from, t0);
  const p = createPlayer(fx, from.top + 0.05, fz);
  if (big) trySetScale(p, BIG.scale, world);
  const keepBig = () => { if (big) { r.sizeT = 99; r.sizeTarget = BIG.scale; } };
  keepBig();
  const c = createController();
  let time = t0, left = false, settled = false;   // settled: 출발 발판에 한 번 착지했는지
  updateMovers(world, time);
  while (time < t0 + 6) {
    updateMovers(world, time);
    const input = controlStep(c, p, to, time);
    const ev = botStep(r, p, input, world);
    if (big) keepBig();
    if (ev.jumped && c.mode === 'run') c.mode = 'air';
    time += FIXED_DT;
    if ((p.grounded && p.groundBox === from) || (ev.landed && ev.landBox === from)) settled = true;
    if (settled && !p.grounded && !(ev.landed && ev.landBox === from)) left = true;
    if (ev.landed) {
      if (ev.landBox === to) return true;
      if (left && ev.landBox !== from) return false;    // 출발 후 다른 곳에 착지 → 실패
      c.mode = 'prep'; c.prepPt = null;
    }
    if (p.y < Math.min(from.top, to.top) - 4) return false;
  }
  return false;
}
