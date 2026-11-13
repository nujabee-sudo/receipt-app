export type ShareResult = 'shared' | 'downloaded' | 'cancelled';

/** 폰 공유 메뉴로 보내고, 지원하지 않으면 다운로드한다 */
export async function shareOrDownload(file: { name: string; blob: Blob }): Promise<ShareResult> {
  const f = new File([file.blob], file.name, { type: file.blob.type });
  const nav = globalThis.navigator as Navigator | undefined;
  if (nav?.canShare?.({ files: [f] }) && nav.share) {
    try {
      await nav.share({ files: [f], title: file.name });
      return 'shared';
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return 'cancelled';
      // 공유 실패 시 다운로드로 대체
    }
  }
  const url = URL.createObjectURL(f);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
