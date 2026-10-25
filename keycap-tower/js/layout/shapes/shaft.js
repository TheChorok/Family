// 탑 형태: 네모난 통로 안쪽 벽면
// 정사각 통로(안쪽 한 변 2H)의 네 벽을 따라 키캡이 붙어 있고, 모서리에서 꺾어 돌며 오른다.
// 경로 매개변수 s = 벽을 따라 잰 둘레 거리(m), 반시계 방향(동 → 북 → 서 → 남)
import { KEY_DIMS, KEY_TYPES } from '../core.js';

export const SHAFT_HALF = 6.5;          // 벽 안쪽 반폭 (안쪽 한 변 13m)
const H = SHAFT_HALF;
const P = H - 0.9;                      // 일반 키 중심선의 반폭
const SIDE = 2 * P;                     // 한 변의 경로 길이
const WALL_T = 1;                       // 벽 두께
// 모서리 칸(벽 두 면이 만나는 1.8m×1.8m)은 비워 둔다.
// 모서리 칸에 키캡을 두면 그 앞뒤 키캡(i, i+2)이 대각선으로 너무 가까워져 지름길이 생기기 때문.
// 대신 양쪽 벽 키캡 사이를 대각선으로 꺾어 뛰는 '모서리 점프'가 경로가 된다.
const CORNER = 1.8;

// 변(side)별 안쪽 법선과 진행 방향
// 0: 동쪽 벽(x=+H), +z 방향 / 1: 북쪽 벽(z=+H), -x 방향 / 2: 서쪽 벽(x=-H), -z 방향 / 3: 남쪽 벽(z=-H), +x 방향
const NORMAL = [[-1, 0], [0, -1], [1, 0], [0, 1]];
const TANGENT = [[0, 1], [-1, 0], [0, -1], [1, 0]];

function sideOf(s) {
  const L = 4 * SIDE;
  const u = ((s % L) + L) % L;
  const side = Math.min(3, Math.floor(u / SIDE));
  return { side, t: u - side * SIDE - P };   // t: 변 위 위치 (-P ~ P)
}

export const shaft = {
  name: 'shaft',
  startS: 0.3 * SIDE,
  search: { start: 0.3, step: 0.02, max: 22 },
  ground: { hx: H, hz: H },

  place(s, type) {
    const { side, t } = sideOf(s);
    const d = KEY_DIMS[type];
    const along = d.hx, depth = d.hz;          // 긴 변을 벽과 나란히
    const n = H - depth;                       // 벽에 붙도록 중심을 벽에서 depth만큼 안쪽에
    // 모서리 칸을 침범하지 않는 범위. 단, 스페이스바(체크포인트·정상)는 길이가 7m 이상이라
    // 모서리 칸을 써도 앞뒤 키캡이 멀어 지름길이 생기지 않으므로 벽 끝까지 허용한다.
    const long = type === KEY_TYPES.SPACE || type === KEY_TYPES.GOAL;
    const lim = H - (long ? 0 : CORNER) - along;
    if (Math.abs(t) > lim) return null;        // 이 위치는 배치 불가 (생성기가 건너뜀)
    const tc = t;
    let x, z;
    if (side === 0) { x = n; z = tc; }
    else if (side === 1) { x = -tc; z = n; }
    else if (side === 2) { x = -n; z = -tc; }
    else { x = tc; z = -n; }
    // 동·서 벽은 벽이 z축과 나란하므로 90도 회전 (hx↔hz)
    return { x, z, rot: side === 0 || side === 2 ? 1 : 0, side, edge: lim - Math.abs(t) };
  },

  tangent(s) {
    const [x, z] = TANGENT[sideOf(s).side];
    return { x, z };
  },

  normal(s) {
    const [x, z] = NORMAL[sideOf(s).side];
    return { x, z };
  },

  // 움직이는 키캡: 벽에서 안쪽으로 튀어나왔다 들어가는 피스톤 (벽을 뚫지 않게 한쪽으로만)
  // 모서리 가까이(1.5m 이내)에서는 튀어나온 키캡이 옆 벽 경로와 가까워져 지름길을 만들므로 움직이지 않는다.
  // 진폭 상한 1.0m(최대 2m 돌출): 반대편 벽까지 거리를 충분히 남긴다.
  maxAmp: 1.0,
  moveAxis(prev, nb) {
    if (nb.edge < 1.5) return null;
    const [ax, az] = NORMAL[nb.side];
    return { ax, az, bias: 1 };
  },

  // 이동 범위까지 포함해 통로 안에 들어가는지
  fits(nb) {
    let hx = nb.hx, hz = nb.hz, cx = nb.x, cz = nb.z;
    if (nb.moving) {
      const m = nb.moving;
      cx = m.ox; cz = m.oz;
      hx += Math.abs(m.ax) * m.amp; hz += Math.abs(m.az) * m.amp;
    }
    const e = 1e-6;
    return cx - hx >= -H - e && cx + hx <= H + e && cz - hz >= -H - e && cz + hz <= H + e;
  },

  // 시작 위치: 첫 키캡에서 통로 안쪽으로 3.2m, 진행 반대쪽으로 1m
  spawn(first) {
    const [nx, nz] = NORMAL[first.side], [tx, tz] = TANGENT[first.side];
    const x = first.x + nx * 3.2 - tx * 1.0, z = first.z + nz * 3.2 - tz * 1.0;
    return { x, z, yaw: Math.atan2(first.x - x, first.z - z) };
  },

  // 벽 4장 (아주 높은 고정 충돌체)
  statics(topY) {
    const top = topY + 12, h = topY + 16;
    const w = (x, z, hx, hz) => ({ x, z, hx, hz, top, h, type: 5, wall: true, dx: 0, dz: 0 });
    return [
      w(H + WALL_T / 2, 0, WALL_T / 2, H + WALL_T),
      w(-H - WALL_T / 2, 0, WALL_T / 2, H + WALL_T),
      w(0, H + WALL_T / 2, H + WALL_T, WALL_T / 2),
      w(0, -H - WALL_T / 2, H + WALL_T, WALL_T / 2),
    ];
  },

  view(topY) {
    return { kind: 'shaft', half: H, wallTop: topY + 12, wallT: WALL_T };
  },
};
