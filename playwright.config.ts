import { defineConfig, devices } from '@playwright/test'

// E2E lives in `e2e/`, deliberately outside the `tests/**` glob vitest is
// configured with (vite.config.ts) — the two runners never see each other's
// files. Chromium only: the suite is a binding smoke test for the Play view's
// own DOM contract, not a browser-compatibility matrix.
const PORT = 5174
// `localhost`, not `127.0.0.1`: vite binds to whatever `localhost` resolves to,
// which on a stock Windows box is the IPv6 loopback only — a `127.0.0.1` probe
// then times out against a server that is up and serving.
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  // A full game against the heuristic AI is a few hundred DOM round-trips.
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // `--strictPort` so a stale server on another port can never be mistaken
    // for this one; the dedicated port keeps `npm run dev` usable alongside it.
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
