// 테스트용 탑 불러오기: 저장본(data/tower-<형태>.json)이 있으면 그것을, 없으면 직접 생성
// (저장본과 생성 결과가 같은지는 tower-data.test.mjs 가 따로 검증)
import { readFileSync, existsSync } from 'node:fs';
import { generateTower, deserializeTower, SEED } from '../js/layout.js';

export function towerFor(shape) {
  const url = new URL(`../data/tower-${shape}.json`, import.meta.url);
  if (existsSync(url)) {
    const d = JSON.parse(readFileSync(url, 'utf8'));
    if (d.seed === SEED && d.shape === shape) return deserializeTower(d);
  }
  return generateTower(SEED, shape);
}
