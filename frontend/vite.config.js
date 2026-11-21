import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'
import { publicDocuments } from './public-pages.js'
import { locationEndpoint } from './server/locationPlugin.js'

const catalog = JSON.parse(readFileSync(new URL('./data-catalog.json', import.meta.url), 'utf8'))
const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL
const origin = productionHost ? `https://${productionHost}` : null

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), locationEndpoint(), publicDocuments({ origin, catalog })],
  server: {
    port: 5173,
    proxy: {
      // Local development fallback so the UI works without extra config
      // when the backend runs on its default port. Production deployments
      // must set VITE_API_BASE_URL instead.
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
