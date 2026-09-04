/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const port = Number(process.env.PORT) || 3410

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the build works at any URL (e.g. GitHub Pages subpath).
  base: './',
  server: { port, strictPort: true },
  preview: { port, strictPort: true },
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/testSetup.ts'],
    exclude: ['e2e/**'],
  },
})
