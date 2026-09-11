import { test, expect } from './fixtures'
import { existsSync, readdirSync } from 'node:fs'

// `data/images/` is gitignored on purpose (README §Official card images:
// "nobody's card art ships with the source", and the app is fully playable
// with zero images present). So a fresh clone — or a git worktree, which the
// feature workflow uses — has none of them, `import.meta.glob` in
// src/ui/images.ts matches nothing, and every printing row renders its
// `prow__img` placeholder instead of an `<img>`. Asserting on the image
// unconditionally made that environment fail as a bare "element(s) not
// found", which reads exactly like a UI regression. Gate the image half of
// this spec on the art actually being present and say so out loud; the goal
// arithmetic above it needs no images and always runs.
const PRINTING_IMAGES = 'data/images/printings'
const hasBundledArt = existsSync(PRINTING_IMAGES) && readdirSync(PRINTING_IMAGES).length > 0

test('artwork and playset goals advance independently across printings', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Collection', exact: true }).click()
  await expect(page.getByTestId('sync-status')).toContainText('Saved to disk')
  await page.getByTestId('expand-industrial-assembly').click()
  const card = page.getByTestId('collection-count-industrial-assembly')
  await expect(card).toContainText('0/3 · Art 0/1')
  await page.getByTestId('printing-inc-arasakademodeck/006').click()
  await expect(card).toContainText('1/3 · Art 1/1')
  await page.getByTestId('printing-inc-welcometonightcityretail/033').click()
  await expect(card).toContainText('2/3 · Art 1/1')
  await page.getByTestId('collection-mode-plan').click()
  await expect(page.getByTestId('copy-playset-list')).toBeVisible()
  await expect(page.getByTestId('copy-artwork-list')).toBeVisible()
  await page.getByTestId('collection-mode-browse').click()
  const printing = page.getByTestId('printing-row-edgerunneropens1/004')
  await expect(printing).toContainText('Artwork 1 · owned')
  if (!hasBundledArt) {
    test.info().annotations.push({ type: 'skip-reason', description: `no art in ${PRINTING_IMAGES}; run node scripts/download-printing-images.mjs to cover the image path` })
    await expect(printing.locator('.prow__img')).toBeAttached()
    return
  }
  const image = printing.locator('img')
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)
})
