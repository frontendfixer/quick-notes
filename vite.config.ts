import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  root: 'apps/web',
  plugins: [
    solid(),
    VitePWA({
      registerType: 'prompt',
      manifest: {
        id: '/',
        name: 'Quick Notes',
        short_name: 'Quick Notes',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f7f6f3',
        theme_color: '#f7f6f3',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,webmanifest}'],
        navigateFallbackDenylist: [/^\/api(?:\/|$)/],
      },
    }),
  ],
  server: { proxy: { '/api': 'http://127.0.0.1:3000' } },
})
