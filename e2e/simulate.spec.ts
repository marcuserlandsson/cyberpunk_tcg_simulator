// End-to-end smoke test for the Simulate view (Task 15).
//
// This drives the REAL worker (`src/sim/worker.ts`), not a mock — the point
// is to prove the `new Worker(new URL(...))` wiring actually works in a
// browser, which `tests/ui/simulate.test.tsx`'s injected-fake-worker suite
// cannot. Both agents are set to `random` (the heuristic agent plays out
// more of its hand per turn and is noticeably slower) and the game count is
// kept small, so a real 20-game run comfortably finishes well under this
// suite's own per-assertion timeout.

import { expect, test } from './fixtures'

test('runs the strategic AI through the real simulation worker', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.getByTestId('tab-simulate').click()
  await page.getByTestId('sim-agent-a').selectOption('medium')
  await page.getByTestId('sim-agent-b').selectOption('medium')
  await page.getByTestId('sim-games').fill('4')
  await page.getByTestId('sim-run').click()
  await expect(page.getByTestId('sim-results')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('sim-winrate-a')).toContainText('%')
  await expect(page.getByTestId('sim-progress')).toHaveCount(0)
  expect(errors).toEqual([])
})

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

    await page.getByTestId('tab-deckBuilder').click()
    await page.getByTestId('tab-simulate').click()

    // The real worker is doing the work here (no mock): allow it real time,
    // but a 20-game random-vs-random run should land in well under 5s.
    await expect(page.getByTestId('sim-results')).toBeVisible({ timeout: 5_000 })

    await expect(page.getByTestId('sim-winrate-a')).toContainText('%')
    await expect(page.getByTestId('sim-winrate-b')).toContainText('%')
    await expect(page.getByTestId('sim-avg-turns')).toContainText('turns')
    // The progress UI is gone once the result has landed.
    await expect(page.getByTestId('sim-progress')).toHaveCount(0)

    await expect(page.getByTestId('sim-provenance')).toContainText('42')
    const provenance = await page.getByTestId('sim-provenance').locator('p').allTextContents()
    const snapshots = JSON.parse((await page.getByTestId('sim-provenance').locator('pre').textContent())!)
    await page.reload()
    await page.getByTestId('tab-simulate').click()
    await expect(page.getByTestId('sim-results')).toBeVisible()
    await expect(page.getByTestId('sim-provenance').locator('p')).toHaveText(provenance)
    expect(JSON.parse((await page.getByTestId('sim-provenance').locator('pre').textContent())!)).toEqual(snapshots)
    await page.getByTestId('sim-history').locator('summary').click()
    await expect(page.getByTestId('sim-open-run')).toHaveCount(1)
    expect(pageErrors, 'no uncaught page errors').toEqual([])
  })
})



test('compares two versions against two opponents and retains the matched results', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('tab-simulate').click()
  await page.getByTestId('sim-agent-a').selectOption('random')
  await page.getByTestId('sim-agent-b').selectOption('random')
  await page.getByTestId('sim-games').fill('2')
  await page.getByTestId('sim-benchmark').locator('summary').click()
  const opponents = page.getByTestId('sim-benchmark').locator('input[type="checkbox"]')
  await opponents.nth(0).check(); await opponents.nth(1).check()
  await page.getByTestId('benchmark-start').click()
  await expect(page.getByTestId('benchmark-result')).toHaveCount(2)
  await expect(page.getByTestId('benchmark-start')).toBeEnabled()
  await expect(page.getByTestId('sim-benchmark')).toContainText('percentage points')
  await page.reload()
  await page.getByTestId('tab-simulate').click()
  await page.getByTestId('sim-benchmark').locator('summary').click()
  await expect(page.getByTestId('benchmark-result')).toHaveCount(2)
  await expect(page.getByTestId('sim-history').locator('summary')).toContainText('(4)')
})


test('runs Hard versus Easy and retains difficulty in simulation history', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('tab-simulate').click()
  await page.getByTestId('sim-deck-a').selectOption('Arasaka \u2014 Embracing Power')
  await page.getByTestId('sim-deck-b').selectOption('Mercs \u2014 The Heist')
  await page.getByTestId('sim-agent-a').selectOption('hard')
  await page.getByTestId('sim-agent-b').selectOption('easy')
  await page.getByTestId('sim-games').fill('1')
  await page.screenshot({ path: 'test-results/ai-difficulty-simulate.png', fullPage: true })
  await page.getByTestId('sim-run').click()
  await expect(page.getByTestId('sim-results')).toBeVisible({ timeout: 120_000 })
  await expect(page.getByTestId('sim-provenance')).toContainText('hard vs easy')
  await page.reload()
  await page.getByTestId('tab-simulate').click()
  await expect(page.getByTestId('sim-provenance')).toContainText('hard vs easy')
})
