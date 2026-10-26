// 가족 저장소 검증 (모의 RTDB 서버 사용 — 실제 Firebase 대신 문서의 REST 동작을 재현)
// 실행: node keycap-tower/tests/cloud.test.mjs
import { createMockRtdb } from './mock-rtdb.mjs';
import { CloudStore, famHash } from '../js/cloud.js';
import { Account, applyOp, emptyData, APPLIED_MAX, APPLIED_KEEP_MS, LEDGER_KEEP } from '../js/account.js';

const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok, info }); console.log(ok ? '✔' : '✘', name, info); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 기기별 저장소 (localStorage 대신)
function memStore() {
  const m = new Map();
  return {
    load: (k, f = null) => (m.has(k) ? JSON.parse(m.get(k)) : f),
    save: (k, v) => { m.set(k, JSON.stringify(v)); return true; },
    remove: (k) => { m.delete(k); },
    m,
  };
}

const mock = createMockRtdb();
const port = await mock.listen();
const base = `http://127.0.0.1:${port}`;
const CODE = '우리집';
const fam = famHash(CODE);

// 체스와 같은 해시 함수인지 (chess.html cHash와 동일 식으로 비교)
const cHash = (s) => { let x = 5381; for (const c of s) x = (x * 33 + c.charCodeAt(0)) >>> 0; return x.toString(36); };
check('가족 코드 해시 = 체스·모노폴리·모리스와 동일', ['우리집', 'abc', 'Family 2026'].every((c) => famHash(c) === cHash('fam:' + c)));

// 기존 게임 데이터 미리 넣어 두기 (끝에 그대로인지 확인)
const others = {
  chess: [{ name: '첫째', level: 3, wins: 5 }],
  monopoly: [{ name: '둘째', wins: 2 }],
  morris: [{ name: '셋째', wins: 1 }],
  _ping: { t: 1 },
};
for (const [k, v] of Object.entries(others)) mock.write(`families/${fam}/${k}`, v);
const othersBefore = JSON.stringify(Object.fromEntries(Object.keys(others).map((k) => [k, mock.read(`families/${fam}/${k}`)])));

function device(opts = {}) {
  const st = memStore();
  const cloud = new CloudStore({ base, fam, ...opts });
  return { st, cloud, acct: new Account({ cloud, storage: st }) };
}

// ── 1. 닉네임 만들기·로그인 ──
const A = device();
let r = await A.acct.create('하늘', '1234');
check('닉네임 만들기', r.ok, JSON.stringify(r));
const id = A.acct.id;
const rec = mock.read(`families/${fam}/keycap/players/${id}`);
check('PIN 원문 저장 안 함 (해시·솔트만)', rec && !JSON.stringify(rec).includes('1234') && /^[0-9a-f]{64}$/.test(rec.pinHash), Object.keys(rec || {}).join(','));
r = await device().acct.create('하늘 ', '9999');
check('같은 닉네임 중복 금지 (공백 차이 포함)', !!r.error, r.error);
const B = device();
r = await B.acct.login(id, '0000');
check('틀린 PIN 거부', !!r.error, r.error);
r = await B.acct.login(id, '1234');
check('맞는 PIN 로그인 (다른 기기)', r.ok && B.acct.id === id);
const C = device();
for (let i = 0; i < 5; i++) await C.acct.login(id, '1111');
r = await C.acct.login(id, '1234');
check('5회 틀리면 잠시 잠금', !!r.error && /잠시/.test(r.error), r.error);

