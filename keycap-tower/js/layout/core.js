// 탑 형태와 무관한 키캡 배치 생성기 (Three.js 의존 없음 → Node 테스트 가능)
// 형태(shape) 모듈이 '경로 위 위치·방향·벽'을 알려 주면, 여기서 간격·도달 여유·이동 키캡·
// 체크포인트·머리 공간·지름길 검증을 공통으로 처리한다.
import { mulberry32 } from '../rng.js';
import { jumpReach, requiredTravel, takeoffSpeed, PLAYER_HW, JUMP_APEX } from '../physics.js';

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
  3: { hx: 3.8, hz: 1.25, h: 1.4, inset: 0.25 },
  4: { hx: 14, hz: 14, h: 2.0, inset: 0.6 },
};

// 스테이지별 도달 여유: 1~3스테이지 30% 이상, 이후 10스테이지까지 15%로 점진 축소
export function stageMargin(s) {
  if (s <= 3) return 0.30;
  return 0.30 - ((s - 3) / (STAGES - 3)) * 0.15;
}

const MIN_GAP = 0.35;          // 키캡끼리 최소 간격 (겹침 방지)
const HEAD_CLEAR = 2.4;        // 아래 키캡 윗면 ~ 위 키캡 바닥 최소 높이 (머리 공간)
export const SHORTCUT_SAFETY = 0.5;   // 지름길 검사 안전 여유 (m)

