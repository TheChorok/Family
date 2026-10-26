// 가족 계정: 닉네임 + 닉네임별 4자리 PIN, 닉네임별 저장 (코인·구매·꾸미기·최고 기록·진행)
//
// 저장 위치 (families/{가족코드 해시}/keycap/ 아래)
//   players/{아이디}  { name, pinHash, salt, iter, created }        ← PIN 분실 시 pinHash만 지우면 됨
//   data/{아이디}     { coins, items, equip, best, progress, applied, appliedFloor, rev, updated }
//   ledger/{아이디}/{거래번호}  { type, amount, item, at, dev }       ← 코인 획득·구매 내역 (최근 것만 보관)
//
// 코인·구매는 서버 값 기준으로 조건부 쓰기(cloud.js transact). 모든 변경에 거래 번호를 붙이고,
// 이미 반영된 번호(applied)는 다시 반영하지 않는다 → 재시도·두 기기 동시 사용에도 복제·유실 없음.
import { hashPin, verifyPin, newSalt, nameId, normName, PIN_ITER, PIN_RE } from './pin.js';
import { CloudOffline } from './cloud.js';
import * as defaultStore from './storage.js';

export const MAX_EARN = 1000;             // 한 번에 얻을 수 있는 코인 상한 (잘못된 값 방지)
export const APPLIED_KEEP_MS = 30 * 864e5; // 반영 기록(applied) 보관 기간: 30일
export const APPLIED_MAX = 500;           // 반영 기록 최대 개수
export const LEDGER_KEEP = 200;           // 내역(ledger) 보관 개수 (넘으면 오래된 것부터 정리)
export const LEDGER_SLACK = 50;           // 이만큼 더 쌓였을 때 한 번에 정리 (매번 지우지 않게)
export const NAME_MAX = 10;
export const PIN_TRIES = 5;               // PIN 연속 실패 허용 횟수
export const PIN_LOCK_MS = 30000;         // 초과 시 잠깐 잠금 (이 기기에서만 — 가족 내 실수 방지 수준)

// 거래 번호: 시간순 정렬되는 앞부분 + 무작위 (기기 간 충돌 방지)
export function txnId(now = Date.now()) {
  const r = new Uint8Array(4);
  crypto.getRandomValues(r);
  return now.toString(36).padStart(9, '0') + '-' + [...r].map((b) => b.toString(36).padStart(2, '0')).join('');
}

export function emptyData() {
  return { coins: 0, items: {}, equip: {}, best: null, progress: null, applied: {}, appliedFloor: 0, rev: 0, updated: 0 };
}
function normalize(cur) {
  const d = Object.assign(emptyData(), cur || {});
  d.items = { ...(d.items || {}) }; d.equip = { ...(d.equip || {}) }; d.applied = { ...(d.applied || {}) };
  return d;
}

// 반영 기록 정리: 30일 지난 것과 개수 초과분을 지우고, 지운 것 중 가장 늦은 시각을 appliedFloor로 기록
// (그보다 오래된 거래가 뒤늦게 오면 이미 반영됐는지 알 수 없으므로 받지 않음 → 복제 방지)
export function pruneApplied(d, now) {
  const ents = Object.entries(d.applied).sort((a, b) => a[1] - b[1]);
  let cut = 0;
  while (cut < ents.length && (ents[cut][1] < now - APPLIED_KEEP_MS || ents.length - cut > APPLIED_MAX)) cut++;
  for (let i = 0; i < cut; i++) {
    d.appliedFloor = Math.max(d.appliedFloor || 0, ents[i][1]);
    delete d.applied[ents[i][0]];
  }
}

// 한 거래를 데이터에 반영 (순수 함수: 같은 입력이면 같은 결과 — 재시도 안전)
// 반환 { next } 또는 { skip: 이유 }
export function applyOp(cur, op, now) {
  const d = normalize(cur);
  if (d.applied[op.txn]) return { skip: 'already' };
  if (op.at <= (d.appliedFloor || 0)) return { skip: 'tooOld' };
  switch (op.kind) {
    case 'earn': {
      const n = op.amount | 0;
      if (n < 1 || n > MAX_EARN) return { skip: 'badAmount' };
      d.coins += n;
      break;
    }
    case 'buy': {
      const price = op.price | 0;
      if (price < 0) return { skip: 'badPrice' };
      if (d.items[op.item]) return { skip: 'owned' };
      if (d.coins < price) return { skip: 'coins' };
      d.coins -= price;
      d.items[op.item] = op.at;
      break;
    }
    case 'equip':
      if (op.item && !d.items[op.item]) return { skip: 'notOwned' };
      if (op.item) d.equip[op.slot] = op.item; else delete d.equip[op.slot];
      break;
    case 'best':
      if (d.best && !(op.time < d.best.time)) return { skip: 'notBetter' };
      d.best = { time: op.time, falls: op.falls, at: op.at };
      break;
    case 'progress':
      if (d.progress && !(op.p.at > d.progress.at)) return { skip: 'older' };
      d.progress = op.p;
      break;
    default:
      return { skip: 'unknown' };
  }
  d.applied[op.txn] = op.at;
  pruneApplied(d, now);
  d.rev = (d.rev || 0) + 1;
  d.updated = now;
  return { next: d };
}

