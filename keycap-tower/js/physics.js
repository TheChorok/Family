// 캐릭터-박스(AABB) 충돌 및 이동 물리 (Three.js 의존 없음 → Node 테스트 가능)
import { G, BOUNCE_V, ICE_ACCEL, ICE_DECEL, CONVEYOR_SPEED } from './gimmicks.js';

// ── 물리 상수 ──
export const GRAVITY = 30;        // 중력 가속도 (m/s²)
export const JUMP_V = 11;         // 점프 초속 (m/s) → 최대 높이 ≈ 2.02m
export const MOVE_SPEED = 6.5;    // 최대 수평 이동 속도 (m/s)
export const ACCEL_GROUND = 70;   // 지면 가속도
export const ACCEL_AIR = 32;      // 공중 가속도 (공중 제어 허용)
export const MAX_FALL = 35;       // 최대 낙하 속도
export const PLAYER_HW = 0.35;    // 캐릭터 AABB 가로/세로 절반 폭
export const PLAYER_H = 1.6;      // 캐릭터 AABB 높이 (발바닥 기준)
export const COYOTE_TIME = 0.1;   // 코요테 타임 (발판을 벗어난 뒤에도 점프 허용 시간)
export const JUMP_BUFFER = 0.12;  // 점프 버퍼 (착지 직전 입력을 기억하는 시간)
export const FIXED_DT = 1 / 120;  // 고정 물리 스텝
export const BUCKET = 4;          // 높이 버킷 크기 (근처 박스만 검사)
export const MAX_BOX_H = 2.5;     // 박스 최대 높이 (버킷 질의 범위 계산용)

const EPS = 1e-4;

// 점프 최대 높이
export const JUMP_APEX = (JUMP_V * JUMP_V) / (2 * GRAVITY);

// 높이 차 dh 만큼 위(음수면 아래)로 뛸 때, 최고 속도로 달려 갈 수 있는 수평 거리(캐릭터 중심 기준)
// speed: 이륙 수평 속도 (도움닫기가 짧으면 최고 속도보다 낮을 수 있음)
// v0: 수직 초속 (일반 점프 JUMP_V, 축소·확대·점프대는 다름)
export function jumpReach(dh, speed = MOVE_SPEED, v0 = JUMP_V) {
  const disc = v0 * v0 - 2 * GRAVITY * dh;
  if (disc < 0) return 0;
  const t = (v0 + Math.sqrt(disc)) / GRAVITY;
  return speed * t;
}

// 수직 초속 v0로 올라갈 수 있는 최고 높이
export function apexOf(v0) {
  return (v0 * v0) / (2 * GRAVITY);
}

// 도움닫기 거리 runup(m)으로 낼 수 있는 이륙 속도
export function takeoffSpeed(runup) {
  return Math.min(MOVE_SPEED, Math.sqrt(2 * ACCEL_GROUND * Math.max(0, runup)));
}

// 발판 윗면 사이 간격(gap) → 캐릭터 중심이 실제로 이동해야 하는 거리
// 출발 시 캐릭터 AABB가 발판 끝에 걸쳐 있을 수 있고, 착지도 걸치기만 하면 되므로 2*HW 만큼 줄어든다.
// 안전 여유 0.2m를 더해 '아슬아슬하게 걸치는' 경우는 계산에서 제외한다.
// hw: 캐릭터 절반 폭 (축소 상태면 더 작음 → 더 많이 이동해야 함)
export function requiredTravel(gap, hw = PLAYER_HW) {
  return Math.max(0, gap - 2 * hw + 0.2);
}

// ── 월드(박스 목록 + 높이 버킷 + 고정 충돌체) ──
// box: { x, z, top, h, hx, hz, dx, dz, type, moving, ... }
//   x,z = 현재 중심, top = 윗면 높이, h = 높이, hx/hz = 윗면 절반 크기(충돌 박스)
// statics: 통로 벽처럼 아주 높은 박스. 높이 버킷과 무관하게 항상 검사한다 (개수가 적음)
export function createWorld(boxes, statics = []) {
  const buckets = new Map();
  for (const b of boxes) {
    b.dx = b.dx || 0;
    b.dz = b.dz || 0;
    const k = Math.floor(b.top / BUCKET);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(b);
  }
  return { boxes, buckets, statics };
}

