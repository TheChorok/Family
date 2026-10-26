// 기능형 키캡(기믹) 정의 — 게임·배치 생성기·봇 테스트가 함께 쓰는 순수 모듈
export const G = {
  NONE: 0,
  BOUNCE: 1,     // 스페이스 점프대: 착지하면 높이 튕김
  ICE: 2,        // 얼음: 미끄러움
  CONVEYOR: 3,   // 방향키 컨베이어: 서 있으면 밀려남
  CRUMBLE: 4,    // 꺼지는 키캡: 밟고 1초 뒤 사라졌다가 복구
  MINUS: 5,      // '－': 캐릭터 축소
  PLUS: 6,       // '＋': 캐릭터 확대
  SHRINK: 7,     // 줄어드는 키캡: 서 있는 동안 작아져 사라짐
  REVERSE: 8,    // 방향 반전
};

// ── 수치 ──
export const BOUNCE_V = 14;            // 점프대 튕김 초속 (최고 약 3.3m, 일반 점프의 약 1.6배)
                                       // 16(4.3m)은 네모 통로 한 바퀴 높이(약 7m)에 비해 머리 공간이 부족해 낮춤
export const ICE_ACCEL = 25;           // 얼음 위 가속도 (일반 70)
export const ICE_DECEL = 4;            // 얼음 위 입력 없을 때 감속도 (거의 안 멈춤)
export const CONVEYOR_SPEED = 2.5;     // 컨베이어 밀림 속도 (캐릭터 최고 속도 6.5보다 느려 버틸 수 있음)
export const CRUMBLE_DELAY = 1.0;      // 밟은 뒤 사라지기까지
export const CRUMBLE_RESTORE = 4.0;    // 사라진 뒤 복구까지
export const SIZE_TIME = 8;            // 크기 변화 지속 시간
export const SMALL = { scale: 0.6, jump: 0.8 };   // '－' 축소: 0.6배, 점프 초속 0.8배 (최고 약 1.3m)
export const BIG = { scale: 1.5, jump: 1.1 };     // '＋' 확대: 1.5배, 점프 초속 1.1배 (최고 약 2.4m)
                                                  // 1.2배는 네모 통로 모서리에서 한 칸 건너뛰는 지름길을 막기 어려워 낮춤
export const SHRINK_TIME = 3;          // 서 있는 동안 사라지기까지
export const SHRINK_REGROW = 1;        // 떠나면 원래 크기로 돌아오는 시간
export const REVERSE_TIME = 5;         // 방향 반전 지속 시간

// 표시 정보: 이름, 첫 등장 안내 문구, 색, 각인
export const GIMMICK_INFO = {
  [G.BOUNCE]:   { name: '점프대',      toast: '⇡ 스페이스 점프대! 밟으면 높이 튕겨요', color: 0xff9a3c, legend: '⇡' },
  [G.ICE]:      { name: '얼음',        toast: '❄ 얼음 키캡! 미끄러우니 조심',        color: 0xaee8ff, legend: '❄' },
  [G.CONVEYOR]: { name: '컨베이어',    toast: '→ 방향키 컨베이어! 화살표 쪽으로 밀려요', color: 0x5a6272, legend: '→' },
  [G.CRUMBLE]:  { name: '꺼지는 키캡', toast: '⚠ 꺼지는 키캡! 밟고 1초 뒤 사라져요',  color: 0xb8865a, legend: '✕' },
  [G.MINUS]:    { name: '축소',        toast: '－ 키캡! 8초 동안 작아져요 (점프 약해짐)', color: 0x4f8dff, legend: '－' },
  [G.PLUS]:     { name: '확대',        toast: '＋ 키캡! 8초 동안 커져요 (점프 강해짐)',   color: 0xff5a5a, legend: '＋' },
  [G.SHRINK]:   { name: '줄어드는 키캡', toast: '◇ 줄어드는 키캡! 오래 서 있으면 사라져요', color: 0xa77bff, legend: '◇' },
  [G.REVERSE]:  { name: '방향 반전',   toast: '⇄ 방향 반전 키캡! 5초 동안 조작이 거꾸로', color: 0xff4fc3, legend: '⇄' },
};

// 스테이지별 등장: 2~6스테이지에 새로 나오는 기믹 (7~10은 전부 섞음)
export const STAGE_NEW = {
  2: [G.BOUNCE, G.ICE],
  3: [G.CONVEYOR, G.CRUMBLE],
  4: [G.MINUS, G.PLUS],
  5: [G.SHRINK],
  6: [G.REVERSE],
};
export const ALL_GIMMICKS = [G.BOUNCE, G.ICE, G.CONVEYOR, G.CRUMBLE, G.MINUS, G.PLUS, G.SHRINK, G.REVERSE];

// 이전 스테이지까지 등장한 기믹
export function gimmicksBefore(stage) {
  const out = [];
  for (let s = 2; s < stage; s++) if (STAGE_NEW[s]) out.push(...STAGE_NEW[s]);
  return out;
}

// 스테이지별 기믹 비율: 2~6 = 새 기믹 약 30% + 이전 기믹 약 15%, 7~10 = 40% → 70%
export function gimmickRates(stage) {
  if (stage <= 1) return { fresh: 0, old: 0 };
  if (stage <= 6) return { fresh: 0.30, old: stage === 2 ? 0 : 0.15 };
  return { fresh: 0, old: 0.40 + (stage - 7) * 0.10 };
}

// 서 있으면 시간 제한이 있는 키캡 (다음 키캡이 '타이밍 대기'를 요구하면 안 됨)
export function isTimed(g) {
  return g === G.CRUMBLE || g === G.SHRINK;
}
