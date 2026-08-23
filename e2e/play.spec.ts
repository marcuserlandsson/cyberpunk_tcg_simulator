// End-to-end smoke test for the Play view.
//
// This is a BINDING test, not a strategy test: it drives the real DOM with a
// deliberately dumb scripted policy (pass every reaction, play the first
// glowing card, attack the Gig area, otherwise end the turn) and asserts that
// the wiring holds up — that clicks reach the engine, that the log grows, and
// that undo removes what the last action wrote. Everything it touches is a
// `data-testid`, so a restyle cannot break it and a renamed handler will.
//
// The AI's pacing delay is turned off with `?aiDelay=0`; `data-awaiting` on the
// playmat is the handshake that keeps the driver from racing the AI's timer.

import { expect, test, type Locator, type Page } from '@playwright/test'

const HUMAN_DECK = 'Arasaka — Embracing Power'
const AI_DECK = 'Mercs — The Heist'
const SEED = '20260822'

/** Hard ceiling on driver iterations, so a wiring bug fails instead of hanging. */
const MAX_STEPS = 500

// A log line renders as "T<turn>\n<text>", so both patterns are anchored to the
// start of a line. `Your X attacks` is the human's own attack; the rival's
// reads "Rival's X attacks your Gig area", which these deliberately miss.
const PLAYED = /^You played /m
const ATTACKED = /^Your .+ attacks /m

function playmat(page: Page): Locator {
  return page.getByTestId('playmat')
}

/** Blocks until the game is waiting on the human (or is over). */
async function awaitHuman(page: Page): Promise<'human' | 'over'> {
  await expect(playmat(page)).toHaveAttribute('data-awaiting', /^(human|over)$/)
  const value = await playmat(page).getAttribute('data-awaiting')
  return value === 'over' ? 'over' : 'human'
}

async function turnNumber(page: Page): Promise<number> {
  return Number((await playmat(page).getAttribute('data-turn')) ?? '0')
}

async function logTexts(page: Page): Promise<string[]> {
  return page.getByTestId('log-line').allInnerTexts()
}

async function isVisible(locator: Locator): Promise<boolean> {
  return (await locator.count()) > 0 && (await locator.first().isVisible())
}

/**
 * One decision, taken by the scripted policy. Returns a tag naming what it did
 * so the test can assert the interesting ones actually happened.
 */
async function takeOneAction(page: Page, wantAttack: boolean): Promise<string> {
  // 1. A pending disambiguation always comes first — it is a half-made choice,
  //    and nothing else on the board is live while it is open.
  const choice = page.getByTestId('choice-bar')
  if (await isVisible(choice)) {
    const gigArea = page.getByTestId('attack-gig-area')
    if (wantAttack && (await isVisible(gigArea))) {
      await gigArea.click()
      return 'attack-gig-area'
    }
    await choice.getByTestId('target-option').first().click()
    return 'target'
  }

  // 2. Reaction window: always pass.
  const reactionBar = page.getByTestId('reaction-bar')
  if (await isVisible(reactionBar)) {
    await page.getByTestId('reaction-pass').click()
    return 'pass'
  }

  // 3. The remaining modal-style prompt bars, answered with their safe option.
  const intercept = page.getByTestId('intercept-decline')
  if (await isVisible(intercept)) {
    await intercept.click()
    return 'intercept-decline'
  }
  const rerollNo = page.getByTestId('gig-reroll-no')
  if (await isVisible(rerollNo)) {
    await rerollNo.click()
    return 'gig-reroll-no'
  }
  const orderFirst = page.getByTestId('choose-order-first')
  if (await isVisible(orderFirst)) {
    await orderFirst.click()
    return 'choose-order'
  }
  const keepHand = page.getByTestId('keep-hand')
  if (await isVisible(keepHand)) {
    await keepHand.click()
    return 'keep-hand'
  }

  // 4. Start of turn: take a Gig die out of the fixer area.
  const fixerDie = page.locator('[data-testid="fixer-die"][data-choosable="true"]')
  if ((await fixerDie.count()) > 0) {
    await fixerDie.first().click()
    return 'choose-gig-die'
  }

  // 5. A steal we own: take the first stealable rival Gig.
  const stealable = page.locator('[data-testid="gig-die"][data-stealable="true"]')
  if ((await stealable.count()) > 0) {
    await stealable.first().click()
    return 'steal-gig'
  }

  // 6. Main phase. Attack first when the test still needs one, then plays,
  //    then end the turn.
  if (wantAttack) {
    const attacker = page.getByTestId('attacker-card')
    if ((await attacker.count()) > 0) {
      await attacker.first().click()
      return 'select-attacker'
    }
  }
  const playable = page.getByTestId('playable-card')
  if ((await playable.count()) > 0) {
    await playable.first().click()
    return 'play-card'
  }
  if (!wantAttack) {
    const attacker = page.getByTestId('attacker-card')
    if ((await attacker.count()) > 0) {
      await attacker.first().click()
      return 'select-attacker'
    }
  }

  const endTurn = page.getByTestId('end-turn')
  if (await endTurn.isEnabled()) {
    await endTurn.click()
    return 'end-turn'
  }

  throw new Error('scripted policy found nothing to click while the game awaited the human')
}

