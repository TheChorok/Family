// 타워 렌더링: 키캡 종류별 InstancedMesh (충돌 박스 = 사다리꼴 윗면 크기)
import * as THREE from 'three';
import { KEY_TYPES, KEY_DIMS, STAGES } from './layout.js';

// 사다리꼴(위가 좁은) 키캡 지오메트리. 원점 = 윗면 중앙, 아래로 h 만큼
// 윗면은 밝게, 아래쪽은 어둡게 버텍스 컬러를 주어 입체감을 낸다.
function keycapGeometry(hx, hz, h, inset) {
  const bx = hx + inset, bz = hz + inset;
  const T = [[-hx, 0, -hz], [hx, 0, -hz], [hx, 0, hz], [-hx, 0, hz]];
  const B = [[-bx, -h, -bz], [bx, -h, -bz], [bx, -h, bz], [-bx, -h, bz]];
  const pos = [], col = [];
  const quad = (a, b, c, d, ca, cb) => {
    // a,b = 위쪽 두 점(ca), c,d = 아래쪽 두 점(cb)
    for (const [v, k] of [[a, ca], [d, cb], [c, cb], [a, ca], [c, cb], [b, ca]]) {
      pos.push(v[0], v[1], v[2]); col.push(k, k, k);
    }
  };
  // 윗면
  for (const [v] of [[T[0]], [T[3]], [T[2]], [T[0]], [T[2]], [T[1]]]) { pos.push(...v); col.push(1, 1, 1); }
  // 옆면 4개 (바깥쪽을 향하도록 감은 순서 지정)
  quad(T[1], T[0], B[0], B[1], 0.86, 0.62);
  quad(T[2], T[1], B[1], B[2], 0.86, 0.62);
  quad(T[3], T[2], B[2], B[3], 0.86, 0.62);
  quad(T[0], T[3], B[3], B[0], 0.86, 0.62);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
export { keycapGeometry };

// 스테이지별 파스텔 색상
function stageColor(stage, wide, rng) {
  const hue = (0.55 + stage * 0.083) % 1;
  const c = new THREE.Color();
  if (wide) c.setHSL(hue, 0.55, 0.5 + rng * 0.05);
  else c.setHSL(hue, 0.65, 0.7 + rng * 0.06);
  return c;
}

const COLOR_SPACE = new THREE.Color(0xf3efe6);
const COLOR_SPACE_ON = new THREE.Color(0x7fe3b6);
const COLOR_GOAL = new THREE.Color(0xffcc45);

// 바닥(키보드 받침) 텍스처: 키 배열 무늬
function groundTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 512;
  const g = cv.getContext('2d');
  g.fillStyle = '#3a4560'; g.fillRect(0, 0, 512, 512);
  const rows = 14, cell = 512 / rows;
  for (let r = 0; r < rows; r++) {
    let x = (r % 2) * cell * 0.4;
    while (x < 512) {
      const w = cell * (Math.random() < 0.15 ? 1.8 : 1);
      g.fillStyle = Math.random() < 0.12 ? '#56638a' : '#4a5677';
      g.fillRect(x + 3, r * cell + 3, w - 6, cell - 6);
      x += w;
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// 스테이지 표지 스프라이트
function labelSprite(text, color) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(30,40,60,0.55)';
  g.beginPath(); g.roundRect(4, 4, 248, 56, 20); g.fill();
  g.fillStyle = color;
  g.font = 'bold 34px "Noto Sans KR", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, fog: true }));
  s.scale.set(3.2, 0.8, 1);
  return s;
}

export class TowerView {
  constructor(scene, tower) {
    this.tower = tower;
    this.group = new THREE.Group();
    scene.add(this.group);

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.0 });
    this.material = mat;
    this.meshes = {};
    this.movers = [];      // { box, mesh, index }
    this.cpSlots = [];     // 체크포인트 index → { mesh, index }
    this.labels = [];      // 체크포인트 index → 표지 스프라이트

    const byType = {};
    for (const b of tower.boxes) {
      if (b.type === KEY_TYPES.GROUND) continue;
      (byType[b.type] = byType[b.type] || []).push(b);
    }
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const qRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const one = new THREE.Vector3(1, 1, 1);
    const v = new THREE.Vector3();
    this._m4 = m4; this._q = q; this._qRot = qRot; this._one = one; this._v = v;

    let rngState = 1;
    const rnd = () => { rngState = (rngState * 16807) % 2147483647; return rngState / 2147483647; };

    for (const type of Object.keys(byType)) {
      const list = byType[type];
      const d = KEY_DIMS[type];
      const geo = keycapGeometry(d.hx, d.hz, d.h, d.inset);
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // 움직이는 키캡이 있으므로 인스턴스 경계 갱신 대신 컬링을 끈다 (인스턴스 수가 적어 부담 없음)
      mesh.frustumCulled = false;
      list.forEach((b, i) => {
        this.setMatrix(mesh, i, b);
        let c;
        if (b.type === KEY_TYPES.GOAL) c = COLOR_GOAL;
        else if (b.type === KEY_TYPES.SPACE) c = COLOR_SPACE;
        else c = stageColor(b.stage, b.type === KEY_TYPES.WIDE, rnd());
        mesh.setColorAt(i, c);
        if (b.moving) this.movers.push({ box: b, mesh, index: i });
        if (b.cpIndex) this.cpSlots[b.cpIndex] = { mesh, index: i };
      });
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
      this.meshes[type] = mesh;
    }

    // 움직이는 키캡 밑면 표시용 테두리 강조 (조금 더 진한 색)
    for (const mv of this.movers) {
      const c = new THREE.Color();
      mv.mesh.getColorAt(mv.index, c);
      c.offsetHSL(0.0, 0.15, -0.12);
      mv.mesh.setColorAt(mv.index, c);
    }
    for (const m of Object.values(this.meshes)) if (m.instanceColor) m.instanceColor.needsUpdate = true;

    // 시작 바닥
    const gb = tower.boxes[0];
    const gGeo = keycapGeometry(gb.hx, gb.hz, gb.h, gb.inset);
    const gMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, map: groundTexture() });
    // 윗면 UV (텍스처 매핑용): 위치 기반 간단 UV
    const p = gGeo.attributes.position;
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      uv[i * 2] = (p.getX(i) / (gb.hx + gb.inset)) * 0.5 + 0.5;
      uv[i * 2 + 1] = (p.getZ(i) / (gb.hz + gb.inset)) * 0.5 + 0.5;
    }
    gGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const ground = new THREE.Mesh(gGeo, gMat);
    ground.position.set(gb.x, gb.top, gb.z);
    ground.receiveShadow = true;
    this.group.add(ground);

    // 체크포인트 표지
    for (const cp of tower.checkpoints) {
      if (!cp.stage) continue;
      const isGoal = cp.stage === STAGES;
      const s = labelSprite(isGoal ? '★ 정상 ★' : `STAGE ${cp.stage + 1}`, isGoal ? '#ffd65c' : '#ffffff');
      s.position.set(cp.x, cp.y + 4.6, cp.z);
      this.labels[cp.stage] = s;
      this.group.add(s);
    }

    // 정상 장식: 회전하는 별(팔면체)
    const goal = tower.goal;
    this.star = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.8),
      new THREE.MeshStandardMaterial({ color: 0xffd34d, emissive: 0x6b4a00, roughness: 0.3, metalness: 0.4 }),
    );
    this.star.position.set(goal.x, goal.top + 4.2, goal.z);
    this.group.add(this.star);
  }

  setMatrix(mesh, i, b) {
    this._v.set(b.x, b.top, b.z);
    this._m4.compose(this._v, b.rot ? this._qRot : this._q.identity(), this._one);
    mesh.setMatrixAt(i, this._m4);
  }

  // 매 프레임: 움직이는 키캡 위치 반영
  update(dt) {
    const dirty = new Set();
    for (const mv of this.movers) {
      this.setMatrix(mv.mesh, mv.index, mv.box);
      dirty.add(mv.mesh);
    }
    for (const m of dirty) m.instanceMatrix.needsUpdate = true;
    this.star.rotation.y += dt * 1.5;
  }

  // 체크포인트 활성 표시 (upTo 이하 모두 활성 색, 도달한 표지는 시야를 가리지 않게 숨김)
  setCheckpoints(upTo) {
    for (let i = 1; i < this.labels.length; i++) if (this.labels[i]) this.labels[i].visible = i > upTo;
    for (let i = 1; i < this.cpSlots.length; i++) {
      const s = this.cpSlots[i];
      if (!s || i === STAGES) continue;
      s.mesh.setColorAt(s.index, i <= upTo ? COLOR_SPACE_ON : COLOR_SPACE);
      s.mesh.instanceColor.needsUpdate = true;
    }
  }
}