// 높이 범위 [minY, maxY]와 겹칠 수 있는 박스를 순회
export function forEachNear(world, minY, maxY, cb) {
  const k0 = Math.floor(minY / BUCKET);
  const k1 = Math.floor((maxY + MAX_BOX_H) / BUCKET);
  for (let k = k0; k <= k1; k++) {
    const list = world.buckets.get(k);
    if (!list) continue;
    for (let i = 0; i < list.length; i++) cb(list[i]);
  }
  const st = world.statics;
  if (st) for (let i = 0; i < st.length; i++) cb(st[i]);
}

// 움직이는 키캡 위치 갱신 (시간 t 기준, 이번 스텝 이동량 dx/dz 기록)
export function updateMovers(world, t) {
  for (const b of world.boxes) {
    const m = b.moving;
    if (!m) continue;
    const off = Math.sin(t * m.speed + m.phase) * m.amp;
    const nx = m.ox + m.ax * off;
    const nz = m.oz + m.az * off;
    b.dx = nx - b.x;
    b.dz = nz - b.z;
    b.x = nx;
    b.z = nz;
  }
}

export function createPlayer(x, y, z) {
  return {
    x, y, z, vx: 0, vy: 0, vz: 0,
    grounded: false, groundBox: null,
    coyote: 0, jumpBuf: 0,
    // 크기 변화('－'/'＋' 키캡)에 따라 바뀌는 값: 충돌박스 크기와 점프 초속
    scale: 1, hw: PLAYER_HW, h: PLAYER_H, jumpV: JUMP_V,
  };
}

// b.off: 꺼지는·줄어드는 키캡이 사라진 상태 (충돌 없음)
export function overlaps(p, b) {
  return (
    !b.off &&
    p.x + p.hw > b.x - b.hx + EPS && p.x - p.hw < b.x + b.hx - EPS &&
    p.z + p.hw > b.z - b.hz + EPS && p.z - p.hw < b.z + b.hz - EPS &&
    p.y + p.h > b.top - b.h + EPS && p.y < b.top - EPS
  );
}

