// 계정 화면: 가족 코드 연결 → 닉네임 선택/만들기 → PIN 입력 (숫자 키패드)
// 화면 상태만 다루고, 저장·확인은 account.js / cloud.js 가 담당
import { Account, NAME_MAX } from './account.js';
import { PIN_RE } from './pin.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class AccountUI {
  // host: { body(요소), getAcct(), connect(code), disconnect(), close(), changed(), toast(msg) }
  constructor(host) {
    this.h = host;
    this.el = host.body;
    this.view = null;
    this.pin = '';
    this.busy = false;
    // PC: 숫자 키·백스페이스로 키패드 입력
    window.addEventListener('keydown', (e) => {
      if (!this.view || !this.view.pad || !this.el.isConnected || !this.el.closest('.overlay.show')) return;
      if (e.target && e.target.tagName === 'INPUT') return;
      if (/^\d$/.test(e.key)) this.press(e.key);
      else if (e.key === 'Backspace') this.press('back');
    });
  }

  // 화면 열기: view = 'auto' | 'list' | 'family' | 'login' | 'newPin' | 'create' | 'me'
  open(view = 'auto', arg = null) {
    const a = this.h.getAcct();
    if (view === 'auto') view = !a ? 'family' : a.session ? 'me' : 'list';
    this.view = { name: view, arg, pad: ['login', 'newPin', 'create'].includes(view), step: 0, first: '' };
    this.pin = '';
    this.msg = '';
    this.render();
    if (view === 'list') this.loadList();
  }

  setMsg(m, bad = true) { this.msg = m; this.msgBad = bad; this.render(); }

  render() {
    const v = this.view, a = this.h.getAcct();
    let html = '';
    const back = (to) => `<button class="big" data-act="go" data-to="${to}">← 돌아가기</button>`;
    if (v.name === 'family') {
      html = `<h2>👨‍👩‍👧 가족 서버 연결</h2>
        <p class="sub">체스·춍춍폴리·모리스와 <b>같은 가족 코드</b>를 쓰면 같은 방이에요.</p>
        <input id="acFam" type="password" maxlength="30" placeholder="우리끼리 정한 가족 코드" class="acInput" autocomplete="off">
        <button class="big primary" data-act="fam">🔗 연결하기</button>
        <button class="big" data-act="close">게스트로 하기 (이 기기에만 저장)</button>`;
    } else if (v.name === 'list') {
      const list = this.list || (a ? a.cachedPlayers() : []);
      html = `<h2>👤 누구세요?</h2>
        <div class="acList">${list.map((p) => `<button class="acName" data-act="pick" data-id="${p.id}">${esc(p.name)}${p.hasPin ? '' : ' 🆕'}</button>`).join('') || '<p class="sub">아직 닉네임이 없어요</p>'}</div>
        <button class="big primary" data-act="go" data-to="create">➕ 새 닉네임 만들기</button>
        <button class="big" data-act="close">게스트로 하기</button>
        <button class="small" data-act="unfam">가족 코드 바꾸기</button>`;
    } else if (v.name === 'create' && v.step === 0) {
      html = `<h2>➕ 새 닉네임</h2>
        <input id="acName" maxlength="${NAME_MAX}" placeholder="닉네임 (${NAME_MAX}자까지)" class="acInput" autocomplete="off">
        <button class="big primary" data-act="name">다음 → PIN 정하기</button>${back('list')}`;
    } else if (v.pad) {
      const who = v.name === 'create' ? v.newName : (v.arg && v.arg.name) || '';
      const title = v.name === 'login' ? `🔒 ${esc(who)}의 PIN`
        : v.step === 2 || (v.name === 'newPin' && v.step === 1) ? '🔁 한 번 더 입력' : `🆕 ${esc(who)}의 새 PIN (숫자 4자리)`;
      const dots = [0, 1, 2, 3].map((i) => `<span class="acDot${i < this.pin.length ? ' on' : ''}"></span>`).join('');
      const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'];
      html = `<h2>${title}</h2>
        ${v.name === 'newPin' && v.step === 0 ? '<p class="sub">PIN이 초기화되었어요. 새 PIN을 정해 주세요.<br>코인·아이템·기록은 그대로예요.</p>' : ''}
        <div class="acDots">${dots}</div>
        <div class="acPad">${keys.map((k) => (k ? `<button data-act="key" data-k="${k}">${k === 'back' ? '⌫' : k}</button>` : '<span></span>')).join('')}</div>
        ${back(v.name === 'newPin' ? 'close' : 'list')}`;
    } else if (v.name === 'me') {
      const d = a.data || {};
      const best = d.best ? `${Math.floor(d.best.time / 60)}분 ${(d.best.time % 60).toFixed(1)}초 · 낙하 ${d.best.falls}회` : '아직 없음';
      const pend = a.queue().length;
      html = `<h2>👤 ${esc(a.session.name)}</h2>
        <table class="rec"><tr><th>코인</th><td>🪙 ${a.coins()}</td></tr>
        <tr><th>아이템</th><td>${Object.keys(d.items || {}).length}개</td></tr>
        <tr><th>최고 기록</th><td>${best}</td></tr></table>
        <p class="sub">${pend ? `⏳ 아직 서버에 못 보낸 기록 ${pend}건 (연결되면 자동 전송)` : '☁️ 서버와 동기화됨'}</p>
        <button class="big primary" data-act="close">확인</button>
        <button class="big" data-act="logout">다른 닉네임으로 바꾸기</button>
        <details class="acInfo"><summary>부모님용: PIN 분실 시</summary>
          <p>Firebase 콘솔 → Realtime Database → 데이터에서 아래 항목(pinHash)만 지우면 다음 접속 때 새 PIN을 정해요. 코인·기록은 유지돼요.</p>
          <code>${esc(a.pinPath())}</code></details>`;
    }
    if (this.msg) html += `<p class="acMsg${this.msgBad ? ' bad' : ''}">${esc(this.msg)}</p>`;
    if (this.busy) html += '<p class="acMsg">⏳ 확인 중…</p>';
    this.el.innerHTML = html;
    for (const b of this.el.querySelectorAll('[data-act]')) {
      b.addEventListener('click', (e) => { e.preventDefault(); this.act(b.dataset.act, b.dataset); });
    }
  }

  async loadList() {
    const a = this.h.getAcct();
    try {
      this.list = await a.listPlayers();
      this.msg = '';
    } catch (e) {
      this.list = a.cachedPlayers();
      this.msg = e.offline ? '오프라인이에요 — 이 기기에서 쓰던 닉네임만 보여요' : e.message;
      this.msgBad = true;
    }
    if (this.view && this.view.name === 'list') this.render();
  }

  async act(act, ds) {
    if (this.busy) return;
    const a = this.h.getAcct();
    if (act === 'close') { this.view = null; this.h.close(); return; }
    if (act === 'go') { if (ds.to === 'close') { this.view = null; this.h.close(); } else this.open(ds.to); return; }
    if (act === 'fam') {
      const code = (this.el.querySelector('#acFam').value || '').trim();
      if (code.length < 2) return this.setMsg('가족 코드는 2자 이상이에요');
      this.h.connect(code);
      return this.open('list');
    }
    if (act === 'unfam') { this.h.disconnect(); return this.open('family'); }
    if (act === 'logout') { a.logout(); this.h.changed(); return this.open('list'); }
    if (act === 'pick') {
      const p = (this.list || a.cachedPlayers()).find((x) => x.id === ds.id);
      return this.run(async () => {
        let state = 'login';
        try { state = await a.pinState(ds.id); } catch (e) { if (!e.offline) throw e; }
        if (state === 'missing') return this.setMsg('없는 닉네임이에요');
        this.open(state === 'newPin' ? 'newPin' : 'login', { id: ds.id, name: p ? p.name : '' });
      });
    }
    if (act === 'name') {
      const name = this.el.querySelector('#acName').value;
      const bad = Account.checkName(name);
      if (bad) return this.setMsg(bad);
      this.view = { name: 'create', pad: true, step: 1, newName: name.trim() };
      this.pin = '';
      this.msg = '';
      return this.render();
    }
    if (act === 'key') return this.press(ds.k);
  }

  press(k) {
    const v = this.view;
    if (!v || !v.pad || this.busy) return;
    if (k === 'back') this.pin = this.pin.slice(0, -1);
    else if (this.pin.length < 4) this.pin += k;
    this.msg = '';
    this.render();
    if (this.pin.length === 4) setTimeout(() => this.submitPin(), 120);
  }

  async submitPin() {
    const v = this.view, a = this.h.getAcct(), pin = this.pin;
    if (!PIN_RE.test(pin)) return;
    if (v.name === 'login') {
      return this.run(async () => {
        const r = await a.login(v.arg.id, pin);
        if (r.newPin) return this.open('newPin', v.arg);
        if (r.error) { this.pin = ''; return this.setMsg(r.error); }
        this.done(`👋 ${a.session.name} 로그인!`);
      });
    }
    // 새 PIN(만들기·재설정): 두 번 입력해 확인
    const confirmStep = v.name === 'create' ? 2 : 1;
    if (v.step < confirmStep) {
      v.first = pin; v.step++; this.pin = '';
      return this.render();
    }
    if (pin !== v.first) {
      v.step = confirmStep - 1; v.first = ''; this.pin = '';
      return this.setMsg('두 번 입력한 PIN이 달라요. 처음부터 다시 입력해 주세요');
    }
    return this.run(async () => {
      const r = v.name === 'create' ? await a.create(v.newName, pin) : await a.setNewPin(v.arg.id, pin);
      if (r.error) { this.pin = ''; v.step = confirmStep - 1; return this.setMsg(r.error); }
      this.done(v.name === 'create' ? `🎉 ${a.session.name} 만들기 완료!` : '🔑 새 PIN 설정 완료!');
    });
  }

  async run(fn) {
    this.busy = true; this.render();
    try { await fn(); } catch (e) {
      this.busy = false;
      this.pin = '';
      return this.setMsg(e.offline ? '인터넷 연결을 확인해 주세요' : e.message);
    }
    this.busy = false;
    if (this.view) this.render();
  }

  done(msg) {
    this.view = null;
    this.h.changed();
    this.h.close();
    this.h.toast(msg);
  }
}
