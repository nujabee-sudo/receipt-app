// 누운 영수증 인식 점검. 먼저 python scripts/make-rotated-fixtures.py 로 시험 세트를 만든다.
// 사용: npx tsx scripts/rotation-check.ts (키를 물어봄) 또는 GEMINI_API_KEY=... npx tsx scripts/rotation-check.ts [기준자료폴더]
// 1차: 섞어 돌린 사진을 5장씩 그대로 읽는다 (고치기 전 방식과 같다) → 일자·금액 정답률, 방향 판단 정답률
// 2차: 앱처럼, 누워 있다고 답한 사진만 그 각도로 세운 사진을 1장씩 다시 읽는다 → 최종 정답률
// 실제 Gemini 무료 한도를 쓴다 (26장이면 1차 6번 + 2차 최대 20번 호출, 7초 간격이라 3~4분).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { GeminiRecognizer, DEFAULT_MODELS } from '../src/recognition/gemini';
import type { RecognitionResult } from '../src/recognition/schema';

interface Answer {
  file: string;
  base: string;
  rotation: number;
  date: string;
  amount: number;
}

const BATCH = 5;
const GAP_MS = 7000;

async function askKey(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const out = rl as unknown as { _writeToOutput: (s: string) => void };
  let prompted = false;
  out._writeToOutput = (s: string) => {
    if (!prompted) {
      process.stdout.write(s);
      prompted = true;
    } else if (s.includes('\n') || s.includes('\r')) process.stdout.write('\n');
    else process.stdout.write('*'.repeat(s.length));
  };
  const answer = await new Promise<string>((resolve) => rl.question('Gemini API 키 (입력 내용은 가려져요): ', resolve));
  rl.close();
  return answer.trim();
}

const key = process.env.GEMINI_API_KEY || (process.stdin.isTTY ? await askKey() : '');
if (!key) {
  console.error('Gemini API 키가 필요해요 (GEMINI_API_KEY 환경변수 또는 입력)');
  process.exit(1);
}
const dir = process.argv[2] ?? 'tests/fixtures/reference';
const answers: Answer[] = JSON.parse(readFileSync(join(dir, 'answers-rotated.json'), 'utf8'));
const rec = new GeminiRecognizer(key, { models: DEFAULT_MODELS });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const blobOf = (file: string) => new Blob([readFileSync(join(dir, file))], { type: 'image/jpeg' });
/** 기준 사진을 시계 방향 k도 더 돌려야 서는 상태로 만든 파일 */
const fileFor = (base: string, k: number) => (((k % 360) + 360) % 360 === 0 ? base : `rot${((k % 360) + 360) % 360}/${base}`);

let lastCall = -Infinity;
async function call(blobs: Blob[]): Promise<RecognitionResult[] | null> {
  const wait = lastCall + GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  try {
    return await rec.recognize(blobs);
  } catch (e) {
    console.error('  호출 실패:', (e as Error).message ?? e);
    return null;
  }
}

console.log(`모델: ${DEFAULT_MODELS.join(' → ')}, ${answers.length}장 (돌린 각도 섞음)`);
const first: (RecognitionResult | undefined)[] = [];
for (let i = 0; i < answers.length; i += BATCH) {
  const group = answers.slice(i, i + BATCH);
  const res = await call(group.map((a) => blobOf(a.file)));
  group.forEach((_, j) => first.push(res?.find((x) => x.index === j)));
  console.log(`1차 묶음 ${i / BATCH + 1}/${Math.ceil(answers.length / BATCH)}`);
}

const final: (RecognitionResult | undefined)[] = [...first];
let secondCalls = 0;
for (let i = 0; i < answers.length; i++) {
  const a = answers[i];
  const r = first[i];
  if (!r || r.rotation === 0) continue;
  // 앱은 답한 각도만큼 세운다 → 실제로는 (정답 각도 - 답한 각도)만큼 아직 돌아가 있다
  const res = await call([blobOf(fileFor(a.base, a.rotation - r.rotation))]);
  secondCalls++;
  if (res?.[0]) final[i] = res[0];
  console.log(`2차 ${secondCalls}: ${a.file} (답한 각도 ${r.rotation}°, 정답 ${a.rotation}°)`);
}

const n = answers.length;
const pct = (k: number) => `${k}/${n} (${((k / n) * 100).toFixed(1)}%)`;
const score = (list: (RecognitionResult | undefined)[]) => ({
  date: list.filter((r, i) => r?.date === answers[i].date).length,
  amount: list.filter((r, i) => r?.amount === answers[i].amount).length,
});
const s1 = score(first);
const s2 = score(final);
const rotOk = first.filter((r, i) => r?.rotation === answers[i].rotation).length;
console.log(`\n방향 판단 정답: ${pct(rotOk)}`);
console.log(`1차만 (고치기 전과 같은 방식): 일자 ${pct(s1.date)}, 금액 ${pct(s1.amount)}`);
console.log(`세워서 다시 읽은 뒤 (지금 방식): 일자 ${pct(s2.date)}, 금액 ${pct(s2.amount)}  — 2차 호출 ${secondCalls}번`);
const misses = answers
  .map((a, i) => ({ a, r: final[i], r1: first[i] }))
  .filter(({ a, r }) => r?.date !== a.date || r?.amount !== a.amount)
  .map(({ a, r, r1 }) => `${a.file}: 정답 ${a.date} ${a.amount} / 인식 ${r?.date ?? '—'} ${r?.amount ?? '—'} (방향 답 ${r1?.rotation ?? '—'}°)`);
if (misses.length) console.log('틀린 것:\n  ' + misses.join('\n  '));
