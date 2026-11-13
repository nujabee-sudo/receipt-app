import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  use: {
    baseURL: 'http://localhost:4173/receipt-app/',
    // 아이폰 화면 크기·터치를 흉내 내되, 브라우저는 설치가 가벼운 Chromium을 쓴다
    ...devices['iPhone 13'],
    browserName: 'chromium',
    // 서비스 워커가 가로채면 page.route 모의 응답이 우회될 수 있어 막는다
    serviceWorkers: 'block',
    actionTimeout: 15_000,
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173/receipt-app/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