test.describe('Play view', () => {
  test('plays a game against the AI with log, attacks and undo', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))

    await page.goto('/?aiDelay=0')

    // --- new game: both starter decks and a fixed seed -------------------
    await expect(page.getByTestId('play-setup')).toBeVisible()
    await page.getByTestId('deck-human').selectOption(HUMAN_DECK)
    await page.getByTestId('deck-ai').selectOption(AI_DECK)
    await page.getByTestId('seed-input').fill(SEED)
    await page.getByTestId('start-game').click()

    await expect(playmat(page)).toBeVisible()
    await expect(page.getByTestId('seed-chip')).toContainText(SEED)
    // The log exists from the very first frame: `gameStarted` is an event.
    await expect(page.getByTestId('log-line').first()).toContainText('Game started')

    // --- the scripted game loop ------------------------------------------
    let attackDeclared = false
    let cardPlayed = false
    let undoDone = false
    let steps = 0

    for (; steps < MAX_STEPS; steps++) {
      if ((await awaitHuman(page)) === 'over') break
      if ((await turnNumber(page)) >= 3 && attackDeclared && cardPlayed && undoDone) break

      await takeOneAction(page, !attackDeclared)

      const log = await logTexts(page)
      cardPlayed ||= log.some((line) => PLAYED.test(line))
      attackDeclared ||= log.some((line) => ATTACKED.test(line))

      // --- undo, once, as soon as there is something of ours to undo ----
      if (!undoDone && cardPlayed) {
        if ((await awaitHuman(page)) === 'over') break
        const undo = page.getByTestId('undo')
        await expect(undo).toBeEnabled()
        const before = await logTexts(page)
        const lastLine = before[before.length - 1]
        await undo.click()
        await expect
          .poll(() => page.getByTestId('log-line').count(), { timeout: 15_000 })
          .toBeLessThan(before.length)
        const after = await logTexts(page)
        // The undone action's own lines are gone, and everything before them
        // is untouched: the log is a strict prefix of what it was.
        expect(after.length).toBeLessThan(before.length)
        expect(before.slice(0, after.length)).toEqual(after)
        const occurrences = (lines: string[]) => lines.filter((line) => line === lastLine).length
        expect(occurrences(after)).toBeLessThan(occurrences(before))
        undoDone = true
        // The undone play may have been the only "You played" line.
        cardPlayed = after.some((line) => PLAYED.test(line))
        attackDeclared = after.some((line) => ATTACKED.test(line))
      }
    }

    const reachedTurn = await turnNumber(page)
    const logLines = await page.getByTestId('log-line').count()
    // Printed on purpose: it is the evidence that the policy really played a
    // game rather than tripping over a vacuously-true assertion.
    console.log(
      `scripted policy: ${steps} decisions, reached turn ${reachedTurn}, ${logLines} log lines`
    )

    expect(steps, 'the scripted policy should not have exhausted its step budget').toBeLessThan(
      MAX_STEPS
    )
    expect(undoDone, 'undo was exercised').toBe(true)
    expect(cardPlayed, 'at least one card was played').toBe(true)
    expect(attackDeclared, 'at least one attack was declared').toBe(true)
    expect(await turnNumber(page), 'reached turn 3').toBeGreaterThanOrEqual(3)
    expect(await page.getByTestId('log-line').count()).toBeGreaterThan(20)
    expect(pageErrors, 'no uncaught page errors').toEqual([])
  })

  test('plays a whole game to completion without a page error', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))

    await page.goto('/?aiDelay=0')
    await page.getByTestId('deck-human').selectOption(HUMAN_DECK)
    await page.getByTestId('deck-ai').selectOption(AI_DECK)
    await page.getByTestId('seed-input').fill(SEED)
    await page.getByTestId('start-game').click()
    await expect(playmat(page)).toBeVisible()

    const taken = new Map<string, number>()
    let steps = 0
    for (; steps < MAX_STEPS; steps++) {
      if ((await awaitHuman(page)) === 'over') break
      const what = await takeOneAction(page, false)
      taken.set(what, (taken.get(what) ?? 0) + 1)
    }

    console.log(
      `full game: ${steps} decisions, actions taken: ${JSON.stringify(
        Object.fromEntries([...taken.entries()].sort())
      )}`
    )

    expect(steps).toBeLessThan(MAX_STEPS)
    await expect(page.getByTestId('game-over')).toBeVisible()
    await expect(playmat(page)).toHaveAttribute('data-awaiting', 'over')
    await expect(page.getByTestId('log-line').last()).toContainText('Game over')
    // A whole game against the heuristic always puts the human in at least one
    // reaction window, which is the one decision window that belongs to the
    // human during the RIVAL's turn — the case `activePlayer`-driven UI misses.
    expect(taken.get('pass') ?? 0).toBeGreaterThan(0)
    expect(pageErrors).toEqual([])
  })

  test('undo is disabled before the human has acted', async ({ page }) => {
    await page.goto('/?aiDelay=0')
    await page.getByTestId('deck-human').selectOption(HUMAN_DECK)
    await page.getByTestId('deck-ai').selectOption(AI_DECK)
    await page.getByTestId('seed-input').fill(SEED)
    await page.getByTestId('start-game').click()
    await awaitHuman(page)
    await expect(page.getByTestId('undo')).toBeDisabled()
  })

  test('saves a game and resumes it from the setup screen', async ({ page }) => {
    await page.goto('/?aiDelay=0')
    await page.getByTestId('deck-human').selectOption(HUMAN_DECK)
    await page.getByTestId('deck-ai').selectOption(AI_DECK)
    await page.getByTestId('seed-input').fill(SEED)
    await page.getByTestId('start-game').click()

    // A couple of decisions in, so the record is not empty.
    for (let i = 0; i < 6; i++) {
      if ((await awaitHuman(page)) === 'over') break
      await takeOneAction(page, false)
    }
    await awaitHuman(page)
    const logBefore = await logTexts(page)

    await page.getByTestId('save-name').fill('e2e-slot')
    await page.getByTestId('save-game').click()
    await expect(page.getByTestId('saved-note')).toContainText('e2e-slot')

    // Reload the app entirely, then resume from localStorage.
    await page.goto('/?aiDelay=0')
    await expect(page.getByTestId('play-setup')).toBeVisible()
    const resume = page.locator('[data-testid="resume-game"][data-name="e2e-slot"]')
    await expect(resume).toBeVisible()
    await resume.click()

    await expect(playmat(page)).toBeVisible()
    await awaitHuman(page)
    // The replayed game is the same game: the same log, line for line.
    expect(await logTexts(page)).toEqual(logBefore)
  })
})
