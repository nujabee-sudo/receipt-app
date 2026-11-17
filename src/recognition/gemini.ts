import { GoogleGenAI } from '@google/genai';
import type { Recognizer } from './recognizer';
import { parseRecognition, RecognitionError, RESPONSE_SCHEMA, type RecognitionResult } from './schema';

/** 무료 등급 모델. 구현 시점(2026-11)에 AI Studio에서 확인해 갱신한다. [기본, 429 대체] */
export const DEFAULT_MODELS: [string, string] = ['gemini-flash-latest', 'gemini-flash-lite-latest'];

export interface GenAILike {
  models: {
    generateContent(args: {
      model: string;
      contents: unknown;
      config?: Record<string, unknown>;
    }): Promise<{ text?: string | undefined }>;
  };
}

export const PROMPT = `다음은 한국 영수증 사진들입니다. 각 사진 앞에 [#번호]가 붙어 있습니다.
사진마다 하나의 결과를 results 배열에 넣고, index에는 그 번호를 넣으세요.
- amount: 합계(최종 결제) 금액. 숫자만, 원 단위 정수.
- date: YYYY-MM-DD. 연도가 두 자리면 20을 붙이세요. time: HH:mm (24시간).
  영수증의 연도는 보통 올해({YEAR}년)입니다. 연도가 흐릿해서 헷갈리면 올해로 읽으세요.
- cardLast4: 마스킹(*)되지 않은 카드번호 뒤 4자리. 보이지 않거나 일부가 가려졌으면 null.
- merchant: 가맹점(상호) 이름. approvalNo: 승인번호.
- category: 주유=fuel, 요소수=urea, 식당·식권=meal, 숙박=lodging, 주차=parking, 통행료=toll, 약국=pharmacy, 편의점=convenience, 자재·공구=material, 그 외=other.
- isCancellation: 승인취소/취소 영수증이면 true.
- rotation: 사진 속 영수증이 옆으로 눕거나 뒤집혀 있을 수 있습니다. 글자를 바로 읽으려면 사진을 시계 방향으로 몇 도 돌려야 하는지 0, 90, 180, 270 중에서 고르세요. 바로 서 있으면 0.
  영수증이 누워 있어도 글자 방향을 따라 끝까지 읽으세요.
- corners: 영수증 종이의 네 모서리를 사진에 보이는 그대로 [사진의 좌상, 우상, 우하, 좌하] 순서로. 이미지 크기 기준 0~1000 정규화 좌표.
읽을 수 없는 값은 추측하지 말고 null로 두세요.`;

async function toBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

function classify(e: unknown): RecognitionError {
  if (e instanceof RecognitionError) return e;
  const status = (e as { status?: number } | null)?.status;
  const msg = String((e as Error)?.message ?? '');
  if (status === 401 || status === 403 || /API key not valid|API_KEY_INVALID/i.test(msg))
    return new RecognitionError('auth', msg);
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(msg)) return new RecognitionError('quota', msg);
  if ((typeof status === 'number' && status >= 500) || /UNAVAILABLE|overloaded|INTERNAL/i.test(msg))
    return new RecognitionError('server', msg);
  if (e instanceof TypeError || /fetch|network/i.test(msg)) return new RecognitionError('network', msg);
  return new RecognitionError('format', msg);
}

export class GeminiRecognizer implements Recognizer {
  private client: GenAILike;
  private models: [string, string];

  private today: () => string;

  constructor(
    apiKey: string,
    opts: { client?: GenAILike; models?: [string, string]; /** 'YYYY-MM-DD' */ today?: () => string } = {},
  ) {
    this.today = opts.today ?? (() => new Date().toISOString().slice(0, 10));
    // SDK 기본값은 v1인데, -latest 별칭과 responseJsonSchema는 v1beta에만 있다
    this.client = opts.client ?? (new GoogleGenAI({ apiKey, apiVersion: 'v1beta' }) as unknown as GenAILike);
    this.models = opts.models ?? DEFAULT_MODELS;
  }

  async recognize(images: Blob[]): Promise<RecognitionResult[]> {
    const parts: unknown[] = [{ text: PROMPT.replace('{YEAR}', this.today().slice(0, 4)) }];
    for (let i = 0; i < images.length; i++) {
      parts.push({ text: `[#${i}]` });
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: await toBase64(images[i]) } });
    }
    const call = async (model: string) => {
      const res = await this.client.models.generateContent({
        model,
        contents: [{ role: 'user', parts }],
        config: { responseMimeType: 'application/json', responseJsonSchema: RESPONSE_SCHEMA },
      });
      return parseRecognition(res.text ?? '', images.length);
    };
    try {
      return await call(this.models[0]);
    } catch (e) {
      const err = classify(e);
      // 한도 초과나 '모델 없음'(404)이면 두 번째 모델로 한 번 더 시도한다
      const notFound = (e as { status?: number } | null)?.status === 404;
      if (err.kind !== 'quota' && !notFound) throw err;
      try {
        return await call(this.models[1]);
      } catch (e2) {
        throw classify(e2);
      }
    }
  }
}
