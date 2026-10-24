// 입력 처리: 멀티터치를 조이스틱 / 점프 / 카메라 회전으로 분배 (+ PC 키보드·마우스)
const JOY_RADIUS = 56;     // 조이스틱 최대 반경(px)
const DEADZONE = 0.12;

export class Input {
  constructor({ layer, joyBase, joyKnob, jumpBtn }) {
    this.layer = layer;
    this.joyBase = joyBase;
    this.joyKnob = joyKnob;
    this.jumpBtn = jumpBtn;
    this.enabled = true;

    this.joyId = null; this.joyOx = 0; this.joyOy = 0; this.joyX = 0; this.joyY = 0;
    this.lookId = null; this.lookLx = 0; this.lookLy = 0; this.lookDx = 0; this.lookDy = 0;
    this.jumpQueued = false;
    this.jumpIds = new Set();
    this.keys = new Set();
    this.gestureCbs = [];

    layer.addEventListener('pointerdown', (e) => this.onDown(e));
    layer.addEventListener('pointermove', (e) => this.onMove(e));
    layer.addEventListener('pointerup', (e) => this.onUp(e));
    layer.addEventListener('pointercancel', (e) => this.onUp(e));
    layer.addEventListener('lostpointercapture', (e) => this.onUp(e));

    jumpBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.fireGesture();
      if (!this.enabled) return;
      this.jumpQueued = true;
      this.jumpIds.add(e.pointerId);
      jumpBtn.classList.add('down');
    });
    const jumpUp = (e) => {
      this.jumpIds.delete(e.pointerId);
      if (this.jumpIds.size === 0) jumpBtn.classList.remove('down');
    };
    jumpBtn.addEventListener('pointerup', jumpUp);
    jumpBtn.addEventListener('pointercancel', jumpUp);
    jumpBtn.addEventListener('pointerleave', jumpUp);

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.fireGesture();
      const k = e.code;
      if (k === 'Space') { this.jumpQueued = this.enabled; e.preventDefault(); }
      this.keys.add(k);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.reset());
    // 길게 누르기 메뉴·드래그 기본 동작 차단
    layer.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // 첫 사용자 제스처 콜백 (오디오 활성화 등)
  onGesture(cb) { this.gestureCbs.push(cb); }
  fireGesture() { for (const cb of this.gestureCbs) cb(); }

  onDown(e) {
    e.preventDefault();
    this.fireGesture();
    if (!this.enabled) return;
    const w = window.innerWidth, h = window.innerHeight;
    const isTouch = e.pointerType !== 'mouse';
    // 왼쪽 하단 영역 → 플로팅 조이스틱
    if (isTouch && this.joyId === null && e.clientX < w * 0.5 && e.clientY > h * 0.4) {
      this.joyId = e.pointerId;
      this.joyOx = e.clientX; this.joyOy = e.clientY;
      this.joyX = 0; this.joyY = 0;
      this.showJoy(true);
      this.updateJoyVisual();
    } else if (this.lookId === null) {
      // 나머지 영역 → 카메라 회전
      this.lookId = e.pointerId;
      this.lookLx = e.clientX; this.lookLy = e.clientY;
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
      this.lookDx += e.clientX - this.lookLx;
      this.lookDy += e.clientY - this.lookLy;
      this.lookLx = e.clientX; this.lookLy = e.clientY;
    }
  }

  onUp(e) {
    if (e.pointerId === this.joyId) {
      this.joyId = null; this.joyX = 0; this.joyY = 0;
      this.showJoy(false);
    } else if (e.pointerId === this.lookId) {
      this.lookId = null;
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
    this.jumpQueued = false; this.jumpIds.clear();
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

  consumeLook() {
    const d = { dx: this.lookDx, dy: this.lookDy };
    this.lookDx = 0; this.lookDy = 0;
    return d;
  }
}
