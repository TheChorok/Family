// 지름길 검증: 분석(도달 거리 계산) + 실제 물리 점프 시도, 둘 다 0건이어야 통과
// 지름길 = 키캡 i에서 i+2 이후 키캡에 바로 닿는 것 (반대편 벽으로 건너뛰기, 모서리 건너뛰기 포함)
// 실행: node keycap-tower/tests/shortcut.test.mjs [shaft|spiral]
import { generateTower, shortcutReport, DEFAULT_SHAPE, gapRange } from '../js/layout.js';
import { JUMP_APEX } from '../js/physics.js';
import { makeWorld, tryJump } from './bot-lib.mjs';

const shapes = process.argv[2] ? [process.argv[2]] : [DEFAULT_SHAPE, 'spiral'];
let fail = 0;
for (const shape of shapes) {
  const tower = generateTower(undefined, shape);
  const world = makeWorld(tower);
  const b = tower.boxes;

  // 1) 분석: 여유 없는 물리적 최대 도달 거리 + 안전 0.5m 기준
  const analytic = shortcutReport(tower);

  // 2) 실제 물리: 높이상 닿을 가능성이 있는 모든 후보 쌍에 봇이 최선의 점프를 시도
  //    움직이는 키캡이 끼면 출발 시점을 4가지로 바꿔 시도
  let tried = 0, cross = 0;
  const hits = [];
  for (let i = 1; i < b.length; i++) {
    for (let j = i + 2; j < b.length; j++) {
      const dh = b[j].top - b[i].top;
      if (dh > JUMP_APEX + 0.3) break;            // 이후는 더 높아 불가 (높이 순 정렬)
      const g = gapRange(b[i], b[j]).best;
      if (g > 9.5) continue;                       // 통로 폭보다 멀면 제외
      if (b[i].side !== undefined && b[j].side !== undefined && (b[i].side + 2) % 4 === b[j].side) cross++;
      const times = b[i].moving || b[j].moving ? [0, 0.8, 1.6, 2.4] : [0];
      for (const t0 of times) {
        tried++;
        if (tryJump(tower, world, b[i], b[j], t0)) { hits.push({ from: i, to: j, gap: +g.toFixed(2), dh: +dh.toFixed(2), t0 }); break; }
      }
    }
  }
  // 3) 자가 검증: 같은 봇이 정상 경로(i → i+1) 점프는 성공해야 지름길 0건 결과를 믿을 수 있다
  let normalOk = 0, normalN = 0;
  for (let i = 1; i < b.length - 1; i++) {
    normalN++;
    const times = b[i].moving || b[i + 1].moving ? [0, 0.8, 1.6, 2.4] : [0];
    if (times.some((t0) => tryJump(tower, world, b[i], b[i + 1], t0))) normalOk++;
  }
  const capable = normalOk / normalN >= 0.95;
  console.log(`[${shape}] 자가 검증: 정상 경로 점프 성공 ${normalOk}/${normalN} ${capable ? '✔' : '✘ (봇 능력 부족 → 지름길 결과 신뢰 불가)'}`);
  const ok = capable && analytic.length === 0 && hits.length === 0;
  console.log(`[${shape}] 분석상 지름길 ${analytic.length}쌍 / 물리 시도 ${tried}회(반대편 벽 후보 ${cross}쌍) → 성공 ${hits.length}건 ${ok ? '✔' : '✘'}`);
  if (analytic.length) console.log('  분석', JSON.stringify(analytic.slice(0, 5)));
  if (hits.length) console.log('  물리', JSON.stringify(hits.slice(0, 5)));
  if (!ok) fail++;
}
process.exit(fail ? 1 : 0);
