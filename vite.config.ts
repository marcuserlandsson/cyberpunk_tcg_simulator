import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// NOTE: Installed Vitest is v4.1.11, which dropped the `environmentMatchGlobs`
// config option present in Vitest 0.x/1.x. Per-directory jsdom environments
// are configured with `// @vitest-environment jsdom` pragma comments at the
// top of individual UI test files instead (e.g. tests/ui/**/*.test.tsx).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
} as any)
