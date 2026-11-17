import type { Category, Pt, Rotation } from '../domain/types';

export type Corners = [Pt, Pt, Pt, Pt];

export interface RecognitionResult {
  index: number;
  date: string | null;
  time: string | null;
  amount: number | null;
  cardLast4: string | null;
  merchant: string | null;
  approvalNo: string | null;
  category: Category;
  isCancellation: boolean;
  /** 영수증을 바로 세우려면 시계 방향으로 돌려야 하는 각도 */
  rotation: Rotation;
  /** 0~1000 정규화 좌표 (좌상, 우상, 우하, 좌하) */
  corners: Corners | null;
}

/** server: 5xx(과부하 등) — 잠깐 뒤 다시 시도할 일시 오류 */
export type RecognitionErrorKind = 'auth' | 'quota' | 'network' | 'format' | 'server';

export class RecognitionError extends Error {
  constructor(
    public kind: RecognitionErrorKind,
    message?: string,
  ) {
    super(message ?? kind);
    this.name = 'RecognitionError';
  }
}

export const CATEGORIES: Category[] = [
  'fuel',
  'urea',
  'meal',
  'lodging',
  'parking',
  'toll',
  'pharmacy',
  'convenience',
  'material',
  'other',
];

const nullable = (type: string) => ({ type: [type, 'null'] });

/** Gemini `responseJsonSchema` (JSON Schema) */
export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          date: { ...nullable('string'), description: 'YYYY-MM-DD' },
          time: { ...nullable('string'), description: 'HH:mm (24시간)' },
          amount: { ...nullable('integer'), description: '합계(최종 결제) 금액, 원' },
          cardLast4: { ...nullable('string'), description: '마스킹되지 않은 카드번호 뒤 4자리' },
          merchant: nullable('string'),
          approvalNo: nullable('string'),
          category: { type: 'string', enum: CATEGORIES },
          isCancellation: { type: 'boolean' },
          rotation: {
            type: 'integer',
            enum: [0, 90, 180, 270],
            description: '영수증 글자를 바로 읽으려면 사진을 시계 방향으로 몇 도 돌려야 하는지',
          },
          corners: {
            type: ['array', 'null'],
            items: { type: 'array', items: { type: 'number' } },
            description: '영수증 종이의 네 모서리 [좌상,우상,우하,좌하], 0~1000 정규화',
          },
        },
        required: [
          'index',
          'date',
          'time',
          'amount',
          'cardLast4',
          'merchant',
          'approvalNo',
          'category',
          'isCancellation',
          'rotation',
          'corners',
        ],
      },
    },
  },
  required: ['results'],
} as const;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function amountOf(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  if (typeof v === 'string') {
    const n = Number(v.replace(/[,\s원]/g, ''));
    return Number.isFinite(n) && v.trim() ? Math.round(n) : null;
  }
  return null;
}

function dateOf(v: unknown): string | null {
  const s = str(v);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 ? s : null;
}

function timeOf(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h < 24 && mi < 60 ? `${String(h).padStart(2, '0')}:${m[2]}` : null;
}

const ROTATIONS: Rotation[] = [0, 90, 180, 270];
const rotationOf = (v: unknown): Rotation => (ROTATIONS.includes(v as Rotation) ? (v as Rotation) : 0);

function cornersOf(v: unknown): Corners | null {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const ok = v.every(
    (p) =>
      Array.isArray(p) &&
      p.length === 2 &&
      p.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1000),
  );
  return ok ? (v.map((p) => [p[0], p[1]]) as Corners) : null;
}

/** 모델 응답을 안전하게 해석. 잘못된 필드는 null, 잘못된 index/중복 index 항목은 버린다. */
export function parseRecognition(raw: unknown, imageCount: number): RecognitionResult[] {
  let obj = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      throw new RecognitionError('format', '응답이 JSON이 아니에요');
    }
  }
  const results = (obj as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) throw new RecognitionError('format', 'results 배열이 없어요');

  const seen = new Set<number>();
  const out: RecognitionResult[] = [];
  for (const r of results as Record<string, unknown>[]) {
    const index = r?.index;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= imageCount) continue;
    if (seen.has(index)) {
      // 여러 장 묶음에서 번호가 겹치면 어느 결과가 어느 사진인지 믿을 수 없다 → 하나도 쓰지 않고 1장씩 다시 인식
      if (imageCount > 1) return [];
      continue;
    }
    seen.add(index);
    const card = str(r.cardLast4);
    out.push({
      index,
      date: dateOf(r.date),
      time: timeOf(r.time),
      amount: amountOf(r.amount),
      cardLast4: card && /^\d{4}$/.test(card) ? card : null,
      merchant: str(r.merchant),
      approvalNo: str(r.approvalNo),
      category: CATEGORIES.includes(r.category as Category) ? (r.category as Category) : 'other',
      isCancellation: r.isCancellation === true,
      rotation: rotationOf(r.rotation),
      corners: cornersOf(r.corners),
    });
  }
  return out;
}
