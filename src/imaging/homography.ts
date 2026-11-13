import type { Pt } from '../domain/types';

export type Quad = [Pt, Pt, Pt, Pt];

/** 부분 피벗 가우스 소거로 Ax=b 풀이 */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    if (Math.abs(m[piv][col]) < 1e-12) throw new Error('특이 행렬: 모서리가 한 줄로 놓였어요');
    [m[col], m[piv]] = [m[piv], m[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

/** src의 네 점을 dst의 네 점으로 보내는 3×3 호모그래피 (길이 9, h[8]=1) */
export function computeHomography(src: Quad, dst: Quad): number[] {
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    a.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    b.push(v);
  }
  return [...solve(a, b), 1];
}

export function applyHomography(h: number[], [x, y]: Pt): Pt {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

/** 0~1000 정규화 좌표 → 픽셀 */
export function denormalizeCorners(c: Quad, w: number, h: number): Quad {
  return c.map(([x, y]) => [(x * w) / 1000, (y * h) / 1000]) as Quad;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** 마주 보는 변 길이의 최댓값으로 출력 크기를 정한다 */
export function outputSize([tl, tr, br, bl]: Quad): { width: number; height: number } {
  return {
    width: Math.round(Math.max(dist(tl, tr), dist(bl, br))),
    height: Math.round(Math.max(dist(tl, bl), dist(tr, br))),
  };
}
