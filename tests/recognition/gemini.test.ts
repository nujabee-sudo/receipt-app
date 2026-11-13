import { expect, test } from 'vitest';
import { GeminiRecognizer, type GenAILike } from '../../src/recognition/gemini';
import { RecognitionError } from '../../src/recognition/schema';

const ok = (n: number) =>
  JSON.stringify({
    results: Array.from({ length: n }, (_, i) => ({
      index: i,
      date: '2026-09-29',
      time: '13:00',
      amount: 13200,
      cardLast4: null,
      merchant: '한빛식당',
      approvalNo: null,
      category: 'meal',
      isCancellation: false,
      corners: null,
    })),
  });

function fakeClient(responses: Array<string | Error>) {
  const calls: any[] = [];
  const client: GenAILike = {
    models: {
      async generateContent(args: any) {
        calls.push(args);
        const r = responses.shift()!;
        if (r instanceof Error) throw r;
        return { text: r };
      },
    },
  };
  return { client, calls };
}

const httpErr = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });
const jpeg = (s: string) => new Blob([s], { type: 'image/jpeg' });

test('labels each image and requests JSON', async () => {
  const { client, calls } = fakeClient([ok(2)]);
  const rec = new GeminiRecognizer('KEY', { client, models: ['flash', 'lite'] });
  const out = await rec.recognize([jpeg('a'), jpeg('b')]);
  expect(out).toHaveLength(2);
  expect(calls[0].model).toBe('flash');
  const parts = calls[0].contents[0].parts;
  expect(parts[1].text).toBe('[#0]');
  expect(parts[2].inlineData.mimeType).toBe('image/jpeg');
  expect(parts[3].text).toBe('[#1]');
  expect(parts[4].inlineData.data).toBe(btoa('b'));
  expect(calls[0].config.responseMimeType).toBe('application/json');
});

test('429 falls back to second model once', async () => {
  const { client, calls } = fakeClient([httpErr(429), ok(1)]);
  const out = await new GeminiRecognizer('KEY', { client, models: ['flash', 'lite'] }).recognize([jpeg('a')]);
  expect(out).toHaveLength(1);
  expect(calls.map((c) => c.model)).toEqual(['flash', 'lite']);
});

test('429 twice is quota error', async () => {
  const { client } = fakeClient([httpErr(429), httpErr(429)]);
  await expect(
    new GeminiRecognizer('KEY', { client, models: ['flash', 'lite'] }).recognize([jpeg('a')]),
  ).rejects.toMatchObject({ kind: 'quota' });
});

test.each([401, 403])('%i is auth error', async (status) => {
  const { client } = fakeClient([httpErr(status)]);
  const p = new GeminiRecognizer('KEY', { client, models: ['flash', 'lite'] }).recognize([jpeg('a')]);
  await expect(p).rejects.toBeInstanceOf(RecognitionError);
  await expect(p).rejects.toMatchObject({ kind: 'auth' });
});

test('400 with API key invalid message is auth error', async () => {
  const e = Object.assign(new Error('API key not valid. Please pass a valid API key.'), { status: 400 });
  const { client } = fakeClient([e]);
  await expect(
    new GeminiRecognizer('KEY', { client, models: ['flash', 'lite'] }).recognize([jpeg('a')]),
  ).rejects.toMatchObject({ kind: 'auth' });
});

test('fetch TypeError is network error', async () => {
  const { client } = fakeClient([new TypeError('Failed to fetch')]);
  await expect(
    new GeminiRecognizer('KEY', { client, models: ['flash', 'lite'] }).recognize([jpeg('a')]),
  ).rejects.toMatchObject({ kind: 'network' });
});

test('garbage text is format error', async () => {
  const { client } = fakeClient(['oops']);
  await expect(
    new GeminiRecognizer('KEY', { client, models: ['flash', 'lite'] }).recognize([jpeg('a')]),
  ).rejects.toMatchObject({ kind: 'format' });
});

test('503 overloaded is a temporary server error', async () => {
  const { client } = fakeClient([httpErr(503)]);
  const err = await new GeminiRecognizer('K', { client }).recognize([jpeg('a')]).catch((e) => e);
  expect(err).toBeInstanceOf(RecognitionError);
  expect(err.kind).toBe('server');
});

test('the real client talks to v1beta, where the -latest model aliases exist', () => {
  const rec = new GeminiRecognizer('K') as unknown as { client: { apiClient: { getApiVersion(): string } } };
  expect(rec.client.apiClient.getApiVersion()).toBe('v1beta');
});

test('404 model-not-found on the first model falls back to the second', async () => {
  const notFound = Object.assign(new Error('models/x is not found'), { status: 404 });
  const { client, calls } = fakeClient([notFound, ok(1)]);
  const out = await new GeminiRecognizer('K', { client, models: ['a', 'b'] }).recognize([jpeg('x')]);
  expect(out).toHaveLength(1);
  expect(calls.map((c) => c.model)).toEqual(['a', 'b']);
});

test('the prompt tells the model that the year is usually this year', async () => {
  const { client, calls } = fakeClient([ok(1)]);
  await new GeminiRecognizer('K', { client, today: () => '2026-11-13' }).recognize([jpeg('a')]);
  const prompt: string = calls[0].contents[0].parts[0].text;
  expect(prompt).toContain('보통 올해(2026년)');
});
