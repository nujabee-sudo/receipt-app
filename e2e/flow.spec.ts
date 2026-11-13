import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const jpg = readFileSync('tests/fixtures/tiny.jpg');
const now = new Date();
const pad = (n: number) => String(n).padStart(2, '0');
const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const BASE_NAME = `${now.getFullYear()}년 ${now.getMonth() + 1}월 법인카드(#1234) 사용내역서_김철수`;

test('photo → review → generate → download', async ({ page }) => {
  // 공유 메뉴 대신 다운로드 경로를 타게 한다
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  });

  // Gemini 호출을 가로채 고정 응답을 준다. 요청에 들어 있는 [#n] 표시 수만큼 결과를 만든다.
  let calls = 0;
  await page.route('**/generativelanguage.googleapis.com/**', async (route) => {
    calls++;
    const body = route.request().postData() ?? '';
    const n = (body.match(/\[#\d+\]/g) ?? []).length || 1;
    const results = Array.from({ length: n }, (_, i) => ({
      index: i,
      date: TODAY,
      time: `${pad(9 + i)}:30`,
      amount: 10000 + i * 1500,
      cardLast4: '1234',
      merchant: `테스트주유소${i + 1}`,
      approvalNo: `1000${i}`,
      category: 'fuel',
      isCancellation: false,
      corners: null,
    }));
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify({ results }) }] }, finishReason: 'STOP' }],
      }),
    });
  });

  // 1) 설정
  await page.goto('#/settings');
  await page.getByLabel('Gemini API 키').fill('test-key');
  await page.getByLabel('기본 카드번호 뒷자리').fill('1234');
  await page.getByLabel('기본 사용자 이름').fill('김철수');
  await page.getByLabel('기본 차량 이름').fill('쏘렌토');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByText('저장했어요')).toBeVisible();

  // 2) 사진 2장 등록
  await page.goto('#/capture');
  await page.getByLabel('앨범에서 사진 선택').setInputFiles([
    { name: 'r1.jpg', mimeType: 'image/jpeg', buffer: jpg },
    { name: 'r2.jpg', mimeType: 'image/jpeg', buffer: jpg },
  ]);
  await expect(page.getByText('이번에 2장 등록했어요')).toBeVisible();
  await page.getByRole('link', { name: '완료' }).click();

  // 3) 인식이 끝나면 ⚠ 2건 (현장이 비어 있음)
  await expect(page.getByLabel('확인 필요')).toHaveCount(2, { timeout: 45_000 });
  expect(calls).toBeGreaterThan(0);

  // 4) 각각 현장 입력 후 확인
  await page.locator('a.row').first().click();
  for (let i = 0; i < 2; i++) {
    await expect(page.getByRole('heading', { name: '영수증 확인' })).toBeVisible();
    await expect(page.getByLabel('가맹점')).toHaveValue(/테스트주유소/);
    const before = page.url();
    await page.getByLabel('현장', { exact: true }).fill('가나테크_서울 본사, 1호기 시운전');
    await page.getByRole('button', { name: '확인', exact: true }).click();
    await expect(page).not.toHaveURL(before);
  }
  await expect(page.getByLabel('문서 생성 완료')).toHaveCount(0);
  await expect(page.getByLabel('확인 필요')).toHaveCount(0);

  // 5) 문서 생성 → 이번 달 전체 → PDF와 엑셀 다운로드
  await page.getByRole('link', { name: '문서 생성' }).click();
  await expect(page.getByLabel('이번 달 전체')).toBeChecked();
  await page.getByRole('button', { name: '문서 만들기' }).click();
  await expect(page.getByTitle('PDF 미리보기')).toBeVisible({ timeout: 30_000 });

  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PDF 저장/공유' }).click()]);
  expect(pdf.suggestedFilename()).toBe(`${BASE_NAME}.pdf`);
  const [xlsx] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '엑셀 저장/공유' }).click()]);
  expect(xlsx.suggestedFilename()).toBe(`${BASE_NAME}.xlsx`);

  // 저장 뒤에는 ✓ 문서 생성 완료로 바뀐다
  await page.getByRole('link', { name: '뒤로' }).click();
  await expect(page.getByLabel('문서 생성 완료')).toHaveCount(2);
});
