// 저장된 탑 데이터가 현재 생성기·시드로 새로 만든 결과와 완전히 같은지 검증 (약 2분 소요)
// 실행: node keycap-tower/tests/tower-data.test.mjs
import { readFileSync } from 'node:fs';
import { generateTower, serializeTower, SEED, DEFAULT_SHAPE } from '../js/layout.js';

const shape = process.argv[2] || DEFAULT_SHAPE;
const saved = readFileSync(new URL(`../data/tower-${shape}.json`, import.meta.url), 'utf8');
const fresh = JSON.stringify(serializeTower(generateTower(SEED, shape), SEED));
const ok = saved === fresh;
console.log(`[${shape}] 저장본 ${ok ? '일치' : '불일치 — node keycap-tower/tools/build-tower.mjs 로 다시 만들어 주세요'} (${saved.length} 바이트)`);
process.exit(ok ? 0 : 1);
