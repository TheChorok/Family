// 자동 플레이 봇으로 실제 물리(stepPlayer) 기준 정상까지 도달 가능한지 검증 (탑 형태별)
// 실행: node keycap-tower/tests/bot.test.mjs [shaft|spiral]
import { generateTower, DEFAULT_SHAPE } from '../js/layout.js';
import { runFull } from './bot-lib.mjs';

const shapes = process.argv[2] ? [process.argv[2]] : [DEFAULT_SHAPE, 'spiral'];
let fail = 0;
for (const shape of shapes) {
  const tower = generateTower(undefined, shape);
  const r = runFull(tower);
  console.log(`[${shape}] 결과: ${r.ok ? '정상 도달' : '실패'} / 플레이 시간 ${r.time.toFixed(1)}s / 낙하 ${r.falls}회(1.5초 낙하 부활 ${r.timeoutFalls}) / 점프 ${r.jumps} (코요테 ${r.coyoteJumps}) / 목표 ${r.target}/${r.total}`);
  console.log(`[${shape}] 스테이지별 낙하`, JSON.stringify(r.fallByStage));
  if (r.stuck) console.log(`[${shape}] 반복 실패`, JSON.stringify(r.stuck));
  if (!r.ok) fail++;
}
process.exit(fail ? 1 : 0);