// 오프라인이어도 쌓아 두었다가 나중에 보낼 수 있는 거래 (구매는 온라인 전용)
const QUEUEABLE = new Set(['earn', 'equip', 'best', 'progress']);

export class Account {
  // cloud: CloudStore, storage: { load, save, remove } (기본: kt_ 접두어 localStorage)
  constructor({ cloud, storage = defaultStore, now = () => Date.now() }) {
    this.cloud = cloud;
    this.st = storage;
    this.now = now;
    this.fam = cloud.fam;
    this.session = null;            // { fam, id, name }
    this.data = null;               // 마지막으로 확인한 서버 데이터 (화면 표시용)
    this.flushing = null;
    this.flushAgain = null;
    this.ledgerChecked = false;
    this.dropped = 0;               // 너무 오래돼 버린 대기 거래 수
    let dev = this.st.load('device', null);
    if (!dev) { dev = txnId(); this.st.save('device', dev); }
    this.dev = dev;
    const s = this.st.load('session', null);
    if (s && s.fam === this.fam) this.session = s;
    if (this.session) this.data = this.st.load(this.dataKey(), null);
  }

  get id() { return this.session && this.session.id; }
  dataKey(id = this.id) { return `data_${this.fam}_${id}`; }
  queueKey(id = this.id) { return `pending_${this.fam}_${id}`; }
  recKey(id) { return `acct_${this.fam}_${id}`; }
  queue() { return this.st.load(this.queueKey(), []) || []; }

  // ── 닉네임 ──
  async listPlayers() {
    const all = (await this.cloud.get('players')) || {};
    const list = Object.entries(all).map(([id, r]) => ({ id, name: r.name, hasPin: !!r.pinHash }));
    list.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    this.st.save(`players_${this.fam}`, list);
    return list;
  }
  cachedPlayers() { return this.st.load(`players_${this.fam}`, []) || []; }

  static checkName(name) {
    const n = normName(name);
    if (!n) return '닉네임을 입력해 주세요';
    if ([...n].length > NAME_MAX) return `닉네임은 ${NAME_MAX}자까지예요`;
    return null;
  }

  async create(name, pin) {
    const bad = Account.checkName(name);
    if (bad) return { error: bad };
    if (!PIN_RE.test(pin)) return { error: 'PIN은 숫자 4자리예요' };
    const n = normName(name), id = await nameId(n), salt = newSalt();
    const rec = { name: n, pinHash: await hashPin(pin, salt, id), salt, iter: PIN_ITER, created: this.now() };
    // 같은 닉네임이 이미 있으면 만들지 않음 (두 기기가 동시에 만들어도 한쪽만 성공)
    const r = await this.cloud.transact(`players/${id}`, (cur) => (cur ? undefined : rec));
    if (!r.committed) return { error: '이미 있는 닉네임이에요' };
    this.startSession(id, n, rec);
    return { ok: true, id };
  }

  // 로그인 전 상태 확인: 'login'(PIN 입력) | 'newPin'(PIN이 지워져 새로 설정) | 'missing'
  async pinState(id) {
    const rec = await this.cloud.get(`players/${id}`);
    if (!rec) return 'missing';
    return rec.pinHash ? 'login' : 'newPin';
  }

  lockLeft() {
    const l = this.st.load('pinlock', null);
    return l && l.until > this.now() ? l.until - this.now() : 0;
  }
  noteFail() {
    const l = this.st.load('pinlock', { fails: 0, until: 0 });
    l.fails = (l.fails || 0) + 1;
    if (l.fails >= PIN_TRIES) { l.until = this.now() + PIN_LOCK_MS; l.fails = 0; }
    this.st.save('pinlock', l);
  }

