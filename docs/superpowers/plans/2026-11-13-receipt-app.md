# 법인카드 영수증 정리 웹앱 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 영수증 사진을 찍으면 월별 엑셀(.xlsx)과 "법인카드사용 지출내역서" PDF를 폰에서 만들어 주는 PWA.

**Architecture:** 서버 없는 클라이언트 전용 React 앱. 데이터와 사진은 IndexedDB에 저장한다. 인식은 브라우저에서 Gemini API를 직접 호출한다. 페이지 배치, 검증, 항목 추천, 원근 보정 계산은 순수 함수로 분리해서 Node에서 테스트한다. 화면은 이 함수들을 조립하기만 한다.

**Tech Stack:** Node 24, Vite + React 18 + TypeScript, Vitest, Dexie 4 + fake-indexeddb(테스트), pdf-lib + @pdf-lib/fontkit, ExcelJS, JSZip, @google/genai, react-router-dom(HashRouter), vite-plugin-pwa, Playwright, npm `pretendard`(글꼴).

**Spec:** `docs/superpowers/specs/2026-11-13-receipt-app-design.md` — 각 태스크는 설계서의 해당 절(§)을 함께 읽는다.

## Global Constraints

- 화면 문구, 엑셀, PDF의 모든 사용자 노출 텍스트는 한국어
- 비용 0원: 서버 없음, Gemini 무료 등급, GitHub Pages
- Gemini API 키는 IndexedDB 설정에만 저장한다. 코드, 저장소, 백업 zip에 넣지 않는다.
- 원본 사진: 긴 변 2400px JPEG / 인식용: 긴 변 1600px, 품질 0.85 / 보정본: 긴 변 1600px 이하, 흑백, 품질 0.8
- 인식 묶음: 요청당 최대 5장, 요청 간 최소 7000ms, 429면 Flash-Lite로 1회 재시도
- `corners`는 0~1000 정규화 좌표, 순서는 좌상, 우상, 우하, 좌하
- 식사 항목: 시각 < 10:30 → `조식`, 10:30~16:00 → `중식`, 그 외 → `석식`
- 자동완성 정렬: 최근 30일 안에 쓴 값 먼저, 그 안에서 `useCount` 내림차순
- 정렬 기본값: 최신순(날짜 → 시각). `date`/`time`이 null인 건은 항상 맨 뒤
- PDF: A4 210×297mm, 여백 좌우 15, 위 20, 아래 15mm, 제목 블록 16mm, 제목 18pt, 표 행 9mm, 표 글자 10pt, 표 열 비율 12/22/12/21/12/21%, 표-사진 간격 8mm, 사진 2열, 열 간격 6mm, 열 너비 87mm, 사진 줄 간격 6mm, 최소 사진 너비 45mm
- 파일 이름: `{YYYY}년 {M}월 법인카드(#{카드}) 사용내역서_{기본 사용자}.pdf|.xlsx`, 일부만 생성하면 뒤에 `({MM.DD}~{MM.DD})`
- 엑셀 열: No / 일자 / 카드번호 / 사용금액 / 내용 / 사용자 / 가맹점 / 승인번호, 금액 서식 `#,##0`, 시트 이름 `YYYY-MM`
- 내용 = `{현장} : {항목}`
- Windows 개발 환경. 명령은 PowerShell/npm 기준

## Review Focus

1. **아주 긴 영수증** (세로/가로 비율 > 4, 예: 주유소 영수증 두 번 이어 찍기): 페이지를 넘치지 않고 혼자 한 페이지에 들어가야 한다. → Task 6 `test_extremely_tall_photo_gets_own_page`
2. **일자를 못 읽은 건** (`date: null`): 정렬, 배치, 엑셀, 파일 이름이 깨지지 않고 맨 뒤에 빈칸으로 나와야 한다. → Task 1 `sorts nulls last`, Task 7 `null date renders blank cell`, Task 7 `fileName ignores null dates in range`
3. **묶음 응답의 결과 수가 이미지 수와 다름** (Gemini가 5장 중 4개만 반환, 또는 index 중복): 다른 영수증 값이 잘못 들어가면 안 되고, 짝을 못 찾은 사진은 1장 단위로 다시 대기열에 들어가야 한다. → Task 5 `unmatched images are requeued singly`
4. **긴 내용/사용자 텍스트** (현장 이름 40자 이상, 사용자 5명): 표 셀을 넘치지 않아야 한다. 글자를 8pt까지 줄이고, 그래도 넘치면 두 줄로 나눈다. → Task 8 `fitText shrinks then wraps`
5. **디코딩할 수 없는 사진** (일부 안드로이드 브라우저에서 갤러리의 HEIC, 깨진 파일): 앱이 멈추지 않고 그 파일만 "열 수 없는 사진" 메시지로 건너뛰어야 한다. → Task 11 `ingest skips undecodable file with message`

---

## File Structure

