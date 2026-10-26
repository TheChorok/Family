// 기믹 규칙: 꺼지는·줄어드는 키캡 상태, 캐릭터 크기 효과, 방향 반전 타이머
// 게임(main.js)과 봇 테스트가 같은 코드를 써서, 테스트 결과가 실제 게임 규칙과 일치하도록 한다.
import {
  G, CRUMBLE_DELAY, CRUMBLE_RESTORE, SIZE_TIME, SMALL, BIG, SHRINK_TIME, SHRINK_REGROW, REVERSE_TIME,
} from './gimmicks.js';
import { PLAYER_HW, PLAYER_H, JUMP_V, overlaps, forEachNear } from './physics.js';

export function createRules(world) {
  const timed = world.boxes.filter((b) => b.g === G.CRUMBLE || b.g === G.SHRINK);
  for (const b of timed) { b.bhx = b.hx; b.bhz = b.hz; }
  // events: 화면·효과음용 알림 (키캡이 사라짐 등). 게임이 매 프레임 꺼내 쓴다
  const r = { world, timed, sizeT: 0, sizeTarget: 1, reverseT: 0, events: [] };
  resetBoxes(r);
  return r;
}

// 모든 키캡 원상 복구 (부활·처음부터)
export function resetBoxes(r) {
  for (const b of r.timed) {
    b.off = false; b.cr = null; b.shrinkK = 1; b.hx = b.bhx; b.hz = b.bhz;
  }
}

// 부활 시: 키캡 복구 + 효과 해제
export function resetRules(r, p) {
  resetBoxes(r);
  r.events.length = 0;
  r.sizeT = 0; r.sizeTarget = 1; r.reverseT = 0;
  applyScale(p, 1);
}

function applyScale(p, s) {
  const k = s === SMALL.scale ? SMALL.jump : s === BIG.scale ? BIG.jump : 1;
  p.scale = s;
  p.hw = PLAYER_HW * s;
  p.h = PLAYER_H * s;
  p.jumpV = JUMP_V * k;
}

function overlapping(p, world) {
  const out = [];
  forEachNear(world, p.y - 1, p.y + p.h + 1, (b) => { if (overlaps(p, b)) out.push(b); });
  return out;
}

// 크기 변경 시 끼임 방지: 겹치면 ① 위로 밀어 올리기 ② 겹침이 가장 작은 수평 방향으로 밀어내기,
// 그래도 안 되면 크기 변경을 미룬다 (다음 스텝에 다시 시도). 성공하면 true
export function trySetScale(p, s, world) {
  if (p.scale === s) return true;
  const old = { scale: p.scale, x: p.x, y: p.y, z: p.z };
  applyScale(p, s);
  for (let iter = 0; iter < 3; iter++) {
    const hits = overlapping(p, world);
    if (!hits.length) return true;
    // ① 발밑 근처(새 키의 절반 이내)에 걸친 박스면 그 위로 올림
    const lift = Math.max(...hits.map((b) => b.top));
    if (lift - p.y <= p.h * 0.5) {
      const y0 = p.y;
      p.y = lift;
      if (!overlapping(p, world).length) { p.vy = Math.max(0, p.vy); return true; }
      p.y = y0;
    }
    // ② 수평 밀어내기 (가장 작은 침투 방향). 커진 폭만큼만 허용 — 더 밀어야 하면 천장·틈 같은
    //    수직 문제이므로 순간이동처럼 옮기지 않고 크기 변화를 미룬다
    const b = hits[0];
    const pens = [
      [p.x + p.hw - (b.x - b.hx), -1, 0], [b.x + b.hx - (p.x - p.hw), 1, 0],
      [p.z + p.hw - (b.z - b.hz), 0, -1], [b.z + b.hz - (p.z - p.hw), 0, 1],
    ].sort((a, c) => a[0] - c[0]);
    const maxPush = Math.max(0, p.hw - PLAYER_HW * old.scale) + 0.05;
    if (pens[0][0] > maxPush) break;
    p.x += pens[0][1] * (pens[0][0] + 1e-3);
    p.z += pens[0][2] * (pens[0][0] + 1e-3);
  }
  if (!overlapping(p, world).length) return true;
  // 실패: 원래대로 되돌리고 나중에 재시도
  applyScale(p, old.scale);
  p.x = old.x; p.y = old.y; p.z = old.z;
  return false;
}

