// End-to-end smoke test for the Simulate view (Task 15).
//
// This drives the REAL worker (`src/sim/worker.ts`), not a mock — the point
// is to prove the `new Worker(new URL(...))` wiring actually works in a
// browser, which `tests/ui/simulate.test.tsx`'s injected-fake-worker suite
// cannot. Both agents are set to `random` (the heuristic agent plays out
// more of its hand per turn and is noticeably slower) and the game count is
// kept small, so a real 20-game run comfortably finishes well under this
// suite's own per-assertion timeout.

import { expect, test } from '@playwright/test'

test.describe('Simulate view', () => {
  test('runs a real 20-game random-vs-random sim and shows a win rate', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))

    await page.goto('/')
    await page.getByTestId('tab-simulate').click()
    await expect(page.getByTestId('simulate-view')).toBeVisible()

    await page.getByTestId('sim-agent-a').selectOption('random')
    await page.getByTestId('sim-agent-b').selectOption('random')
    await page.getByTestId('sim-games').fill('20')

    await page.getByTestId('sim-run').click()

    // The real worker is doing the work here (no mock): allow it real time,
    // but a 20-game random-vs-random run should land in well under 5s.
    await expect(page.getByTestId('sim-results')).toBeVisible({ timeout: 5_000 })

    await expect(page.getByTestId('sim-winrate-a')).toContainText('%')
    await expect(page.getByTestId('sim-winrate-b')).toContainText('%')
    await expect(page.getByTestId('sim-avg-turns')).toContainText('turns')
    // The progress UI is gone once the result has landed.
    await expect(page.getByTestId('sim-progress')).toHaveCount(0)

    expect(pageErrors, 'no uncaught page errors').toEqual([])
  })
})
