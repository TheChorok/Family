// 타워 배치 검증: 도달 여유(스테이지 기준 이상), 겹침, 벽 침범, 기믹 비율, 후반 난이도 보정 (탑 형태별)
// 실행: node keycap-tower/tests/layout.test.mjs [shaft|spiral]
// (시드 재현성·저장본 일치는 tower-data.test.mjs 에서 검증)
import { reachReport, stageMargin, STAGES, DEFAULT_SHAPE, SHAPES } from '../js/layout.js';
import { gimmickRates } from '../js/gimmicks.js';
import { towerFor } from './tower-cache.mjs';

const LATE_AVG_MIN = 3.4;     // 7~10스테이지 평균 간격 하한 (나선 탑 수준)
const MOVING_MIN = 24;        // 움직이는 키캡 최소 개수

const shapes = process.argv[2] ? [process.argv[2]] : [DEFAULT_SHAPE, 'spiral'];
let fail = 0;
for (const shape of shapes) {
  const t = towerFor(shape);
  const rep = reachReport(t);
  let f = 0;
  for (const r of rep) {
    if (r.margin + 1e-9 < r.requiredMargin) { f++; console.log('여유 부족', r); }
    if (r.bestGap < 0.3) { f++; console.log('겹침 위험', r); }
  }
  // 통로 형태: 모든 키캡(이동 범위 포함)이 벽 안쪽에 있어야 함
  const sh = SHAPES[shape];
  const outside = t.boxes.slice(1).filter((b) => !sh.fits(b)).length;
  if (outside) { f++; console.log('벽 침범 키캡', outside); }
  const moving = t.boxes.filter((b) => b.moving).length;
  console.log(`[${shape}] 키캡 ${t.boxes.length - 1}개, 정상 높이 ${t.height.toFixed(1)}m, 벽 침범 ${outside}, 움직이는 키캡 ${moving}개`);
  if (moving < MOVING_MIN) { f++; console.log(`움직이는 키캡 부족 (${moving} < ${MOVING_MIN})`); }
  for (let s = 1; s <= STAGES; s++) {
    const rs = rep.filter((r) => r.stage === s);
    const minM = Math.min(...rs.map((r) => r.margin));
    const avgGap = rs.reduce((a, r) => a + r.worstGap, 0) / rs.length;
    const keys = t.boxes.filter((b) => b.stage === s && !b.cpIndex);
    const gm = keys.filter((b) => b.g).length;
    const mov = keys.filter((b) => b.moving).length;
    // 기믹 비율: 목표(2~6 새 30%+이전 15%, 7~10 40%→70%)에서 크게 벗어나지 않는지 (배치 규칙상 일부 제외 허용)
    const want = gimmickRates(s).fresh + gimmickRates(s).old;
    const ratio = gm / keys.length;
    const ratioOk = s === 1 ? gm === 0 : ratio >= want - 0.08;
    if (!ratioOk) { f++; console.log(`S${s} 기믹 비율 부족 ${(ratio * 100).toFixed(0)}% (목표 ${(want * 100).toFixed(0)}%)`); }
    if (s >= 7 && avgGap < LATE_AVG_MIN) { f++; console.log(`S${s} 평균 간격 부족 ${avgGap.toFixed(2)} < ${LATE_AVG_MIN}`); }
    console.log(`  S${s} 기준여유 ${(stageMargin(s) * 100).toFixed(1)}% 최소여유 ${(minM * 100).toFixed(1)}% 평균간격 ${avgGap.toFixed(2)}m 이동키 ${mov} 기믹 ${gm}/${keys.length}(${(ratio * 100).toFixed(0)}%)`);
  }
  console.log(`[${shape}] ${f ? `실패 ${f}건` : '통과'}`);
  fail += f;
}
process.exit(fail ? 1 : 0);
