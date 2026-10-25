// 타워 배치 검증: 도달 여유(스테이지 기준 이상), 겹침, 벽 침범, 머리 공간, 시드 재현성 (탑 형태별)
// 실행: node keycap-tower/tests/layout.test.mjs [shaft|spiral]
import { generateTower, reachReport, stageMargin, STAGES, DEFAULT_SHAPE, SHAPES } from '../js/layout.js';

const shapes = process.argv[2] ? [process.argv[2]] : [DEFAULT_SHAPE, 'spiral'];
let fail = 0;
for (const shape of shapes) {
  const t0 = Date.now();
  const t = generateTower(undefined, shape);
  const ms = Date.now() - t0;
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
  console.log(`[${shape}] 키캡 ${t.boxes.length - 1}개, 정상 높이 ${t.height.toFixed(1)}m, 생성 ${ms}ms (되돌아가기 ${t.backtracks}회), 벽 침범 ${outside}`);
  for (let s = 1; s <= STAGES; s++) {
    const rs = rep.filter((r) => r.stage === s);
    const minM = Math.min(...rs.map((r) => r.margin));
    const avgGap = rs.reduce((a, r) => a + r.worstGap, 0) / rs.length;
    const mov = t.boxes.filter((b) => b.stage === s && b.moving).length;
    console.log(`  S${s} 기준여유 ${(stageMargin(s) * 100).toFixed(1)}% 최소여유 ${(minM * 100).toFixed(1)}% 평균간격 ${avgGap.toFixed(2)}m 이동키 ${mov}`);
  }
  // 시드 고정 확인
  const t2 = generateTower(undefined, shape);
  const same = t.boxes.every((b, i) => b.x === t2.boxes[i].x && b.top === t2.boxes[i].top);
  if (!same) { f++; console.log('시드 재현 실패'); }
  console.log(`[${shape}] ${f ? `실패 ${f}건` : '통과'}`);
  fail += f;
}
process.exit(fail ? 1 : 0);
