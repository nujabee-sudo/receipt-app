import type { Pt, Rotation } from '../domain/types';
import type { Quad } from './homography';
import type { Img } from './warp';

/**
 * 사진 기준 모서리(좌상·우상·우하·좌하)를 영수증 글자 방향 기준으로 다시 늘어놓는다.
 * warp는 첫 모서리를 결과의 좌상으로 펴므로, 이렇게 넘기면 누운 영수증도 바로 선 보정본이 된다.
 */
export function orientCorners(corners: Quad, rotation: Rotation): Quad {
  const k = rotation / 90;
  return [0, 1, 2, 3].map((i) => corners[(i - k + 4) % 4]) as [Pt, Pt, Pt, Pt];
}

/** 이미지를 시계 방향으로 rotation도 돌린다 (모서리를 못 찾았을 때 사진 전체를 세운다) */
export function rotateImg(src: Img, rotation: Rotation): Img {
  if (rotation === 0) return src;
  const { width: w, height: h } = src;
  const W = rotation === 180 ? w : h;
  const H = rotation === 180 ? h : w;
  const out = new Uint8ClampedArray(src.data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx: number;
      let ny: number;
      if (rotation === 90) [nx, ny] = [h - 1 - y, x];
      else if (rotation === 180) [nx, ny] = [w - 1 - x, h - 1 - y];
      else [nx, ny] = [y, w - 1 - x];
      const s = (y * w + x) * 4;
      out.set(src.data.subarray(s, s + 4), (ny * W + nx) * 4);
    }
  }
  return { data: out, width: W, height: H };
}
