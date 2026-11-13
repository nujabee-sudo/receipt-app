// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { shareOrDownload } from '../../src/export/share';

const file = { name: 'a.pdf', blob: new Blob(['x'], { type: 'application/pdf' }) };
const nav = navigator as unknown as Record<string, unknown>;

afterEach(() => {
  delete nav.canShare;
  delete nav.share;
  vi.restoreAllMocks();
});

test('uses the share sheet when files can be shared', async () => {
  const share = vi.fn().mockResolvedValue(undefined);
  nav.canShare = () => true;
  nav.share = share;
  expect(await shareOrDownload(file)).toBe('shared');
  expect(share).toHaveBeenCalledOnce();
});

test('falls back to a download when sharing is unsupported', async () => {
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  expect(await shareOrDownload(file)).toBe('downloaded');
  expect(click).toHaveBeenCalledOnce();
});

test('cancelling the share sheet reports cancelled', async () => {
  nav.canShare = () => true;
  nav.share = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'AbortError' }));
  expect(await shareOrDownload(file)).toBe('cancelled');
});
