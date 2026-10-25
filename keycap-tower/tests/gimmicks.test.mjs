// 기믹 단위 테스트: 점프대·얼음·컨베이어·꺼짐·축소(키캡)·크기 변화(끼임 방지)·방향 반전
// 실행: node keycap-tower/tests/gimmicks.test.mjs
import { createWorld, createPlayer, stepPlayer, FIXED_DT, JUMP_APEX, apexOf, JUMP_V } from '../js/physics.js';
import { createRules, onLand, tickRules, transformInput, resetRules } from '../js/rules.js';
import { G, BOUNCE_V, SMALL, BIG, CRUMBLE_DELAY, CRUMBLE_RESTORE, SHRINK_TIME, REVERSE_TIME, CONVEYOR_SPEED } from '../js/gimmicks.js';

let fail = 0;
const check = (name, cond, info = '') => { console.log(`${cond ? '✔' : '✘'} ${name} ${info}`); if (!cond) fail++; };
const box = (x, top, z, hx, hz, extra = {}) => ({ x, top, z, hx, hz, h: 1, type: 0, ...extra });
const idle = { mx: 0, mz: 0, jumpPressed: false };

// 게임과 같은 순서로 한 스텝 진행 (규칙 → 입력 변환 → 물리 → 착지 처리)
function sim(p, w, r, steps, input = idle, log) {
  for (let i = 0; i < steps; i++) {
    tickRules(r, p, FIXED_DT);
    const m = transformInput(r, input.mx, input.mz);
    const ev = stepPlayer(p, { mx: m.mx, mz: m.mz, jumpPressed: !!input.jumpPressed && i === 0 }, w, FIXED_DT);
    if (ev.landed) onLand(r, p, ev.landBox);
    if (log) log(p, ev, i);
  }
}
function setup(boxes, statics = []) {
  const w = createWorld(boxes, statics);
  return { w, r: createRules(w) };
}

