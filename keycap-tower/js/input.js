// 입력 처리: 멀티터치를 조이스틱 / 점프 / 카메라 회전으로 분배 (+ PC 키보드·마우스)
const JOY_RADIUS = 56;     // 조이스틱 최대 반경(px)
const DEADZONE = 0.12;

// PC 점프 키: 스페이스 외에 Shift(좌·우)·Z·X·J
// 일반·노트북 키보드는 '방향키 2개 + 스페이스' 같은 3키 조합을 하드웨어에서 인식 못 하는 경우가 있어(고스팅)
// 배선이 다른 키(특히 Shift)로도 점프할 수 있게 한다
const JUMP_KEYS = new Set(['Space', 'ShiftLeft', 'ShiftRight', 'KeyZ', 'KeyX', 'KeyJ']);
// 점프 버튼 주변 여유(px): 보이는 버튼보다 이만큼 넓게 점프로 인정
// (이동하면서 엄지로 누르면 버튼 가장자리를 살짝 벗어나기 쉬움 → 예전에는 그 터치가 '시점 회전'이 되어 점프가 무시됨)
const JUMP_PAD = 28;

export class Input {
  constructor({ layer, joyBase, joyKnob, jumpBtn }) {
    this.layer = layer;
    this.joyBase = joyBase;
    this.joyKnob = joyKnob;
    this.jumpBtn = jumpBtn;
    this.enabled = true;

    this.joyId = null; this.joyOx = 0; this.joyOy = 0; this.joyX = 0; this.joyY = 0;
    this.lookId = null; this.lookLx = 0; this.lookLy = 0; this.lookDx = 0; this.lookDy = 0;
    // 핀치(두 손가락 거리 조절): 시점 회전 손가락 + 두 번째 손가락
    this.pinchId = null; this.pinchX = 0; this.pinchY = 0; this.pinchD = 0;
    this.zoomF = 1;            // 누적 거리 배율 (1 미만 = 가까이)
    this.jumpQueued = false;
    this.jumpIds = new Set();
    // 진단(?debug=1)용: 터치별 역할, 마지막 pointercancel, 점프 입력 횟수
    this.roles = new Map();          // pointerId → 'joy' | 'look' | 'pinch' | 'jump' | 'jump+'(여유 영역)
    this.lastCancel = null;          // { t, role }
    this.cancels = 0;
    this.jumpTaps = 0; this.padTaps = 0;
    this.keys = new Set();
    this.gestureCbs = [];

    layer.addEventListener('pointerdown', (e) => this.onDown(e));
    layer.addEventListener('pointermove', (e) => this.onMove(e));
    layer.addEventListener('pointerup', (e) => this.onUp(e));
    layer.addEventListener('pointercancel', (e) => this.onUp(e));
    layer.addEventListener('lostpointercapture', (e) => this.onUp(e));

    // 진단용: pointercancel(브라우저가 터치를 가로챔) 기록 — 역할을 지우기 전에 기록되도록 캡처 단계에서
    const noteCancel = (e) => {
      this.cancels++;
      this.lastCancel = { t: performance.now(), role: this.roles.get(e.pointerId) || '?' };
    };
    layer.addEventListener('pointercancel', noteCancel, { capture: true });
    jumpBtn.addEventListener('pointercancel', noteCancel, { capture: true });

    jumpBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.fireGesture();
      if (!this.enabled) return;
      this.pressJump(e.pointerId, 'jump');
    });
    jumpBtn.addEventListener('pointerup', (e) => this.releaseJump(e.pointerId));
    jumpBtn.addEventListener('pointercancel', (e) => this.releaseJump(e.pointerId));
    jumpBtn.addEventListener('pointerleave', (e) => this.releaseJump(e.pointerId));

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.fireGesture();
      const k = e.code;
      if (JUMP_KEYS.has(k)) { this.jumpQueued = this.enabled; e.preventDefault(); }
      this.keys.add(k);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.reset());
    // 길게 누르기 메뉴·드래그 기본 동작 차단
    layer.addEventListener('contextmenu', (e) => e.preventDefault());
    // PC 마우스 휠: 위로 굴리면 가까이, 아래로 굴리면 멀리
    // (HUD 등 다른 요소 위에서 굴려도 동작하도록 window에서 받음, 메뉴가 열려 있으면 무시)
    window.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      const px = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      this.zoomF *= Math.exp(Math.max(-200, Math.min(200, px)) * 0.0015);
    }, { passive: false });
  }

  // 첫 사용자 제스처 콜백 (오디오 활성화 등)
  onGesture(cb) { this.gestureCbs.push(cb); }
  fireGesture() { for (const cb of this.gestureCbs) cb(); }

  pressJump(id, role) {
    this.jumpQueued = true;
    this.jumpIds.add(id);
    this.roles.set(id, role);
    if (role === 'jump') this.jumpTaps++; else this.padTaps++;
    this.jumpBtn.classList.add('down');
  }
  releaseJump(id) {
    if (!this.jumpIds.has(id)) return;
    this.jumpIds.delete(id);
    this.roles.delete(id);
    if (this.jumpIds.size === 0) this.jumpBtn.classList.remove('down');
  }

  // 점프 버튼 주변 여유 영역 안인지 (버튼이 보일 때만)
  inJumpPad(x, y) {
    const r = this.jumpBtn.getBoundingClientRect();
    if (!r.width) return false;
    return x >= r.left - JUMP_PAD && x <= r.right + JUMP_PAD && y >= r.top - JUMP_PAD && y <= r.bottom + JUMP_PAD;
  }

  onDown(e) {
    e.preventDefault();
    this.fireGesture();
    if (!this.enabled) return;
    const w = window.innerWidth, h = window.innerHeight;
    const isTouch = e.pointerType !== 'mouse';
    // 점프 버튼 가장자리 근처 터치 → 점프 (시점 회전·핀치로 쓰지 않음)
    if (isTouch && this.inJumpPad(e.clientX, e.clientY)) {
      this.pressJump(e.pointerId, 'jump+');
      try { this.layer.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
      return;
    }
    // 왼쪽 하단 영역 → 플로팅 조이스틱
    if (isTouch && this.joyId === null && e.clientX < w * 0.5 && e.clientY > h * 0.4) {
      this.joyId = e.pointerId;
      this.joyOx = e.clientX; this.joyOy = e.clientY;
      this.joyX = 0; this.joyY = 0;
      this.roles.set(e.pointerId, 'joy');
      this.showJoy(true);
      this.updateJoyVisual();
    } else if (this.lookId === null) {
      // 나머지 영역 → 카메라 회전
      this.lookId = e.pointerId;
      this.lookLx = e.clientX; this.lookLy = e.clientY;
      this.roles.set(e.pointerId, 'look');
    } else if (isTouch && this.pinchId === null) {
      // 회전 중인 손가락 + 두 번째 손가락 → 핀치로 거리 조절 (핀치 중에는 회전 멈춤)
      this.pinchId = e.pointerId;
      this.pinchX = e.clientX; this.pinchY = e.clientY;
      this.pinchD = Math.hypot(this.pinchX - this.lookLx, this.pinchY - this.lookLy);
      this.roles.set(e.pointerId, 'pinch');
      this.roles.set(this.lookId, 'pinch');
    } else {
      return;
    }
    try { this.layer.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
  }

  onMove(e) {
    if (e.pointerId === this.joyId) {
      let dx = e.clientX - this.joyOx, dy = e.clientY - this.joyOy;
      const l = Math.hypot(dx, dy);
      if (l > JOY_RADIUS) {
        // 손가락이 반경 밖으로 나가면 조이스틱 중심을 따라 끌어옴
        const k = (l - JOY_RADIUS) / l;
        this.joyOx += dx * k; this.joyOy += dy * k;
        dx = e.clientX - this.joyOx; dy = e.clientY - this.joyOy;
      }
      this.joyX = dx / JOY_RADIUS;
      this.joyY = dy / JOY_RADIUS;
      this.updateJoyVisual();
    } else if (e.pointerId === this.lookId) {
      if (this.pinchId === null) {
        this.lookDx += e.clientX - this.lookLx;
        this.lookDy += e.clientY - this.lookLy;
      }
      this.lookLx = e.clientX; this.lookLy = e.clientY;
      this.updatePinch();
    } else if (e.pointerId === this.pinchId) {
      this.pinchX = e.clientX; this.pinchY = e.clientY;
      this.updatePinch();
    }
  }

  // 두 손가락 거리 변화 → 거리 배율 (벌리면 가까이, 오므리면 멀리)
  updatePinch() {
    if (this.pinchId === null) return;
    const d = Math.hypot(this.pinchX - this.lookLx, this.pinchY - this.lookLy);
    if (d > 10 && this.pinchD > 10) this.zoomF *= this.pinchD / d;
    this.pinchD = d;
  }

  onUp(e) {
    if (this.jumpIds.has(e.pointerId)) { this.releaseJump(e.pointerId); return; }
    this.roles.delete(e.pointerId);
    if (e.pointerId === this.joyId) {
      this.joyId = null; this.joyX = 0; this.joyY = 0;
      this.showJoy(false);
    } else if (e.pointerId === this.lookId) {
      // 회전 손가락을 먼저 떼면 남은 핀치 손가락이 회전을 이어받음
      this.lookId = this.pinchId;
      this.lookLx = this.pinchX; this.lookLy = this.pinchY;
      if (this.pinchId !== null) this.roles.set(this.pinchId, 'look');
      this.pinchId = null;
    } else if (e.pointerId === this.pinchId) {
      if (this.lookId !== null) this.roles.set(this.lookId, 'look');
      this.pinchId = null;
    }
  }

  showJoy(on) {
    this.joyBase.classList.toggle('active', on);
  }

  updateJoyVisual() {
    const r = 70; // 베이스 반지름(CSS와 동일)
    this.joyBase.style.transform = `translate(${this.joyOx - r}px, ${this.joyOy - r}px)`;
    this.joyKnob.style.transform = `translate(${this.joyX * JOY_RADIUS}px, ${this.joyY * JOY_RADIUS}px)`;
  }

  reset() {
    this.joyId = null; this.joyX = 0; this.joyY = 0;
    this.lookId = null; this.lookDx = 0; this.lookDy = 0;
    this.pinchId = null; this.zoomF = 1;
    this.jumpQueued = false; this.jumpIds.clear(); this.roles.clear();
    this.keys.clear();
    this.jumpBtn.classList.remove('down');
    this.showJoy(false);
  }

  // 이동 입력: x = 오른쪽, y = 앞쪽 (크기 0~1)
  getMove() {
    let x = this.joyX, y = -this.joyY;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    let l = Math.hypot(x, y);
    if (l < DEADZONE) return { x: 0, y: 0 };
    if (l > 1) { x /= l; y /= l; l = 1; }
    // 데드존 이후 0~1로 재매핑
    const s = (l - DEADZONE) / (1 - DEADZONE) / l;
    return { x: x * s, y: y * s };
  }

  consumeJump() {
    const j = this.jumpQueued;
    this.jumpQueued = false;
    return j && this.enabled;
  }

  // 이번 프레임까지 쌓인 거리 배율 (1 = 변화 없음)
  consumeZoom() {
    const f = this.zoomF;
    this.zoomF = 1;
    return f;
  }

  consumeLook() {
    const d = { dx: this.lookDx, dy: this.lookDy };
    this.lookDx = 0; this.lookDy = 0;
    return d;
  }
}
