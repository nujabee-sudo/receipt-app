// 사용: npx tsx scripts/accuracy-check.ts (키를 물어봄) 또는 GEMINI_API_KEY=... npx tsx scripts/accuracy-check.ts [기준자료폴더=tests/fixtures/reference] [모델1,모델2]
// 실제 Gemini 무료 한도를 쓴다(5장 묶음, 26장이면 6번 호출). 일자·금액 정답률을 출력한다. 목표 ≥ 90%.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { GeminiRecognizer, DEFAULT_MODELS } from '../src/recognition/gemini';
import type { RecognitionResult } from '../src/recognition/schema';

interface Answer {
  file: string;
  date: string;
  amount: number;
  merchant?: string;
}

const BATCH = 5;
const GAP_MS = 7000; // 무료 등급 분당 호출 제한을 넘지 않게

/** 환경변수가 없으면 화면에 보이지 않게 키를 묻는다 (키는 어디에도 저장하지 않는다) */
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
const models = (process.argv[3]?.split(',') as [string, string] | undefined) ?? DEFAULT_MODELS;
const answers: Answer[] = JSON.parse(readFileSync(join(dir, 'answers.json'), 'utf8'));
const rec = new GeminiRecognizer(key, { models });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

console.log(`모델: ${models.join(' → ')}, ${answers.length}장`);
let dateOk = 0;
let amountOk = 0;
let checked = 0;
const misses: string[] = [];
for (let i = 0; i < answers.length; i += BATCH) {
  const group = answers.slice(i, i + BATCH);
  const blobs = group.map((a) => new Blob([readFileSync(join(dir, a.file))], { type: 'image/jpeg' }));
  let results: RecognitionResult[];
  const t0 = Date.now();
  try {
    results = await rec.recognize(blobs);
  } catch (e) {
    console.error(`묶음 ${i / BATCH + 1} 실패:`, (e as Error).message ?? e);
    misses.push(...group.map((a) => `${a.file}: 호출 실패`));
    checked += group.length;
    continue;
  }
  console.log(`묶음 ${i / BATCH + 1}: ${group.length}장, ${((Date.now() - t0) / 1000).toFixed(1)}초`);
  group.forEach((a, j) => {
    checked++;
    const r = results.find((x) => x.index === j);
    const dOk = r?.date === a.date;
    const aOk = r?.amount === a.amount;
    if (dOk) dateOk++;
    if (aOk) amountOk++;
    if (!dOk || !aOk)
      misses.push(`${a.file}: 정답 ${a.date} ${a.amount} / 인식 ${r?.date ?? '—'} ${r?.amount ?? '—'} (${r?.merchant ?? ''})`);
  });
  if (i + BATCH < answers.length) await sleep(GAP_MS);
}

const pct = (n: number) => `${((n / checked) * 100).toFixed(1)}%`;
console.log(`\n일자 ${dateOk}/${checked} (${pct(dateOk)}), 금액 ${amountOk}/${checked} (${pct(amountOk)})`);
if (misses.length) console.log('틀린 것:\n  ' + misses.join('\n  '));
process.exit(dateOk / checked >= 0.9 && amountOk / checked >= 0.9 ? 0 : 2);
