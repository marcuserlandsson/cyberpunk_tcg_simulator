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
  // is asked anything at all. Drain it before touching the human's own
  // mulligan prompt, which — like every human-chosen action — resolves
  // instantly rather than queuing beats.
  for (let i = 0; i < 60; i++) {
    const awaiting = await playmat.getAttribute('data-awaiting')
    if (awaiting === 'human') break
    await page.waitForTimeout(100)
  }
  const keepHand = page.getByTestId('keep-hand')
  if (await keepHand.isVisible().catch(() => false)) await keepHand.click()

  // Rival goes first with this seed, so the human's next prompts (if any)
  // are answered with the same safe defaults play.spec.ts's takeOneAction
  // uses, until the rival's own turn starts playing as beats.
  for (let i = 0; i < 60; i++) {
    const awaiting = await playmat.getAttribute('data-awaiting')
    if (awaiting === 'presenting') break
    if (awaiting === 'human') {
      const orderFirst = page.getByTestId('choose-order-first')
      const stillKeepHand = page.getByTestId('keep-hand')
      const endTurn = page.getByTestId('end-turn')
      if (await orderFirst.isVisible().catch(() => false)) await orderFirst.click()
      else if (await stillKeepHand.isVisible().catch(() => false)) await stillKeepHand.click()
      else if (await endTurn.isEnabled().catch(() => false)) await endTurn.click()
    }
    await page.waitForTimeout(100)
  }
  await expect(playmat).toHaveAttribute('data-awaiting', 'presenting', { timeout: 15_000 })
  await expect(page.getByTestId('beat-layer')).toBeVisible()
  await page.screenshot({ path: 'test-results/pacing-beat.png' })

  // Playback blocks the prompt; skipping the turn gets back to the human.
  await expect(page.getByTestId('end-turn')).toBeDisabled()
  await page.getByTestId('pacing-skip-turn').click()
  await expect(playmat).toHaveAttribute('data-awaiting', /^(human|over)$/, { timeout: 30_000 })
  await expect(page.getByTestId('beat-layer')).toHaveCount(0)
})
