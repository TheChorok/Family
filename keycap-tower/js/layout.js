// 키캡 타워 배치 진입점
// 실제 생성은 layout/core.js, 탑 모양은 layout/shapes/*.js 가 담당한다.
// 새 탑 형태(예: 바깥 벽)는 shapes 폴더에 모듈 하나를 추가하고 SHAPES에 등록하면 된다.
import { buildTower } from './layout/core.js';
import { spiral } from './layout/shapes/spiral.js';
import { shaft } from './layout/shapes/shaft.js';

export { KEY_TYPES, KEY_DIMS, STAGES, stageMargin, gapRange, reachReport, shortcutReport } from './layout/core.js';

export const SEED = 20261024;
export const SHAPES = { spiral, shaft };
export const DEFAULT_SHAPE = 'shaft';

export function generateTower(seed = SEED, shapeName = DEFAULT_SHAPE) {
  const shape = SHAPES[shapeName];
  if (!shape) throw new Error('알 수 없는 탑 형태: ' + shapeName);
  return buildTower(shape, seed);
}

// ── 미리 계산한 탑 데이터 ──
// 네모 통로 탑은 생성(지름길·머리 공간 검증 + 후반 후보 비교)에 PC 기준 약 2분이 걸려 폰에서 매번 만들 수 없다.
// 같은 시드·코드로 만든 결과를 data/tower-<형태>.json 으로 저장해 두고 불러온다.
// (tests/tower-data.test.mjs 가 저장본과 새로 생성한 결과가 완전히 같은지 검증)
export const TOWER_DATA_URL = (shapeName) => new URL(`../data/tower-${shapeName}.json`, import.meta.url);

// 박스 참조(체크포인트·정상)는 인덱스로 바꿔 저장
export function serializeTower(t, seed = SEED) {
  const idx = new Map(t.boxes.map((b, i) => [b, i]));
  return {
    seed, shape: t.shape, height: t.height,
    backtracks: t.backtracks, rerolls: t.rerolls, stageBacks: t.stageBacks,
    boxes: t.boxes,
    checkpoints: t.checkpoints.map((c) => ({ ...c, box: idx.get(c.box) })),
    goal: idx.get(t.goal),
    statics: t.statics, view: t.view,
  };
}

export function deserializeTower(d) {
  const boxes = d.boxes;
  return {
    shape: d.shape, height: d.height, backtracks: d.backtracks, rerolls: d.rerolls, stageBacks: d.stageBacks,
    boxes,
    checkpoints: d.checkpoints.map((c) => ({ ...c, box: boxes[c.box] })),
    goal: boxes[d.goal],
    statics: d.statics, view: d.view,
  };
}

// 게임용: 저장본을 불러오고, 없거나 시드가 다르면 직접 생성 (느리지만 동작은 동일)
export async function loadTower(seed = SEED, shapeName = DEFAULT_SHAPE) {
  try {
    const res = await fetch(TOWER_DATA_URL(shapeName));
    if (res.ok) {
      const d = await res.json();
      if (d.seed === seed && d.shape === shapeName) return deserializeTower(d);
    }
  } catch (e) { /* 오프라인 첫 실행 등: 직접 생성 */ }
  return generateTower(seed, shapeName);
}
