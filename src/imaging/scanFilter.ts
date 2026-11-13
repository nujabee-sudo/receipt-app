import type { Img } from './warp';

const HIGH_PCT = 0.95; // 상위 5% 이상 → 흰색
const LOW_PCT = 0.02; // 하위 2% 이하 → 검정

/** 흑백 변환 + 레벨 보정으로 "스캔한 것처럼" 만든다 */
export function scanFilter(img: Img): Img {
  const n = img.width * img.height;
  const lum = new Uint8ClampedArray(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const v = Math.round(0.299 * img.data[o] + 0.587 * img.data[o + 1] + 0.114 * img.data[o + 2]);
    lum[i] = v;
    hist[v]++;
  }
  const valueAt = (pct: number) => {
    const target = Math.floor(pct * n);
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc > target) return v;
    }
    return 255;
  };
  const low = valueAt(LOW_PCT);
  const high = valueAt(HIGH_PCT);
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const v = high > low ? ((lum[i] - low) / (high - low)) * 255 : lum[i];
    const o = i * 4;
    out[o] = out[o + 1] = out[o + 2] = v;
    out[o + 3] = 255;
  }
  return { data: out, width: img.width, height: img.height };
}
