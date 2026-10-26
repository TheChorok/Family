// 탑 형태와 무관한 키캡 배치 생성기 (Three.js 의존 없음 → Node 테스트 가능)
// 형태(shape) 모듈이 '경로 위 위치·방향·벽'을 알려 주면, 여기서 간격·도달 여유·이동 키캡·
// 체크포인트·머리 공간·지름길 검증을 공통으로 처리한다.
import { mulberry32 } from '../rng.js';
import { jumpReach, requiredTravel, apexOf, PLAYER_HW, JUMP_V, MOVE_SPEED, ACCEL_GROUND } from '../physics.js';
import {
  G, BOUNCE_V, ICE_ACCEL, SMALL, BIG, STAGE_NEW, ALL_GIMMICKS, gimmicksBefore, gimmickRates, isTimed,
} from '../gimmicks.js';

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

// 키캡 b에서 출발하는 점프에 필요한 머리 공간 = 그 점프의 최고 높이 + 캐릭터 키 + 여유
// (커진 상태일 수 있으면 커진 키·점프력, 점프대는 튕김 높이 기준)
function clearanceOf(b) {
  const tall = b.big ? 1.6 * BIG.scale : 1.6;
  const v0 = b.g === G.BOUNCE ? BOUNCE_V : b.g === G.MINUS ? JUMP_V * SMALL.jump : b.big ? JUMP_V * BIG.jump : JUMP_V;
  return apexOf(v0) + tall + 0.1;
}

// 키캡은 위로 갈수록 높아지는 순서로 놓이므로, 높이 차가 이보다 크면 더 아래 키캡은 볼 필요가 없다
const SCAN_DEPTH = 9;

function rectsOverlap(a, b) {
  return Math.abs(a.cx - b.cx) < a.hx + b.hx && Math.abs(a.cz - b.cz) < a.hz + b.hz;
}
// 두 키캡(이동 범위 포함)을 함께 감싸는 사각형 = 그 사이 점프 경로가 지나가는 통로
function corridor(a, b, pad) {
  const ra = sweptRect(a, pad), rb = sweptRect(b, pad);
  const x0 = Math.min(ra.cx - ra.hx, rb.cx - rb.hx), x1 = Math.max(ra.cx + ra.hx, rb.cx + rb.hx);
  const z0 = Math.min(ra.cz - ra.hz, rb.cz - rb.hz), z1 = Math.max(ra.cz + ra.hz, rb.cz + rb.hz);
  return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2 };
}

// 머리 공간: 새 키캡 nb가 아래쪽 점프 경로(b → b 다음 키캡의 통로) 위에 있으면,
// 그 점프의 최고 높이 + 키만큼 떨어져 있어야 한다 (점프하다 윗바퀴 키캡 밑면에 머리를 부딪히지 않게)
function headroomOk(nb, boxes) {
  const r = sweptRect(nb, 0);
  const bottom = nb.top - nb.h;
  for (let i = boxes.length - 2; i >= 1; i--) {   // 바닥(0)과 직전 박스 제외, 최근 것부터 거꾸로
    const b = boxes[i];
    if (nb.top - b.top > SCAN_DEPTH) break;
    if (b.top > nb.top) continue;
    const next = boxes[i + 1];
    const path = next && next !== nb ? corridor(b, next, 0.45) : sweptRect(b, 0.45);
    if (rectsOverlap(r, path) && bottom - b.top < clearanceOf(b)) return false;
  }
  return true;
}

// 물리적으로 닿을 수 있는 최대 간격 (여유 없음 + 안전 여유)
// v0: 출발 키캡에서 낼 수 있는 최대 수직 초속(점프대·확대 반영), hw: 그때의 캐릭터 절반 폭
export function physicalMaxGap(dh, v0 = JUMP_V, hw = PLAYER_HW) {
  if (dh > apexOf(v0)) return -Infinity;
  return jumpReach(dh, MOVE_SPEED, v0) + 2 * hw + SHORTCUT_SAFETY;
}

