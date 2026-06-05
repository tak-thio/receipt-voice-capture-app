import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Tauri injects TAURI_DEV_HOST when running `tauri android/ios dev` so the device
// or emulator can reach the dev server over the LAN instead of localhost.
const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [react()],
  // Prevent Vite from obscuring Rust/mobile build errors.
  clearScreen: false,
  server: {
    host: host || '0.0.0.0',
    port: 5173,
    strictPort: true,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 5174,
        }
      : undefined,
    watch: {
      // Don't watch the Rust/native side from the web dev server.
      ignored: ['**/src-tauri/**'],
    },
  },
})