  async login(id, pin) {
    if (this.lockLeft()) return { error: `잠시 후 다시 시도해 주세요 (${Math.ceil(this.lockLeft() / 1000)}초)` };
    let rec;
    try {
      rec = await this.cloud.get(`players/${id}`);
    } catch (e) {
      if (!e.offline) throw e;
      rec = this.st.load(this.recKey(id), null);       // 오프라인: 이 기기에서 마지막으로 확인한 정보로
      if (!rec) return { error: '오프라인이라 확인할 수 없어요 (이 기기에서 처음 로그인)' };
    }
    if (!rec) return { error: '없는 닉네임이에요' };
    if (!rec.pinHash) return { newPin: true };
    if (!(await verifyPin(pin, rec, id))) { this.noteFail(); return { error: 'PIN이 맞지 않아요' }; }
    this.st.remove('pinlock');
    this.startSession(id, rec.name, rec);
    await this.refresh().catch(() => {});             // 오프라인이면 이 기기에 저장된 값 사용
    this.flush().catch(() => {});
    return { ok: true };
  }

  // PIN이 지워진 닉네임에 새 PIN 설정 (코인·구매·기록은 data/ 아래라 그대로 유지)
  async setNewPin(id, pin) {
    if (!PIN_RE.test(pin)) return { error: 'PIN은 숫자 4자리예요' };
    const salt = newSalt();
    const pinHash = await hashPin(pin, salt, id);
    let rec = null;
    const r = await this.cloud.transact(`players/${id}`, (cur) => {
      if (!cur || cur.pinHash) return undefined;      // 사라졌거나, 그사이 다른 기기에서 이미 설정함
      rec = { ...cur, pinHash, salt, iter: PIN_ITER };
      return rec;
    });
    if (!r.committed) return { error: '이미 다른 기기에서 PIN을 정했어요. 그 PIN으로 로그인해 주세요' };
    this.startSession(id, rec.name, rec);
    return { ok: true };
  }

  startSession(id, name, rec) {
    this.session = { fam: this.fam, id, name };
    this.st.save('session', this.session);
    this.st.save(this.recKey(id), { name: rec.name, pinHash: rec.pinHash, salt: rec.salt, iter: rec.iter });
    this.data = this.st.load(this.dataKey(), null);
    this.ledgerChecked = false;
  }

  logout() {
    this.session = null;
    this.data = null;
    this.st.remove('session');
  }

  // 시작할 때: 저장된 로그인이 아직 유효한지 확인
  // 'none' | 'ok' | 'offline'(확인 못 했지만 이 기기 로그인 유지) | 'newPin'(PIN이 지워짐) | 'relogin'(다른 기기에서 PIN 변경)
  async resume() {
    if (!this.session) return 'none';
    const id = this.id;
    let rec;
    try {
      rec = await this.cloud.get(`players/${id}`);
    } catch (e) {
      if (e.offline) return 'offline';
      throw e;
    }
    if (!rec) { this.logout(); return 'none'; }
    if (!rec.pinHash) return 'newPin';
    const cached = this.st.load(this.recKey(id), null);
    if (!cached || cached.pinHash !== rec.pinHash) { this.logout(); return 'relogin'; }
    await this.refresh();
    this.flush().catch(() => {});
    return 'ok';
  }

  // ── 데이터 ──
  async refresh() {
    if (!this.id) return null;
    const d = await this.cloud.get(`data/${this.id}`);
    this.data = normalize(d);
    this.st.save(this.dataKey(), this.data);
    return this.data;
  }

  // 화면 표시용 코인: 서버 값 + 아직 못 보낸 획득분
  coins() {
    const base = (this.data && this.data.coins) || 0;
    return base + this.queue().filter((o) => o.kind === 'earn').reduce((a, o) => a + (o.amount | 0), 0);
  }

  // 거래 하나 실행 (서버 조건부 쓰기). 반환 { ok } | { skip } | { offline } | { error }
  async run(op) {
    const id = this.id;
    let res = null;
    try {
      const r = await this.cloud.transact(`data/${id}`, (cur) => {
        res = applyOp(cur, op, this.now());
        return res.next;
      });
      if (r.committed || res.skip === 'already') {
        this.data = normalize(r.value);
        this.st.save(this.dataKey(id), this.data);
      }
      if (r.committed && (op.kind === 'earn' || op.kind === 'buy')) {
        // 내역 기록 (보관용 — 실패해도 코인에는 영향 없음)
        this.cloud.put(`ledger/${id}/${op.txn}`, {
          type: op.kind, amount: op.kind === 'earn' ? op.amount : -op.price, item: op.item || null, at: op.at, dev: this.dev,
        }).then(() => this.cleanupLedger()).catch(() => {});
      }
      return r.committed ? { ok: true } : { skip: res ? res.skip : 'none' };
    } catch (e) {
      if (e.offline) return { offline: true };
      return { error: e.message };
    }
  }

