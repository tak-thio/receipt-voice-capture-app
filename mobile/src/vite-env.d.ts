/// <reference types="vite/client" />

// vite.config.ts が tauri.conf.json の version をビルド時に埋め込む(define)。
declare const __APP_VERSION__: string