```
receipt-app/
  index.html, package.json, vite.config.ts, tsconfig.json, vitest.config.ts, playwright.config.ts
  .github/workflows/deploy.yml
  src/
    main.tsx, App.tsx                      # 라우팅(HashRouter), 전역 레이아웃
    domain/types.ts                        # 설계서 §5 타입
    domain/sort.ts                         # sortReceipts
    domain/content.ts                      # composeContent, suggestItem
    domain/validate.ts                     # validateReceipt
    storage/db.ts                          # Dexie 스키마
    storage/receipts.ts, presets.ts, settings.ts
    imaging/homography.ts                  # 순수 수학
    imaging/warp.ts                        # ImageData 원근 보정(순수)
    imaging/scanFilter.ts                  # 흑백+레벨(순수)
    imaging/browser.ts                     # Blob↔ImageData, 축소 (canvas, 브라우저 전용)
    recognition/schema.ts                  # responseSchema, parseRecognition
    recognition/recognizer.ts              # Recognizer 인터페이스
    recognition/gemini.ts                  # GeminiRecognizer
    recognition/queue.ts                   # 묶음, 간격, 재시도, 결과 반영
    layout/paginate.ts                     # 페이지 배치(순수)
    export/fileName.ts, xlsx.ts, pdf.ts, fitText.ts, share.ts
    backup/backup.ts
    ingest/ingest.ts                       # 사진 등록 → 저장 → 대기열 (화면과 모듈 연결)
    ui/HomePage.tsx, CapturePage.tsx, ReviewPage.tsx, CornerEditor.tsx, GeneratePage.tsx, SettingsPage.tsx
    ui/components/AutoComplete.tsx, UserChips.tsx, Banner.tsx
  tests/                                   # 모듈과 같은 경로 구조 (tests/domain/sort.test.ts 등)
  tests/fixtures/reference/                # 참고 PDF에서 잘라낸 영수증 + answers.json (Task 14)
  e2e/flow.spec.ts
  scripts/extract-fixtures.py, scripts/accuracy-check.ts, scripts/render-sample-pdf.ts
```

---

### Task 1: 프로젝트 뼈대 + 도메인 순수 함수

**Files:**
- Create: 프로젝트 설정 파일 일체, `src/domain/types.ts`, `sort.ts`, `content.ts`, `validate.ts`
- Test: `tests/domain/sort.test.ts`, `content.test.ts`, `validate.test.ts`

**Interfaces:**
- Produces:
  - `types.ts`: 설계서 §5의 `Receipt`, `Photo`, `Pt = [number, number]`, `ReceiptStatus`, `Preset`, `Settings` 그대로. 추가로 `type Category = 'fuel'|'urea'|'meal'|'lodging'|'parking'|'toll'|'pharmacy'|'convenience'|'material'|'other'`
  - `sortReceipts(list: Receipt[], order: 'desc'|'asc'): Receipt[]` (원본 불변)
  - `composeContent(site: string, item: string): string`
  - `suggestItem(category: Category, time: string|null, vehicle: string): string`
  - `validateReceipt(r: Receipt, ctx: { today: string; cardLast4: string; others: Receipt[] }): string[]` (경고 문구 배열, 빈 배열이면 통과)

- [ ] **Step 1: 뼈대 만들기와 git 초기화**

`npm create vite@latest . -- --template react-ts`, 의존성 설치(Tech Stack 전부, 테스트용 `vitest jsdom fake-indexeddb @playwright/test`), `vitest.config.ts`(environment `node`, `tests/**/*.test.ts`), `.gitignore`, `git init`. `npm run build`가 통과하는지 확인한다.

- [ ] **Step 2: 실패하는 테스트 작성**

```ts
// sort.test.ts
test('sorts desc by date then time, nulls last', () => {
  const ids = sortReceipts([r('a','2026-09-21','11:46'), r('b','2026-09-29','13:00'),
    r('c',null,null), r('d','2026-09-29','18:51'), r('e','2026-09-29',null)], 'desc').map(x=>x.id);
  expect(ids).toEqual(['d','b','e','a','c']);
});
test('asc keeps nulls last', () => { /* 같은 입력, 'asc' → ['a','b','d','e','c'] */ });

// content.test.ts
test('composeContent', () => expect(composeContent('가나테크_서울 본사, 1호기 시운전','주유(쏘렌토)'))
  .toBe('가나테크_서울 본사, 1호기 시운전 : 주유(쏘렌토)'));
test.each([
  ['fuel','18:02','주유(쏘렌토)'], ['urea','18:51','요소수(쏘렌토)'],
  ['meal','10:29','조식'], ['meal','10:30','중식'], ['meal','15:59','중식'], ['meal','16:00','석식'],
  ['meal',null,'중식'], ['parking','09:00','주차'], ['material','09:00','자재 구매'], ['other','09:00',''],
])('suggestItem %s %s', (c,t,exp) => expect(suggestItem(c as Category,t,'쏘렌토')).toBe(exp));

// validate.test.ts  (ctx.today = '2026-11-13', cardLast4 = '1234')
test('passes a complete receipt', () => expect(validateReceipt(full(), ctx)).toEqual([]));
test('missing date/amount', ...)          // '일자를 확인해 주세요', '금액을 확인해 주세요'
test('future date / older than 3 months') // '2026-11-14' 경고, '2026-08-12' 경고, '2026-08-13' 통과
test('amount <= 0')                       // 0 → '금액을 확인해 주세요'
test('different card')                    // '1234' → '다른 카드 영수증일 수 있어요'
test('duplicate')                         // others에 같은 date+amount+merchant, 다른 id → '중복일 수 있어요'
test('empty site/item/users')             // '현장을 입력해 주세요', '항목을 입력해 주세요', '사용자를 선택해 주세요'
```
`meal`에 시각이 없으면 `중식`으로 정한다(가장 흔한 경우).

- [ ] **Step 3: 테스트 실패 확인** — `npx vitest run tests/domain` → FAIL (모듈 없음)
- [ ] **Step 4: 네 파일 구현** — 날짜 비교는 `'YYYY-MM-DD'` 문자열 비교로 충분하다. 3개월 경계는 today에서 월을 3 빼서 계산한다.
- [ ] **Step 5: 통과 확인** — `npx vitest run tests/domain` → PASS
- [ ] **Step 6: 커밋** — `git add -A; git commit -m "feat: scaffold app and domain rules"`