  newOp(kind, fields) {
    return { kind, txn: txnId(this.now()), at: this.now(), ...fields };
  }

  // 대기열에 넣고 바로 보내 보기 (오프라인이면 대기열에 남음)
  async enqueue(op) {
    if (!this.id) return { error: '로그인이 필요해요' };
    const q = this.queue();
    q.push(op);
    this.st.save(this.queueKey(), q);
    await this.flush();
    // 이미 진행 중이던 보내기가 이 거래를 보기 전에 끝났을 수 있어 한 번 더
    if (this.queue().some((o) => o.txn === op.txn)) await this.flush();
    return { queued: this.queue().some((o) => o.txn === op.txn) };
  }

  // 대기열 순서대로 보내기. 오프라인이면 멈추고 나중에 다시 (같은 거래 번호라 중복 반영 없음)
  flush() {
    // 이미 보내는 중이면 그 작업이 끝난 뒤 한 번 더 (그사이 연결이 돌아왔거나 새 거래가 생겼을 수 있음)
    if (this.flushing) {
      if (!this.flushAgain) this.flushAgain = this.flushing.then(() => { this.flushAgain = null; return this.flush(); });
      return this.flushAgain;
    }
    const job = (async () => {
      for (;;) {
        const q = this.queue();
        if (!q.length || !this.id) return;
        const r = await this.run(q[0]);
        if (r.offline || r.error) return;           // 나중에 다시
        if (r.skip === 'tooOld') this.dropped++;
        const rest = this.queue().filter((o) => o.txn !== q[0].txn);
        this.st.save(this.queueKey(), rest);
      }
    })();
    // 주의: 대기열이 비어 있으면 위 함수가 즉시 끝나므로, 정리는 할당 뒤에 붙인 finally에서 해야 함
    // (함수 안 finally에서 지우면 할당보다 먼저 실행돼 '끝난 작업'이 계속 남아 이후 보내기가 멈춤)
    this.flushing = job.finally(() => { if (this.flushing === wrapped) this.flushing = null; });
    const wrapped = this.flushing;
    return wrapped;
  }

  earn(amount, reason = '') { return this.enqueue(this.newOp('earn', { amount: amount | 0, reason })); }
  equip(slot, item) { return this.enqueue(this.newOp('equip', { slot, item: item || null })); }
  saveBest(time, falls) { return this.enqueue(this.newOp('best', { time, falls })); }
  saveProgress(p) { return this.enqueue(this.newOp('progress', { p: { ...p, at: this.now() } })); }

  // 구매: 온라인에서만 (서버의 현재 코인 기준으로 바로 결정)
  async buy(item, price) {
    if (!this.id) return { error: '로그인이 필요해요' };
    await this.flush();                                 // 먼저 쌓인 획득분부터 반영
    const r = await this.run(this.newOp('buy', { item, price: price | 0 }));
    if (r.offline) return { error: '인터넷에 연결되어 있을 때만 살 수 있어요' };
    if (r.skip === 'coins') return { error: '코인이 부족해요' };
    if (r.skip === 'owned') return { error: '이미 가지고 있어요' };
    return r;
  }

  // 내역 정리: 보관 개수 + 여유분을 넘으면 오래된 것부터 지움 (세션당 한 번 확인)
  async cleanupLedger(force = false) {
    if (!this.id || (this.ledgerChecked && !force)) return 0;
    this.ledgerChecked = true;
    const keys = Object.keys((await this.cloud.get(`ledger/${this.id}`, { shallow: true })) || {}).sort();
    if (keys.length <= LEDGER_KEEP + (force ? 0 : LEDGER_SLACK)) return 0;
    const del = {};
    for (const k of keys.slice(0, keys.length - LEDGER_KEEP)) del[k] = null;
    await this.cloud.patch(`ledger/${this.id}`, del);
    return Object.keys(del).length;
  }

  // 콘솔에서 PIN을 지울 때의 정확한 경로 (계정 화면·보고서 표시용)
  pinPath(id = this.id) { return `families/${this.fam}/keycap/players/${id}/pinHash`; }
}
