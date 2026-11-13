import { applyHomography, computeHomography, outputSize, type Quad } from './homography';

/** RGBA 이미지 (ImageData와 같은 모양) */
export interface Img {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** corners(원본 픽셀, 좌상·우상·우하·좌하)로 둘러싼 영역을 직사각형으로 펴낸다. 역방향 매핑 + 쌍선형 보간. */
export function warp(src: Img, corners: Quad): Img {
  const { width: W, height: H } = outputSize(corners);
  const h = computeHomography(
    [
      [0, 0],
      [W, 0],
      [W, H],
      [0, H],
    ],
    corners,
  );
  const out = new Uint8ClampedArray(W * H * 4);
  const sw = src.width;
  const sh = src.height;
  const px = (x: number, y: number, c: number) => {
    const cx = Math.min(sw - 1, Math.max(0, x));
    const cy = Math.min(sh - 1, Math.max(0, y));
    return src.data[(cy * sw + cx) * 4 + c];
  };
  for (let oy = 0; oy < H; oy++) {
    for (let ox = 0; ox < W; ox++) {
      const [sx0, sy0] = applyHomography(h, [ox + 0.5, oy + 0.5]);
      const sx = sx0 - 0.5;
      const sy = sy0 - 0.5;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const o = (oy * W + ox) * 4;
      for (let c = 0; c < 4; c++) {
        const top = px(x0, y0, c) * (1 - fx) + px(x0 + 1, y0, c) * fx;
        const bot = px(x0, y0 + 1, c) * (1 - fx) + px(x0 + 1, y0 + 1, c) * fx;
        out[o + c] = top * (1 - fy) + bot * fy;
      }
    }
  }
  return { data: out, width: W, height: H };
}