---

### Task 2: 저장소 (Dexie)

**Files:**
- Create: `src/storage/db.ts`, `receipts.ts`, `presets.ts`, `settings.ts`
- Test: `tests/storage/*.test.ts` (`import 'fake-indexeddb/auto'`)

**Interfaces:**
- Consumes: Task 1 타입
- Produces:
  - `db`: Dexie 테이블 `receipts`(인덱스 `id, date, status, generatedAt, createdAt`), `presets`(복합 키 `[kind+value]`), `settings`(단일 행 key `'main'`)
  - `receipts.put(r: Receipt)`, `receipts.get(id)`, `receipts.remove(id)`, `receipts.listByMonth(ym: string): Promise<Receipt[]>`. date가 null이면 `createdAt`의 달로 분류
  - `receipts.listByStatus(s: ReceiptStatus[])`, `receipts.markGenerated(ids: string[], at: string)`
  - `presets.touch(kind, value, now: string)`: 없으면 만들고, 있으면 `useCount+1`, `lastUsedAt=now`
  - `presets.list(kind, now: string): Promise<string[]>` (Global Constraints의 정렬 규칙)
  - `settings.get(): Promise<Settings>` (기본값 `{geminiKey:'', cardLast4:'', defaultUser:'', vehicle:'', sortOrder:'desc'}`), `settings.save(patch: Partial<Settings>)`
  - `requestPersistence(): Promise<boolean>` (`navigator.storage?.persist`가 없으면 false)
  - `receipts.purgeMonth(ym: string, mode: 'photos'|'all'): Promise<number>`: 'photos'는 해당 달 영수증의 `original`을 지우고 `processed`만 남긴다. 'all'은 해당 달 영수증을 삭제한다. 반환값은 영향받은 건수
  - `class StorageFullError extends Error`: `put`에서 `QuotaExceededError`가 나면 이걸로 바꿔 던진다

- [ ] **Step 1: 실패하는 테스트**
  - `listByMonth('2026-09')`는 date가 9월인 건과, date가 null이면서 createdAt이 9월인 건을 반환하고 10월 건은 제외한다.
  - `presets.list` 정렬: A(useCount 9, 40일 전), B(useCount 2, 1일 전), C(useCount 5, 3일 전) → `['C','B','A']`
  - `touch`를 두 번 하면 `useCount === 2`
  - `settings.get()`은 처음에 기본값을 주고, `save({cardLast4:'1234'})` 후에는 다른 필드를 유지한다.
  - `markGenerated(['a'], t)` 후 a.generatedAt === t, b는 null 그대로
  - `purgeMonth('2026-09','photos')` 후 9월 건의 photos[0].original은 비어 있고 processed는 유지되며, 10월 건은 그대로. `'all'`이면 9월 건만 삭제된다
- [ ] **Step 2: 실패 확인** — `npx vitest run tests/storage` → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: 커밋** — `feat: indexeddb storage`

---

### Task 3: 이미지 처리 (원근 보정, 스캔 필터)

**Files:**
- Create: `src/imaging/homography.ts`, `warp.ts`, `scanFilter.ts`, `browser.ts`
- Test: `tests/imaging/homography.test.ts`, `warp.test.ts`, `scanFilter.test.ts`

**Interfaces:**
- Produces:
  - `type Img = { data: Uint8ClampedArray; width: number; height: number }` (RGBA, ImageData와 같은 모양)
  - `computeHomography(src: Pt[4], dst: Pt[4]): number[]` (길이 9, h33=1). dst→src 방향으로 쓸 수 있게 일반 함수로 둔다
  - `applyHomography(h: number[], p: Pt): Pt`
  - `denormalizeCorners(c: Pt[4], w: number, h: number): Pt[4]` (0~1000 → 픽셀)
  - `outputSize(corners: Pt[4]): { width: number; height: number }`: 마주 보는 변 길이의 최댓값
  - `warp(src: Img, corners: Pt[4]): Img`: 역방향 매핑 + 쌍선형 보간
  - `scanFilter(img: Img): Img`: 흑백 변환(0.299R+0.587G+0.114B). 밝기 상위 5% 이상은 255, 하위 2% 이하는 0, 사이는 선형으로 늘린다
  - (`browser.ts`, 브라우저 전용, 단위 테스트 없음) `decodeToImg(blob: Blob, maxLong: number): Promise<Img>`, `imgToJpeg(img: Img, quality: number): Promise<Blob>`, `processPhoto(original: Blob, corners: Pt[4]|null): Promise<Blob>` (corners가 없으면 scanFilter만 적용)

- [ ] **Step 1: 실패하는 테스트**
  - `computeHomography`: 단위 정사각형 → 임의의 사각형 `[[10,20],[110,30],[100,140],[5,120]]`. 네 모서리가 각각 오차 1e-6 이내로 매핑된다.
  - 항등: 같은 사각형끼리 매핑하면 내부 점 `[0.3,0.7]`이 그대로 나온다.
  - `warp`: 40×40 이미지에 (10,10)-(30,30) 흰 사각형, 나머지는 검정. corners를 흰 사각형의 모서리로 주면 출력은 20×20이고, 모든 픽셀의 R ≥ 250이다.
  - `outputSize([[0,0],[100,0],[90,200],[10,190]])` → `{width:100,height:200}`
  - `scanFilter`: 밝기 100~200 균일 분포 이미지 → 출력 최댓값 255, 최솟값 0, R=G=B
- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현** — `computeHomography`는 8×8 선형계를 부분 피벗 가우스 소거로 푼다. `warp`는 출력 사각형 → 입력 사각형 호모그래피로 각 출력 픽셀의 원본 좌표를 구한다.
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: 커밋** — `feat: perspective warp and scan filter`

---

### Task 4: 인식 응답 스키마와 Gemini 인식기

**Files:**
- Create: `src/recognition/schema.ts`, `recognizer.ts`, `gemini.ts`
- Test: `tests/recognition/schema.test.ts`, `gemini.test.ts`

**Interfaces:**
- Produces:
  - `interface RecognitionResult { index: number; date: string|null; time: string|null; amount: number|null; cardLast4: string|null; merchant: string|null; approvalNo: string|null; category: Category; isCancellation: boolean; corners: Pt[4]|null }`
  - `interface Recognizer { recognize(images: Blob[]): Promise<RecognitionResult[]> }`
  - `class RecognitionError extends Error { kind: 'auth'|'quota'|'network'|'format' }`
  - `RESPONSE_SCHEMA` (설계서 §6.2 구조, Gemini `responseSchema` 형식)
  - `parseRecognition(raw: unknown, imageCount: number): RecognitionResult[]`: 형식이 틀린 필드는 null로 바꾼다. `0 ≤ index < imageCount`가 아니거나 index가 중복된 항목은 버린다. 최상위 형식이 틀리면 `RecognitionError('format')`
  - `class GeminiRecognizer implements Recognizer { constructor(apiKey: string, opts?: { client?: GenAILike; models?: [string, string] }) }`. `models[0]`은 Flash, `[1]`은 Flash-Lite. 기본값은 구현 시점에 AI Studio에서 확인한 무료 모델명으로 상수 `DEFAULT_MODELS`에 둔다
- 프롬프트(한국어, `gemini.ts` 상수): 각 이미지는 `[#n]` 뒤에 온다. 합계(최종 결제) 금액을 쓴다. 날짜는 YYYY-MM-DD, 시각은 HH:mm. 카드번호는 마스킹되지 않은 뒷 4자리만, 읽을 수 없으면 null. 승인취소 영수증이면 isCancellation=true. corners는 영수증 종이의 네 모서리를 0~1000 좌표로.

- [ ] **Step 1: 실패하는 테스트**
  - `parseRecognition`: 정상 응답 2건 → 그대로. `amount: "10,000"` → 10000(쉼표 문자열 허용). `date: "26/09/29"` → null. `category: "food"` → `'other'`. `index: 7`(imageCount 5) → 버림. index 중복 → 처음 것만. `{}` → `RecognitionError` kind `format`
  - `gemini.test.ts` (가짜 client 주입): 이미지 2장이면 contents에 `[#0]`, 이미지, `[#1]`, 이미지 순서로 들어간다. config에 `responseMimeType: 'application/json'`이 있다. 첫 모델이 429를 던지면 두 번째 모델로 1회 재시도하고, 그것도 429면 `RecognitionError('quota')`. 401/403 → `'auth'`. fetch TypeError → `'network'`
- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현** — `@google/genai`의 `GoogleGenAI({apiKey}).models.generateContent({model, contents, config:{responseMimeType, responseSchema}})`를 쓴다. 이미지는 `inlineData: {mimeType:'image/jpeg', data: base64}`. `GenAILike`는 테스트 주입용으로 `{ models: { generateContent(args): Promise<{ text: string }> } }` 모양만 요구한다.
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: 커밋** — `feat: gemini recognizer with schema parsing`

---

### Task 5: 인식 대기열

**Files:**
- Create: `src/recognition/queue.ts`
- Test: `tests/recognition/queue.test.ts` (fake-indexeddb, 가짜 Recognizer, 가짜 시계)

**Interfaces:**
- Consumes: Task 1 `suggestItem`, `validateReceipt`; Task 2 `receipts`, `settings`; Task 3 `processPhoto`; Task 4 `Recognizer`, `RecognitionError`
- Produces:
  - `createQueue(deps: { recognizer: () => Recognizer|null; prepare: (p: Photo) => Promise<Blob>; process: (p: Photo, corners) => Promise<Blob>; now: () => number; sleep: (ms) => Promise<void>; isOnline: () => boolean }): { runOnce(): Promise<RunResult>; start(): void; stop(): void; onChange(cb): () => void }`
  - `type RunResult = 'idle'|'processed'|'no_key'|'auth'|'quota'|'offline'`
  - 동작: `queued` 상태인 영수증을 createdAt 순으로 최대 5건 가져와 `recognizing`으로 바꾸고, 각 건의 첫 사진을 `prepare`해서(1600px JPEG) 인식한다. 결과를 반영한 뒤 `validateReceipt`로 `needs_review`/`excluded`를 정한다. 반영은 인식이 준 빈 필드만 채운다(사용자가 이미 입력한 site/users는 유지). item이 비어 있으면 `suggestItem` 값을 넣는다
  - 요청 사이 7000ms 보장(`now`/`sleep`). `quota`면 해당 건들을 `queued`로 되돌리고 `'quota'` 반환. `start()`는 'quota'를 받으면 10분 뒤 재시도하고, 'offline'이면 `window`의 `online` 이벤트가 올 때 재개한다. 'auth'와 'no_key'면 멈추고, 설정이 저장될 때 다시 시작한다

