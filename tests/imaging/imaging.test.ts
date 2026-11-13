import { expect, test } from 'vitest';
import {
  applyHomography,
  computeHomography,
  denormalizeCorners,
  outputSize,
} from '../../src/imaging/homography';
import { warp, type Img } from '../../src/imaging/warp';
import { scanFilter } from '../../src/imaging/scanFilter';
import type { Pt } from '../../src/domain/types';

type Quad = [Pt, Pt, Pt, Pt];
const unit: Quad = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

test('computeHomography maps the four corners', () => {
  const dst: Quad = [
    [10, 20],
    [110, 30],
    [100, 140],
    [5, 120],
  ];
  const h = computeHomography(unit, dst);
  expect(h).toHaveLength(9);
  unit.forEach((p, i) => {
    const [x, y] = applyHomography(h, p);
    expect(x).toBeCloseTo(dst[i][0], 6);
    expect(y).toBeCloseTo(dst[i][1], 6);
  });
});

test('identity homography keeps interior points', () => {
  const q: Quad = [
    [3, 4],
    [50, 2],
    [55, 60],
    [1, 58],
  ];
  const h = computeHomography(q, q);
  const [x, y] = applyHomography(h, [0.3, 0.7]);
  expect(x).toBeCloseTo(0.3, 6);
  expect(y).toBeCloseTo(0.7, 6);
});

test('denormalizeCorners scales 0..1000 to pixels', () => {
  expect(
    denormalizeCorners(
      [
        [0, 0],
        [1000, 0],
        [1000, 1000],
        [500, 250],
      ],
      200,
      400,
    ),
  ).toEqual([
    [0, 0],
    [200, 0],
    [200, 400],
    [100, 100],
  ]);
});

test('outputSize uses longest opposite edges', () => {
  expect(
    outputSize([
      [0, 0],
      [100, 0],
      [90, 200],
      [10, 190],
    ]),
  ).toEqual({ width: 100, height: 200 });
});

function makeImg(w: number, h: number, fill: (x: number, y: number) => number): Img {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = fill(x, y);
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  return { data, width: w, height: h };
}

test('warp extracts the white square', () => {
  const src = makeImg(40, 40, (x, y) => (x >= 10 && x < 30 && y >= 10 && y < 30 ? 255 : 0));
  const out = warp(src, [
    [10, 10],
    [30, 10],
    [30, 30],
    [10, 30],
  ]);
  expect(out.width).toBe(20);
  expect(out.height).toBe(20);
  for (let i = 0; i < out.data.length; i += 4) expect(out.data[i]).toBeGreaterThanOrEqual(250);
});

test('scanFilter stretches to full range in grayscale', () => {
  const src = makeImg(101, 1, (x) => 100 + x); // 100..200
  // 색을 섞어 회색 변환 확인
  src.data[0] = 200;
  src.data[1] = 50;
  const out = scanFilter(src);
  let min = 255,
    max = 0;
  for (let i = 0; i < out.data.length; i += 4) {
    expect(out.data[i]).toBe(out.data[i + 1]);
    expect(out.data[i]).toBe(out.data[i + 2]);
    min = Math.min(min, out.data[i]);
    max = Math.max(max, out.data[i]);
  }
  expect(max).toBe(255);
  expect(min).toBe(0);
});

test('scanFilter on flat image does not divide by zero', () => {
  const out = scanFilter(makeImg(4, 4, () => 128));
  expect(Array.from(out.data.slice(0, 3)).every((v) => Number.isFinite(v))).toBe(true);
});
