// 오리지널 블록형 캐릭터 '딸깍이' (키캡 머리 + 블록 몸) 와 바닥 그림자 원
import * as THREE from 'three';
import { keycapGeometry } from './tower.js';
import { forEachNear, PLAYER_HW } from './physics.js';

function box(w, h, d, color, y) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.6 }),
  );
  m.position.y = y;
  m.castShadow = true;
  return m;
}

export class PlayerView {
  constructor(scene) {
    this.root = new THREE.Group();
    this.body = new THREE.Group();     // 찌그러짐(스쿼시) 적용용
    this.root.add(this.body);
    scene.add(this.root);

    // 다리
    this.legL = new THREE.Group(); this.legR = new THREE.Group();
    this.legL.position.set(-0.17, 0.55, 0); this.legR.position.set(0.17, 0.55, 0);
    this.legL.add(box(0.26, 0.55, 0.3, 0x34405e, -0.275));
    this.legR.add(box(0.26, 0.55, 0.3, 0x34405e, -0.275));
    // 몸통
    const torso = box(0.68, 0.6, 0.42, 0xff7b5c, 0.85);
    // 팔
    this.armL = new THREE.Group(); this.armR = new THREE.Group();
    this.armL.position.set(-0.43, 1.1, 0); this.armR.position.set(0.43, 1.1, 0);
    this.armL.add(box(0.18, 0.5, 0.22, 0xffd8b0, -0.22));
    this.armR.add(box(0.18, 0.5, 0.22, 0xffd8b0, -0.22));
    // 머리: 작은 키캡 모양
    const headGeo = keycapGeometry(0.27, 0.25, 0.46, 0.07);
    const head = new THREE.Mesh(headGeo, new THREE.MeshStandardMaterial({ color: 0x8fe0d2, vertexColors: true, roughness: 0.5 }));
    head.position.y = 1.62;
    head.castShadow = true;
    // 눈 (앞쪽 +Z)
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1d2433 });
    const eyeGeo = new THREE.BoxGeometry(0.08, 0.12, 0.02);
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(-0.11, 1.38, 0.3);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set(0.11, 1.38, 0.3);
    eyeL.rotation.x = eyeR.rotation.x = -0.15;

    this.body.add(this.legL, this.legR, torso, this.armL, this.armR, head, eyeL, eyeR);
    // 모델 높이(≈1.62)를 충돌 높이 1.6에 맞춤
    this.body.scale.setScalar(0.98);

    // 바닥 그림자 원 (그림자 꺼진 저사양에서도 착지 지점 파악용)
    const blobTex = (() => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 64;
      const g = cv.getContext('2d');
      const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
      gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(cv);
    })();
    this.blob = new THREE.Mesh(
      new THREE.PlaneGeometry(1.2, 1.2),
      new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }),
    );
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.renderOrder = 1;
    scene.add(this.blob);

    this.yaw = 0;
    this.walk = 0;
    this.squash = 0;
  }

  setShadows(on) {
    this.body.traverse((o) => { if (o.isMesh) o.castShadow = on; });
  }

  onLand(strength) {
    this.squash = Math.min(0.28, 0.08 + strength * 0.2);
  }

  update(dt, p, world) {
    this.root.position.set(p.x, p.y, p.z);
    // '－'/'＋' 키캡 크기 변화: 충돌 크기(p.scale)를 부드럽게 따라감 (약 0.15초)
    const cur = this.root.scale.x, want = p.scale || 1;
    this.root.scale.setScalar(Math.abs(want - cur) < 0.002 ? want : cur + (want - cur) * Math.min(1, dt * 14));
    const sp = Math.hypot(p.vx, p.vz);
    // 이동 방향으로 부드럽게 회전
    if (sp > 0.3) {
      const target = Math.atan2(p.vx, p.vz);
      let d = target - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 14);
    }
    this.root.rotation.y = this.yaw;

    // 걷기/점프 자세
    if (p.grounded) {
      this.walk += dt * sp * 2.4;
      const a = Math.sin(this.walk) * Math.min(1, sp / 4) * 0.8;
      this.legL.rotation.x = a; this.legR.rotation.x = -a;
      this.armL.rotation.x = -a; this.armR.rotation.x = a;
      this.armL.rotation.z = this.armR.rotation.z = 0;
    } else {
      this.legL.rotation.x = 0.35; this.legR.rotation.x = -0.25;
      this.armL.rotation.x = this.armR.rotation.x = 0;
      this.armL.rotation.z = -2.4; this.armR.rotation.z = 2.4; // 만세 자세
    }
    // 착지 찌그러짐
    this.squash = Math.max(0, this.squash - dt * 1.6);
    this.body.scale.set(0.98 * (1 + this.squash * 0.6), 0.98 * (1 - this.squash), 0.98 * (1 + this.squash * 0.6));

    // 바닥 그림자 위치: 아래쪽 가장 높은 윗면 찾기
    let best = -Infinity;
    forEachNear(world, p.y - 40, p.y + 0.01, (b) => {
      if (b.top > p.y + 0.01) return;
      if (b.off) return;
      if (Math.abs(p.x - b.x) < b.hx + PLAYER_HW * 0.3 && Math.abs(p.z - b.z) < b.hz + PLAYER_HW * 0.3 && b.top > best) best = b.top;
    });
    if (best > -Infinity) {
      const h = p.y - best;
      this.blob.visible = true;
      this.blob.position.set(p.x, best + 0.02, p.z);
      const s = Math.max(0.35, 1 - h * 0.06) * (p.scale || 1);
      this.blob.scale.set(s, s, s);
      this.blob.material.opacity = Math.max(0.25, 1 - h * 0.05);
    } else {
      this.blob.visible = false;
    }
  }
}
