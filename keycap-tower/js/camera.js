// 3인칭 오빗 카메라: 드래그로 회전, 키캡에 가려지면 거리를 줄여 캐릭터가 보이게 함
import * as THREE from 'three';
import { raycastBoxes } from './physics.js';

const DIST = 7.5;
const MIN_DIST = 1.6;
const PITCH_MIN = -0.35;
const PITCH_MAX = 1.25;

export class FollowCamera {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0;
    this.pitch = 0.42;
    this.dist = DIST;
    this.target = new THREE.Vector3();
    this.first = true;
  }

  // 화면 드래그 픽셀 → 회전
  rotate(dx, dy) {
    this.yaw -= dx * 0.0065;
    this.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, this.pitch + dy * 0.005));
  }

  // 캐릭터가 바라보는 방향(facingYaw, sin=x/cos=z 기준) 뒤쪽으로 카메라 배치
  setBehind(facingYaw) {
    this.yaw = facingYaw + Math.PI;
    this.pitch = 0.42;
    this.first = true;
  }

  // 조이스틱 입력(x=오른쪽, y=앞) → 월드 이동 방향
  moveDir(mx, my) {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    // 앞 = 카메라→캐릭터 방향 (-sin, -cos), 오른쪽 = (cos, -sin)
    return { x: c * mx - s * my, z: -s * mx - c * my };
  }

  update(dt, p, world) {
    const tx = p.x, ty = p.y + 1.3, tz = p.z;
    if (this.first) { this.target.set(tx, ty, tz); this.first = false; }
    // 목표점은 약간 지연 추적 (수직은 더 부드럽게)
    const kx = 1 - Math.exp(-dt * 16), ky = 1 - Math.exp(-dt * 8);
    this.target.x += (tx - this.target.x) * kx;
    this.target.z += (tz - this.target.z) * kx;
    this.target.y += (ty - this.target.y) * ky;

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const ox = Math.sin(this.yaw) * cp, oy = sp, oz = Math.cos(this.yaw) * cp;
    const t = this.target;
    // 가림 검사: 목표 → 원하는 카메라 위치
    const hit = raycastBoxes(world, t.x, t.y, t.z, t.x + ox * DIST, t.y + oy * DIST, t.z + oz * DIST);
    const want = Math.max(MIN_DIST, hit * DIST - 0.35);
    // 가까워질 땐 즉시, 멀어질 땐 천천히
    if (want < this.dist) this.dist = want;
    else this.dist += (want - this.dist) * (1 - Math.exp(-dt * 3));

    this.camera.position.set(t.x + ox * this.dist, t.y + oy * this.dist, t.z + oz * this.dist);
    this.camera.lookAt(t);
  }
}
