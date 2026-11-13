import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/receipt-app/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: '영수증 정리',
        short_name: '영수증',
        description: '법인카드 영수증을 찍어 지출내역서 PDF와 엑셀로 정리해요',
        lang: 'ko',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        background_color: '#ffffff',
        theme_color: '#2445a8',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 앱 셸 + 한글 글꼴(약 2.7MB)을 미리 받아 두어 오프라인에서도 문서를 만들 수 있게 한다
        globPatterns: ['**/*.{js,css,html,ttf,png,svg}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
});
