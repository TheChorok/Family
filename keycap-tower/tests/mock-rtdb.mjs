// 테스트용 모의 Firebase Realtime Database REST 서버 (실제 서버 대신 로컬에서 동작 확인)
// Firebase 문서의 동작을 따라 구현: GET/PUT/PATCH/DELETE, shallow, 조건부 요청
//  - 'X-Firebase-ETag: true' 요청 → 응답에 ETag (값이 없으면 'null_etag')
//  - PUT + 'if-match' → 일치하면 저장, 아니면 412 + 최신 값·ETag
//  - PATCH 는 조건부 불가(400), 여러 경로 한 번에 원자적 반영, null = 삭제
//  - 빈 객체·null 은 저장하지 않음 (RTDB와 같음)
// 장애 주입: dropRate(저장 후 응답 끊기), latency(지연), cors(ETag 헤더 허용/노출 여부)
// 단독 실행: node mock-rtdb.mjs 9100
import http from 'node:http';
import { createHash } from 'node:crypto';

function clean(v) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object') return v;
  const o = {};
  for (const [k, x] of Object.entries(v)) { const c = clean(x); if (c !== null) o[k] = c; }
  return Object.keys(o).length ? o : null;
}
const canon = (v) => (v && typeof v === 'object'
  ? '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}' : JSON.stringify(v));
export const etagOf = (v) => (v === null ? 'null_etag' : createHash('sha1').update(canon(v)).digest('base64'));

export function createMockRtdb({ dropRate = 0, latency = 0, cors = { allowEtag: true, expose: true } } = {}) {
  let root = null;
  const stats = { gets: 0, puts: 0, patches: 0, conflicts: 0, dropped: 0 };
  const parts = (p) => p.split('/').filter(Boolean);
  function read(p) {
    let v = root;
    for (const k of parts(p)) { if (!v || typeof v !== 'object') return null; v = v[k] ?? null; }
    return v;
  }
  function write(p, val) {
    const ks = parts(p);
    if (!ks.length) { root = clean(val); return; }
    root = root && typeof root === 'object' ? root : {};
    let o = root;
    for (const k of ks.slice(0, -1)) { if (!o[k] || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }
    o[ks[ks.length - 1]] = val;
    root = clean(root);
  }
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => setTimeout(() => handle(req, res, body), latency ? Math.random() * latency : 0));
  });
  function send(res, code, val, headers = {}) {
    const h = { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', ...headers };
    if (cors.expose) h['Access-Control-Expose-Headers'] = 'ETag';
    res.writeHead(code, h);
    res.end(JSON.stringify(val));
  }
  function handle(req, res, body) {
    const u = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') {
      const allow = ['Content-Type'].concat(cors.allowEtag ? ['X-Firebase-ETag', 'if-match'] : []);
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,PUT,PATCH,DELETE,POST,OPTIONS',
        'Access-Control-Allow-Headers': allow.join(','), 'Access-Control-Max-Age': '600',
      });
      return res.end();
    }
    if (!u.pathname.endsWith('.json')) return send(res, 404, { error: 'not found' });
    const p = decodeURIComponent(u.pathname.slice(0, -5));
    const wantEtag = String(req.headers['x-firebase-etag'] || '') === 'true';
    const ifMatch = req.headers['if-match'];
    const cur = read(p);
    if (req.method === 'GET') {
      stats.gets++;
      let v = cur;
      if (u.searchParams.get('shallow') === 'true' && v && typeof v === 'object') v = Object.fromEntries(Object.keys(v).map((k) => [k, true]));
      return send(res, 200, v, wantEtag ? { ETag: etagOf(cur) } : {});
    }
    let val;
    try { val = body ? JSON.parse(body) : null; } catch (e) { return send(res, 400, { error: 'Invalid data' }); }
    if (req.method === 'PUT') {
      stats.puts++;
      if (ifMatch !== undefined && ifMatch !== etagOf(cur)) {
        stats.conflicts++;
        return send(res, 412, cur, { ETag: etagOf(cur) });
      }
      write(p, val);
      if (dropRate && Math.random() < dropRate) { stats.dropped++; return req.socket.destroy(); }   // 저장은 됐는데 응답이 사라짐
      return send(res, 200, read(p), wantEtag ? { ETag: etagOf(read(p)) } : {});
    }
    if (req.method === 'PATCH') {
      stats.patches++;
      if (ifMatch !== undefined) return send(res, 400, { error: 'conditional PATCH not supported' });
      for (const [k, v] of Object.entries(val || {})) write(p + '/' + k, v);
      return send(res, 200, val);
    }
    if (req.method === 'DELETE') { write(p, null); return send(res, 200, null); }
    return send(res, 405, { error: 'method' });
  }
  return {
    server, stats,
    get root() { return root; },
    read, write,
    set(opts) { if ('dropRate' in opts) dropRate = opts.dropRate; if ('latency' in opts) latency = opts.latency; if (opts.cors) cors = opts.cors; },
    listen(port = 0) { return new Promise((r) => server.listen(port, '127.0.0.1', () => r(server.address().port))); },
    close() { return new Promise((r) => server.close(r)); },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = +(process.argv[2] || 9100);
  const m = createMockRtdb();
  globalThis.__mock = m;
  // 테스트 제어용 엔드포인트: /__ctl?drop=0.2&latency=50&etag=0  /__dump
  const orig = m.server.listeners('request')[0];
  m.server.removeAllListeners('request');
  m.server.on('request', (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/__ctl') {
      const o = {};
      if (u.searchParams.has('drop')) o.dropRate = +u.searchParams.get('drop');
      if (u.searchParams.has('latency')) o.latency = +u.searchParams.get('latency');
      if (u.searchParams.has('etag')) o.cors = { allowEtag: u.searchParams.get('etag') === '1', expose: u.searchParams.get('etag') === '1' };
      m.set(o);
      res.writeHead(200, { 'Access-Control-Allow-Origin': '*' }); return res.end('ok');
    }
    if (u.pathname === '/__dump') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ root: m.root, stats: m.stats }));
    }
    return orig(req, res);
  });
  m.listen(port).then((p) => console.log('mock rtdb on', p));
}
