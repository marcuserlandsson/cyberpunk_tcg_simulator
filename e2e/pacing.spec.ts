// Paced presentation, end to end: at normal pacing, a rival turn plays as
// visible beats, the human prompt waits for playback, and Skip turn drains
// it. Unlike play.spec.ts this runs WITHOUT `?aiDelay=0`, because pacing
// is the point. It never plays a full game.
import { expect, test } from './fixtures'

test('rival actions play as beats before the human is prompted', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ctcg.pacingSpeed', 'fast'))
  await page.goto('/')
  await expect(page.getByTestId('play-setup')).toBeVisible()
  await page.getByTestId('deck-human').selectOption('Arasaka — Embracing Power')
  await page.getByTestId('deck-ai').selectOption('Mercs — The Heist')
  await page.getByTestId('seed-input').fill('20260822')
  await page.getByTestId('start-game').click()

  const playmat = page.getByTestId('playmat')
  await expect(page.getByTestId('pacing-speed-fast')).toBeChecked()

  // The pregame reveal (order roll, both hands' draws, the rival's own
  // mulligan) plays as one continuous presenting sequence before the human
  // is asked anything at all. Wait for it to drain before touching the
  // human's own mulligan prompt.
  await expect.poll(() => playmat.getAttribute('data-awaiting'), { timeout: 30_000 }).toBe('human')

  // Rival goes first with this seed, so the human's prompts are answered with
  // the same safe defaults play.spec.ts's takeOneAction uses, until the
  // rival's own turn starts playing as beats.
  await expect(async () => {
    if ((await playmat.getAttribute('data-awaiting')) === 'human') {
      const orderFirst = page.getByTestId('choose-order-first')
      const keepHand = page.getByTestId('keep-hand')
      const endTurn = page.getByTestId('end-turn')
      if (await orderFirst.isVisible()) await orderFirst.click()
      else if (await keepHand.isVisible()) await keepHand.click()
      else if (await endTurn.isEnabled()) await endTurn.click()
    }
    expect(await playmat.getAttribute('data-awaiting')).toBe('presenting')
  }).toPass({ timeout: 15_000, intervals: [100] })

  // Pause at once, so the presenting window cannot close under the checks.
  await page.keyboard.press('p')
  await expect(page.getByTestId('pacing-pause')).toHaveAttribute('aria-pressed', 'true')
  await expect(playmat).toHaveAttribute('data-awaiting', 'presenting')
  await expect(page.getByTestId('beat-layer')).toBeVisible()
  await page.screenshot({ path: 'test-results/pacing-beat.png' })

  // Playback blocks the prompt.
  await expect(page.getByTestId('end-turn')).toBeDisabled()

  // Space skips a beat even while paused: the step indicator or the beat
  // itself changes.
  // Read straight from the DOM: a locator would wait for a missing element.
  const signature = () => page.evaluate(() => {
    const step = document.querySelector('[data-testid="pacing-step"]')
    const layer = document.querySelector('[data-testid="beat-layer"]')
    return [step?.textContent, layer?.className, layer?.textContent].join('|')
  })
  const before = await signature()
  await page.keyboard.press('Space')
  await expect.poll(signature).not.toBe(before)

  // Skipping the turn gets back to the human.
  if ((await playmat.getAttribute('data-awaiting')) === 'presenting') await page.getByTestId('pacing-skip-turn').click()
  await expect(playmat).toHaveAttribute('data-awaiting', /^(human|over)$/, { timeout: 30_000 })
  await expect(page.getByTestId('beat-layer')).toHaveCount(0)
})
