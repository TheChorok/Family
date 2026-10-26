// 탑 데이터 미리 계산: node keycap-tower/tools/build-tower.mjs [shaft]
// 배치 생성기(layout/core.js, shapes/*)나 시드를 바꾸면 다시 실행해 data/tower-<형태>.json 을 갱신한다.
import { writeFileSync } from 'node:fs';
import { generateTower, serializeTower, SEED, DEFAULT_SHAPE } from '../js/layout.js';

const shape = process.argv[2] || DEFAULT_SHAPE;
const t0 = Date.now();
const t = generateTower(SEED, shape);
const url = new URL(`../data/tower-${shape}.json`, import.meta.url);
writeFileSync(url, JSON.stringify(serializeTower(t, SEED)));
console.log(`${shape}: 키캡 ${t.boxes.length}개, ${((Date.now() - t0) / 1000).toFixed(1)}초 → ${url.pathname}`);
