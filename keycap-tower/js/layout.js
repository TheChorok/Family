// 시드 고정 나선형 키캡 타워 배치 생성 (Three.js 의존 없음 → Node 테스트 가능)
import { mulberry32 } from './rng.js';
import { jumpReach, requiredTravel, PLAYER_HW } from './physics.js';

export const SEED = 20261024;
export const STAGES = 10;

// 키캡 종류 (충돌 박스는 '윗면' 크기 기준: hx/hz = 윗면 절반 크기)
// inset = 바닥면이 윗면보다 각 변에서 넓어지는 정도(사다리꼴 측면)
export const KEY_TYPES = {
  NORMAL: 0,   // 일반 키
  WIDE: 1,     // 기능 키 (가로로 긴 키)
  SPACE: 2,    // 스페이스바 체크포인트
  GOAL: 3,     // 정상 스페이스바
  GROUND: 4,   // 시작 바닥(키보드 받침)
};
export const KEY_DIMS = {
  0: { hx: 0.9, hz: 0.9, h: 1.0, inset: 0.18 },
  1: { hx: 1.4, hz: 0.9, h: 1.0, inset: 0.18 },
  2: { hx: 3.5, hz: 1.1, h: 1.2, inset: 0.22 },
  3: { hx: 4.0, hz: 1.6, h: 1.4, inset: 0.25 },
  4: { hx: 14, hz: 14, h: 2.0, inset: 0.6 },
};

// 스테이지별 도달 여유: 1~3스테이지 30% 이상, 이후 10스테이지까지 15%로 점진 축소
export function stageMargin(s) {
  if (s <= 3) return 0.30;
  return 0.30 - ((s - 3) / (STAGES - 3)) * 0.15;
}

const MIN_GAP = 0.35;     // 키캡끼리 최소 간격 (겹침 방지)
const HEAD_CLEAR = 2.4;   // 아래 키캡 윗면 ~ 위 키캡 바닥 최소 높이 (머리 공간)

function radiusAt(theta) {
  return 8 + 1.2 * Math.sin(theta * 0.9);
}

// 두 사각형(XZ) 사이 최소 거리
function rectGap(ax, az, ahx, ahz, bx, bz, bhx, bhz) {
  const dx = Math.max(0, Math.abs(ax - bx) - (ahx + bhx));
  const dz = Math.max(0, Math.abs(az - bz) - (ahz + bhz));
  return Math.hypot(dx, dz);
}

// 박스의 이동 범위 샘플 위치들 (정지 박스면 중심 1개)
function samplePositions(b, n) {
  if (!b.moving) return [[b.x, b.z]];
  const m = b.moving, out = [];
  for (let i = 0; i < n; i++) {
    const off = -m.amp + (2 * m.amp * i) / (n - 1);
    out.push([m.ox + m.ax * off, m.oz + m.az * off]);
  }
  return out;
}

// 두 박스 간 최악(최대) 간격과 최소 간격 (움직이는 경우 전체 이동 범위 고려)
// 사각형 간 거리는 평행이동에 대해 볼록함수이므로 최댓값은 양 끝점에서 나온다.
export function gapRange(a, b) {
  const ea = samplePositions(a, 2), eb = samplePositions(b, 2);
  let worst = 0;
  for (const [ax, az] of ea) for (const [bx, bz] of eb)
    worst = Math.max(worst, rectGap(ax, az, a.hx, a.hz, bx, bz, b.hx, b.hz));
  const sa = samplePositions(a, 9), sb = samplePositions(b, 9);
  let best = Infinity;
  for (const [ax, az] of sa) for (const [bx, bz] of sb)
    best = Math.min(best, rectGap(ax, az, a.hx, a.hz, bx, bz, b.hx, b.hz));
  return { worst, best };
}

// 이동 범위를 포함한 XZ 외곽 사각형
function sweptRect(b, pad) {
  let hx = b.hx, hz = b.hz;
  if (b.moving) { hx += Math.abs(b.moving.ax) * b.moving.amp; hz += Math.abs(b.moving.az) * b.moving.amp; }
  const cx = b.moving ? b.moving.ox : b.x, cz = b.moving ? b.moving.oz : b.z;
  return { cx, cz, hx: hx + pad, hz: hz + pad };
}