- [ ] **Step 1: 실패하는 테스트**
  - `processes up to 5 per request`: queued 7건 → 첫 runOnce에서 recognizer가 5장으로 1회 호출, 두 번째에 2장
  - `waits 7s between requests`: 두 번째 호출 전 sleep 인자의 합 ≥ 7000
  - `unmatched images are requeued singly` (Review Focus 3): 5장 중 index 0,1,2,4만 반환 → 3번 건은 `queued`이고 `batchSingle` 표시가 붙어 다음 실행에서 단독 요청으로 간다. 3번 건에는 다른 영수증의 금액이 들어가지 않는다
  - `cancellation becomes excluded`
  - `keeps user-entered site and users`: site='현장A'가 미리 있으면 인식 후에도 '현장A'
  - `quota returns items to queued`, `auth stops and reports 'auth'`, `no key → 'no_key' without calling`, `offline → 'offline'`
  - `format error retries once then needs_review`
- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현** — `Receipt`에 선택 필드 `batchSingle?: boolean`을 추가한다(Task 1 `types.ts` 수정). 진행 중 상태가 앱 종료로 `recognizing`에 남는 경우를 막기 위해, 대기열을 시작할 때 `recognizing` 건을 `queued`로 되돌린다.
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: 커밋** — `feat: batched recognition queue with rate limit`

---

### Task 6: 페이지 배치 (`paginate`)

**Files:**
- Create: `src/layout/paginate.ts`
- Test: `tests/layout/paginate.test.ts`

**Interfaces:**
- Produces:
  - `interface PageSpec { pageW: 210; pageH: 297; marginX: 15; marginTop: 20; marginBottom: 15; titleH: 16; rowH: 9; tableGap: 8; cols: 2; colGap: 6; rowGap: 6; minPhotoW: 45 }`, `DEFAULT_SPEC`
  - `interface LayoutReceipt { id: string; date: string|null; photos: { photoId: string; aspect: number }[] }` (aspect = 높이/너비)
  - `interface PlacedPhoto { receiptId: string; photoId: string; x: number; y: number; w: number; h: number }` (mm, 페이지 왼쪽 위 기준)
  - `interface Page { receiptIds: string[]; tableTop: number; photos: PlacedPhoto[] }`
  - `paginate(receipts: LayoutReceipt[], spec?: PageSpec): Page[]` (입력은 이미 정렬됨. 순서 유지)
- 알고리즘: 설계서 §8.2. 핵심 계산은 다음과 같다.

```
content = pageH - marginTop - marginBottom - titleH          // 246
area(n) = content - n*2*rowH - tableGap                       // 건 n개일 때 사진 영역
colW = (pageW - 2*marginX - colGap) / cols                    // 87
place(photos, area): 순서대로 2열 채움. 사진 w = colW, h = w*aspect.
  h > area 이면 h = area, w = h/aspect.  w < minPhotoW 이면 실패.
  줄 높이 = 그 줄의 최대 h, 전체 높이 = Σ줄높이 + rowGap*(줄수-1) ≤ area 이어야 성공.
  한 건의 사진들은 연속 배치(같은 줄에 안 들어가면 다음 줄로 이어짐).
fits(set) = place(set의 모든 사진, area(|set|)) 성공 여부
날짜 그룹 단위 탐욕 → 안 맞으면 새 페이지 → 빈 페이지에도 안 맞으면 건 단위 →
  건 하나도 안 맞으면 그 건 단독 페이지, minPhotoW 무시하고 area에 맞게 축소.
```
- 사진 x: 1열 = marginX, 2열 = marginX + colW + colGap. 칸 안에서 가로 가운데 정렬. y는 표 아래부터 쌓는다.

- [ ] **Step 1: 실패하는 테스트** (`aspect` 2.0 = 일반, 3.2 = 긴 주유소 영수증)
  - `two receipts same day fit one page`: 같은 날 2건(각 사진 1장, aspect 2.0) → 1페이지, receiptIds 2개
  - `small days merge`: 09-29 1건 + 09-21 1건 → 1페이지 (첨부 4쪽 재현)
  - `four short photos 2x2`: aspect 1.0 사진 4건(같은 날) → 1페이지, 사진 4장, 서로 다른 y 두 줄
  - `day too big splits by receipt`: 같은 날 aspect 2.0 사진 6건 → 2페이지 이상. 모든 페이지에서 `photos`의 receiptId 집합 == `receiptIds` 집합 (페이지 완결)
  - `multi-photo receipt stays together`: 한 건에 사진 3장 → 세 사진이 같은 페이지에 있다
  - `respects min width`: 모든 배치 사진의 w ≥ 45 (단독 예외 건 제외)
  - `test_extremely_tall_photo_gets_own_page` (Review Focus 1): aspect 9.0 사진 1건 + 일반 1건 → 긴 건이 단독 페이지, h ≤ area(1), 페이지 영역 밖으로 나가지 않음
  - `no photo overflows page`: 무작위 aspect(0.5~4) 30건, 고정 시드 → 모든 사진이 `y+h ≤ 297-15`, `x+w ≤ 210-15`
- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: 커밋** — `feat: page layout algorithm`

---

### Task 7: 엑셀과 파일 이름

**Files:**
- Create: `src/export/fileName.ts`, `src/export/xlsx.ts`
- Test: `tests/export/fileName.test.ts`, `xlsx.test.ts`

**Interfaces:**
- Consumes: Task 1 `composeContent`, `sortReceipts`
- Produces:
  - `fileName(opts: { ym: string; cardLast4: string; user: string; partial: boolean; receipts: Receipt[] }, ext: 'pdf'|'xlsx'): string`
  - `buildXlsx(receipts: Receipt[], ym: string): Promise<Uint8Array>` (이미 정렬된 목록을 받는다)