// 지름길 검사: 새 키캡 nb가 직전(prev)보다 앞선 키캡(i ≤ j-2)에서 바로 닿으면 안 된다.
// 시작 바닥(boxes[0])은 1스테이지 입구라 제외한다.
export function shortcutFrom(nb, boxes) {
  for (let i = boxes.length - 2; i >= 1; i--) {
    const b = boxes[i];
    if (nb.top - b.top > SCAN_DEPTH) break;     // 최대 점프 높이(약 3.3m)보다 훨씬 아래
    const lim = physicalMaxGap(nb.top - b.top, b.maxV ?? JUMP_V, b.maxHw ?? PLAYER_HW);
    if (lim === -Infinity) continue;           // 높이 차가 점프 최고 높이보다 크면 불가
    if (gapRange(b, nb).best <= lim) return i;
  }
  return -1;
}

// a 윗면에서 b 방향으로 뛸 때의 도달 거리 (캐릭터 중심 기준)
// - 도움닫기: 윗면을 가로지르는 길이로 낼 수 있는 이륙 속도 (얼음은 가속이 느림)
// - 점프대: 서 있을 수 없어 튕김(초속 16)으로만 출발, 공중 가속 손실 0.7m를 뺀다
// - small: '－' 효과 구간이면 점프 초속 0.8배
function reachBetween(a, bx, bz, dh, small) {
  const ax = a.moving ? a.moving.ox : a.x, az = a.moving ? a.moving.oz : a.z;
  const l = Math.hypot(bx - ax, bz - az) || 1;
  const ux = Math.abs((bx - ax) / l), uz = Math.abs((bz - az) / l);
  const runup = 2 * (ux * a.hx + uz * a.hz);   // 윗면을 가로지르는 길이 (가장자리 걸침 포함 근사)
  // 점프대는 처음 닿은 자리에서 바로 튕겨 나가므로, 다음 키캡 반대쪽 가장자리에서 출발할 수도 있다
  // → 점프대 폭(진행 방향 길이)만큼 빼서 어디에 착지하든 닿게 한다
  if (a.g === G.BOUNCE) return Math.max(0, jumpReach(dh, MOVE_SPEED, BOUNCE_V) - 0.7 - runup);
  const accel = a.g === G.ICE ? ICE_ACCEL : ACCEL_GROUND;
  // 얼음: 앞 키캡에서 옆 방향 속도를 가진 채 내리면 느린 가속으로 방향을 틀어야 해서 이륙 속도를 80%로 본다
  const speed = Math.min(MOVE_SPEED, Math.sqrt(2 * accel * runup)) * (a.g === G.ICE ? 0.8 : 1);
  return jumpReach(dh, speed, small ? JUMP_V * SMALL.jump : JUMP_V);
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

// 기믹 속성 부여: 종류, 컨베이어 방향(경로 접선 ±), 지름길·머리 공간 계산용 최대 점프 능력
function setGimmick(nb, spec, shape, fx) {
  nb.g = spec.g || G.NONE;
  if (nb.g === G.CONVEYOR) {
    const t = shape.tangent(nb.s);
    nb.conv = { x: t.x * spec.convSign, z: t.z * spec.convSign };
  }
  // 이 키캡에서 출발할 때 커진 상태일 수 있는지 ('－' 키캡은 착지하면 작아지므로 제외)
  nb.big = nb.g === G.PLUS || (!!fx.big && nb.g !== G.MINUS);
  // '－' 키캡은 착지하는 순간 작아지므로 거기서 출발하는 점프는 축소 상태 능력이 최대
  nb.maxV = nb.g === G.BOUNCE ? BOUNCE_V : nb.g === G.MINUS ? JUMP_V * SMALL.jump : nb.big ? JUMP_V * BIG.jump : JUMP_V;
  nb.maxHw = nb.g === G.MINUS ? PLAYER_HW * SMALL.scale : nb.big ? PLAYER_HW * BIG.scale : PLAYER_HW;
}

// 직전 박스 prev 다음에 새 키캡을 경로를 따라 배치 (불가능하면 null)
// spec: 미리 뽑아 둔 키캡 속성, minS: 되돌아가기 재시도 시 탐색 시작 위치 하한
// 한 칸 미리 확인: a 다음 키캡(spec)을 놓을 위치가 기하적으로 있는지 (탐색 간격의 5배 간격으로) 빠르게 확인
// (지름길·머리 공간까지 보는 전체 탐색을 후보마다 돌리면 너무 느려서 간격·벽 조건만 본다)
// 후반(minFrac)은 '허용 간격의 minFrac 이상' 자리가 있어야 함 → 모서리 앞 막다른 구간에 놓이는 것을 피함
function roomOk(shape, a, spec, small) {
  const sc = shape.search;
  const hw = small ? PLAYER_HW * SMALL.scale : PLAYER_HW;
  for (let s = a.s + sc.start; s < a.s + sc.max; s += sc.step * 5) {
    const p = shape.place(s, spec.type, 0, spec.stage);
    if (!p) continue;
    const nb = makeBox(spec.type, p.rot, p.x, a.top + spec.dh, p.z, spec.stage);
    if (!shape.fits(nb)) continue;
    const reach = reachBetween(a, p.x, p.z, spec.dh, small);
    const allowed = reach * (1 - spec.margin) + 2 * hw - 0.2;
    const lo = Math.max(MIN_GAP, (spec.minFrac || 0) * allowed - 0.25);
    const gap = rectGap(a.moving ? a.moving.ox : a.x, a.moving ? a.moving.oz : a.z, a.hx, a.hz, p.x, p.z, nb.hx, nb.hz);
    if (gap >= lo && gap <= allowed) return true;
    if (gap > allowed + 6) break;                 // 이미 너무 멀어짐
  }
  return false;
}

// fx: 효과 상태 { small: '－' 효과 구간, big: '＋' 효과 가능 구간 }
function placeNext(shape, prev, boxes, spec, minS = -Infinity, fx = {}, nextSpec = null, maxS = Infinity) {
  const { type, dh, travelFrac, margin, moveAmp, stage, jit } = spec;
  const top = prev.top + dh;
  const minFrac = spec.minFrac || 0;
  // 한도 기준 모드: 후반(minFrac>0)이나 '＋' 효과 구간(커진 캐릭터가 멀리 뜀 → 간격이 짧으면 한 칸 건너뛰는
  // 지름길)은 허용 최대 간격의 100%부터 2%씩 낮추며 시도. 그 외는 도달 거리 × travelFrac 기준
  const relMode = minFrac > 0 || !!fx.big || !!prev.big;
  let frac = relMode ? 1 : travelFrac;
  const sc = shape.search;
  const s0 = Math.max(prev.s + sc.start, minS);
  const hw = fx.small ? PLAYER_HW * SMALL.scale : PLAYER_HW;

  // 목표 간격을 점점 줄여 가며 탐색. 마지막 시도(frac=0)는 같은 변에 남은 짧은 구간이라도 쓰게 해
  // 모서리 앞 막다른 상황을 피한다. 후반(minFrac>0)은 허용 한도의 100%부터 2%씩 낮춰 가며 시도하므로
  // 대부분 한도 가까운 간격이 되고, 정말 안 될 때만 짧아진다 (평균 간격 보정).
  for (let attempt = 0; attempt <= 14; attempt++) {
    // 마지막 대안(frac=0, 짧은 간격 허용)은 전반에만. 후반은 하한 미만이면 포기하고 스테이지 다시 뽑기
    if (minFrac > 0 && frac < minFrac - 1e-9) break;
    if (attempt === 14) { if (minFrac > 0) break; frac = 0; }
    for (let s = s0; s < Math.min(prev.s + sc.max, maxS); s += sc.step) {
      const p = shape.place(s, type, jit, stage);
      if (!p) continue;                        // 형태상 배치 불가 위치
      const nb = makeBox(type, p.rot, p.x, top, p.z, stage);
      nb.s = s;
      nb.side = p.side;
      nb.edge = p.edge;
      setGimmick(nb, spec, shape, fx);
      // 효과·도움닫기를 반영한 도달 거리 (모서리 키캡처럼 진행 방향 길이가 짧으면 줄어듦)
      const reach = reachBetween(prev, p.x, p.z, dh, fx.small);
      const allowedGap = reach * (1 - margin) + 2 * hw - 0.2;   // requiredTravel 역산
      // 후반(minFrac>0): 목표 = 허용 최대 간격 × frac (frac 1.0 → minFrac), 그 외: 도달 거리 × frac 기준
      // 움직이는 키캡은 이동으로 간격이 늘어날 여유(0.25m)를 남겨 둔다 (부족하면 이동 폭이 자동으로 줄어듦)
      const moveRoom = moveAmp > 0 ? 0.25 : 0;
      const targetGap = relMode && frac > 0
        ? Math.max(MIN_GAP + 0.15, allowedGap * frac - 0.04 - moveRoom)
        : Math.max(MIN_GAP + 0.15, Math.min(allowedGap - 0.04 - moveRoom, reach * frac + 2 * hw - 0.2));
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
        if (nb.moving.amp < (shape.minAmp ?? 0.5)) { nb.moving = null; break; }
      }
      const g = gapRange(prev, nb);
      if (g.worst > allowedGap) break;          // 이 목표 간격은 불가 → 목표를 줄여 재시도
      if (g.best < MIN_GAP) continue;
      if (!shape.fits(nb)) continue;
      if (!headroomOk(nb, boxes)) continue;
      if (shortcutFrom(nb, boxes) >= 0) continue;
      if (nb.moving) { nb.x = nb.moving.ox; nb.z = nb.moving.oz; }
      // 다음 키캡(특히 긴 스페이스바·후반 키캡)을 놓을 자리가 기하적으로 있는지 한 칸 미리 확인
      const nextSmall = nextSpec && (nb.g === G.MINUS || (fx.small && fx.smallLeft > 1));
      if (nextSpec && (nextSpec.cp || nextSpec.minFrac) && !roomOk(shape, nb, nextSpec, nextSmall)) {
        if (nb.moving) { nb.x = nb.moving.bx; nb.z = nb.moving.bz; }
        continue;
      }
      nb.gapInfo = { worst: g.worst, best: g.best, allowedGap, dh, margin, reach, hw, small: !!fx.small, from: prev.g || 0, rel: relMode };
      return nb;
    }
    frac = relMode ? frac - 0.02 : frac * 0.88;   // 한도 기준 모드는 촘촘하게 줄여 가며 탐색
  }
  return null;
}

