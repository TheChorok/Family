# 가족 서버(Firebase) 보안 규칙 안내 — 키캡 타워 계정 추가용

규칙 파일: [`firebase-rules.json`](./firebase-rules.json)
대상 DB: `thechorokfamilygame-default-rtdb` (asia-southeast1)

> ⚠️ 이 규칙 문안은 **문법(JSON)만 자동 확인**했습니다. 규칙 식이 의도대로 동작하는지는
> 개발 환경에서 Firebase 에뮬레이터 실행이 막혀 검증하지 못했습니다(불확실).
> 아래 "적용 전 확인" 순서대로 콘솔의 **규칙 플레이그라운드**에서 먼저 시험한 뒤 게시해 주세요.

## 1. 지금 쓰는 경로 (코드 전수 조사, 2026-10-26 main 기준)

| 게임 | 경로 | 동작 |
|---|---|---|
| 체스 | `families/{가족해시}/chess` | 읽기·PUT 덮어쓰기 |
| 춍춍폴리 | `families/{가족해시}/monopoly` | 읽기·PUT 덮어쓰기 |
| 모리스 | `families/{가족해시}/morris` | 읽기·PUT 덮어쓰기 |
| 세 게임 공통 '연결 테스트' | `families/{가족해시}/_ping` | 쓰기 후 읽기 |
| 키캡 타워 (이번 추가) | `families/{가족해시}/keycap/players·data·ledger` | 아래 표 |

키캡 타워 저장 구조:

| 경로 | 내용 |
|---|---|
| `keycap/players/{아이디}` | `name`(닉네임), `pinHash`(PIN 해시), `salt`, `iter`, `created` |
| `keycap/data/{아이디}` | `coins`, `items`, `equip`, `best`, `progress`, `applied`(반영된 거래 번호), `appliedFloor`, `rev`, `updated` |
| `keycap/ledger/{아이디}/{거래번호}` | 코인 획득·구매 내역 (최근 200건만 보관) |

## 2. 규칙이 하는 일

- **최상위 읽기 금지**: DB 전체·가족 목록을 한 번에 내려받지 못하게 함 (지금은 막혀 있지 않을 가능성이 높음)
- **가족 경로 안은 지금과 같이 허용**: 체스·춍춍폴리·모리스·`_ping`은 읽기/쓰기 그대로
- **키캡 데이터 형식 검사**: 코인은 0 이상 정수, PIN 해시는 64자, 모르는 항목은 거부 등
- 한계: 로그인(인증) 없는 구조라 **가족 해시를 아는 사람은 여전히 읽고 쓸 수 있음**.
  가족 코드를 길고 추측하기 어렵게 정하는 것이 가장 효과적인 보호입니다.

## 3. 적용 전 확인 (기존 게임이 계속 동작하는지)

0. **백업**: 콘솔 → Realtime Database → 규칙 탭의 현재 규칙 전체를 복사해 메모장에 보관
1. **데이터 탭 최상위 확인**: 최상위에 `families` 말고 다른 항목이 있으면 알려 주세요
   (새 규칙은 `families` 밖을 모두 막으므로, 쓰는 곳이 있다면 규칙을 추가해야 함)
2. 규칙 탭에 `firebase-rules.json` 내용을 붙여넣고 **게시하지 말고** '규칙 플레이그라운드'에서 시험:

| 시뮬레이션 | 위치 | 기대 결과 |
|---|---|---|
| 읽기 | `/families/test1/chess` | ✅ 허용 |
| 설정(set) `[{"name":"a"}]` | `/families/test1/chess` | ✅ 허용 |
| 설정 | `/families/test1/monopoly`, `/families/test1/morris`, `/families/test1/_ping` | ✅ 허용 |
| 읽기 | `/` (최상위) | ❌ 거부 |
| 읽기 | `/families` | ❌ 거부 |
| 설정 `-5` | `/families/test1/keycap/data/u1/coins` | ❌ 거부 |
| 설정 `120` | `/families/test1/keycap/data/u1/coins` | ✅ 허용 |
| 설정 `{"name":"하늘","created":1,"pinHash":"…64자…","salt":"ab","iter":100000}` | `/families/test1/keycap/players/u1` | ✅ 허용 |

3. 게시 후 실제 확인
   - 체스·춍춍폴리·모리스 각각 **가족 서버 → 연결 테스트** 버튼 → ✅ 확인
   - 한 판씩 플레이 후 데이터 탭에서 해당 경로 값이 갱신됐는지 확인
   - 키캡 타워 `?debug=1` → 계정 로그인 후 마지막 줄 `서버 etag` 또는 `서버 sdk` 표시 확인
4. 문제가 있으면 0번에서 백업한 규칙을 다시 붙여넣고 게시 (즉시 원래대로)

## 4. PIN 분실 시 (대표님 작업)

콘솔 → Realtime Database → 데이터 탭에서 아래 항목 **하나만** 삭제합니다.

```
families/{가족코드 해시}/keycap/players/{아이디}/pinHash
```

- 정확한 경로는 키캡 타워에서 그 닉네임으로 로그인 → 타이틀의 👤 닉네임 → **부모님용: PIN 분실 시** 에 표시됩니다.
- 로그인할 수 없는 상황이면: 데이터 탭에서 `keycap/players` 아래 항목들을 펼쳐 `name`이 해당 닉네임인 것을 찾고,
  그 안의 `pinHash`만 지우면 됩니다 (`name`·`salt` 등 다른 항목과 `keycap/data`는 지우지 마세요).
- 다음 접속 때 그 닉네임은 **새 PIN 설정 화면**이 뜨고, 코인·구매·꾸미기·기록은 그대로 유지됩니다.
- 다른 기기에 로그인돼 있던 경우: PIN이 바뀐 것을 감지해 다시 로그인을 요청합니다.
