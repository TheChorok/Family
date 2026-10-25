// 타워 배치 검증: 모든 연속 키캡의 도달 여유가 스테이지 기준 이상인지, 겹침이 없는지 확인
// 실행: node keycap-tower/tests/layout.test.mjs
import { generateTower, reachReport, stageMargin, STAGES } from '../js/layout.js';

const t = generateTower();
const rep = reachReport(t);
let fail = 0;
for (const r of rep) {
  if (r.margin + 1e-9 < r.requiredMargin) { fail++; console.log('여유 부족', r); }
  if (r.bestGap < 0.3) { fail++; console.log('겹침 위험', r); }
}
console.log('키캡 수', t.boxes.length - 1, '정상 높이', t.height.toFixed(1) + 'm');
for (let s = 1; s <= STAGES; s++) {
  const rs = rep.filter((r) => r.stage === s);
  const minM = Math.min(...rs.map((r) => r.margin));
  const avgGap = rs.reduce((a, r) => a + r.worstGap, 0) / rs.length;
  const mov = t.boxes.filter((b) => b.stage === s && b.moving).length;
  console.log(`S${s} 기준여유 ${(stageMargin(s) * 100).toFixed(1)}% 최소여유 ${(minM * 100).toFixed(1)}% 평균간격 ${avgGap.toFixed(2)}m 이동키 ${mov}`);
}
// 시드 고정 확인
const t2 = generateTower();
const same = t.boxes.every((b, i) => b.x === t2.boxes[i].x && b.top === t2.boxes[i].top);
if (!same) { fail++; console.log('시드 재현 실패'); }
console.log(fail ? `실패 ${fail}건` : '통과');
process.exit(fail ? 1 : 0);
