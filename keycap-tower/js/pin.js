// 닉네임별 4자리 PIN: 원문은 저장하지 않고 PBKDF2-SHA256 해시만 저장 (브라우저 내장 WebCrypto)
// 보안 수준: 가족 안에서 실수·장난을 막는 용도. 4자리(1만 가지)라 해시를 읽을 수 있는 사람이
// 마음먹고 대입하면 풀 수 있다 (대표님 승인 사항).
// 반복 횟수는 플레이어 기록에 함께 저장(iter)해서 나중에 바꿔도 예전 PIN을 확인할 수 있다.

export const PIN_ITER = 100000;     // 헤드리스 측정 약 0.1~0.3초. 실기기에서 1초를 넘으면 낮춤 (기록마다 iter 저장 → 예전 PIN도 확인 가능)
export const PIN_RE = /^\d{4}$/;

const enc = new TextEncoder();

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function newSalt() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return toHex(a.buffer);
}

export const pinStats = { lastMs: 0 };   // 마지막 해시 계산 시간 (진단 모드 표시: 실기기 속도 확인용)

// PIN + 솔트(+ 아이디) → 64자리 16진수 해시
// 아이디를 섞어 같은 PIN·솔트라도 다른 사람 해시와 같아지지 않게 한다
export async function hashPin(pin, salt, id, iter = PIN_ITER) {
  const t0 = performance.now();
  const key = await crypto.subtle.importKey('raw', enc.encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(`${salt}:${id}`), iterations: iter },
    key, 256,
  );
  pinStats.lastMs = performance.now() - t0;
  return toHex(bits);
}

export async function verifyPin(pin, rec, id) {
  if (!rec || !rec.pinHash || !rec.salt) return false;
  const h = await hashPin(pin, rec.salt, id, rec.iter || PIN_ITER);
  // 길이가 같은 문자열 비교 (시간차 공격은 이 용도에서 의미가 없어 단순 비교)
  return h === rec.pinHash;
}

// 닉네임 → 저장 경로용 아이디 (Firebase 키 금지 문자 회피 + 대소문자·공백 차이 통일)
export function normName(name) {
  return String(name || '').normalize('NFC').trim().replace(/\s+/g, ' ');
}
export async function nameId(name) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode('kt-name:' + normName(name).toLowerCase()));
  return 'u' + toHex(d).slice(0, 12);
}
