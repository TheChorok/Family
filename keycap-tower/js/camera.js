// 3인칭 오빗 카메라: 드래그로 회전, 키캡에 가려지면 거리를 줄여 캐릭터가 보이게 함
// 네모 통로(shaft)에서는 'C 방식'을 쓴다:
//  1) 기본 시점은 통로 중심 쪽에서 벽 쪽 캐릭터를 바라봄 (벽이 캐릭터 뒤에 있어 가려지지 않음)
//  2) 드래그 회전은 허용하되, 가까운 벽 바깥쪽으로 돌아가지 않게 회전 범위를 제한
//  3) 카메라 위치는 통로 안쪽으로 제한 → 통로는 볼록한 공간이라 카메라-캐릭터 사이에 벽이 끼지 않음
//  4) 그래도 벽에 가리는 순간(전환 중 등)에는 그 벽만 반투명 (tower.js updateWalls)
//  5) 위쪽 키캡에 가리면 지금처럼 거리를 줄임
import * as THREE from 'three';
import { raycastBoxes } from './physics.js';

const DIST = 7.5;
const MIN_DIST = 1.6;
const PITCH_MIN = -0.35;
const PITCH_MAX = 1.25;
const WALL_NEAR = 4.0;       // 이 거리 안의 벽에 대해 회전 범위 제한
const MIN_INWARD = 0.15;     // 카메라 방향과 벽 안쪽 방향의 최소 내적 (≈ 벽 법선 기준 ±81°)
const CAM_PAD = 0.4;         // 카메라와 벽 사이 최소 거리

export class FollowCamera {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0;
    this.pitch = 0.42;
    this.dist = DIST;
    this.target = new THREE.Vector3();
    this.first = true;
    this.view = { kind: 'spiral' };
  }

  setView(view) {
    this.view = view || { kind: 'spiral' };
    if (this.view.kind === 'shaft') this.pitch = 0.5;
  }

  // 화면 드래그 픽셀 → 회전
  rotate(dx, dy) {
    this.yaw -= dx * 0.0065;
    this.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, this.pitch + dy * 0.005));
  }

  // 부활·시작 시 기본 시점. facingYaw: 캐릭터가 바라보는 방향(sin=x/cos=z 기준)
  // normal(통로 벽 안쪽 방향)이 있으면 '통로 중심 쪽 + 진행 방향 뒤쪽'에서 비스듬히 바라봄
  setBehind(facingYaw, normal) {
    if (this.view.kind === 'shaft' && normal) {
      const tx = Math.sin(facingYaw), tz = Math.cos(facingYaw);
      const ox = -tx * 0.55 + normal.x * 0.85, oz = -tz * 0.55 + normal.z * 0.85;
      this.yaw = Math.atan2(ox, oz);
      this.pitch = 0.5;
    } else {
      this.yaw = facingYaw + Math.PI;
      this.pitch = 0.42;
    }
    this.first = true;
  }

  // 조이스틱 입력(x=오른쪽, y=앞) → 월드 이동 방향
  moveDir(mx, my) {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    // 앞 = 카메라→캐릭터 방향 (-sin, -cos), 오른쪽 = (cos, -sin)
    return { x: c * mx - s * my, z: -s * mx - c * my };
  }

  // 통로: 가까운 벽 바깥쪽으로 카메라가 돌아가지 않게 yaw 제한 (부드럽게 보정)
  limitYaw(dt, p) {
    const H = this.view.half;
    let ox = Math.sin(this.yaw), oz = Math.cos(this.yaw);
    const walls = [
      [H - p.x, -1, 0], [p.x + H, 1, 0], [H - p.z, 0, -1], [p.z + H, 0, 1],
    ];
    let changed = false;
    for (const [d, nx, nz] of walls) {
      if (d > WALL_NEAR) continue;
      const dot = ox * nx + oz * nz;
      if (dot >= MIN_INWARD) continue;
      // 벽과 나란한 성분의 부호는 유지한 채 안쪽 성분을 MIN_INWARD로 끌어올림
      const tx = -nz, tz = nx;
      const side = Math.sign(ox * tx + oz * tz) || 1;
      const k = Math.sqrt(1 - MIN_INWARD * MIN_INWARD);
      ox = nx * MIN_INWARD + tx * side * k;
      oz = nz * MIN_INWARD + tz * side * k;
      changed = true;
    }
    if (!changed) return;
    const want = Math.atan2(ox, oz);
    let d = want - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, dt * 10);
  }

  // free = true 이면 회전 제한 없음 (타이틀 화면 연출)
  update(dt, p, world, free = false) {
    const shaft = this.view.kind === 'shaft';
    if (shaft && !free) this.limitYaw(dt, p);

    const tx = p.x, ty = p.y + 1.3 * (p.scale || 1), tz = p.z;   // 커지거나 작아지면 바라보는 높이도 맞춤
    if (this.first) { this.target.set(tx, ty, tz); this.first = false; }
    // 목표점은 약간 지연 추적 (수직은 더 부드럽게)
    const kx = 1 - Math.exp(-dt * 16), ky = 1 - Math.exp(-dt * 8);
    this.target.x += (tx - this.target.x) * kx;
    this.target.z += (tz - this.target.z) * kx;
    this.target.y += (ty - this.target.y) * ky;

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const ox = Math.sin(this.yaw) * cp, oy = sp, oz = Math.cos(this.yaw) * cp;
    const t = this.target;
    // 가림 검사: 목표 → 원하는 카메라 위치 (키캡·벽)
    const hit = raycastBoxes(world, t.x, t.y, t.z, t.x + ox * DIST, t.y + oy * DIST, t.z + oz * DIST);
    let want = Math.max(MIN_DIST, hit * DIST - 0.35);
    // 통로 안쪽으로 카메라 위치 제한: 벽 앞에서 멈추도록 거리 자체를 줄임
    if (shaft && !free) {
      const lim = this.view.half - CAM_PAD;
      for (const [o, c] of [[ox, t.x], [oz, t.z]]) {
        if (Math.abs(o) < 1e-6) continue;
        const room = ((o > 0 ? lim : -lim) - c) / o;   // 이 축으로 벽까지 갈 수 있는 거리
        if (room < want) want = Math.max(MIN_DIST, room);
      }
    }
    // 가까워질 땐 즉시, 멀어질 땐 천천히
    if (want < this.dist) this.dist = want;
    else this.dist += (want - this.dist) * (1 - Math.exp(-dt * 3));

    this.camera.position.set(t.x + ox * this.dist, t.y + oy * this.dist, t.z + oz * this.dist);
    this.camera.lookAt(t);
  }
}
