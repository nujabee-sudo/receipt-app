// 브라우저 전용: Vite가 글꼴 파일을 정적 자산으로 내보내고 URL을 준다.
import regularUrl from 'pretendard/dist/public/static/alternative/Pretendard-Regular.ttf?url';

let cache: Promise<{ regular: Uint8Array }> | null = null;

export function loadFonts(): Promise<{ regular: Uint8Array }> {
  cache ??= fetch(regularUrl)
    .then((r) => r.arrayBuffer())
    .then((b) => ({ regular: new Uint8Array(b) }));
  return cache;
}
