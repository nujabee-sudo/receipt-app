export type Pt = [number, number];

export type ReceiptStatus = 'queued' | 'recognizing' | 'needs_review' | 'done' | 'excluded';

export type Category =
  | 'fuel'
  | 'urea'
  | 'meal'
  | 'lodging'
  | 'parking'
  | 'toll'
  | 'pharmacy'
  | 'convenience'
  | 'material'
  | 'other';

export interface Photo {
  id: string;
  /** 원본 (긴 변 2400px JPEG). 달 정리('photos')로 지워질 수 있다. */
  original: Blob | null;
  /** 보정본 (긴 변 1600px 이하, 흑백 JPEG) */
  processed: Blob | null;
  /** 사용자가 자르기를 직접 맞췄으면 true (다시 인식해도 유지) */
  manualCorners?: boolean;
  /** 원본 기준 픽셀 모서리 좌표 (좌상, 우상, 우하, 좌하) */
  corners: [Pt, Pt, Pt, Pt] | null;
}

export interface Receipt {
  id: string;
  date: string | null; // 'YYYY-MM-DD'
  time: string | null; // 'HH:mm'
  amount: number | null;
  cardLast4: string | null;
  merchant: string | null;
  approvalNo: string | null;
  site: string;
  item: string;
  users: string[];
  photos: Photo[];
  status: ReceiptStatus;
  warnings: string[];
  isCancellation: boolean;
  generatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** 묶음 인식에서 짝을 못 찾은 건: 다음엔 단독 요청 */
  batchSingle?: boolean;
}

export type PresetKind = 'site' | 'item' | 'user';

export interface Preset {
  kind: PresetKind;
  value: string;
  useCount: number;
  lastUsedAt: string;
}

export interface Settings {
  geminiKey: string;
  cardLast4: string;
  defaultUser: string;
  vehicle: string;
  sortOrder: 'desc' | 'asc';
}