// 두 사각형(XZ) 사이 최소 거리
export function rectGap(ax, az, ahx, ahz, bx, bz, bhx, bhz) {
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
export function sweptRect(b, pad = 0) {
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

// 물리적으로 a 윗면에서 b 윗면까지 '닿을 수 있는' 최대 간격 (여유 없음 + 안전 여유)
export function physicalMaxGap(dh) {
  if (dh > JUMP_APEX) return -Infinity;
  return jumpReach(dh) + 2 * PLAYER_HW + SHORTCUT_SAFETY;
}

// 지름길 검사: 새 키캡 nb가 직전(prev)보다 앞선 키캡(i ≤ j-2)에서 바로 닿으면 안 된다.
// 시작 바닥(boxes[0])은 1스테이지 입구라 제외한다.
export function shortcutFrom(nb, boxes) {
  for (let i = 1; i < boxes.length - 1; i++) {
    const b = boxes[i];
    const lim = physicalMaxGap(nb.top - b.top);
    if (lim === -Infinity) continue;           // 높이 차가 점프 최고 높이보다 크면 불가
    if (gapRange(b, nb).best <= lim) return i;
  }
  return -1;
}

// a 윗면에서 b 방향으로 확보할 수 있는 도움닫기 거리 → 이륙 속도 반영 도달 거리
function reachBetween(a, bx, bz, dh) {
  const ax = a.moving ? a.moving.ox : a.x, az = a.moving ? a.moving.oz : a.z;
  const l = Math.hypot(bx - ax, bz - az) || 1;
  const ux = Math.abs((bx - ax) / l), uz = Math.abs((bz - az) / l);
  const runup = 2 * (ux * a.hx + uz * a.hz);   // 윗면을 가로지르는 길이 (가장자리 걸침 포함 근사)
  return jumpReach(dh, takeoffSpeed(runup));
}

export function makeBox(type, rot, x, top, z, stage) {
  const d = KEY_DIMS[type];
  return {
    type, rot, stage,
    x, z, top, h: d.h,
    hx: rot ? d.hz : d.hx, hz: rot ? d.hx : d.hz,
    inset: d.inset,
    moving: null, s: 0, dx: 0, dz: 0,
  };
}

// 이동 범위 설정: 기준점(base)에서 bias 쪽으로 치우쳐 왕복 (bias 0 = 기준점 중심, 1 = 기준점에서 한쪽으로만)
function setAmp(m, amp) {
  m.amp = amp;
  m.ox = m.bx + m.ax * amp * m.bias;
  m.oz = m.bz + m.az * amp * m.bias;
}

// 직전 박스 prev 다음에 새 키캡을 경로를 따라 배치 (불가능하면 null)
// spec: 미리 뽑아 둔 키캡 속성, minS: 되돌아가기 재시도 시 탐색 시작 위치 하한
function placeNext(shape, prev, boxes, spec, minS = -Infinity) {
  const { type, dh, travelFrac, margin, moveAmp, stage, jit } = spec;
  const top = prev.top + dh;
  let frac = travelFrac;
  const sc = shape.search;
  const s0 = Math.max(prev.s + sc.start, minS);

  // 목표 간격을 점점 줄여 가며 탐색. 마지막 시도(frac=0)는 같은 변에 남은 짧은 구간이라도 쓰게 해
  // 모서리 앞에서 '같은 변은 너무 가깝고 다음 변은 너무 먼' 막다른 상황을 피한다.
  for (let attempt = 0; attempt <= 14; attempt++) {
    if (attempt === 14) frac = 0;
    for (let s = s0; s < prev.s + sc.max; s += sc.step) {
      const p = shape.place(s, type, jit);
      if (!p) continue;                        // 형태상 배치 불가 위치
      const nb = makeBox(type, p.rot, p.x, top, p.z, stage);
      nb.s = s;
      nb.side = p.side;
      nb.edge = p.edge;
      // 도움닫기를 반영한 도달 거리 (모서리 키캡처럼 진행 방향 길이가 짧으면 줄어듦)
      const reach = reachBetween(prev, p.x, p.z, dh);
      const allowedGap = reach * (1 - margin) + 2 * PLAYER_HW - 0.2;   // requiredTravel 역산
      const targetGap = Math.max(MIN_GAP + 0.15, Math.min(allowedGap, reach * frac + 2 * PLAYER_HW - 0.2));
      const nominal = rectGap(prev.moving ? prev.moving.ox : prev.x, prev.moving ? prev.moving.oz : prev.z,
        prev.hx, prev.hz, p.x, p.z, nb.hx, nb.hz);
      if (nominal < targetGap) continue;

      const mv = moveAmp > 0 ? shape.moveAxis(prev, nb) : null;
      if (mv) {
        nb.moving = { bx: p.x, bz: p.z, ax: mv.ax, az: mv.az, bias: mv.bias, speed: spec.speed, phase: spec.phase };
        setAmp(nb.moving, Math.min(moveAmp, shape.maxAmp ?? Infinity));
      }
      // 최악 위치에서도 도달 가능한지, 최소 간격·벽·지름길 조건을 만족하는지 확인
      // 이동 중 간격 변화폭도 0.9m 이하로 제한 (예측 가능한 움직임)
      const bad = () => {
        const g = gapRange(prev, nb);
        return g.worst > allowedGap || g.best < MIN_GAP || g.worst - g.best > 0.9 || !shape.fits(nb) ||
          !headroomOk(nb, boxes) || shortcutFrom(nb, boxes) >= 0;
      };
      while (nb.moving && bad()) {
        setAmp(nb.moving, nb.moving.amp * 0.8);
        if (nb.moving.amp < 0.5) { nb.moving = null; break; }
      }
      const g = gapRange(prev, nb);
      if (g.worst > allowedGap) break;          // 이 목표 간격은 불가 → 목표를 줄여 재시도
      if (g.best < MIN_GAP) continue;
      if (!shape.fits(nb)) continue;
      if (!headroomOk(nb, boxes)) continue;
      if (shortcutFrom(nb, boxes) >= 0) continue;
      if (nb.moving) { nb.x = nb.moving.ox; nb.z = nb.moving.oz; }
      nb.gapInfo = { worst: g.worst, best: g.best, allowedGap, dh, margin, reach };
      return nb;
    }
    frac *= 0.88;
  }
  return null;
}

export function buildTower(shape, seed) {
  const rng = mulberry32(seed);

  // 시작 바닥 (키보드 받침)
  const ground = makeBox(KEY_TYPES.GROUND, 0, 0, 0, 0, 0);
  if (shape.ground) { ground.hx = shape.ground.hx; ground.hz = shape.ground.hz; }

  // 첫 키캡: 경로 시작점
  const s0 = shape.startS;
  const p0 = shape.place(s0, KEY_TYPES.NORMAL, 0);
  const first = makeBox(KEY_TYPES.NORMAL, p0.rot, p0.x, 0.8, p0.z, 1);
  first.s = s0;
  first.side = p0.side;

  // 1) 모든 키캡의 속성을 난수로 미리 뽑아 둔다 (되돌아가기를 해도 시드 결과가 고정되도록)
  const specs = [];
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
      const travelFrac = Math.min(0.97, baseFrac + (rng() * 0.12 - 0.06));
      let moveAmp = 0;
      if (moveProb > 0 && lastMoving < 1 && rng() < moveProb) moveAmp = 1.2 + rng() * 0.8;
      lastMoving = moveAmp > 0 ? lastMoving + 1 : 0;
      specs.push({
        type, dh, travelFrac, margin, moveAmp, stage: s,
        jit: shape.jitter ? shape.jitter(rng) : 0, speed: 0.7 + rng() * 0.6, phase: rng() * Math.PI * 2,
      });
    }
    // 스테이지 끝: 스페이스바 체크포인트 (마지막은 정상)
    specs.push({
      type: s === STAGES ? KEY_TYPES.GOAL : KEY_TYPES.SPACE, dh: 0.45 + rng() * 0.25,
      travelFrac: 0.45 + 0.03 * s, margin, moveAmp: 0, stage: s, cp: s,
      jit: shape.jitter ? shape.jitter(rng) : 0, speed: 0, phase: 0,
    });
  }

  // 2) 순서대로 배치. 놓을 수 없으면 직전 키캡을 경로상 더 앞쪽으로 다시 놓는다 (되돌아가기)
  const placed = [first];
  const minS = new Array(specs.length).fill(-Infinity);
  let k = 0, steps = 0, backtracks = 0;
  while (k < specs.length) {
    if (++steps > 60000) throw new Error(`키캡 배치 실패 (${shape.name}): 되돌아가기 한도 초과 (k=${k}, stage ${specs[k].stage}, type ${specs[k].type})`);
    const prev = placed[placed.length - 1];
    const nb = placeNext(shape, prev, [ground, ...placed], specs[k], minS[k]);
    if (nb) {
      if (specs[k].cp) nb.cpIndex = specs[k].cp;
      placed.push(nb);
      k++;
      if (k < specs.length) minS[k] = -Infinity;
    } else {
      if (k === 0) throw new Error(`키캡 배치 실패 (${shape.name}): 첫 구간`);
      const popped = placed.pop();
      k--;
      backtracks++;
      minS[k] = popped.s + 0.5;              // 같은 키캡을 조금 더 앞쪽에서 다시 탐색
    }
  }

  const boxes = [ground, ...placed];
  const checkpoints = [];
  const sp = shape.spawn(first);
  const nrm = (s) => (shape.normal ? shape.normal(s) : null);   // 카메라 기본 시점용 벽 안쪽 방향
  checkpoints.push({ x: sp.x, y: 0, z: sp.z, yaw: sp.yaw, box: ground, stage: 0, s: s0, normal: nrm(s0) });
  for (const b of placed) {
    if (!b.cpIndex) continue;
    // 부활 위치: 스페이스바 중앙, 다음 진행 방향을 바라봄
    const t = shape.tangent(b.s);
    checkpoints.push({ x: b.x, y: b.top, z: b.z, yaw: Math.atan2(t.x, t.z), box: b, stage: b.cpIndex, s: b.s, normal: nrm(b.s) });
  }

  const goal = boxes[boxes.length - 1];
  return {
    shape: shape.name,
    boxes, checkpoints, goal, height: goal.top, backtracks,
    statics: shape.statics ? shape.statics(goal.top) : [],
    view: shape.view ? shape.view(goal.top) : { kind: shape.name },
  };
}

// 테스트·검증용: 연속 키캡 간 실제 도달 여유 계산
export function reachReport(tower) {
  const out = [];
  const b = tower.boxes;
  for (let i = 2; i < b.length; i++) {
    const g = b[i].gapInfo;
    if (!g) continue;
    out.push({
      index: i, stage: b[i].stage, type: b[i].type, moving: !!b[i].moving || !!b[i - 1].moving,
      dh: g.dh, worstGap: g.worst, bestGap: g.best,
      margin: 1 - requiredTravel(g.worst) / g.reach,
      requiredMargin: g.margin,
    });
  }
  return out;
}

// 테스트·검증용: 지름길(i → j ≥ i+2) 후보 전체 목록
export function shortcutReport(tower) {
  const b = tower.boxes, out = [];
  for (let j = 3; j < b.length; j++) {
    for (let i = 1; i <= j - 2; i++) {
      const lim = physicalMaxGap(b[j].top - b[i].top);
      if (lim === -Infinity) continue;
      const g = gapRange(b[i], b[j]).best;
      if (g <= lim) out.push({ from: i, to: j, gap: g, limit: lim });
    }
  }
  return out;
}
