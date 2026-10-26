// 타워 렌더링: 키캡 종류별 InstancedMesh (충돌 박스 = 사다리꼴 윗면 크기)
import * as THREE from 'three';
import { KEY_TYPES, KEY_DIMS, STAGES } from './layout.js';
import { G, GIMMICK_INFO } from './gimmicks.js';

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

// 통로 벽 텍스처: 연한 판 위에 키캡 자국 무늬 (4m × 4m 반복)
function wallTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = '#c9d3ec'; g.fillRect(0, 0, 256, 256);
  const cell = 64;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      g.fillStyle = (x + y) % 2 ? '#bcc7e4' : '#c3cde8';
      g.beginPath(); g.roundRect(x * cell + 6, y * cell + 6, cell - 12, cell - 12, 10); g.fill();
    }
  }
  g.fillStyle = 'rgba(80,95,140,0.18)'; g.fillRect(0, 126, 256, 4);   // 가로 줄눈
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// 기믹 각인 텍스처 (키캡 윗면에 붙이는 반투명 데칼)
function legendTexture(ch) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.strokeStyle = 'rgba(30,40,60,0.55)';
  g.lineWidth = 6;
  g.font = 'bold 92px "Noto Sans KR", "Apple SD Gothic Neo", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.strokeText(ch, 64, 70);
  g.fillText(ch, 64, 70);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
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
    this.slot = new Map(); // 박스 → { mesh, index }
    this.decal = new Map(); // 박스 → { mesh, index } (기믹 각인)
    this.dynamic = [];     // 매 프레임 갱신할 박스 (움직임·꺼짐·줄어듦)

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
        else if (b.g) c = new THREE.Color(GIMMICK_INFO[b.g].color);   // 기믹 키캡은 종류별 고유 색
        else c = stageColor(b.stage, b.type === KEY_TYPES.WIDE, rnd());
        mesh.setColorAt(i, c);
        this.slot.set(b, { mesh, index: i });
        if (b.moving) this.movers.push({ box: b, mesh, index: i });
        if (b.moving || b.g === G.CRUMBLE || b.g === G.SHRINK) this.dynamic.push(b);
        if (b.cpIndex) this.cpSlots[b.cpIndex] = { mesh, index: i };
      });
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
      this.meshes[type] = mesh;
    }

    // 기믹 각인 데칼: 종류별 InstancedMesh 하나씩 (키캡 윗면에 평평하게)
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    const byG = {};
    for (const b of tower.boxes) if (b.g) (byG[b.g] = byG[b.g] || []).push(b);
    this.decalMeshes = [];
    for (const g of Object.keys(byG)) {
      const list = byG[g];
      const dm = new THREE.InstancedMesh(plane, new THREE.MeshBasicMaterial({
        map: legendTexture(GIMMICK_INFO[g].legend), transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2,
      }), list.length);
      dm.frustumCulled = false;
      dm.renderOrder = 1;
      list.forEach((b, i) => { this.decal.set(b, { mesh: dm, index: i }); this.setDecal(b); });
      dm.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(dm);
      this.decalMeshes.push(dm);
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

    // 네모 통로 벽: 키보드 판 무늬, 벽마다 따로 반투명 전환
    this.walls = [];
    if (tower.view && tower.view.kind === 'shaft') {
      const base = wallTexture();
      for (const w of tower.statics) {
        const alongX = w.hx > w.hz;                  // 남·북 벽(가로로 긴 벽)
        const len = 2 * (alongX ? w.hx : w.hz);
        const tex = base.clone();
        tex.needsUpdate = true;
        tex.repeat.set(len / 4, w.h / 4);
        // 벽은 화면 대부분을 덮어 픽셀 비용이 크므로 조명 계산 없는 Basic 재질을 쓰고,
        // 태양 방향(+x, +z 쪽 위)을 기준으로 벽 방향별 밝기만 다르게 해 입체감을 낸다.
        // (헤드리스 측정: 표준 재질 대비 벽 렌더 비용 약 1/6, 대신 벽에 키캡 그림자는 맺히지 않음)
        const axis = alongX ? 'z' : 'x';
        const out = Math.sign(alongX ? w.z : w.x);
        const sunDot = -out * (alongX ? 0.55 : 0.83);    // 안쪽 면 법선(-out)과 태양 수평 방향의 내적
        const mat = new THREE.MeshBasicMaterial({
          map: tex, transparent: true, opacity: 1,
          color: new THREE.Color().setScalar(0.82 + 0.13 * sunDot),
        });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(2 * w.hx, w.h, 2 * w.hz), mat);
        mesh.position.set(w.x, w.top - w.h / 2, w.z);
        this.group.add(mesh);
        // 안쪽 면 위치와 바깥 방향 (카메라가 이 면 바깥에 있으면 벽이 가린다고 판단)
        const face = (alongX ? w.z : w.x) - out * (alongX ? w.hz : w.hx);
        this.walls.push({ mesh, mat, axis, out, face, opacity: 1 });
      }
    }
  }

  // 카메라가 벽 안쪽 면 바깥(또는 면 바로 앞)에 있으면 그 벽만 반투명 (그 외에는 불투명)
  // 통로는 볼록한 공간이라, 카메라가 모든 벽 안쪽에 있으면 카메라-캐릭터 사이에 벽이 올 수 없다.
  // 켜짐/꺼짐 기준을 다르게 해(히스테리시스) 경계에서 깜빡이지 않게 한다
  updateWalls(dt, cam) {
    const k = 1 - Math.exp(-dt * 10);
    for (const w of this.walls) {
      const depth = (cam[w.axis] - w.face) * w.out;   // 안쪽 면 기준 바깥으로 나간 거리 (안쪽이면 음수)
      const beyond = w.see ? depth > -0.35 : depth > -0.15;
      w.see = beyond;
      const want = beyond ? 0.3 : 1;
      w.opacity += (want - w.opacity) * k;
      if (Math.abs(w.opacity - want) < 0.01) w.opacity = want;
      w.mat.opacity = w.opacity;
      w.mat.depthWrite = w.opacity > 0.99;
      w.mesh.renderOrder = w.opacity < 1 ? 2 : 0;
    }
  }

  // 키캡 표시 상태: 줄어드는 키캡은 가로·세로 축소, 꺼지는 키캡은 눌림(흔들림), 사라지면 숨김
  boxLook(b) {
    if (b.off) return { sx: 0, sz: 0, dy: 0 };
    let sx = 1, sz = 1, dy = 0;
    if (b.g === G.SHRINK && b.bhx) { sx = b.hx / b.bhx; sz = b.hz / b.bhz; }
    if (b.g === G.CRUMBLE && b.cr) dy = -0.12 + Math.sin(b.cr.t * 60) * 0.03;
    return { sx, sz, dy };
  }

  setMatrix(mesh, i, b) {
    const k = this.boxLook(b);
    this._v.set(b.x, b.top + k.dy, b.z);
    // 회전된 키캡(rot)은 지오메트리 기준 축이 바뀌므로 축소 비율도 맞바꿈. 사라진 키캡은 아주 작게 숨김
    this._s = this._s || new THREE.Vector3();
    if (b.off) this._s.set(1e-4, 1e-4, 1e-4);
    else if (b.rot) this._s.set(Math.max(1e-4, k.sz), 1, Math.max(1e-4, k.sx));
    else this._s.set(Math.max(1e-4, k.sx), 1, Math.max(1e-4, k.sz));
    this._m4.compose(this._v, b.rot ? this._qRot : this._q.identity(), this._s);
    mesh.setMatrixAt(i, this._m4);
  }

  // 각인 데칼: 윗면 위 2cm, 컨베이어는 화살표를 밀리는 방향으로 회전
  setDecal(b) {
    const d = this.decal.get(b);
    if (!d) return;
    const k = this.boxLook(b);
    const size = Math.min(b.hx, b.hz) * 1.5;
    this._dq = this._dq || new THREE.Quaternion();
    this._dy = this._dy || new THREE.Vector3(0, 1, 0);
    const ang = b.g === G.CONVEYOR && b.conv ? Math.atan2(-b.conv.z, b.conv.x) : 0;
    this._dq.setFromAxisAngle(this._dy, ang);
    this._ds = this._ds || new THREE.Vector3();
    const vis = b.off ? 1e-4 : 1;
    this._ds.set(size * vis, 1, size * vis);
    this._v.set(b.x, b.top + 0.02 + k.dy, b.z);
    this._m4.compose(this._v, this._dq, this._ds);
    d.mesh.setMatrixAt(d.index, this._m4);
  }

  // 매 프레임: 움직이는·꺼지는·줄어드는 키캡 반영
  update(dt) {
    const dirty = new Set();
    for (const b of this.dynamic) {
      const s = this.slot.get(b);
      this.setMatrix(s.mesh, s.index, b);
      dirty.add(s.mesh);
      const d = this.decal.get(b);
      if (d) { this.setDecal(b); dirty.add(d.mesh); }
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