// 후반(7~10스테이지) 난이도 보정: 목표 간격 비율과 하한, 이동 키캡 확률
const LATE_FRAC = { 7: 0.90, 8: 0.93, 9: 0.95, 10: 0.97 };
const LATE_MIN_FRAC = 0.85;   // 후반 키캡 간격 하한: 허용 최대 간격(여유 기준 한도)의 85%
const MOVE_PROB = { 6: 0.75, 7: 0.85, 8: 0.9, 9: 0.9, 10: 0.9 };
const MAX_CONSEC_MOVING = 2;   // 연속 이동 키캡 최대 개수 (간격 변화폭 0.9m 제한은 유지)
export const SMALL_WINDOW = 2;   // '－' 이후 이 횟수의 점프는 축소 상태 기준으로 배치 (그 뒤는 안정 키캡에서 기다릴 수 있음)
export const BIG_WINDOW = 8;     // '＋' 이후 이 개수의 키캡은 커진 상태일 수 있다고 보고 지름길·머리 공간 검사

// 다음 키캡을 놓을 때의 효과 상태 (직전 키캡들의 '－'/'＋' 기준)
function effectState(placed) {
  const n = placed.length;
  let small = false, big = false;
  for (let i = n - 1; i >= Math.max(0, n - BIG_WINDOW); i--) {
    const g = placed[i].g;
    if (g === G.MINUS) {                                              // 가장 최근 크기 효과만 유효
      small = n - 1 - i < SMALL_WINDOW;
      return { small, big, smallLeft: SMALL_WINDOW - (n - 1 - i) };
    }
    if (g === G.PLUS) { big = true; break; }
  }
  return { small, big };
}

