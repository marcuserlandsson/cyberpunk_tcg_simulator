// The proof that the whole chain works: a card added in the browser reaches
// data/collection.json (here, a scratch file, see playwright.config.ts's
// webServer.env.CTCG_COLLECTION_FILE) and comes back after browser storage is
// wiped — which is only possible if it was read from disk.
import { test, expect } from '@playwright/test'
import { rm } from 'node:fs/promises'

const SCRATCH = 'test-results/e2e-collection.json'

test.beforeEach(async () => {
  await rm(SCRATCH, { force: true })
  await rm(SCRATCH.replace(/\.json$/, '.backup.json'), { force: true })
})

test('a quick-added card survives clearing browser storage', async ({ page }) => {
  await page.goto('/?aiDelay=0')
  await page.getByTestId('tab-collection').click()

  await page.getByTestId('quick-add-set').selectOption('welcometonightcitybeta')
  await page.getByTestId('quick-add-input').fill('mantis')
  await page.getByTestId('quick-add-input').press('Enter')
  await expect(page.getByTestId('collection-count-mantis-blades')).toContainText('1/3')

  // Wait for the debounced flush to reach disk. Asserted against the
  // "--idle" state class rather than text containing /saved/i: the
  // "unsaved" state's own text ("N changes not yet saved to disk") also
  // contains the substring "saved", so a text-only regex would already be
  // satisfied the instant the card is added — before any PUT has even been
  // attempted — and would never actually fail if the save were broken.
  await expect(page.getByTestId('sync-status')).toHaveClass(/collection-header__sync--idle/, {
    timeout: 10_000,
  })

  // Wipe every browser-side copy (the pending buffer AND the last-confirmed
  // snapshot cache both live in localStorage — see src/ui/collection.ts):
  // only the file can supply the count now.
  await page.evaluate(() => window.localStorage.clear())
  await page.reload()
  await page.getByTestId('tab-collection').click()
  await expect(page.getByTestId('collection-count-mantis-blades')).toContainText('1/3')
})

// The failure path, which is the whole reason the buffer exists: with saving
// broken, entered cards must survive a reload rather than being discarded.
test('cards entered while saving is broken survive a reload', async ({ page }) => {
  await page.goto('/?aiDelay=0')
  // Let the initial GET through, then break every write.
  await page.route('**/__collection', async (route) => {
    if (route.request().method() === 'PUT') return route.abort()
    return route.continue()
  })

  await page.getByTestId('tab-collection').click()
  await page.getByTestId('quick-add-set').selectOption('welcometonightcitybeta')
  await page.getByTestId('quick-add-input').fill('mantis')
  await page.getByTestId('quick-add-input').press('Enter')

  await expect(page.getByTestId('sync-status')).toContainText('not yet saved', { timeout: 10_000 })
  await expect(page.getByTestId('sync-retry')).toBeVisible()

  // The card is still there after a reload, and still reported as unsaved —
  // nothing was silently dropped and nothing was silently claimed as saved.
  await page.reload()
  await page.getByTestId('tab-collection').click()
  await expect(page.getByTestId('collection-count-mantis-blades')).toContainText('1/3')
  await expect(page.getByTestId('sync-status')).toContainText('not yet saved')
})
