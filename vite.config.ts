/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the build works at any URL (e.g. GitHub Pages subpath).
  base: './',
  test: {
    environment: 'happy-dom',
  },
})
