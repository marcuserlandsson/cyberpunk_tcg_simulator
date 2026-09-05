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
    // Never reuse: this suite's whole safety story is that the server it talks
    // to was started with CTCG_COLLECTION_FILE pointed at a scratch file. A
    // leftover server on this port, started some other way, would be reused
    // silently and the collection tests would write the owner's real
    // data/collection.json. It costs nothing here -- `npm run dev` defaults to
    // 5173, so this only ever converts a genuinely stale 5174 server into a
    // loud port-in-use failure instead of a quiet wrong-target run.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
    // The whole e2e suite must never touch the real data/collection.json or
    // produce a real git commit. Pointing the endpoint at a scratch file
    // (gitignored under test-results/) also disables git automation entirely
    // (see src/server/collectionGit.ts's gitAutomationDisabled) — the same
    // lever closes both risks at once.
    env: {
      ...process.env,
      CTCG_COLLECTION_FILE: 'test-results/e2e-collection.json',
    },
  },
})
