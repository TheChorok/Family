// 가족 서버 저장 계층 (Firebase Realtime Database)
// - 체스·모노폴리·모리스와 같은 가족 코드·같은 DB를 쓴다: families/{가족코드 해시}/keycap/...
//   (다른 게임 경로 chess·monopoly·morris·_ping 은 절대 건드리지 않음: 항상 keycap 아래 경로에만 씀)
// - 동시 사용 안전: 읽은 값의 버전표(ETag)를 붙여 조건부로 쓴다. 그사이 다른 기기가 바꿨으면 서버가
//   412로 거부 → 최신 값으로 다시 계산해 재시도 (Firebase REST 'Conditional requests')
// - 브라우저가 ETag를 쓸 수 없으면(CORS) Firebase 공식 SDK의 runTransaction으로 대체 (대표님 승인 사항)

export const FB_URL = 'https://thechorokfamilygame-default-rtdb.asia-southeast1.firebasedatabase.app';
export const SDK_VERSION = '12.19.0';     // 대체 경로용 Firebase JS SDK (2026-09-09 배포, 고정)
const ROOT = 'keycap';

// 가족 코드 → 경로 해시 (체스·모노폴리·모리스와 동일한 함수: 같은 가족 코드면 같은 방)
export function famHash(code) {
  let x = 5381;
  for (const c of 'fam:' + code) x = (x * 33 + c.charCodeAt(0)) >>> 0;
  return x.toString(36);
}

// 가족 코드는 다른 게임과 같은 localStorage 키(familyCode)를 공유 (같은 출처 thechorok.github.io)
export function loadFamilyCode() {
  try { return (localStorage.getItem('familyCode') || '').trim(); } catch (e) { return ''; }
}
export function saveFamilyCode(code) {
  try {
    if (code) localStorage.setItem('familyCode', code.trim());
    else localStorage.removeItem('familyCode');
  } catch (e) { /* 저장 불가: 이번 실행 동안만 사용 */ }
}

