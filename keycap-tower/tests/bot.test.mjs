// 자동 플레이 봇으로 실제 물리(stepPlayer) 기준 정상까지 도달 가능한지 검증
// 실행: node keycap-tower/tests/bot.test.mjs
import { generateTower } from '../js/layout.js';
import {
  createWorld, createPlayer, stepPlayer, updateMovers, FIXED_DT,
  GRAVITY, JUMP_V, MOVE_SPEED, PLAYER_HW, COYOTE_TIME,
} from '../js/physics.js';

const tower = generateTower();
const world = createWorld(tower.boxes);
const seq = tower.boxes.slice(1); // 오를 순서 (바닥 제외)
const idxOf = new Map(seq.map((b, i) => [b, i]));

const cp0 = tower.checkpoints[0];
const p = createPlayer(cp0.x, cp0.y, cp0.z);
let time = 0;
let target = 0;
let mode = 'prep';
let falls = 0;
const fallByStage = {};
let failsOnTarget = 0;
let lastCp = cp0;
let jumps = 0, coyoteJumps = 0;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function posAt(b, t) {
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

let ungroundedSteps = 0;
let prepPt = null; // 도움닫기 시작점 (prep 진입 시 1회 계산)
const MAX_T = 60 * 30;
let ok = false;
while (time < MAX_T) {
  updateMovers(world, time);
  const B = seq[target];
  const input = { mx: 0, mz: 0, jumpPressed: false };

  if (p.grounded) {
    const A = p.groundBox;
    // 예측: 달리기+비행 대략 1초 뒤 위치
    const tl = (JUMP_V + Math.sqrt(Math.max(0, JUMP_V * JUMP_V - 2 * GRAVITY * (B.top - p.y)))) / GRAVITY;
    const [bx, bz] = posAt(B, time + tl + 0.25);
    const [tx, tz] = nearestIn(bx, bz, B.hx, B.hz, 0.5, p.x, p.z);
    const overlapAB = Math.abs(A.x - bx) < A.hx + B.hx && Math.abs(A.z - bz) < A.hz + B.hz;
    if (mode === 'prep') {
      // 발판에서 목표 반대쪽 가장자리 근처로 물러나 도움닫기 준비
      const [lx, lz] = nearestIn(A.x, A.z, A.hx, A.hz, 0.35, tx, tz);
      let dx = tx - lx, dz = tz - lz;
      if (Math.hypot(dx, dz) < 0.3) { dx = tx - p.x; dz = tz - p.z; } // B가 A 위에 겹친 경우: 현재 위치 기준
      const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
      const back = overlapAB ? 4 : 1.3;
      if (!prepPt) {
        const q = overlapAB
          ? nearestIn(A.x, A.z, A.hx, A.hz, 0.4, tx - dx * back, tz - dz * back)
          : nearestIn(A.x, A.z, A.hx, A.hz, 0.4, lx - dx * back, lz - dz * back);
        prepPt = [q[0] - A.x, q[1] - A.z]; // 발판 기준 상대 좌표 (움직이는 발판 대응)
      }
      const kx = A.x + prepPt[0], kz = A.z + prepPt[1];
      const ex = kx - p.x, ez = kz - p.z, el = Math.hypot(ex, ez);
      // 움직이는 키캡이면 도착 시점 간격이 평균 이하가 되는 타이밍까지 대기
      let goodPhase = true;
      if ((B.moving || A.moving) && B.gapInfo) {
        const tArr = time + 0.3 + tl;
        const [px, pz] = posAt(B, tArr), [ax, az] = posAt(A, tArr);
        const g = Math.hypot(Math.max(0, Math.abs(px - ax) - A.hx - B.hx), Math.max(0, Math.abs(pz - az) - A.hz - B.hz));
        goodPhase = g <= (B.gapInfo.worst + B.gapInfo.best) / 2;
      }
      if (el < 0.15 && Math.hypot(p.vx, p.vz) < 0.5 && goodPhase) mode = 'run';
      else { const s = Math.min(1, el * 3); input.mx = (ex / (el || 1)) * s; input.mz = (ez / (el || 1)) * s; }
    }
    if (mode === 'run') {
      const ex = tx - p.x, ez = tz - p.z, el = Math.hypot(ex, ez) || 1;
      input.mx = ex / el; input.mz = ez / el;
      // B가 A 위쪽에 겹쳐 있으면 가장자리 대신 거리 기준으로 점프
      const d = Math.hypot(Math.max(0, Math.abs(p.x - bx) - B.hx), Math.max(0, Math.abs(p.z - bz) - B.hz));
      if (overlapAB && d < 1.4) input.jumpPressed = true;
    }
    ungroundedSteps = 0;
  } else {
    ungroundedSteps++;
    // 발판을 벗어난 직후(코요테 타임 안) 점프 입력
    if (mode === 'run' && p.vy <= 0 && ungroundedSteps * FIXED_DT < COYOTE_TIME * 0.8) {
      input.jumpPressed = true; coyoteJumps++; mode = 'air';
    }
    // 공중: 착지 시점에 목표점에 닿도록 탄도 제어
    let tl = timeToLand(p.y, p.vy, B.top);
    if (tl < 0) tl = 0.3;
    tl = Math.max(tl, 0.05);
    const [bx, bz] = posAt(B, time + tl);
    const [tx, tz] = nearestIn(bx, bz, B.hx, B.hz, 0.45, p.x, p.z);
    let vx = (tx - p.x) / tl, vz = (tz - p.z) / tl;
    const vl = Math.hypot(vx, vz);
    if (vl > MOVE_SPEED) { vx *= MOVE_SPEED / vl; vz *= MOVE_SPEED / vl; }
    input.mx = vx / MOVE_SPEED; input.mz = vz / MOVE_SPEED;
  }

  const ev = stepPlayer(p, input, world, FIXED_DT);
  if (ev.jumped) { jumps++; if (mode === 'run') mode = 'air'; }
  time += FIXED_DT;

  if (ev.landed) {
    const i = idxOf.get(ev.landBox);
    if (i !== undefined && i < target - 1) target = i + 1; // 아래 키캡으로 떨어지면 거기서 다시 오름
    else if (i !== undefined && i >= target) {
      if (ev.landBox.cpIndex) lastCp = tower.checkpoints[ev.landBox.cpIndex];
      if (ev.landBox === tower.goal) { ok = true; break; }
      target = i + 1; failsOnTarget = 0;
    }
    mode = 'prep'; prepPt = null;
  }
  // 낙하 판정 (게임과 동일한 기준: 마지막 체크포인트보다 12m 아래, 또는 바닥 착지)
  const fell = p.y < lastCp.y - 12 || (lastCp.stage > 0 && p.grounded && p.groundBox === tower.boxes[0]);
  if (fell) {
    falls++; failsOnTarget++;
    fallByStage[B.stage] = (fallByStage[B.stage] || 0) + 1;
    if (failsOnTarget > 6) { console.log('반복 실패: target', target, 'stage', B.stage, B.gapInfo); break; }
    Object.assign(p, createPlayer(lastCp.x, lastCp.y, lastCp.z));
    target = lastCp.stage === 0 ? 0 : idxOf.get(lastCp.box) + 1;
    mode = 'prep'; prepPt = null;
  }
}
console.log(`결과: ${ok ? '정상 도달' : '실패'} / 플레이 시간 ${time.toFixed(1)}s / 낙하 ${falls}회 / 점프 ${jumps} (코요테 ${coyoteJumps}) / 목표 ${target}/${seq.length}`);
console.log('스테이지별 낙하', JSON.stringify(fallByStage));
process.exit(ok ? 0 : 1);