// 기믹 배정 (한 스테이지 분량의 specs): 스테이지별 비율(2~6: 새 약 30% + 이전 약 15%, 7~10: 40%→70%)만큼
// 정해진 개수를 뽑아 배치 규칙을 지키는 자리에만 넣는다.
//  - 체크포인트 바로 앞: 점프대·시간 제한 키캡 금지 / 체크포인트 앞 2칸: '－'·'＋' 금지
//    ('＋'는 커져서 긴 스페이스바로 한 칸 건너뛰는 지름길, '－'는 효과 구간이 스테이지를 넘어감)
//  - 시간 제한(꺼짐·줄어듦) 키캡: 움직이지 않는 키캡에만, 다음 키캡이 움직이는 키캡이면 금지(타이밍 대기 불가)
//  - 방향 반전 바로 다음: 시간 제한 키캡 금지
//  - '－' 다음 SMALL_WINDOW개 키캡: 기다릴 수 있도록 점프대·시간 제한·얼음·컨베이어 금지
//  - 얼음은 넓은(기능키) 키캡으로
function assignGimmicks(specs, s, rng) {
  const ok = (i, g) => {
    const sp = specs[i], next = specs[i + 1], prev = specs[i - 1], next2 = specs[i + 2];
    if (sp.cp || sp.g || sp.first) return false;
    if (next && next.cp && (g === G.BOUNCE || isTimed(g))) return false;
    if ((g === G.PLUS || g === G.MINUS) && ((next && next.cp) || (next2 && next2.cp))) return false;
    if (isTimed(g) && (sp.moveAmp > 0 || (next && next.moveAmp > 0))) return false;
    if (isTimed(g) && prev && prev.g === G.REVERSE) return false;
    if (g === G.REVERSE && next && isTimed(next.g)) return false;
    // '－' 다음 2칸은 원래 크기로 돌아올 때까지 기다릴 수 있는 키캡이어야 함 (점프대·시간 제한·얼음·컨베이어 금지)
    const unstable = (x) => x === G.BOUNCE || isTimed(x) || x === G.ICE || x === G.CONVEYOR;
    for (let d = 1; d <= SMALL_WINDOW; d++) {
      const b = specs[i - d];
      if (b && b.g === G.MINUS && unstable(g)) return false;
      const a = specs[i + d];
      if (g === G.MINUS && a && unstable(a.g)) return false;
    }
    return true;
  };
  if (s >= 2) {
    const idx = specs.map((sp, i) => (!sp.cp ? i : -1)).filter((i) => i >= 0);
    const n = idx.length;
    const rate = gimmickRates(s);
    const fresh = Math.round(n * rate.fresh), old = Math.round(n * rate.old);
    const want = [];
    for (let j = 0; j < fresh; j++) want.push(STAGE_NEW[s][j % STAGE_NEW[s].length]);
    const list = s >= 7 ? ALL_GIMMICKS : gimmicksBefore(s);
    // 후반은 '－'·점프대·얼음을 스테이지당 1개까지만: 셋 다 다음 간격이 짧아져(축소 점프, 착지 위치 불확실,
    // 미끄러운 도움닫기) 후반 평균 간격 보정과 충돌한다
    const LIMITED = [G.MINUS, G.BOUNCE, G.ICE];
    const cnt = {};
    for (const g of want) cnt[g] = (cnt[g] || 0) + 1;
    for (let j = 0; j < old; j++) {
      let g = list[Math.floor(rng() * list.length)];
      while (s >= 7 && LIMITED.includes(g) && (cnt[g] || 0) >= 1) g = list[Math.floor(rng() * list.length)];
      cnt[g] = (cnt[g] || 0) + 1;
      want.push(g);
    }
    // 자리 순서를 섞어서 배정
    const order = idx.slice();
    for (let j = order.length - 1; j > 0; j--) { const r = Math.floor(rng() * (j + 1)); [order[j], order[r]] = [order[r], order[j]]; }
    // 원하는 종류를 놓을 자리가 없으면 같은 후보군(새 기믹 → 이전 기믹 → 전체) 안의 다른 종류로 대체해 비율 유지
    const fallback = (s >= 7 ? ALL_GIMMICKS : STAGE_NEW[s].concat(gimmicksBefore(s)))
      .filter((g) => s < 7 || !LIMITED.includes(g));
    for (const want1 of want) {
      let g = want1, at = order.find((i) => ok(i, g));
      if (at === undefined) {
        const alt = fallback.slice().sort(() => rng() - 0.5);
        for (const g2 of alt) { at = order.find((i) => ok(i, g2)); if (at !== undefined) { g = g2; break; } }
      }
      if (at === undefined) continue;
      specs[at].g = g;
      if (g === G.ICE) specs[at].type = KEY_TYPES.WIDE;
      order.splice(order.indexOf(at), 1);
    }
  }
  // '－' 효과 구간(점프 최고 약 1.3m)의 다음 키캡들은 높이 차를 0.6~0.9m로 제한 (오를 수 없는 계단 방지)
  for (let i = 0; i < specs.length; i++) {
    if (specs[i].g !== G.MINUS) continue;
    for (let d = 1; d <= SMALL_WINDOW && i + d < specs.length; d++) {
      specs[i + d].dh = Math.min(specs[i + d].dh, 0.6 + rng() * 0.3);
    }
  }
  // 점프대 다음 키캡은 튕김 높이를 살려 더 높게 (1.2~2.2m)
  for (let i = 0; i < specs.length - 1; i++) {
    if (specs[i].g === G.BOUNCE && !specs[i + 1].cp) specs[i + 1].dh = 1.2 + rng() * 1.0;
  }
}

