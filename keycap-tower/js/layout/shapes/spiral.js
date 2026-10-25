// 탑 형태: 나선 (1단계 원래 형태, 테스트·향후 선택용으로 보존)
// 경로 매개변수 s = 나선 각도(rad)

function radiusAt(theta) {
  return 8 + 1.2 * Math.sin(theta * 0.9);
}

export const spiral = {
  name: 'spiral',
  startS: 0,
  search: { start: 0.05, step: 0.004, max: 3.0 },
  ground: { hx: 14, hz: 14 },
  // 키캡마다 반지름을 조금씩 흔듦
  jitter: (rng) => rng() * 0.8 - 0.4,

  place(s, type, jit) {
    const r = radiusAt(s) + jit;
    const x = Math.cos(s) * r, z = Math.sin(s) * r;
    // 접선 방향으로 긴 키를 정렬 (AABB 유지를 위해 0/90도만 사용)
    const t = this.tangent(s);
    return { x, z, rot: Math.abs(t.z) > Math.abs(t.x) ? 1 : 0, side: 0 };
  },

  tangent(s) {
    return { x: -Math.sin(s), z: Math.cos(s) };
  },

  // 움직이는 키캡: 직전 키캡에서 오는 방향의 수직(좌우) 방향으로, 기준점 중심 왕복
  moveAxis(prev, nb) {
    const vx = nb.x - (prev.moving ? prev.moving.ox : prev.x);
    const vz = nb.z - (prev.moving ? prev.moving.oz : prev.z);
    const l = Math.hypot(vx, vz) || 1;
    return { ax: -vz / l, az: vx / l, bias: 0 };
  },

  fits: () => true,

  spawn(first) {
    const x = first.x - 0.3, z = first.z - 3.2;
    return { x, z, yaw: Math.atan2(first.x - x, first.z - z) };
  },
};
