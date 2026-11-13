import type { RecognitionResult } from './schema';

/** 인식 엔진 경계. 나중에 Claude API 구현체를 추가할 수 있다. */
export interface Recognizer {
  recognize(images: Blob[]): Promise<RecognitionResult[]>;
}
