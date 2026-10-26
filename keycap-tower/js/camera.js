// 3인칭 오빗 카메라 (로블록스식)
//  1) 드래그로 좌우 360° 자유 회전, 상하는 바닥 아래·바로 위만 제외
//  2) 캐릭터와 카메라 사이에 키캡·벽이 오면 카메라를 캐릭터 쪽으로 당김
//  3) 벽 때문에 MIN_DIST(1.5m)보다 더 당겨야 하면 거기서 멈추고, 그 벽은 반투명 (tower.js updateWalls)
//  4) 핀치(폰)·마우스 휠(PC)로 카메라 거리 조절 (3~12m, 저장: kt_camdist)
//  5) 당겨질 때는 빠르게, 돌아올 때는 천천히 부드럽게
import * as THREE from 'three';
import { BUCKET, MAX_BOX_H } from './physics.js';

export const DIST = 7.5;           // 기본 거리
export const ZOOM_MIN = 3;
export const ZOOM_MAX = 12;
const MIN_DIST = 1.5;              // 이보다 더 당기지 않음 (벽은 반투명 처리)
const PITCH_MIN = -0.6;            // 아래에서 올려다보기 한계 (약 -34°)
const PITCH_MAX = 1.35;            // 위에서 내려다보기 한계 (약 77°, 바로 위 제외)
const KEY_PAD = 0.35;              // 가린 키캡 앞에 카메라를 둘 여유
const WALL_PAD = 0.3;              // 벽 안쪽 면 앞에 카메라를 둘 여유
const PULL_RATE = 30;              // 당겨질 때 보간 속도 (약 0.03초)
const PULL_LAG = 0.25;             // 당겨질 때 목표보다 최대 이만큼만 늦게 따라감 (KEY_PAD 안쪽 → 키캡에 가리지 않음)
const BODY_DROP = 0.5;             // 몸통 확인점: 목표점(머리 쪽)보다 이만큼 아래
const RETURN_W = 5;                // 돌아올 때 스프링 세기 (임계 감쇠: 출발·도착 모두 부드러움)
const RETURN_MAX_SPEED = 10;       // 돌아올 때 최대 속도 (m/s) — 멀리 당겨졌다 돌아와도 휙 튀지 않게

// 카메라 가림 검사용 광선: 키캡만 검사 (사라진 키캡 제외, 벽은 따로 평면으로 계산)
// 반환: 0~1 (처음 닿는 지점의 비율, 안 닿으면 1)
const _mn = [0, 0, 0], _mx = [0, 0, 0], _o = [0, 0, 0], _d = [0, 0, 0];
export function raycastKeys(world, ox, oy, oz, ex, ey, ez) {
  _o[0] = ox; _o[1] = oy; _o[2] = oz;
  _d[0] = ex - ox; _d[1] = ey - oy; _d[2] = ez - oz;
  let best = 1;
  const k0 = Math.floor((Math.min(oy, ey) - 0.5) / BUCKET);
  const k1 = Math.floor((Math.max(oy, ey) + 0.5 + MAX_BOX_H) / BUCKET);
  for (let k = k0; k <= k1; k++) {
    const list = world.buckets.get(k);
    if (!list) continue;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.off) continue;
      _mn[0] = b.x - b.hx; _mx[0] = b.x + b.hx;
      _mn[1] = b.top - b.h; _mx[1] = b.top;
      _mn[2] = b.z - b.hz; _mx[2] = b.z + b.hz;
      let t0 = 0, t1 = best, j = 0;
      for (; j < 3; j++) {
        const o = _o[j], d = _d[j];
        if (Math.abs(d) < 1e-8) { if (o < _mn[j] || o > _mx[j]) break; continue; }
        let ta = (_mn[j] - o) / d, tb = (_mx[j] - o) / d;
        if (ta > tb) { const q = ta; ta = tb; tb = q; }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1) break;
      }
      if (j === 3 && t0 > 0 && t0 < best) best = t0;
    }
  }
  return best;
}