function headroomOk(nb, boxes) {
  const r = sweptRect(nb, 0.45);
  const bottom = nb.top - nb.h;
  for (let i = 1; i < boxes.length - 1; i++) {   // 바닥(0)과 직전 박스 제외
    const b = boxes[i];
    if (b.top > nb.top) continue;
    const o = sweptRect(b, 0.45);
    if (Math.abs(r.cx - o.cx) < r.hx + o.hx && Math.abs(r.cz - o.cz) < r.hz + o.hz) {
      if (bottom - b.top < HEAD_CLEAR) return false;
    }
  }
  return true;
}

function makeBox(type, rot, x, top, z, stage) {
  const d = KEY_DIMS[type];
  return {
    type, rot, stage,
    x, z, top, h: d.h,
    hx: rot ? d.hz : d.hx, hz: rot ? d.hx : d.hz,
    inset: d.inset,
    moving: null, theta: 0, dx: 0, dz: 0,
  };
}

// 직전 박스 prev 다음에 새 키캡을 나선을 따라 배치
function placeNext(prev, boxes, opt, rng) {
  const { type, dh, travelFrac, margin, moveAmp, stage } = opt;
  const top = prev.top + dh;
  const allowedGap = jumpReach(dh) * (1 - margin) + 2 * PLAYER_HW - 0.2; // requiredTravel 역산
  const rj = rng() * 0.8 - 0.4;   // 반지름 흔들림
  let frac = travelFrac;

  for (let attempt = 0; attempt < 14; attempt++) {
    const targetGap = Math.max(MIN_GAP + 0.15, Math.min(allowedGap, jumpReach(dh) * frac + 2 * PLAYER_HW - 0.2));
    let amp = moveAmp;
    for (let th = prev.theta + 0.05; th < prev.theta + 3.0; th += 0.004) {
      const r = radiusAt(th) + rj;
      const x = Math.cos(th) * r, z = Math.sin(th) * r;
      // 접선 방향으로 긴 키를 정렬 (AABB 유지를 위해 0/90도만 사용)
      const tx = -Math.sin(th), tz = Math.cos(th);
      const rot = Math.abs(tz) > Math.abs(tx) ? 1 : 0;
      const nb = makeBox(type, rot, x, top, z, stage);
      nb.theta = th;
      const nominal = rectGap(prev.moving ? prev.moving.ox : prev.x, prev.moving ? prev.moving.oz : prev.z,
        prev.hx, prev.hz, x, z, nb.hx, nb.hz);
      if (nominal < targetGap) continue;

      // 움직이는 키캡: 직전 키캡에서 오는 방향의 수직(좌우) 방향으로 왕복
      if (amp > 0) {
        const vx = x - (prev.moving ? prev.moving.ox : prev.x);
        const vz = z - (prev.moving ? prev.moving.oz : prev.z);
        const l = Math.hypot(vx, vz) || 1;
        nb.moving = {
          ox: x, oz: z, ax: -vz / l, az: vx / l, amp,
          speed: 0.7 + rng() * 0.6, phase: rng() * Math.PI * 2,
        };
      }
      // 최악 위치에서도 도달 가능한지, 최소 간격이 유지되는지 확인
      let g = gapRange(prev, nb);
      // 이동 중 간격 변화폭도 0.9m 이하로 제한 (예측 가능한 '좌우' 움직임)
      while (nb.moving && (g.worst > allowedGap || g.best < MIN_GAP || g.worst - g.best > 0.9)) {
        nb.moving.amp *= 0.8;
        if (nb.moving.amp < 0.6) { nb.moving = null; break; }
        g = gapRange(prev, nb);
      }
      if (g.worst > allowedGap) break;          // 이 목표 간격은 불가 → 목표를 줄여 재시도
      if (g.best < MIN_GAP) continue;
      if (!headroomOk(nb, boxes)) continue;
      nb.gapInfo = { worst: g.worst, best: g.best, allowedGap, dh, margin };
      return nb;
    }
    frac *= 0.88;
  }
  throw new Error('키캡 배치 실패 (stage ' + stage + ')');
}