// 스테이지 첫 키캡의 높이 차 (고정값): 체크포인트를 놓을 때 다음 스테이지 첫 키캡 자리를 정확히 미리 확인하기 위함
function firstDh(s) {
  return s >= 7 ? 1.0 : (0.45 + 0.05 * s + 0.85 + 0.07 * s) / 2;
}
// 스테이지 첫 키캡 속성: 일반 키, 기믹·움직임 없음
function firstSpec(s) {
  return {
    type: KEY_TYPES.NORMAL, dh: firstDh(s), margin: stageMargin(s), stage: s, minFrac: s >= 7 ? LATE_MIN_FRAC : 0,
    travelFrac: s >= 7 ? LATE_FRAC[s] : 0.35 + 0.06 * (s - 1), moveAmp: 0, g: G.NONE, jit: 0, speed: 1, phase: 0, first: true,
  };
}

// 한 스테이지 분량의 키캡 속성을 난수로 뽑는다 (스테이지가 막히면 다른 난수로 다시 뽑아 재시도)
function stageSpecs(shape, s, rng) {
  const specs = [];
  const margin = stageMargin(s);
  const n = 11 + s;                       // 스테이지별 키캡 수 (12 ~ 21)
  const late = s >= 7;
  // 후반은 높이 차를 약간 줄여(0.7~1.25m) 같은 여유 기준에서 더 먼 간격을 쓰게 한다 (난이도는 간격으로)
  // (더 낮추면 네모 통로 한 바퀴 높이가 낮아져 점프 경로 머리 공간을 확보할 수 없음)
  const dhLo = late ? 0.7 : 0.45 + 0.05 * s, dhHi = late ? 1.25 : 0.85 + 0.07 * s;
  // 위로 갈수록 간격 증가. 7~10스테이지는 허용 한도 가까이에서 시작하는 '한도 기준 모드'(minFrac)
  const baseFrac = late ? LATE_FRAC[s] : 0.35 + 0.06 * (s - 1);
  const moveProb = s >= 6 ? MOVE_PROB[s] : 0;
  let lastMoving = 0;
  const startIdx = s === 1 ? 1 : 0;        // 1스테이지 첫 키캡은 이미 배치됨
  for (let i = startIdx; i < n; i++) {
    const type = rng() < 0.25 ? KEY_TYPES.WIDE : KEY_TYPES.NORMAL;
    const dh = dhLo + rng() * (dhHi - dhLo);
    const travelFrac = Math.min(0.97, baseFrac + (rng() * 0.12 - 0.06));
    let moveAmp = 0;
    if (moveProb > 0 && lastMoving < MAX_CONSEC_MOVING && rng() < moveProb) moveAmp = 1.2 + rng() * 0.8;
    lastMoving = moveAmp > 0 ? lastMoving + 1 : 0;
    const sp = {
      type, dh, travelFrac, margin, moveAmp, stage: s, minFrac: late ? LATE_MIN_FRAC : 0,
      jit: shape.jitter ? shape.jitter(rng) : 0, speed: 0.7 + rng() * 0.6, phase: rng() * Math.PI * 2,
      g: G.NONE, convSign: rng() < 0.5 ? 1 : -1,
    };
    // 2스테이지부터 첫 키캡은 고정 속성 (체크포인트 다음 자리 미리 확인과 일치)
    specs.push(s >= 2 && i === 0 ? Object.assign(sp, firstSpec(s), { jit: sp.jit }) : sp);
    if (s >= 2 && i === 0) lastMoving = 0;
  }
  // 체크포인트 바로 앞 키캡은 움직이지 않게 (움직이면 체크포인트까지 간격을 크게 줄여야 해 후반 평균 간격이 떨어짐)
  if (specs.length > 1) specs[specs.length - 1].moveAmp = 0;
  // 스테이지 끝: 스페이스바 체크포인트 (마지막은 정상)
  specs.push({
    type: s === STAGES ? KEY_TYPES.GOAL : KEY_TYPES.SPACE, dh: 0.45 + rng() * 0.25,
    travelFrac: 0.45 + 0.03 * s, margin, moveAmp: 0, stage: s, cp: s,
    jit: shape.jitter ? shape.jitter(rng) : 0, speed: 0, phase: 0, g: G.NONE,
  });
  assignGimmicks(specs, s, rng);
  return specs;
}