// 한 고정 스텝 진행. input = { mx, mz (월드 방향, 크기 0~1), jumpPressed(이번 스텝 눌림), }
// 반환: 이벤트 { jumped, landed, landSpeed, landBox, bounced }
export function stepPlayer(p, input, world, dt) {
  const ev = { jumped: false, landed: false, landSpeed: 0, landBox: null, bounced: false };
  const HW = p.hw, PH = p.h;
  const wasGrounded = p.grounded;

  // 1) 움직이는 발판 위에 서 있으면 발판 이동량만큼 함께 이동, 컨베이어면 화살표 방향으로 밀림
  const gb = p.grounded ? p.groundBox : null;
  if (gb && gb.moving) {
    p.x += gb.dx;
    p.z += gb.dz;
  }
  if (gb && gb.g === G.CONVEYOR && gb.conv) {
    p.x += gb.conv.x * CONVEYOR_SPEED * dt;
    p.z += gb.conv.z * CONVEYOR_SPEED * dt;
  }

  // 1-1) 움직이는 발판이 옆에서 밀고 들어온 경우 수평으로 밀어냄
  forEachNear(world, p.y, p.y + PH, (b) => {
    if (!b.moving || b === p.groundBox || !overlaps(p, b)) return;
    const penL = p.x + HW - (b.x - b.hx);
    const penR = b.x + b.hx - (p.x - HW);
    const penB = p.z + HW - (b.z - b.hz);
    const penF = b.z + b.hz - (p.z - HW);
    const m = Math.min(penL, penR, penB, penF);
    if (m === penL) p.x -= penL + EPS;
    else if (m === penR) p.x += penR + EPS;
    else if (m === penB) p.z -= penB + EPS;
    else p.z += penF + EPS;
  });

  // 2) 수평 속도: 목표 속도로 가속 (얼음 위에서는 느리게 가속하고 거의 안 멈춤)
  let accelRate = p.grounded ? ACCEL_GROUND : ACCEL_AIR;
  if (gb && gb.g === G.ICE) accelRate = Math.hypot(input.mx, input.mz) > 0.05 ? ICE_ACCEL : ICE_DECEL;
  const accel = accelRate * dt;
  const tx = input.mx * MOVE_SPEED;
  const tz = input.mz * MOVE_SPEED;
  const ddx = tx - p.vx, ddz = tz - p.vz;
  const dl = Math.hypot(ddx, ddz);
  if (dl <= accel) { p.vx = tx; p.vz = tz; }
  else { p.vx += (ddx / dl) * accel; p.vz += (ddz / dl) * accel; }

  // 3) 점프: 점프 버퍼 + 코요테 타임
  if (input.jumpPressed) p.jumpBuf = JUMP_BUFFER;
  if (p.grounded) p.coyote = COYOTE_TIME;
  if (p.jumpBuf > 0 && p.coyote > 0) {
    p.vy = p.jumpV;
    p.jumpBuf = 0;
    p.coyote = 0;
    p.grounded = false;
    p.groundBox = null;
    ev.jumped = true;
  }
  p.jumpBuf = Math.max(0, p.jumpBuf - dt);
  if (!p.grounded) p.coyote = Math.max(0, p.coyote - dt);

  // 4) 중력
  p.vy = Math.max(-MAX_FALL, p.vy - GRAVITY * dt);

  // 5) 축별 이동 및 충돌 해소 (X → Z → Y 순서)
  const qMin = p.y - 1, qMax = p.y + PH + 1;

  p.x += p.vx * dt;
  forEachNear(world, qMin, qMax, (b) => {
    if (!overlaps(p, b)) return;
    if (p.x < b.x) p.x = b.x - b.hx - HW;
    else p.x = b.x + b.hx + HW;
    p.vx = 0;
  });

  p.z += p.vz * dt;
  forEachNear(world, qMin, qMax, (b) => {
    if (!overlaps(p, b)) return;
    if (p.z < b.z) p.z = b.z - b.hz - HW;
    else p.z = b.z + b.hz + HW;
    p.vz = 0;
  });

  const vyBefore = p.vy;
  p.y += p.vy * dt;
  p.grounded = false;
  let ground = null;
  forEachNear(world, qMin - 1, qMax, (b) => {
    if (!overlaps(p, b)) return;
    if (p.vy <= 0) {
      p.y = b.top;
      ground = b;
    } else {
      p.y = b.top - b.h - PH;
    }
    p.vy = 0;
  });
  if (ground) {
    p.grounded = true;
    p.groundBox = ground;
    p.coyote = COYOTE_TIME;
  } else {
    p.groundBox = null;
  }

  if (p.grounded && !wasGrounded) {
    ev.landed = true;
    ev.landSpeed = -vyBefore;
    ev.landBox = ground;
  }
  // 점프대: 착지하는 순간 위로 튕김 (서 있을 수 없음)
  if (ground && ground.g === G.BOUNCE) {
    p.vy = BOUNCE_V;
    p.grounded = false;
    p.groundBox = null;
    p.coyote = 0;
    ev.bounced = true;
  }
  return ev;
}

// 카메라 충돌용 선분-AABB 교차 (가장 가까운 t 반환, 없으면 1)
export function raycastBoxes(world, ox, oy, oz, ex, ey, ez) {
  const dx = ex - ox, dy = ey - oy, dz = ez - oz;
  let best = 1;
  forEachNear(world, Math.min(oy, ey) - 0.5, Math.max(oy, ey) + 0.5, (b) => {
    let t0 = 0, t1 = best;
    const mins = [b.x - b.hx, b.top - b.h, b.z - b.hz];
    const maxs = [b.x + b.hx, b.top, b.z + b.hz];
    const o = [ox, oy, oz], d = [dx, dy, dz];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-8) {
        if (o[i] < mins[i] || o[i] > maxs[i]) return;
      } else {
        let ta = (mins[i] - o[i]) / d[i];
        let tb = (maxs[i] - o[i]) / d[i];
        if (ta > tb) { const s = ta; ta = tb; tb = s; }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1) return;
      }
    }
    if (t0 > 0 && t0 < best) best = t0;
  });
  return best;
}
