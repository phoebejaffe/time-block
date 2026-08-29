import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5177',
    trace: 'on-first-retry',
    launchOptions: {
      slowMo: Number(process.env.PW_SLOW_MO ?? 0),
    },
  },
  webServer: {
    command: 'VITE_E2E=true npm run dev -- --host 127.0.0.1 --port 5177',
    url: 'http://127.0.0.1:5177',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Pixel 5'],
        hasTouch: true,
      },
    },
  ],
})
