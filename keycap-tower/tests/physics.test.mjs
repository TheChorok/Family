// 물리 단위 테스트: 착지, 코요테 타임, 점프 버퍼, 측면/머리 충돌, 움직이는 발판
// 실행: node keycap-tower/tests/physics.test.mjs
import { createWorld, createPlayer, stepPlayer, updateMovers, FIXED_DT, JUMP_APEX, PLAYER_HW } from '../js/physics.js';

let fail = 0;
const check = (name, cond, info = '') => { console.log(`${cond ? '✔' : '✘'} ${name} ${info}`); if (!cond) fail++; };
const box = (x, top, z, hx, hz, h = 1, extra = {}) => ({ x, top, z, hx, hz, h, type: 0, ...extra });
const idle = { mx: 0, mz: 0, jumpPressed: false };
function run(p, w, steps, input = idle) { let ev = []; for (let i = 0; i < steps; i++) ev.push(stepPlayer(p, input, w, FIXED_DT)); return ev; }

// 1) 착지 및 정지
{
  const w = createWorld([box(0, 0, 0, 2, 2)]);
  const p = createPlayer(0, 3, 0);
  const evs = run(p, w, 120);
  check('낙하 후 윗면 착지', p.grounded && Math.abs(p.y) < 1e-6, `y=${p.y.toFixed(4)}`);
  check('착지 이벤트 1회', evs.filter((e) => e.landed).length === 1);
}
// 2) 점프 높이
{
  const w = createWorld([box(0, 0, 0, 2, 2)]);
  const p = createPlayer(0, 0, 0); run(p, w, 2);
  let maxY = 0;
  stepPlayer(p, { mx: 0, mz: 0, jumpPressed: true }, w, FIXED_DT);
  for (let i = 0; i < 120; i++) { stepPlayer(p, idle, w, FIXED_DT); maxY = Math.max(maxY, p.y); }
  check('점프 최고 높이 ≈ 이론값', Math.abs(maxY - JUMP_APEX) < 0.06, `${maxY.toFixed(3)} vs ${JUMP_APEX.toFixed(3)}`);
}
// 3) 코요테 타임: 가장자리를 벗어난 뒤 일정 시간 안에는 점프 가능
function coyoteTrial(delaySteps) {
  const w = createWorld([box(0, 0, 0, 1, 1)]);
  const p = createPlayer(0, 0, 0); run(p, w, 2);
  const right = { mx: 1, mz: 0, jumpPressed: false };
  let n = 0; while (p.grounded && n++ < 500) stepPlayer(p, right, w, FIXED_DT);
  run(p, w, delaySteps, right);
  const ev = stepPlayer(p, { mx: 1, mz: 0, jumpPressed: true }, w, FIXED_DT);
  return ev.jumped;
}
check('코요테: 발판 이탈 0.05초 후 점프 성공', coyoteTrial(6));
check('코요테: 발판 이탈 0.15초 후 점프 불가', !coyoteTrial(18));
// 4) 점프 버퍼: 착지 직전 입력 기억
function bufferTrial(stepsBeforeLand) {
  const w = createWorld([box(0, 0, 0, 2, 2)]);
  const p = createPlayer(0, 0, 0); run(p, w, 2);
  stepPlayer(p, { mx: 0, mz: 0, jumpPressed: true }, w, FIXED_DT);
  // 착지까지 남은 스텝 수 계산 후 그 직전에 입력
  const sim = { ...p }; let k = 0;
  while (!sim.grounded && k < 500) { stepPlayer(sim, idle, w, FIXED_DT); k++; }
  run(p, w, k - stepsBeforeLand - 1);
  stepPlayer(p, { mx: 0, mz: 0, jumpPressed: true }, w, FIXED_DT);
  const evs = run(p, w, stepsBeforeLand + 2);
  return evs.some((e) => e.jumped);
}
check('버퍼: 착지 0.08초 전 입력 → 착지 즉시 점프', bufferTrial(10));
check('버퍼: 착지 0.2초 전 입력 → 무시', !bufferTrial(24));
// 5) 측면 충돌: 벽을 뚫지 않음
{
  const w = createWorld([box(0, 0, 0, 10, 10), box(2, 3, 0, 0.5, 2, 3)]);
  const p = createPlayer(0, 0, 0); run(p, w, 2);
  run(p, w, 120, { mx: 1, mz: 0, jumpPressed: false });
  check('측면 충돌 정지', Math.abs(p.x - (1.5 - PLAYER_HW)) < 1e-3, `x=${p.x.toFixed(3)}`);
}
// 6) 머리 충돌: 위 박스에 막혀 상승 중단
{
  const w = createWorld([box(0, 0, 0, 3, 3), box(0, 3, 0, 1, 1, 1)]);
  const p = createPlayer(0, 0, 0); run(p, w, 2);
  stepPlayer(p, { mx: 0, mz: 0, jumpPressed: true }, w, FIXED_DT);
  let maxY = 0; for (let i = 0; i < 120; i++) { stepPlayer(p, idle, w, FIXED_DT); maxY = Math.max(maxY, p.y); }
  check('머리 충돌 (천장 2m → 발 최고 0.4m)', maxY <= 0.4 + 1e-3 && p.grounded, `maxY=${maxY.toFixed(3)}`);
}
// 7) 움직이는 발판 위에서 함께 이동
{
  const mover = box(0, 0, 0, 1, 1, 1, { moving: { ox: 0, oz: 0, ax: 1, az: 0, amp: 2, speed: 1, phase: 0 } });
  const w = createWorld([mover]);
  const p = createPlayer(0, 0.5, 0);
  let t = 0, off = 0, rel = null;
  for (let i = 0; i < 240; i++) {
    updateMovers(w, t); stepPlayer(p, idle, w, FIXED_DT); t += FIXED_DT;
    // 착지 순간의 상대 위치를 기준으로 이후 변화량 측정
    if (p.grounded && rel === null) rel = p.x - mover.x;
    if (rel !== null) off = Math.max(off, Math.abs(p.x - mover.x - rel));
  }
  check('움직이는 발판 동승 (상대 위치 유지)', p.grounded && off < 0.02, `오차=${off.toFixed(4)}`);
}
// 8) 통로 벽(고정 충돌체): 높은 곳에서도 항상 충돌, 모서리에 끼지 않음
{
  const H = 6.5, top = 200, h = 210;
  const walls = [
    { x: H + 0.5, z: 0, hx: 0.5, hz: H + 1, top, h, wall: true },
    { x: -H - 0.5, z: 0, hx: 0.5, hz: H + 1, top, h, wall: true },
    { x: 0, z: H + 0.5, hx: H + 1, hz: 0.5, top, h, wall: true },
    { x: 0, z: -H - 0.5, hx: H + 1, hz: 0.5, top, h, wall: true },
  ];
  // 높이 150m 발판 위에서 동쪽 벽으로 달리기 → 벽 앞에서 멈춤
  const w = createWorld([box(0, 150, 0, H, H)], walls);
  const p = createPlayer(0, 150, 0); run(p, w, 2);
  run(p, w, 200, { mx: 1, mz: 0, jumpPressed: false });
  check('벽 충돌 (높이 150m)', Math.abs(p.x - (H - PLAYER_HW)) < 1e-3, `x=${p.x.toFixed(3)}`);
  // 북동 모서리로 대각선 돌진 후 반대 방향으로 빠져나오기
  run(p, w, 200, { mx: 0.7, mz: 0.7, jumpPressed: false });
  const inCorner = Math.abs(p.x - (H - PLAYER_HW)) < 1e-3 && Math.abs(p.z - (H - PLAYER_HW)) < 1e-3;
  run(p, w, 60, { mx: -0.7, mz: -0.7, jumpPressed: false });
  check('모서리에 끼지 않고 빠져나옴', inCorner && p.x < H - 2 && p.z < H - 2, `x=${p.x.toFixed(2)} z=${p.z.toFixed(2)}`);
  // 벽에 붙은 채 점프해도 벽에 걸리지 않고 정상 높이까지 올라감
  run(p, w, 200, { mx: 1, mz: 0, jumpPressed: false });
  stepPlayer(p, { mx: 1, mz: 0, jumpPressed: true }, w, FIXED_DT);
  let maxY = 0; for (let i = 0; i < 120; i++) { stepPlayer(p, { mx: 1, mz: 0, jumpPressed: false }, w, FIXED_DT); maxY = Math.max(maxY, p.y - 150); }
  check('벽에 붙어 점프 (벽 마찰 없음)', Math.abs(maxY - JUMP_APEX) < 0.06 && p.grounded, `최고 ${maxY.toFixed(2)}m`);
}
console.log(fail ? `실패 ${fail}건` : '전체 통과');
process.exit(fail ? 1 : 0);
