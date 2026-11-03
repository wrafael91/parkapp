import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Same origin in development too: the page calls /api and Vite forwards
    // it to the local API, as Nginx does in production (ADR 0002).
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
  build: {
    // Never inline files as data: URIs, so the CSP can allow only 'self'.
    assetsInlineLimit: 0,
  },
})
