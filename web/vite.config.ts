import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, proxy /api to the FastAPI backend. In prod, Caddy serves both on one origin.
export default defineConfig({
  plugins: [react()],
  build: {
    // Multi-page: the tenant SPA (index.html) and the separate operator console
    // (operator.html). Each is emitted as a real static file, so the operator
    // console does NOT rely on the SPA history fallback.
    rollupOptions: {
      input: {
        main: 'index.html',
        operator: 'operator.html',
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
})