// ── 2. 두 기기 동시 코인 획득 100회씩 ──
const t0 = Date.now();
await Promise.all([A, B].map(async (d) => { for (let i = 0; i < 100; i++) await d.acct.earn(1, 'test'); }));
let data = mock.read(`families/${fam}/keycap/data/${id}`);
const conflicts = A.cloud.stats.conflicts + B.cloud.stats.conflicts;
check('동시 100회×2기기 → 코인 정확히 200 (복제·유실 0)', data.coins === 200, `코인 ${data.coins}, 충돌 재시도 ${conflicts}회, ${Date.now() - t0}ms`);
check('충돌이 실제로 발생했는지 (검증 유효성)', conflicts > 0, `${conflicts}회`);
check('대기열 비어 있음', A.acct.queue().length === 0 && B.acct.queue().length === 0);
await sleep(300);
const ledgerN = Object.keys(mock.read(`families/${fam}/keycap/ledger/${id}`) || {}).length;
check('내역(ledger) 200건', ledgerN === 200, String(ledgerN));

// ── 2b. 강한 경쟁: 5기기 × 40회, 지연 20ms (충돌 재시도 경로 집중 검증) ──
{
  mock.set({ latency: 20 });
  const devs = [];
  for (let i = 0; i < 5; i++) { const d = device(); await d.acct.login(id, '1234'); devs.push(d); }
  const b0 = mock.read(`families/${fam}/keycap/data/${id}`).coins;
  const t1 = Date.now();
  await Promise.all(devs.map(async (d) => { for (let i = 0; i < 40; i++) await d.acct.earn(1, 'stress'); }));
  mock.set({ latency: 0 });
  const got = mock.read(`families/${fam}/keycap/data/${id}`).coins - b0;
  const cf = devs.reduce((a, d) => a + d.cloud.stats.conflicts, 0);
  check('강한 경쟁 5기기×40회 → 정확히 +200', got === 200 && devs.every((d) => d.acct.queue().length === 0), `+${got}, 충돌 재시도 ${cf}회, ${Date.now() - t1}ms`);
}

// ── 3. 응답 유실(저장은 됐는데 응답이 끊김) 20% + 지연 속에서 동시 100회×2 ──
mock.set({ dropRate: 0.2, latency: 15 });
const before = mock.read(`families/${fam}/keycap/data/${id}`).coins;
await Promise.all([A, B].map(async (d) => { for (let i = 0; i < 100; i++) await d.acct.earn(1, 'drop'); }));
// 끊긴 거래는 대기열에 남음 → 다시 보내기 (같은 거래 번호라 이미 반영된 건 건너뜀)
for (let k = 0; k < 30 && (A.acct.queue().length || B.acct.queue().length); k++) { await A.acct.flush(); await B.acct.flush(); }
mock.set({ dropRate: 0, latency: 0 });
await A.acct.flush(); await B.acct.flush();
data = mock.read(`families/${fam}/keycap/data/${id}`);
check('응답 유실 20% 속 동시 100회×2 → 정확히 +200', data.coins - before === 200, `+${data.coins - before}, 유실 ${mock.stats.dropped}건`);

// ── 4. 동시 구매 경쟁 ──
mock.write(`families/${fam}/keycap/data/${id}/coins`, 100);
let [ra, rb] = await Promise.all([A.acct.buy('hat_red', 80), B.acct.buy('hat_blue', 80)]);
data = mock.read(`families/${fam}/keycap/data/${id}`);
check('잔액 100에서 80짜리 두 개 동시 구매 → 하나만 성공, 음수 없음',
  [ra, rb].filter((x) => x.ok).length === 1 && data.coins === 20, `코인 ${data.coins}, ${JSON.stringify([ra, rb])}`);
mock.write(`families/${fam}/keycap/data/${id}/coins`, 100);
[ra, rb] = await Promise.all([A.acct.buy('cape', 30), B.acct.buy('cape', 30)]);
data = mock.read(`families/${fam}/keycap/data/${id}`);
check('같은 아이템 동시 구매 → 한 번만 차감', data.coins === 70 && [ra, rb].filter((x) => x.ok).length === 1, `코인 ${data.coins}`);
r = await A.acct.equip('hat', 'cape');
check('보유 아이템 착용', mock.read(`families/${fam}/keycap/data/${id}/equip/hat`) === 'cape');
await A.acct.equip('hat', 'not_owned');
check('미보유 아이템 착용 거부', mock.read(`families/${fam}/keycap/data/${id}/equip/hat`) === 'cape');
await A.acct.saveBest(300.5, 3); await B.acct.saveBest(320, 1); await B.acct.saveBest(290.2, 5);
check('최고 기록: 더 좋은 기록만', mock.read(`families/${fam}/keycap/data/${id}/best/time`) === 290.2);