export class CloudOffline extends Error {
  constructor(msg = '오프라인') { super(msg); this.offline = true; }
}
export class CloudError extends Error {
  constructor(status, msg) { super(msg || `서버 오류 (HTTP ${status})`); this.status = status; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 기본 SDK 불러오기 (필요할 때만, 대체 경로에서 한 번)
async function defaultSdkLoader() {
  const base = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;
  const [app, db] = await Promise.all([import(`${base}/firebase-app.js`), import(`${base}/firebase-database.js`)]);
  return { initializeApp: app.initializeApp, ...db };
}

export class CloudStore {
  // base: DB 주소, fam: 가족 코드 해시, fetchImpl/sdkLoader: 테스트에서 바꿔 끼움
  constructor({ base = FB_URL, fam, fetchImpl, sdkLoader = defaultSdkLoader, timeoutMs = 8000 } = {}) {
    if (!fam) throw new Error('가족 코드가 필요합니다');
    this.base = base.replace(/\/$/, '');
    this.fam = fam;
    this.fetch = fetchImpl || ((...a) => fetch(...a));
    this.sdkLoader = sdkLoader;
    this.timeoutMs = timeoutMs;
    this.mode = null;          // null(미확인) | 'etag' | 'sdk'
    this.sdk = null;
    this.stats = { conflicts: 0, retries: 0, writes: 0 };
  }

  path(p) { return `families/${this.fam}/${ROOT}${p ? '/' + p : ''}`; }
  url(p, q = '') { return `${this.base}/${this.path(p)}.json${q}`; }

  async req(url, opts = {}) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), this.timeoutMs) : 0;
    try {
      return await this.fetch(url, ctl ? { ...opts, signal: ctl.signal } : opts);
    } catch (e) {
      throw new CloudOffline(e && e.name === 'AbortError' ? '서버 응답 없음' : '서버에 닿지 못함');
    } finally {
      if (t) clearTimeout(t);
    }
  }

  // 읽기 (shallow: 하위 키 목록만)
  async get(p, { shallow = false } = {}) {
    const r = await this.req(this.url(p, shallow ? '?shallow=true' : ''));
    if (!r.ok) throw new CloudError(r.status);
    return r.json();
  }

  // 덮어쓰기·부분 수정·삭제 (조건 없음: 기록 보관용 ledger 등 충돌해도 무방한 곳에만 사용)
  async put(p, value) {
    const r = await this.req(this.url(p), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    if (!r.ok) throw new CloudError(r.status);
  }
  async patch(p, obj) {
    const r = await this.req(this.url(p), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
    if (!r.ok) throw new CloudError(r.status);
  }

  // ETag와 함께 읽기. ETag를 쓸 수 없는 환경이면 null 반환 (→ SDK 대체)
  async getE(p) {
    let r;
    try {
      r = await this.req(this.url(p), { headers: { 'X-Firebase-ETag': 'true' } });
    } catch (e) {
      // 맞춤 헤더 때문에 CORS 사전 요청이 막힌 것인지, 정말 오프라인인지 일반 읽기로 구분
      await this.get(p);           // 이것도 실패하면 CloudOffline이 그대로 올라감
      return null;
    }
    if (!r.ok) throw new CloudError(r.status);
    const etag = r.headers.get('ETag');
    const value = await r.json();
    return etag ? { value, etag } : null;
  }

  // 원자적 갱신: fn(현재값) → 새 값 (undefined를 돌려주면 쓰지 않고 끝냄)
  // 반환 { committed, value } — committed=false 이면 fn이 '쓸 것 없음'을 고른 것
  async transact(p, fn, { maxTries = 12 } = {}) {
    if (this.mode !== 'sdk') {
      const first = await this.getE(p);
      if (first) {
        this.mode = 'etag';
        return this.casLoop(p, fn, first, maxTries);
      }
      this.mode = 'sdk';
    }
    return this.sdkTransact(p, fn);
  }

  async casLoop(p, fn, { value, etag }, maxTries) {
    for (let i = 0; i < maxTries; i++) {
      const next = fn(value);
      if (next === undefined) return { committed: false, value };
      const r = await this.req(this.url(p), {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'if-match': etag }, body: JSON.stringify(next),
      });
      if (r.ok) { this.stats.writes++; return { committed: true, value: next }; }
      if (r.status !== 412) throw new CloudError(r.status);
      // 다른 기기가 먼저 바꿈: 응답에 담긴 최신 값·ETag로 다시 계산 (없으면 다시 읽음)
      this.stats.conflicts++;
      let latest = null;
      try { latest = { value: await r.json(), etag: r.headers.get('ETag') }; } catch (e) { latest = null; }
      if (!latest || !latest.etag) latest = await this.getE(p);
      if (!latest) throw new CloudError(412, 'ETag 재확인 실패');
      ({ value, etag } = latest);
      this.stats.retries++;
      await sleep(10 + Math.random() * 40 * (i + 1));   // 같은 순간 재충돌을 피하려 조금씩 다르게 기다림
    }
    throw new CloudError(412, '동시 수정이 계속 겹쳐 저장하지 못했어요. 잠시 후 다시 시도해 주세요');
  }

  // 대체 경로: Firebase SDK runTransaction (서버가 충돌 시 자동 재실행)
  async sdkTransact(p, fn) {
    if (!this.sdk) {
      let m;
      try { m = await this.sdkLoader(); } catch (e) { throw new CloudOffline('Firebase SDK를 불러오지 못함'); }
      const app = m.initializeApp({ databaseURL: this.base }, 'keycap-' + this.fam);
      this.sdk = { m, db: m.getDatabase(app) };
    }
    const { m, db } = this.sdk;
    const run = m.runTransaction(m.ref(db, this.path(p)), (cur) => fn(cur === undefined ? null : cur), { applyLocally: false });
    // SDK는 오프라인이면 연결될 때까지 기다리므로 시간 제한을 둔다 (나중에 반영돼도 거래 번호로 중복 없음)
    const res = await Promise.race([run, sleep(this.timeoutMs).then(() => null)]);
    if (!res) throw new CloudOffline('서버 응답 없음 (SDK)');
    this.stats.writes++;
    return { committed: res.committed, value: res.snapshot.val() };
  }
}
