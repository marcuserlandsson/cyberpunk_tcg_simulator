// The box-and-deck delivery the overhaul was designed around (spec §Add
// cards): a whole product plus booster pulls staged from Browse, surviving a
// reload as a stale draft, applied as one History entry with cost and a
// rarity breakdown, then undone as one step.
import { test, expect } from './fixtures'
import { rm } from 'node:fs/promises'
const SCRATCH = 'test-results/e2e-collection.json'
test.beforeEach(async () => { await rm(SCRATCH, { force: true }); await rm(SCRATCH.replace(/\.json$/, '.backup.json'), { recursive: true, force: true }) })

test('records a booster box and a demo deck as one undoable acquisition', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('tab-collection').click()
  await expect(page.getByTestId('sync-status')).toContainText('Saved to disk')

  // Seed one unrelated card first: undoing the whole acquisition later must
  // not empty the collection, which the server refuses to save.
  await page.getByTestId('expand-animals-wrecker').click()
  await page.getByTestId('printing-inc-welcometonightcitybeta/β007').click()
  await page.getByTestId('drawer-close').click()
  await expect(page.getByTestId('collection-count-animals-wrecker')).toContainText('1/3')

  // Quick add in Browse stages into a session that starts by itself.
  await page.getByTestId('quick-add-set').selectOption('welcometonightcitybeta')
  for (let i = 0; i < 3; i++) { await page.getByTestId('quick-add-input').fill('mantis'); await page.getByTestId('quick-add-input').press('Enter') }
  await expect(page.getByTestId('staged-pill')).toContainText('3 staged')
  await expect(page.getByTestId('collection-count-mantis-blades')).toContainText('0/3')

  // The demo deck as one block, with source and cost.
  await page.getByTestId('staged-pill').click()
  await page.getByTestId('product-arasakademodeck').click()
  await expect(page.getByTestId('session-group-Arasaka Demo Deck')).toContainText('whole product')
  await page.getByTestId('session-source').fill('Beta booster box + Arasaka demo deck')
  await page.getByTestId('session-cost').fill('1450 SEK')
  await expect(page.getByTestId('session-rarity')).toBeVisible()

  // Survives a reload, and says so.
  await page.reload()
  await page.getByTestId('tab-collection').click()
  await expect(page.getByTestId('staged-pill')).toHaveClass(/staged-pill--stale/)
  await page.getByTestId('collection-mode-add').click()
  await expect(page.getByTestId('session-line-welcometonightcitybeta/β025')).toContainText('+3')
  await expect(page.getByTestId('session-source')).toHaveValue('Beta booster box + Arasaka demo deck')

  // One apply, one entry.
  await page.getByTestId('session-apply').click()
  await expect(page.getByTestId('staged-pill')).toHaveCount(0)
  await page.getByTestId('collection-mode-browse').click()
  // 3 quick-added from the beta booster plus 3 bundled in the Arasaka Demo
  // Deck itself (data/decks/arasaka-embracing-power.json) = 6 owned.
  await expect(page.getByTestId('collection-count-mantis-blades')).toContainText('6/3')
  await page.getByTestId('collection-mode-history').click()
  const entry = page.getByTestId('collection-history-entry').first()
  await expect(entry).toContainText('Acquisition')
  await expect(entry).toContainText('1450 SEK')
  await entry.getByTestId('history-details').click()
  await expect(entry.getByTestId('history-rarity')).toBeVisible()
  await entry.getByTestId('history-undo').click()
  await page.getByTestId('collection-mode-browse').click()
  await expect(page.getByTestId('collection-count-mantis-blades')).toContainText('0/3')
  await expect(page.getByTestId('sync-status')).toContainText('Saved to disk')
})
