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
