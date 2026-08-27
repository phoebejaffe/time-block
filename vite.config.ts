/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the build works at any URL (e.g. GitHub Pages subpath).
  base: './',
  // Pin the dev/preview port: 5174 belongs to another local app, and Google
  // OAuth only allows the origins registered in Google Cloud (5173).
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 5173,
    strictPort: true,
  },
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/testSetup.ts'],
  },
})