// 1) 점프대: 착지하면 약 4.3m 튕김
{
  const { w, r } = setup([box(0, 0, 0, 1, 1, { g: G.BOUNCE })]);
  const p = createPlayer(0, 0.5, 0);
  let maxY = 0, bounces = 0;
  sim(p, w, r, 240, idle, (pp, ev) => { maxY = Math.max(maxY, pp.y); if (ev.bounced) bounces++; });
  check('점프대 튕김 높이 ≈ ' + apexOf(BOUNCE_V).toFixed(2) + 'm', Math.abs(maxY - apexOf(BOUNCE_V)) < 0.1, `최고 ${maxY.toFixed(2)}m, 튕김 ${bounces}회`);
}
// 2) 얼음: 최고 속도에서 손을 떼면 멀리 미끄러짐 (일반 바닥 대비)
function slide(g) {
  const { w, r } = setup([box(0, 0, 0, 40, 2, { g })]);
  const p = createPlayer(-30, 0, 0); sim(p, w, r, 2);
  sim(p, w, r, 240, { mx: 1, mz: 0 });
  const x0 = p.x; sim(p, w, r, 600);
  return p.x - x0;
}
{
  const ice = slide(G.ICE), normal = slide(G.NONE);
  check('얼음 미끄러짐 (손 뗀 뒤 이동 거리)', ice > 4.5 && normal < 0.5, `얼음 ${ice.toFixed(2)}m / 일반 ${normal.toFixed(2)}m`);
}
// 3) 컨베이어: 가만히 있으면 화살표 방향으로 2.5m/s 밀림, 반대로 걸으면 버틸 수 있음
{
  const { w, r } = setup([box(0, 0, 0, 20, 2, { g: G.CONVEYOR, conv: { x: 1, z: 0 } })]);
  const p = createPlayer(0, 0, 0); sim(p, w, r, 2);
  const x0 = p.x; sim(p, w, r, 120);
  check('컨베이어 밀림 속도', Math.abs((p.x - x0) - CONVEYOR_SPEED) < 0.05, `1초에 ${(p.x - x0).toFixed(2)}m`);
  const x1 = p.x; sim(p, w, r, 120, { mx: -1, mz: 0 });
  check('컨베이어 거슬러 걷기 가능', p.x < x1 - 3, `1초에 ${(p.x - x1).toFixed(2)}m`);
}
// 4) 꺼지는 키캡: 1초 뒤 사라지고 4초 뒤 복구
{
  const k = box(0, 0, 0, 1, 1, { g: G.CRUMBLE });
  const { w, r } = setup([k, box(5, -10, 0, 1, 1)]);
  const p = createPlayer(0, 0.3, 0);
  let offAt = null, landT = null, t = 0;
  sim(p, w, r, 400, idle, (pp, ev) => { t += FIXED_DT; if (ev.landed && landT === null) landT = t; if (k.off && offAt === null) offAt = t; });
  check('꺼지는 키캡: 착지 1초 뒤 사라짐', offAt !== null && Math.abs(offAt - landT - CRUMBLE_DELAY) < 0.02, `${(offAt - landT).toFixed(2)}초`);
  check('사라지면 캐릭터 낙하', p.y < -1);
  // 캐릭터를 멀리 옮기고 복구 확인
  Object.assign(p, { x: 5, y: -9, z: 0 });
  let restoreAt = null;
  sim(p, w, r, 600, idle, () => { t += FIXED_DT; if (!k.off && restoreAt === null && k.cr === null) restoreAt = t; });
  check('꺼지는 키캡: 4초 뒤 복구', restoreAt !== null && Math.abs(restoreAt - offAt - CRUMBLE_RESTORE) < 0.05, `${(restoreAt - offAt).toFixed(2)}초`);
}
// 5) 줄어드는 키캡: 서 있는 동안 3초에 걸쳐 사라짐, 떠나면 복구
{
  const k = box(0, 0, 0, 0.9, 0.9, { g: G.SHRINK });
  const { w, r } = setup([k, box(4, 0, 0, 1, 1)]);
  const p = createPlayer(0, 0.05, 0);
  let t = 0, goneAt = null, landT = null;
  sim(p, w, r, 480, idle, (pp, ev) => { t += FIXED_DT; if (ev.landed && landT === null) landT = t; if (k.off && goneAt === null) goneAt = t; });
  check('줄어드는 키캡: 서 있으면 3초 뒤 사라짐', goneAt !== null && Math.abs(goneAt - landT - SHRINK_TIME) < 0.05, `${(goneAt - landT).toFixed(2)}초`);
  // 다른 발판으로 옮기면 복구
  Object.assign(p, { x: 4, y: 0.05, z: 0, vy: 0 });
  sim(p, w, r, 180);
  check('떠나면 복구 (1초)', !k.off && k.shrinkK === 1 && Math.abs(k.hx - 0.9) < 1e-9, `k=${k.shrinkK}`);
  // 2초 서 있다가 떠나면 사라지지 않고 원래대로
  Object.assign(p, { x: 0, y: 0.05, z: 0, vy: 0 });
  sim(p, w, r, 240);
  const mid = k.hx;
  Object.assign(p, { x: 4, y: 0.05, z: 0, vy: 0 });
  sim(p, w, r, 180);
  check('도중에 떠나면 줄다가 복구', mid < 0.5 && mid > 0.1 && k.hx === 0.9 && !k.off, `중간 ${mid.toFixed(2)} → ${k.hx}`);
}
// 6) '－' 축소 / '＋' 확대: 충돌박스·점프력 연동, 8초 뒤 복구
function jumpApex(p, w, r) {
  sim(p, w, r, 2);
  const y0 = p.y; let maxY = y0;
  sim(p, w, r, 150, { mx: 0, mz: 0, jumpPressed: true }, (pp) => { maxY = Math.max(maxY, pp.y); });
  return maxY - y0;
}
{
  const { w, r } = setup([box(0, 0, 0, 6, 6), box(9, 0, 0, 1, 1, { g: G.MINUS }), box(-9, 0, 0, 1, 1, { g: G.PLUS })]);
  const p = createPlayer(9, 0.1, 0);
  sim(p, w, r, 30);
  const smallApex = jumpApex(p, w, r);
  check('축소: 0.6배 충돌박스 + 점프 약해짐', Math.abs(p.hw - 0.21) < 1e-9 && Math.abs(smallApex - apexOf(JUMP_V * SMALL.jump)) < 0.08, `폭 ${p.hw.toFixed(2)}, 점프 ${smallApex.toFixed(2)}m`);
  Object.assign(p, { x: -9, y: 0.1, z: 0, vy: 0 });
  sim(p, w, r, 30);
  const bigApex = jumpApex(p, w, r);
  check('확대: 1.5배 충돌박스 + 점프 강해짐 (효과 교체)', Math.abs(p.h - 2.4) < 1e-9 && Math.abs(bigApex - apexOf(JUMP_V * BIG.jump)) < 0.1, `키 ${p.h.toFixed(2)}, 점프 ${bigApex.toFixed(2)}m`);
  Object.assign(p, { x: 0, y: 0.05, z: 0, vy: 0 });
  sim(p, w, r, Math.ceil(8 / FIXED_DT) + 5);
  check('8초 뒤 원래 크기', p.scale === 1 && Math.abs(p.h - 1.6) < 1e-9);
}
// 7) 확대 끼임 방지: 천장 아래·벽 옆에서 커져도 박스와 겹치지 않음
{
  // 벽 바로 옆에서 확대 → 벽에서 밀려남
  const wall = { x: 2.5, z: 0, hx: 0.5, hz: 10, top: 50, h: 60, wall: true };
  const { w, r } = setup([box(0, 0, 0, 3, 3), box(1.4, 0.001, 0, 0.6, 1, { g: G.PLUS })], [wall]);
  const p = createPlayer(1.65, 0.1, 0);
  sim(p, w, r, 20);
  const overlapWall = p.x + p.hw > wall.x - wall.hx + 1e-6;
  check('벽 옆 확대: 벽과 겹치지 않음', p.scale === BIG.scale && !overlapWall, `x=${p.x.toFixed(3)} 오른쪽 끝 ${(p.x + p.hw).toFixed(3)} / 벽 ${wall.x - wall.hx}`);
  // 낮은 천장 아래에서 확대 → 공간이 없으면 미뤘다가 나오면 커짐
  const { w: w2, r: r2 } = setup([box(0, 0, 0, 6, 2), box(0, 3.6, 0, 1.5, 2, { h: 1.6 }), box(0, 0.001, 0, 0.5, 0.5, { g: G.PLUS })]);
  const p2 = createPlayer(0, 0.2, 0);
  sim(p2, w2, r2, 20);
  const deferred = p2.scale === 1;
  sim(p2, w2, r2, 120, { mx: 1, mz: 0 });
  check('천장 아래 확대: 끼지 않게 미룬 뒤, 빠져나오면 확대', deferred && p2.scale === BIG.scale, `미룸=${deferred}, 이후 scale=${p2.scale}`);
  // 축소 상태에서 좁은 곳에 들어간 뒤 효과 종료 → 복구 시 끼지 않음
  const { w: w3, r: r3 } = setup([box(0, 0, 0, 6, 2), box(0, 3.0, 0, 3, 2, { h: 1.6 }), box(-4, 0.001, 0, 0.5, 0.5, { g: G.MINUS })]);
  const p3 = createPlayer(-4, 0.2, 0);
  sim(p3, w3, r3, 20);
  sim(p3, w3, r3, 60, { mx: 1, mz: 0 });           // 높이 1.4m 틈 아래로 걸어 들어감 (작아서 가능)
  const under = p3.x > -3 && p3.scale === SMALL.scale;
  sim(p3, w3, r3, Math.ceil(8 / FIXED_DT));          // 틈 아래에서 효과 종료 시점 도달
  const stillSmall = p3.scale === SMALL.scale;
  sim(p3, w3, r3, 300, { mx: 1, mz: 0 });           // 틈을 빠져나가면 복구
  check('좁은 틈 아래 축소 종료: 끼지 않게 미룬 뒤 나와서 복구', under && stillSmall && p3.scale === 1, `틈 아래=${under}, 대기=${stillSmall}, 최종 ${p3.scale}`);
}
// 8) 방향 반전: 5초 동안 입력이 거꾸로
{
  const { w, r } = setup([box(0, 0, 0, 20, 2), box(0, 0.001, 0, 0.5, 0.5, { g: G.REVERSE })]);
  const p = createPlayer(0, 0.2, 0);
  sim(p, w, r, 10);
  const x0 = p.x; sim(p, w, r, 60, { mx: 1, mz: 0 });
  const reversed = p.x < x0;
  sim(p, w, r, Math.ceil(REVERSE_TIME / FIXED_DT));
  const x1 = p.x; sim(p, w, r, 60, { mx: 1, mz: 0 });
  check('방향 반전 5초 후 정상', reversed && p.x > x1, `반전 중 ${(p.x - x0).toFixed(2)}`);
}
// 9) 부활 시 초기화
{
  const k = box(0, 0, 0, 1, 1, { g: G.CRUMBLE });
  const { w, r } = setup([k]);
  const p = createPlayer(0, 0.1, 0);
  sim(p, w, r, 200);
  r.reverseT = 3; r.sizeT = 5;
  resetRules(r, p);
  check('부활 시 키캡·효과 초기화', !k.off && k.cr === null && r.reverseT === 0 && p.scale === 1);
}
console.log(fail ? `실패 ${fail}건` : '전체 통과');
process.exit(fail ? 1 : 0);
