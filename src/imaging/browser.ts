// 브라우저 전용 (canvas). 단위 테스트 대상 아님 — E2E와 실기기로 확인한다.
import type { Pt } from '../domain/types';
import { denormalizeCorners, type Quad } from './homography';
import { scanFilter } from './scanFilter';
import { warp, type Img } from './warp';
import { DecodeError } from './errors';

export { DecodeError } from './errors';

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Blob을 디코딩해 긴 변이 maxLong 이하가 되게 줄인 RGBA 이미지로 */
export async function decodeToImg(blob: Blob, maxLong: number): Promise<Img> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    throw new DecodeError();
  }
  const scale = Math.min(1, maxLong / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const ctx = canvas(w, h).getContext('2d')!;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const d = ctx.getImageData(0, 0, w, h);
  return { data: d.data, width: w, height: h };
}

export function imgToJpeg(img: Img, quality: number): Promise<Blob> {
  const c = canvas(img.width, img.height);
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('JPEG 변환 실패'))), 'image/jpeg', quality),
  );
}

/** 긴 변 maxLong JPEG로 다시 저장 (원본 2400px, 인식용 1600px) */
export async function resizeJpeg(blob: Blob, maxLong: number, quality: number): Promise<Blob> {
  return imgToJpeg(await decodeToImg(blob, maxLong), quality);
}

/** corners(원본 기준 픽셀 좌표)로 펴고 스캔 필터 → 1600px 이하 JPEG */
export async function processPhoto(original: Blob, corners: [Pt, Pt, Pt, Pt] | null): Promise<Blob> {
  const src = await decodeToImg(original, 2400);
  let img = corners ? warp(src, corners) : src;
  img = scanFilter(img);
  const long = Math.max(img.width, img.height);
  if (long > 1600) {
    const tmp = await imgToJpeg(img, 0.92);
    img = await decodeToImg(tmp, 1600);
  }
  return imgToJpeg(img, 0.8);
}

/** 정규화 corners(0~1000)를 원본 픽셀로 변환 */
export async function cornersToPixels(original: Blob, normalized: Quad): Promise<Quad> {
  const bmp = await createImageBitmap(original, { imageOrientation: 'from-image' });
  const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  bmp.close();
  return denormalizeCorners(normalized, w, h);
}

/** 높이/너비 비율 */
export async function imageAspect(blob: Blob): Promise<number> {
  const bmp = await createImageBitmap(blob);
  const a = bmp.height / bmp.width;
  bmp.close();
  return a;
}

export async function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  const bmp = await createImageBitmap(blob);
  const s = { width: bmp.width, height: bmp.height };
  bmp.close();
  return s;
}