// 착지 이벤트 처리. 반환: 발동한 효과 이름(없으면 null) — UI·효과음용
export function onLand(r, p, box) {
  switch (box.g) {
    case G.CRUMBLE:
      if (!box.cr) box.cr = { t: 0 };
      return 'crumble';
    case G.MINUS:
      r.sizeT = SIZE_TIME; r.sizeTarget = SMALL.scale;
      trySetScale(p, SMALL.scale, r.world);
      return 'small';
    case G.PLUS:
      r.sizeT = SIZE_TIME; r.sizeTarget = BIG.scale;
      trySetScale(p, BIG.scale, r.world);
      return 'big';
    case G.REVERSE:
      r.reverseT = REVERSE_TIME;
      return 'reverse';
    default:
      return null;
  }
}

// 매 물리 스텝 호출
export function tickRules(r, p, dt) {
  // 꺼지는 키캡: 밟고 1초 뒤 사라짐 → 4초 뒤 복구 (복구 자리에 캐릭터가 있으면 비킬 때까지 대기)
  // 줄어드는 키캡: 서 있는 동안 3초에 걸쳐 작아져 사라짐 → 떠나면 1초에 걸쳐 복구
  for (const b of r.timed) {
    if (b.g === G.CRUMBLE) {
      if (!b.cr) continue;
      b.cr.t += dt;
      if (!b.off && b.cr.t >= CRUMBLE_DELAY) { b.off = true; r.events.push({ type: 'vanish', box: b }); }
      if (b.off && b.cr.t >= CRUMBLE_DELAY + CRUMBLE_RESTORE) {
        b.off = false;
        if (overlaps(p, b)) b.off = true;      // 캐릭터와 겹치면 아직 복구하지 않음
        else b.cr = null;
      }
    } else {
      const standing = p.grounded && p.groundBox === b;
      if (standing) {
        b.shrinkK = Math.max(0, b.shrinkK - dt / SHRINK_TIME);
        if (b.shrinkK <= 0 && !b.off) { b.off = true; r.events.push({ type: 'vanish', box: b }); }
      } else if (b.shrinkK < 1) {
        const k0 = b.shrinkK;
        b.shrinkK = Math.min(1, b.shrinkK + dt / SHRINK_REGROW);
        const wasOff = b.off;
        b.off = false;
        b.hx = b.bhx * Math.max(0.02, b.shrinkK); b.hz = b.bhz * Math.max(0.02, b.shrinkK);
        if (overlaps(p, b)) { b.shrinkK = k0; b.off = wasOff; }   // 자라면서 캐릭터를 밀어내지 않게 대기
      }
      b.hx = b.bhx * Math.max(0.02, b.shrinkK);
      b.hz = b.bhz * Math.max(0.02, b.shrinkK);
    }
  }
  // 크기 효과 시간 경과 → 원래 크기로 (공간이 없으면 생길 때까지 계속 시도)
  if (r.sizeT > 0) {
    r.sizeT -= dt;
    if (r.sizeT <= 0) { r.sizeT = 0; r.sizeTarget = 1; }
  }
  if (p.scale !== r.sizeTarget && trySetScale(p, r.sizeTarget, r.world) && r.sizeTarget === 1) {
    r.events.push({ type: 'sizeEnd' });
  }
  if (r.reverseT > 0) r.reverseT = Math.max(0, r.reverseT - dt);
}

// 방향 반전 중이면 이동 입력을 거꾸로
export function transformInput(r, mx, mz) {
  return r.reverseT > 0 ? { mx: -mx, mz: -mz } : { mx, mz };
}