const STAGE_BUDGET = 4000;      // 스테이지 하나를 되돌아가기로 푸는 최대 단계 수 (넘으면 다시 뽑기)
const STAGE_REROLLS = 60;
const STAGE_VARIANTS = 10;      // 6~10스테이지에서 비교할 성공 배치 수
const LATE_TARGET_GAP = 3.45;   // 7~10스테이지 목표 평균 간격 (나선 탑 수준 3.4~3.6m)

const QUALITY_BACKS = 3;        // 후반 스테이지별 품질 되돌아가기 최대 횟수

// 스테이지 평균 간격 (최악 위치 기준, 체크포인트 제외)
function avgGap(keys) {
  const gs = keys.filter((b) => b.gapInfo && !b.cpIndex).map((b) => b.gapInfo.worst);
  return gs.reduce((a, g) => a + g, 0) / Math.max(1, gs.length);
}
// 후보 배치 점수: 7~10스테이지는 목표 평균 간격 도달을 가장 우선하고, 그다음 평균 간격 + 움직이는 키 1개당 0.08
// 6스테이지(움직이는 키캡 첫 등장)는 움직이는 키 수를 더 중시 (1개당 0.15)
function stageScore(keys, s) {
  const avg = avgGap(keys);
  if (s < 7) return avg + 0.15 * keys.filter((b) => b.moving).length;
  return 10 * Math.min(avg, LATE_TARGET_GAP) + avg + 0.08 * keys.filter((b) => b.moving).length;
}       // 스테이지 다시 뽑기 최대 횟수 (넘으면 앞 스테이지를 다시 뽑음)