export function generateTower(seed = SEED) {
  const rng = mulberry32(seed);
  const boxes = [];
  const checkpoints = [];

  // 시작 바닥 (키보드 받침)
  const ground = makeBox(KEY_TYPES.GROUND, 0, 0, 0, 0, 0);
  boxes.push(ground);

  // 첫 키캡: 바닥 위 나선 시작점
  const th0 = 0;
  const first = makeBox(KEY_TYPES.NORMAL, 0, Math.cos(th0) * radiusAt(th0), 0.8, Math.sin(th0) * radiusAt(th0), 1);
  first.theta = th0;
  boxes.push(first);

  // 체크포인트 0: 바닥 위, 첫 키캡 앞
  const sp = { x: first.x - 0.3, z: first.z - 3.2 };
  checkpoints.push({ x: sp.x, y: 0, z: sp.z, yaw: Math.atan2(first.x - sp.x, first.z - sp.z), box: ground, stage: 0 });

  let prev = first;
  for (let s = 1; s <= STAGES; s++) {
    const margin = stageMargin(s);
    const n = 11 + s;                       // 스테이지별 키캡 수 (12 ~ 21)
    const dhLo = 0.45 + 0.05 * s, dhHi = 0.85 + 0.07 * s;
    const baseFrac = 0.35 + 0.06 * (s - 1);  // 위로 갈수록 간격 증가
    const moveProb = s >= 6 ? 0.4 + 0.08 * (s - 6) : 0;
    let lastMoving = 0;
    const startIdx = s === 1 ? 1 : 0;        // 1스테이지 첫 키캡은 이미 배치됨

    for (let i = startIdx; i < n; i++) {
      const type = rng() < 0.25 ? KEY_TYPES.WIDE : KEY_TYPES.NORMAL;
      const dh = dhLo + rng() * (dhHi - dhLo);
      const frac = Math.min(0.97, baseFrac + (rng() * 0.12 - 0.06));
      let moveAmp = 0;
      if (moveProb > 0 && lastMoving < 1 && rng() < moveProb) moveAmp = 1.2 + rng() * 0.8;
      const nb = placeNext(prev, boxes, { type, dh, travelFrac: frac, margin, moveAmp, stage: s }, rng);
      lastMoving = nb.moving ? lastMoving + 1 : 0;
      boxes.push(nb);
      prev = nb;
    }

    // 스테이지 끝: 스페이스바 체크포인트 (마지막은 정상)
    const isGoal = s === STAGES;
    const cpType = isGoal ? KEY_TYPES.GOAL : KEY_TYPES.SPACE;
    const dh = 0.45 + rng() * 0.25;
    const cp = placeNext(prev, boxes, { type: cpType, dh, travelFrac: 0.45 + 0.03 * s, margin, moveAmp: 0, stage: s }, rng);
    cp.cpIndex = s;
    boxes.push(cp);
    // 부활 위치: 스페이스바 중앙, 다음 진행 방향(접선)을 바라봄
    const tx = -Math.sin(cp.theta), tz = Math.cos(cp.theta);
    checkpoints.push({ x: cp.x, y: cp.top, z: cp.z, yaw: Math.atan2(tx, tz), box: cp, stage: s });
    prev = cp;
  }

  // 각 박스의 원점 위치(움직임 기준점) 정리
  for (const b of boxes) {
    if (b.moving) { b.x = b.moving.ox; b.z = b.moving.oz; }
  }
  const goal = boxes[boxes.length - 1];
  return { boxes, checkpoints, goal, height: goal.top };
}

// 테스트·검증용: 연속 키캡 간 실제 도달 여유 계산
export function reachReport(tower) {
  const out = [];
  const b = tower.boxes;
  for (let i = 2; i < b.length; i++) {
    const g = b[i].gapInfo;
    if (!g) continue;
    const reach = jumpReach(g.dh);
    out.push({
      index: i, stage: b[i].stage, type: b[i].type, moving: !!b[i].moving || !!b[i - 1].moving,
      dh: g.dh, worstGap: g.worst, bestGap: g.best,
      margin: 1 - requiredTravel(g.worst) / reach,
      requiredMargin: g.margin,
    });
  }
  return out;
}
