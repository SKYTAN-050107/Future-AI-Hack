import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendTarget = String(env.VITE_DIAGNOSIS_API_URL || 'http://127.0.0.1:8000').trim()
  const swarmTarget = String(env.VITE_SWARM_API_URL || 'http://localhost:3400').trim()

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['pwa-icon.svg', 'pwa-maskable.svg'],
        manifest: {
          name: 'AcreZen',
          short_name: 'AcreZen',
          description: 'Offline-first AI farming assistant for padi farmers.',
          theme_color: '#10a36c',
          background_color: '#edf8f4',
          display: 'standalone',
          scope: '/',
          start_url: '/',
          icons: [
            {
              src: '/pwa-icon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          navigateFallback: '/index.html',
          runtimeCaching: [
            {
              urlPattern: ({ request }) => request.destination === 'document',
              handler: 'NetworkFirst',
              options: {
                cacheName: 'pages-cache',
              },
            },
            {
              urlPattern: ({ request }) => request.destination === 'script' || request.destination === 'style' || request.destination === 'worker',
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'asset-cache',
              },
            },
            {
              urlPattern: ({ url }) => url.pathname.startsWith('/api'),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'api-cache',
                networkTimeoutSeconds: 4,
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
        },
      }),
    ],
    server: {
      proxy: {
        '/api': {
          target: backendTarget,
          changeOrigin: true,
        },
        '/health': {
          target: backendTarget,
          changeOrigin: true,
        },
        '/ws': {
          target: backendTarget,
          ws: true,
          changeOrigin: true,
        },
        '/swarm-api': {
          target: swarmTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/swarm-api/, '/api'),
        },
      },
    },
  }
})
