import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  root: 'apps/web',
  plugins: [
    solid(),
    VitePWA({
      injectRegister: false,
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
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest,woff2}'],
        // Keep the cache name stable for installations already using network navigation.
        cacheId: 'quick-notes-network-navigation',
        cleanupOutdatedCaches: false,
        skipWaiting: false,
        clientsClaim: true,
        directoryIndex: null,
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: ({ request, url, sameOrigin }) =>
              request.mode === 'navigate' && sameOrigin && url.pathname === '/',
            handler: 'NetworkOnly',
            options: { precacheFallback: { fallbackURL: '/index.html' } },
          },
        ],
      },
    }),
  ],
  server: { proxy: { '/api': 'http://127.0.0.1:3000' } },
})