- [ ] **Step 1: 실패하는 테스트**
  - 전체: `fileName({ym:'2026-09',cardLast4:'1234',user:'김철수',partial:false,...},'pdf')` → `'2026년 9월 법인카드(#1234) 사용내역서_김철수.pdf'`
  - 일부: 9/1, 9/15 건 → `'2026년 9월 법인카드(#1234) 사용내역서_김철수(09.01~09.15).xlsx'`
  - `fileName ignores null dates in range` (Review Focus 2): null 일자 건이 섞여도 범위는 날짜가 있는 건으로만 계산. 모두 null이면 접미사 없음
  - xlsx를 ExcelJS로 다시 읽기: 시트 이름 `'2026-09'`, 1행 머리글이 정확히 8개 열, 2행 = `[1,'2026-09-29','1234',10000,'…: 요소수(쏘렌토)','김철수','행복주유소','12345678']`, 금액 셀 `numFmt === '#,##0'`, 마지막 행이 `'합계'`와 합계 금액, 사용자 여러 명은 `'이영희, 김철수'`
  - `null date renders blank cell` (Review Focus 2)
- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: 커밋** — `feat: xlsx export and file naming`

---

### Task 8: PDF 생성

**Files:**
- Create: `src/export/fitText.ts`, `src/export/pdf.ts`, `scripts/render-sample-pdf.ts`
- Test: `tests/export/fitText.test.ts`, `pdf.test.ts`

**Interfaces:**
- Consumes: Task 6 `Page`, `DEFAULT_SPEC`; Task 1 `composeContent`
- Produces:
  - `fitText(text: string, maxWidthPt: number, measure: (s: string, size: number) => number, opts?: { size?: 10; minSize?: 8; maxLines?: 2 }): { size: number; lines: string[] }`
  - `buildPdf(input: { pages: Page[]; receipts: Map<string, Receipt>; photoBytes: Map<string, Uint8Array>; fonts: { regular: Uint8Array; bold: Uint8Array } }): Promise<Uint8Array>`
  - `loadFonts(): Promise<{regular, bold}>`: `pretendard/dist/public/static/Pretendard-Regular.otf`, `-Bold.otf`를 Vite `?url`로 가져와 fetch
- 그리기 규칙: mm→pt 변환은 ×72/25.4. 제목은 bold 18pt, 가운데. 표는 Global Constraints 비율, 선 두께 0.75pt, 라벨 셀은 가운데, 값 셀은 가운데, 금액은 오른쪽 정렬. 2행 내용 셀은 열 2~4를 병합. 사진은 `PlacedPhoto` 좌표에 JPEG로 삽입(pdf-lib는 y가 아래부터이므로 뒤집는다).

- [ ] **Step 1: 실패하는 테스트**
  - `fitText shrinks then wraps` (Review Focus 4): 글자당 `size*0.6` 폭인 가짜 measure. 들어가는 텍스트 → size 10, 한 줄. 9pt에서 들어가는 텍스트 → size 9. 8pt로도 안 들어가면 → size 8, 두 줄로 나뉘고 각 줄 ≤ maxWidth. 두 줄로도 넘치면 둘째 줄 끝을 `…`로 자른다
  - `pdf.test.ts`: 실제 Pretendard 글꼴과 10×20px 테스트 JPEG로 Task 6 페이지 3개를 만든다 → `PDFDocument.load` 결과 `getPageCount() === 3`, 각 페이지 크기 ≈ 595.28×841.89pt. 페이지 1에 그려진 이미지 개수 == 그 페이지의 photos 수
- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현** — `fitText`는 공백 기준으로 줄을 나누고, 공백이 없는 긴 단어는 글자 단위로 나눈다.
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: 샘플 렌더 스크립트** — `scripts/render-sample-pdf.ts`(`npx tsx`)는 Task 14의 기준 자료(없으면 단색 가짜 사진)로 `out/sample.pdf`를 만든다. 실행해서 파일이 생기는지 확인한다.
- [ ] **Step 6: 커밋** — `feat: pdf export in expense-report format`

---

### Task 9: 백업

**Files:**
- Create: `src/backup/backup.ts`
- Test: `tests/backup/backup.test.ts` (fake-indexeddb)

**Interfaces:**
- Consumes: Task 2 storage
- Produces: `exportBackup(now: Date): Promise<{ name: string; blob: Blob }>`, `importBackup(file: Blob): Promise<{ added: number; updated: number; skipped: number }>`, `lastBackupAt(): Promise<string|null>`, `needsBackupReminder(now: Date): Promise<boolean>` (30일 초과, 또는 영수증은 있는데 백업한 적 없음)

- [ ] **Step 1: 실패하는 테스트**
  - 이름 `receipts-backup-20261113.zip`, zip 안에 `data.json`, `photos/{id}-original.jpg`, `photos/{id}-processed.jpg`
  - `data.json`의 settings에 `geminiKey` 없음
  - 왕복: 내보내고 DB 비운 뒤 불러오기 → 영수증, 사진 Blob 크기, 프리셋 동일
  - 충돌: 같은 id에서 DB 쪽 updatedAt이 더 최근이면 skipped, 백업 쪽이 더 최근이면 updated
  - 리마인더: 마지막 백업 31일 전 → true, 29일 전 → false
- [ ] **Step 2~4: 실패 확인 → 구현 → 통과 확인**
- [ ] **Step 5: 커밋** — `feat: zip backup and restore`

---

### Task 10: 앱 껍데기, 설정, 홈 화면