// ── 5. PIN 분실: 콘솔에서 pinHash 삭제 → 새 PIN 설정, 데이터 유지 ──
const snap = JSON.stringify(mock.read(`families/${fam}/keycap/data/${id}`));
const pinPath = A.acct.pinPath();
mock.write(pinPath, null);                                 // 대표님이 콘솔에서 지우는 것과 같은 동작
check('PIN 경로 형식', pinPath === `families/${fam}/keycap/players/${id}/pinHash`, pinPath);
check('pinHash 삭제 후 → 새 PIN 필요', (await B.acct.resume()) === 'newPin' && (await A.acct.pinState(id)) === 'newPin');
r = await A.acct.login(id, '1234');
check('예전 PIN으로는 로그인 대신 새 PIN 안내', !!r.newPin);
const [n1, n2] = await Promise.all([A.acct.setNewPin(id, '5678'), B.acct.setNewPin(id, '4321')]);
check('두 기기 동시 새 PIN 설정 → 하나만 적용', [n1, n2].filter((x) => x.ok).length === 1, JSON.stringify([n1, n2]));
const winner = n1.ok ? '5678' : '4321';
const D = device();
check('새 PIN으로 로그인', (await D.acct.login(id, winner)).ok);
check('코인·구매·꾸미기·기록 그대로', JSON.stringify(mock.read(`families/${fam}/keycap/data/${id}`)) === snap);
check('PIN 바뀐 뒤 다른 기기 저장 로그인 → 다시 로그인 요구', (await (n1.ok ? B : A).acct.resume()) === 'relogin');

// ── 6. 오프라인: 획득은 대기열, 구매 거부, 다시 연결되면 반영 ──
let online = true;
const flaky = (...a) => (online ? fetch(...a) : Promise.reject(new TypeError('Failed to fetch')));
const E = device({ fetchImpl: flaky });
await E.acct.login(id, winner);
const c0 = mock.read(`families/${fam}/keycap/data/${id}/coins`);
online = false;
for (let i = 0; i < 10; i++) await E.acct.earn(3, 'offline');
await E.acct.saveBest(100, 0);
check('오프라인 획득 10회 → 대기열 11건, 화면 코인에 포함', E.acct.queue().length === 11 && E.acct.coins() === c0 + 30, `대기 ${E.acct.queue().length}, 표시 ${E.acct.coins()}`);
r = await E.acct.buy('shoes', 1);
check('오프라인 구매 거부', !!r.error, r.error);
check('오프라인 중 서버 변화 없음', mock.read(`families/${fam}/keycap/data/${id}/coins`) === c0);
r = await E.acct.login(id, winner);
check('오프라인 재로그인 (이 기기 캐시로 확인)', r.ok);
check('오프라인 시작 시 로그인 유지', (await E.acct.resume()) === 'offline');
online = true;
await E.acct.flush();
check('다시 연결 → 대기열 반영 (+30, 기록 갱신)', mock.read(`families/${fam}/keycap/data/${id}/coins`) === c0 + 30 &&
  mock.read(`families/${fam}/keycap/data/${id}/best/time`) === 100 && E.acct.queue().length === 0);