// 한 스테이지 배치 (스테이지 안에서만 되돌아가기). 성공하면 새 키캡 배열, 실패하면 null
function placeStage(shape, ground, placed, specs, stats) {
  const base = placed.length;
  const out = [];
  const minS = new Array(specs.length).fill(-Infinity);
  const maxS = new Array(specs.length).fill(Infinity);
  let k = 0, steps = 0;
  while (k < specs.length) {
    if (++steps > STAGE_BUDGET) return null;
    const all = placed.concat(out);
    const prev = all[all.length - 1];
    // 체크포인트(스테이지 마지막)는 다음 스테이지 첫 키캡을 아직 모르므로 대표 키캡으로 미리 확인
    const s1 = specs[k].stage + 1;
    const nextSpec = specs[k + 1] || (s1 <= STAGES ? firstSpec(s1) : null);
    const nb = placeNext(shape, prev, [ground, ...all], specs[k], minS[k], effectState(all), nextSpec, maxS[k]);
    if (nb) {
      if (specs[k].cp) nb.cpIndex = specs[k].cp;
      out.push(nb);
      k++;
      if (k < specs.length) { minS[k] = -Infinity; maxS[k] = Infinity; }
    } else {
      if (k === 0) return null;               // 스테이지 첫 키캡도 못 놓으면 다시 뽑기
      const popped = out.pop();
      k--;
      stats.backtracks++;
      // 같은 키캡을 다른 자리에서 다시 탐색: 한도 기준 모드(후반·'＋' 구간)는 이미 한도 가까운 간격이라
      // 더 앞쪽은 닿지 않으므로 조금 더 뒤쪽(짧은 간격)에서, 그 외는 조금 더 앞쪽에서
      const back = popped.gapInfo && popped.gapInfo.rel;
      if (back) maxS[k] = popped.s - (shape.search.retry || 0.5);
      else minS[k] = popped.s + (shape.search.retry || 0.5);
    }
  }
  return base === placed.length ? out : null;
}

