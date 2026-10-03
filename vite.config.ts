/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json' with { type: 'json' }

/**
 * Injects the Content-Security-Policy meta tag at build time only.
 * (Vite's dev server relies on inline scripts for HMR, so CSP is not applied in dev.)
 * GitHub Pages cannot send HTTP headers, so a meta tag is the only option there.
 */
function cspPlugin(supabaseUrl: string, shopifyStore: string): Plugin {
  return {
    name: 'havenwear-csp',
    apply: 'build',
    transformIndexHtml(html) {
      let origin = ''
      try {
        origin = new URL(supabaseUrl).origin
      } catch {
        throw new Error('VITE_SUPABASE_URL must be set to a valid URL for production builds')
      }
      const wss = origin.replace(/^https:/, 'wss:')
      const csp = [
        "default-src 'self'",
        "script-src 'self'",
        // Radix + Recharts set inline style attributes; this does not allow inline scripts.
        "style-src 'self' 'unsafe-inline'",
        // Normal Shopify product pictures for the production workflow.
        "img-src 'self' data: blob: https://cdn.shopify.com",
        "font-src 'self'",
        // Supabase API + the store's public products feed (pictures/sizes/colours; no credentials).
        `connect-src 'self' ${origin} ${wss} https://${shopifyStore}`,
        "worker-src 'self'",
        "manifest-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; ')
      return html.replace(
        '<!--CSP-->',
        `<meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      )
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = env.VITE_BASE ?? '/havenwear-ops/'
  const supabaseUrl = env.VITE_SUPABASE_URL ?? ''
  const shopifyStore = env.VITE_SHOPIFY_STORE || 'havenwearpakistan.com'

  return {
    base: mode === 'test' ? '/' : base,
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    plugins: [
      react(),
      tailwindcss(),
      cspPlugin(supabaseUrl, shopifyStore),
      VitePWA({
        registerType: 'prompt',
        injectRegister: null,
        includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
        manifest: {
          name: 'HavenWear Ops',
          short_name: 'HW Ops',
          description: 'Production & returns tracker for HavenWear Pakistan',
          theme_color: '#1F2A44',
          background_color: '#F7F8FA',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '.',
          scope: '.',
          icons: [
            { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          navigateFallback: 'index.html',
          // Never cache Supabase API responses in the service worker; data caching is handled
          // by TanStack Query's persister (cleared on sign-out).
          runtimeCaching: [],
        },
      }),
    ],
    build: {
      sourcemap: false,
      chunkSizeWarningLimit: 900,
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      coverage: { include: ['src/domain/**'] },
    },
  }
})
