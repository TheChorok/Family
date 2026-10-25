// 저사양 기기 대비 자동 그래픽 품질 조정
// 워밍업 1초 후 2초간 프레임 시간을 측정해 느리면 한 단계씩 낮춘다.
// 레벨: 2=높음(그림자, 해상도 최대 2배), 1=중간(그림자 끔, 1.5배), 0=낮음(그림자 끔, 1배, 안개 가까이)
import { load, save } from './storage.js';

const WARMUP = 1.0;
const MEASURE = 2.0;
const SLOW_MS = 20; // 평균 프레임 시간이 이보다 길면(≈50fps 미만) 하향

export const QUALITY_NAMES = ['낮음', '중간', '높음'];

export class Quality {
  constructor(apply) {
    this.apply = apply;               // (level) => void
    const saved = load('quality', null);
    this.level = saved && typeof saved.level === 'number' ? saved.level : 2;
    this.measuring = !saved;          // 저장값이 없으면 첫 실행 → 측정
    this.onResult = null;
    this.resetMeasure();
    this.apply(this.level);
  }

  resetMeasure() {
    this.elapsed = 0; this.sum = 0; this.frames = 0;
  }

  // '그래픽 재측정': 최고 품질부터 다시 측정
  remeasure() {
    this.level = 2;
    this.apply(this.level);
    this.measuring = true;
    this.resetMeasure();
  }

  // 매 프레임 호출 (dt: 초, 실제 렌더 간격). 게임 진행 중일 때만 호출할 것
  tick(dt) {
    if (!this.measuring) return;
    // 탭 전환 등으로 생긴 비정상적으로 긴 프레임은 제외
    if (dt > 0.25) return;
    this.elapsed += dt;
    if (this.elapsed < WARMUP) return;
    this.sum += dt; this.frames++;
    if (this.elapsed < WARMUP + MEASURE) return;

    const avgMs = (this.sum / this.frames) * 1000;
    if (avgMs > SLOW_MS && this.level > 0) {
      // 한 단계 낮추고 다시 측정
      this.level--;
      this.apply(this.level);
      this.resetMeasure();
      return;
    }
    this.measuring = false;
    save('quality', { level: this.level, avgMs: Math.round(avgMs * 10) / 10, at: Date.now() });
    if (this.onResult) this.onResult(this.level, avgMs);
  }
}