// ── 7. 정리 규칙: applied 최대 500·30일, ledger 200 ──
{
  let d = emptyData(), now = 1e12;
  for (let i = 0; i < 700; i++) { now += 1000; d = applyOp(d, { kind: 'earn', amount: 1, txn: 't' + String(i).padStart(4, '0'), at: now }, now).next; }
  check('applied 최대 개수 유지', Object.keys(d.applied).length === APPLIED_MAX && d.coins === 700, `${Object.keys(d.applied).length}개`);
  const later = now + APPLIED_KEEP_MS + 5000;
  d = applyOp(d, { kind: 'earn', amount: 1, txn: 'late', at: later }, later).next;
  check('30일 지난 applied 정리', Object.keys(d.applied).length === 1, `${Object.keys(d.applied).length}개, floor ${d.appliedFloor}`);
  const old = applyOp(d, { kind: 'earn', amount: 1, txn: 't0001', at: 1e12 + 2000 }, later);
  check('정리된 시점보다 오래된 거래는 거부 (중복 반영 방지)', old.skip === 'tooOld');
}
{
  const F = device();
  await F.acct.login(id, winner);
  const l = {};
  for (let i = 0; i < 320; i++) l[`zz${String(i).padStart(4, '0')}`] = { type: 'earn', amount: 1, at: i };
  await F.cloud.patch(`ledger/${id}`, l);
  const n0 = Object.keys(mock.read(`families/${fam}/keycap/ledger/${id}`)).length;
  const del = await F.acct.cleanupLedger(true);
  const n1b = Object.keys(mock.read(`families/${fam}/keycap/ledger/${id}`)).length;
  check(`ledger 정리 → ${LEDGER_KEEP}건 유지`, n1b === LEDGER_KEEP, `${n0} → ${n1b} (삭제 ${del})`);
}

// ── 8. ETag를 쓸 수 없는 환경 → SDK 대체 경로로 전환 (SDK는 가짜로 대체해 전환 판단만 검증) ──
{
  mock.set({ cors: { allowEtag: true, expose: false } });
  // Node fetch는 CORS가 없어 '헤더 노출 안 됨'을 흉내 내려고 ETag 헤더를 지운 응답을 돌려줌
  const noEtag = async (...a) => { const res = await fetch(...a); const h = new Headers(res.headers); h.delete('ETag'); return new Response(await res.text(), { status: res.status, headers: h }); };
  let sdkCalls = 0;
  const fakeSdk = async () => ({
    initializeApp: () => ({}), getDatabase: () => ({}), ref: (db, p) => p,
    runTransaction: async (p, fn) => {     // 서버 값을 읽어 fn 적용 후 저장 (실제 SDK의 원자적 재시도는 서버가 보장)
      sdkCalls++;
      const cur = mock.read(p);
      const next = fn(cur);
      if (next !== undefined) mock.write(p, next);
      return { committed: next !== undefined, snapshot: { val: () => (next !== undefined ? next : cur) } };
    },
  });
  const G = device({ fetchImpl: noEtag, sdkLoader: fakeSdk });
  await G.acct.login(id, winner);
  const cc = mock.read(`families/${fam}/keycap/data/${id}/coins`);
  await G.acct.earn(5);
  check('ETag 못 읽으면 SDK 경로로 전환', G.cloud.mode === 'sdk' && sdkCalls > 0 && mock.read(`families/${fam}/keycap/data/${id}/coins`) === cc + 5, `mode ${G.cloud.mode}`);
  mock.set({ cors: { allowEtag: true, expose: true } });
}

// ── 9. 다른 게임 데이터 영향 없음 ──
const othersAfter = JSON.stringify(Object.fromEntries(Object.keys(others).map((k) => [k, mock.read(`families/${fam}/${k}`)])));
check('체스·모노폴리·모리스·_ping 데이터 그대로', othersBefore === othersAfter);
const famKeys = Object.keys(mock.read(`families/${fam}`)).sort().join(',');
check('가족 경로에는 keycap만 추가', famKeys === '_ping,chess,keycap,monopoly,morris', famKeys);

await mock.close();
const fail = results.filter((x) => !x.ok).length;
console.log(`결과 ${results.length - fail}/${results.length}`);
process.exit(fail ? 1 : 0);
