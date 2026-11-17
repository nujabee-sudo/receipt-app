// 브라우저 전용 연결부: 실제 Gemini, 실제 이미지 처리, 실제 시계로 대기열을 만든다.
import { cornersToPixels, processPhoto, resizeJpeg } from './imaging/browser';
import { GeminiRecognizer } from './recognition/gemini';
import { createQueue, recognitionSource, type Queue } from './recognition/queue';
import { settings } from './storage/settings';
import { today } from './ui/format';

export function createAppQueue(): Queue {
  return createQueue({
    recognizer: async () => {
      const s = await settings.get();
      return s.geminiKey ? new GeminiRecognizer(s.geminiKey, { today }) : null;
    },
    prepare: async (p) => resizeJpeg(recognitionSource(p), 1600, 0.85),
    process: async (p, corners, rotation) => {
      if (!p.original) return p;
      const px = corners ? await cornersToPixels(p.original, corners) : null;
      return { ...p, corners: px, rotation, processed: await processPhoto(p.original, px, rotation) };
    },
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    isOnline: () => navigator.onLine,
    today: () => today(),
  });
}