**Files:**
- Create: `src/App.tsx`, `src/main.tsx`, `src/ui/HomePage.tsx`, `SettingsPage.tsx`, `ui/components/Banner.tsx`, `src/ui/useLiveQuery.ts`(Dexie `liveQuery` 래퍼)
- Test: `tests/ui/home.test.tsx` (jsdom + @testing-library/react, fake-indexeddb)

**Interfaces:**
- Consumes: Task 2, Task 9 `needsBackupReminder`, Task 5 `createQueue`(앱 시작 시 `start()`)
- Produces: 라우트 `#/`(홈), `#/capture`, `#/review/:id`, `#/generate`, `#/settings`. 전역 `QueueContext`(대기열 인스턴스)

- [ ] **Step 1: 실패하는 테스트**
  - 홈: 9월 영수증 3건(금액 10,000 / 13,200 / 1,400, 앞의 2건은 같은 날) → 날짜 머리글 2개, 합계 `24,600원`과 `3건` 표시. 상태 아이콘: queued/recognizing ⏳, needs_review ⚠, generatedAt 있음 ✓
  - excluded 건은 기본으로 숨겨져 있다가 "제외됨 (1)"을 누르면 보인다
  - 키가 비어 있으면 "설정에서 Gemini API 키를 입력해 주세요" 배너
  - 설정: 카드번호에 숫자 4자리가 아니면 저장 버튼 비활성. 저장 후 다시 열면 값이 유지된다
  - 백업 리마인더가 true이면 홈에 "백업한 지 30일이 지났어요" 배너
  - `StorageFullError`가 나면 "저장 공간이 부족해요. 백업 후 오래된 달을 정리해 주세요" 배너와 설정으로 가는 링크
- [ ] **Step 2~4: 실패 확인 → 구현 → 통과 확인** — 모바일 우선 레이아웃(최대 너비 480px, 하단 고정 버튼 두 개). 앱 시작 시 `requestPersistence()` 호출. 설정 화면에는 Task 9의 백업 내보내기/불러오기, `navigator.storage.estimate()`로 계산한 사용량(예: `142MB 사용 중`), 달 정리(달 선택 → 사진만 지우기 / 전체 지우기, 확인 대화상자)를 둔다
- [ ] **Step 5: 커밋** — `feat: app shell, home list, settings`

---

### Task 11: 촬영, 등록, 확인/수정 화면

**Files:**
- Create: `src/ingest/ingest.ts`, `src/ui/CapturePage.tsx`, `ReviewPage.tsx`, `CornerEditor.tsx`, `ui/components/AutoComplete.tsx`, `UserChips.tsx`
- Test: `tests/ingest/ingest.test.ts`, `tests/ui/review.test.tsx`

**Interfaces:**
- Consumes: Task 1~5
- Produces:
  - `ingestFiles(files: File[], ctx: { site: string; defaultUser: string; decode?: typeof decodeToImg }): Promise<{ added: string[]; failed: { name: string; message: string }[] }>`: 원본(2400px JPEG) 저장, `status:'queued'`, `site`=현재 현장, `users=[defaultUser]`(비어 있으면 빈 배열), `presets.touch('site')`
  - `confirmReceipt(id): Promise<{ ok: boolean; warnings: string[] }>`: 검증을 통과하면 `done`으로 바꾸고 site/item/users 프리셋을 touch. 통과하지 못하면 경고를 반환
  - `nextToReview(currentId): Promise<string|null>`

- [ ] **Step 1: 실패하는 테스트**
  - `ingest skips undecodable file with message` (Review Focus 5): decode가 던지는 파일 1개 + 정상 2개 → added 2, failed 1(`message: '열 수 없는 사진이에요'`)
  - 등록된 건: status `queued`, site = ctx.site, users = `['김철수']`
  - Review 화면: 현장 입력란에 '한성'을 치면 프리셋 '가나테크_서울 본사, 1호기 시운전'이 후보로 뜬다. 내용 미리보기가 `composeContent` 결과로 나온다. 사용자 칩 추가/삭제. [확인]을 누르면 경고가 있을 때 경고 문구를 보여주고 이동하지 않는다. 경고가 없으면 다음 확인 대상으로 이동한다
  - 중복 경고는 표시만 하고 [그래도 확인]으로 `done`으로 바꿀 수 있다 (다른 경고는 해결해야 확인됨)
- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현**
  - Capture: 현재 현장 선택(AutoComplete), `<input type=file accept="image/*" capture="environment">`, 갤러리용 `multiple` input. 촬영 후 input을 비워서 바로 다음 촬영이 되게 한다. 등록 수 카운터와 [완료]
  - CornerEditor: 원본 위에 네 점을 pointer 이벤트로 끌어 옮긴다. 저장하면 `processPhoto`로 보정본을 다시 만든다
  - Review: [사진 추가], [다시 인식](status→queued), [삭제](confirm 대화상자)
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: 커밋** — `feat: capture, ingest and review screens`

---

### Task 12: 문서 생성 화면과 공유

**Files:**
- Create: `src/ui/GeneratePage.tsx`, `src/export/share.ts`, `src/export/generate.ts`
- Test: `tests/export/generate.test.ts`, `share.test.ts`