export function buildTower(shape, seed) {
  // 시작 바닥 (키보드 받침)
  const ground = makeBox(KEY_TYPES.GROUND, 0, 0, 0, 0, 0);
  if (shape.ground) { ground.hx = shape.ground.hx; ground.hz = shape.ground.hz; }

  // 첫 키캡: 경로 시작점
  const s0 = shape.startS;
  const p0 = shape.place(s0, KEY_TYPES.NORMAL, 0);
  const first = makeBox(KEY_TYPES.NORMAL, p0.rot, p0.x, 0.8, p0.z, 1);
  first.s = s0;
  first.side = p0.side;
  first.g = G.NONE; first.maxV = JUMP_V; first.maxHw = PLAYER_HW;

  // 스테이지 단위로 배치: 막히면 그 스테이지의 속성만 다른 난수로 다시 뽑아 재시도하고,
  // 그래도 안 되면 앞 스테이지로 돌아가 그 스테이지를 다른 난수로 다시 뽑는다 (시드 고정 유지)
  const placed = [first];
  const stats = { backtracks: 0, rerolls: 0, stageBacks: 0 };
  const nextAttempt = new Array(STAGES + 2).fill(0);   // 스테이지별 다음에 시도할 난수 번호
  const stageStart = [];                                // 스테이지별 placed 시작 위치
  const cands = [];                                     // 스테이지별 남은 후보 배치 (점수 순)
  const qualityBacks = [];                              // 스테이지별 품질 되돌아가기 횟수
  let s = 1;
  while (s <= STAGES) {
    if (stats.stageBacks > 60) throw new Error(`키캡 배치 실패 (${shape.name}): 스테이지 되돌아가기 한도 초과`);
    stageStart[s] = placed.length;
    // 6~10스테이지는 성공한 배치를 여러 개 만들어 (평균 간격 + 움직이는 키 수) 점수 순으로 쓴다.
    // 모든 후보가 같은 검증(여유·지름길·머리 공간)을 통과했으므로 난이도 보장은 그대로 유지된다.
    // 뒤 스테이지가 막혀 되돌아오면 남은 후보 중 다음 순위를 쓴다
    if (!cands[s]) {
      cands[s] = [];
      const want = s >= 6 ? STAGE_VARIANTS : 1;
      while (cands[s].length < want && nextAttempt[s] < STAGE_REROLLS) {
        const attempt = nextAttempt[s]++;
        const rng = mulberry32((seed * 31 + s * 7919 + attempt * 104729) >>> 0);
        const cand = placeStage(shape, ground, placed, stageSpecs(shape, s, rng), stats);
        if (cand) cands[s].push({ keys: cand, score: stageScore(cand, s) });
        else stats.rerolls++;
      }
      cands[s].sort((a, b) => b.score - a.score);
    }
    // 품질 되돌아가기: 후반 스테이지의 가장 좋은 후보도 목표 평균 간격에 못 미치면, 앞 스테이지의 다음 후보로
    // 바꿔 다시 시도 (스테이지당 최대 QUALITY_BACKS회 — 결과가 나아지지 않아도 그 뒤에는 그대로 진행)
    if (s >= 7 && cands[s].length && avgGap(cands[s][0].keys) < LATE_TARGET_GAP - 0.05 &&
        cands[s - 1] && cands[s - 1].length && (qualityBacks[s] || 0) < QUALITY_BACKS) {
      qualityBacks[s] = (qualityBacks[s] || 0) + 1;
      cands[s] = null;
      nextAttempt[s] = 0;
      s--;
      placed.length = stageStart[s];
      continue;
    }
    const done = cands[s].shift();
    if (done) { placed.push(...done.keys); s++; continue; }
    // 이 스테이지는 지금의 앞 스테이지 배치로는 불가 → 앞 스테이지의 다음 후보(없으면 다음 난수)로
    if (s === 1) throw new Error(`키캡 배치 실패 (${shape.name}): 1스테이지 배치 불가`);
    cands[s] = null;
    nextAttempt[s] = 0;
    s--;
    placed.length = stageStart[s];
    if (!cands[s].length) cands[s] = null;
    stats.stageBacks++;
  }
  const { backtracks, rerolls, stageBacks } = stats;

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
    boxes, checkpoints, goal, height: goal.top, backtracks, rerolls, stageBacks,
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
      margin: 1 - requiredTravel(g.worst, g.hw) / g.reach,
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
      const lim = physicalMaxGap(b[j].top - b[i].top, b[i].maxV ?? JUMP_V, b[i].maxHw ?? PLAYER_HW);
      if (lim === -Infinity) continue;
      const g = gapRange(b[i], b[j]).best;
      if (g <= lim) out.push({ from: i, to: j, gap: g, limit: lim });
    }
  }
  return out;
}
