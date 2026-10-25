// HUD 표시와 오버레이(시작·일시정지·확인·클리어) 관리
const $ = (id) => document.getElementById(id);

export function formatTime(sec) {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${String(m).padStart(2, '0')}:${r.toFixed(1).padStart(4, '0')}`;
}

export class Hud {
  constructor() {
    this.el = {
      height: $('hHeight'), stage: $('hStage'), time: $('hTime'), falls: $('hFalls'),
      toast: $('toast'), fade: $('fade'),
    };
    this.last = {};
    this.toastTimer = 0;
  }

  // 값이 바뀐 경우에만 DOM 갱신 (불필요한 레이아웃 비용 방지)
  set(key, text) {
    if (this.last[key] === text) return;
    this.last[key] = text;
    this.el[key].textContent = text;
  }

  update({ height, stage, stages, time, falls }) {
    this.set('height', String(Math.max(0, Math.floor(height))));
    this.set('stage', `${stage}/${stages}`);
    this.set('time', formatTime(time));
    this.set('falls', String(falls));
  }

  toast(msg, ms = 1800) {
    const t = this.el.toast;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  fade(on) {
    this.el.fade.classList.toggle('on', on);
  }
}

// 오버레이 하나만 보이도록 전환 (null이면 모두 닫기)
export function showOverlay(id) {
  for (const o of document.querySelectorAll('.overlay')) o.classList.toggle('show', o.id === id);
  document.body.classList.toggle('menu-open', !!id);
}