export class FollowCamera {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0;
    this.pitch = 0.42;
    this.zoom = DIST;          // 사용자가 정한 거리 (핀치·휠)
    this.dist = DIST;          // 실제 거리 (가림 때문에 당겨질 수 있음)
    this.distV = 0;            // 거리 변화 속도 (복귀 스프링용)
    this.blocked = false;      // 이번 프레임에 당겨졌는지 (테스트·디버그용)
    this.target = new THREE.Vector3();
    this.first = true;
    this.view = { kind: 'spiral' };
  }

  setView(view) {
    this.view = view || { kind: 'spiral' };
    if (this.view.kind === 'shaft') this.pitch = 0.5;
  }

  // 화면 드래그 픽셀 → 회전 (좌우 무제한)
  rotate(dx, dy) {
    this.yaw -= dx * 0.0065;
    this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));
    this.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, this.pitch + dy * 0.005));
  }

  // 거리 조절: factor < 1 이면 가까이 (핀치 벌림·휠 위로), > 1 이면 멀리
  zoomBy(factor) {
    this.setZoom(this.zoom * factor);
  }
  setZoom(z) {
    if (!(z > 0)) return;
    this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
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

  // 조이스틱 입력(x=오른쪽, y=앞) → 월드 이동 방향 (항상 현재 카메라 방향 기준)
  moveDir(mx, my) {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    // 앞 = 카메라→캐릭터 방향 (-sin, -cos), 오른쪽 = (cos, -sin)
    return { x: c * mx - s * my, z: -s * mx - c * my };
  }

  // 목표점 t에서 방향 (ox,oy,oz)로 거리 d만큼 갈 때, 가림 없이 둘 수 있는 거리
  clearDist(world, t, ox, oy, oz, d) {
    let want = d;
    // 키캡: 가린 키캡 앞까지 당김 (머리 쪽 목표점 기준)
    const hit = raycastKeys(world, t.x, t.y, t.z, t.x + ox * d, t.y + oy * d, t.z + oz * d);
    if (hit < 1) want = Math.min(want, hit * d - KEY_PAD);
    // 몸통까지도 보이게: 카메라 후보 위치 → 몸통 선분이 키캡에 막히면 막힌 지점까지 더 당김 (최대 3회)
    const by = t.y - BODY_DROP;
    for (let i = 0; i < 3 && want > MIN_DIST; i++) {
      const cx = t.x + ox * want, cy = t.y + oy * want, cz = t.z + oz * want;
      const f = raycastKeys(world, t.x, by, t.z, cx, cy, cz);
      if (f >= 1) break;
      want = Math.min(want - 0.05, f * want - KEY_PAD);
    }
    // 통로 벽: 안쪽 면 앞까지 당김 (통로는 볼록한 공간이라 벽 안쪽에 있으면 벽에 가리지 않음)
    if (this.view.kind === 'shaft') {
      const lim = this.view.half - WALL_PAD;
      for (const [o, c] of [[ox, t.x], [oz, t.z]]) {
        if (Math.abs(o) < 1e-6) continue;
        const room = ((o > 0 ? lim : -lim) - c) / o;
        if (room < want) want = room;
      }
    }
    // MIN_DIST보다는 당기지 않음 → 벽 바깥으로 나가면 그 벽은 반투명 처리됨
    return Math.max(MIN_DIST, want);
  }

  update(dt, p, world) {
    const tx = p.x, ty = p.y + 1.3 * (p.scale || 1), tz = p.z;   // 커지거나 작아지면 바라보는 높이도 맞춤
    if (this.first) { this.target.set(tx, ty, tz); }
    // 목표점은 약간 지연 추적 (수직은 더 부드럽게)
    const kx = 1 - Math.exp(-dt * 16), ky = 1 - Math.exp(-dt * 8);
    this.target.x += (tx - this.target.x) * kx;
    this.target.z += (tz - this.target.z) * kx;
    this.target.y += (ty - this.target.y) * ky;

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const ox = Math.sin(this.yaw) * cp, oy = sp, oz = Math.cos(this.yaw) * cp;
    const t = this.target;
    const want = this.clearDist(world, t, ox, oy, oz, this.zoom);
    this.blocked = want < this.zoom - 1e-3;
    // 당겨질 때는 빠르게, 돌아올 때는 천천히 (지수 보간이라 튀지 않음)
    if (this.first) { this.dist = want; this.distV = 0; }
    else if (want < this.dist) {
      // 당겨질 때: 빠른 보간 + 늦게 따라가는 정도를 PULL_LAG 이내로 제한 (더 늦으면 가린 키캡 뒤에 카메라가 남음)
      this.dist += (want - this.dist) * (1 - Math.exp(-dt * PULL_RATE));
      if (this.dist > want + PULL_LAG) this.dist = want + PULL_LAG;
      this.distV = 0;
    } else {
      // 돌아올 때: 임계 감쇠 스프링 (속도가 0에서 서서히 붙고, 넘치지 않게 멈춤) + 최대 속도 제한
      const a = RETURN_W * RETURN_W * (want - this.dist) - 2 * RETURN_W * this.distV;
      this.distV = Math.min(RETURN_MAX_SPEED, this.distV + a * dt);
      this.dist = Math.min(want, this.dist + this.distV * dt);
    }
    this.first = false;

    this.camera.position.set(t.x + ox * this.dist, t.y + oy * this.dist, t.z + oz * this.dist);
    this.camera.lookAt(t);
  }
}