**Interfaces:**
- Consumes: Task 1 `sortReceipts`, Task 2, Task 6, Task 7, Task 8
- Produces:
  - `selectTargets(all: Receipt[], mode: 'month'|'pending'): { targets: Receipt[]; unresolved: Receipt[] }`: excluded 제외. pending은 `generatedAt === null`만. unresolved는 그중 queued/recognizing/needs_review
  - `generateDocs(targets: Receipt[], ctx: { ym; settings; partial: boolean }): Promise<{ pdf: { name; blob }; xlsx: { name; blob } }>`: 사진 aspect는 보정본(없으면 원본)에서 읽는다
  - `shareOrDownload(file: { name; blob }): Promise<'shared'|'downloaded'|'cancelled'>`: `navigator.canShare?.({files})`이면 share, 아니면 `<a download>`. AbortError면 'cancelled'

- [ ] **Step 1: 실패하는 테스트**
  - selectTargets: month → excluded만 빠짐. pending → generatedAt 있는 건 빠짐. unresolved 분류
  - 대상이 0건이면 화면에 "만들 영수증이 없어요"를 표시하고 생성 버튼 비활성
  - unresolved가 있으면 생성 전에 그 목록과 [그래도 진행] / [돌아가서 확인] 대화상자를 띄운다
  - share: canShare true → navigator.share 호출, 'shared'. 없으면 'downloaded'. AbortError → 'cancelled'이고 markGenerated를 호출하지 않는다
  - GeneratePage: 'shared' 또는 'downloaded' 뒤에만 `markGenerated(대상 id, now)` 호출
- [ ] **Step 2~4: 실패 확인 → 구현 → 통과 확인** — 미리보기는 생성된 PDF Blob URL을 `<iframe>`에 띄운다. iOS Safari처럼 iframe PDF가 첫 페이지만 보이는 환경을 고려해 [새 탭에서 보기] 링크도 둔다.
- [ ] **Step 5: 커밋** — `feat: generate and share documents`

---

### Task 13: PWA, 배포, E2E

**Files:**
- Modify: `vite.config.ts` (vite-plugin-pwa, `base: '/receipt-app/'`)
- Create: `public/icons/*`, `.github/workflows/deploy.yml`, `playwright.config.ts`, `e2e/flow.spec.ts`

- [ ] **Step 1: PWA 설정** — manifest `name: '영수증 정리'`, `short_name: '영수증'`, `display: 'standalone'`, `lang: 'ko'`, 아이콘 192/512. Workbox가 앱 셸과 글꼴을 미리 캐시한다. `npm run build` 후 `dist/manifest.webmanifest`가 생기는지 확인한다
- [ ] **Step 2: E2E 테스트 작성** — Playwright, `devices['iPhone 13']`, `npm run preview` 서버. Gemini 호출은 `page.route('**/generativelanguage.googleapis.com/**')`로 가로채 고정 응답을 준다. 흐름: 설정(키, 1234, 김철수, 쏘렌토) → 촬영 페이지에서 `setInputFiles`로 테스트 사진 2장 등록 → 홈에서 ⚠ 2건 → 각각 현장 입력 후 [확인] → [문서 생성] → 이번 달 전체 → PDF와 xlsx 다운로드 이벤트, 파일 이름이 규칙과 일치
- [ ] **Step 3: 실행** — `npx playwright test` → PASS
- [ ] **Step 4: 배포 워크플로** — `deploy.yml`: main 브랜치에 push하면 `npm ci && npm test && npm run build` 후 GitHub Pages에 배포. GitHub 저장소 생성과 push는 사용자의 확인을 받은 뒤 진행한다 (계정명 필요)
- [ ] **Step 5: 커밋** — `feat: pwa, e2e flow, pages deploy`

---

### Task 14: 기준 자료와 실제 품질 점검

**Files:**
- Create: `scripts/extract-fixtures.py`, `tests/fixtures/reference/answers.json`, `scripts/accuracy-check.ts`

- [ ] **Step 1: 기준 자료 추출** — `extract-fixtures.py`(PyMuPDF, 가상환경에 설치)는 참고 PDF 3~18쪽에 박힌 이미지를 추출하고, 페이지 렌더에서 영수증 영역을 잘라 `tests/fixtures/reference/p{쪽}-{좌|우}.jpg`로 저장한다. 참고 PDF는 개인 자료이므로 **`tests/fixtures/reference/`는 `.gitignore`에 넣는다**(카드번호 일부, 이름 포함)
- [ ] **Step 2: 정답표** — `answers.json`에 각 사진의 `{file, date, amount, merchant}`를 PDF 표(일자, 사용금액)에서 옮겨 적는다. 가맹점은 우리카드 승인내역 1~2쪽에서 가져온다
- [ ] **Step 3: 정확도 점검** — `npx tsx scripts/accuracy-check.ts`는 `GEMINI_API_KEY` 환경변수로 실제 GeminiRecognizer를 5장 묶음으로 호출하고 일자, 금액 정답률을 출력한다. 무료 한도를 쓰므로 실행 전에 사용자에게 알린다. 목표는 일자와 금액 모두 ≥ 90%. 미달이면 프롬프트를 고쳐서 다시 잰다 (결과와 프롬프트 변경을 커밋 메시지에 기록)
- [ ] **Step 4: 시각 비교** — `render-sample-pdf.ts`로 9월 데이터를 넣은 PDF를 만들고 원본 3~6쪽과 나란히 이미지로 렌더해 사용자에게 보여준다. 표 모양, 글꼴 크기, 사진 배치의 차이를 기록하고 필요하면 Task 8 상수를 조정한다
- [ ] **Step 5: 실기기 확인 요청** — 배포된 주소를 사용자에게 전달해 iPhone/안드로이드에서 홈 화면 설치, 연속 촬영, 공유 메뉴를 확인받는다
- [ ] **Step 6: 커밋** — `test: reference fixtures and accuracy check`
