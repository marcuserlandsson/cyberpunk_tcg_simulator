// Smoke: quick-add persists across reload and feeds the Deck Builder badge.
//
// This pins the size-based session-set default (Task 8) with an end-to-end
// check before relying on it: quick-add's session set defaults to the set
// with the most printings, which on the real dataset is
// `welcometonightcitybeta`. Asserting that explicitly means a future change
// to that heuristic fails loudly here instead of silently changing what this
// test exercises. The set is then selected explicitly before typing, so the
// add itself is deterministic regardless of the default.
import { test, expect } from '@playwright/test'
import { rm } from 'node:fs/promises'

// Now that initCollectionSync (Task 8) is wired in, this test's count reaches
// the same scratch file (playwright.config.ts's webServer.env) as every other
// e2e spec's collection state, so a card left on disk by an earlier spec
// (e.g. e2e/collection-file.spec.ts) would otherwise make this test's "add
// one, expect 1/3" assertion see 2/3 instead. Reset it first, same as that
// spec's own beforeEach.
const SCRATCH = 'test-results/e2e-collection.json'

test.beforeEach(async () => {
  await rm(SCRATCH, { force: true })
  await rm(SCRATCH.replace(/\.json$/, '.backup.json'), { force: true })
})

test('quick-add persists across reload and shows in the deck builder', async ({ page }) => {
  await page.goto('/?aiDelay=0')
  await page.getByTestId('tab-collection').click()

  // Pin the default session set, then select it explicitly (see header note).
  await expect(page.getByTestId('quick-add-set')).toHaveValue('welcometonightcitybeta')
  await page.getByTestId('quick-add-set').selectOption('welcometonightcitybeta')

  await page.getByTestId('quick-add-input').fill('mantis')
  await page.getByTestId('quick-add-input').press('Enter')
  await expect(page.getByTestId('collection-count-mantis-blades')).toContainText('1/3')

  await page.reload()
  await page.getByTestId('tab-collection').click()
  await expect(page.getByTestId('collection-count-mantis-blades')).toContainText('1/3')

  await page.getByTestId('tab-deckBuilder').click()
  await expect(page.getByTestId('owned-mantis-blades')).toContainText('owned 1/3')
})
