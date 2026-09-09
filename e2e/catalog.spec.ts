import { test, expect } from './fixtures'
import catalog from '../data/catalog-status.json' with { type: 'json' }

test('newly discovered cards are visible in deck planning and collection', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.catalog-status summary')).toContainText(`${catalog.cardCount} cards`)
  await page.getByTestId('tab-deckBuilder').click()
  await expect(page.getByTestId('add-detonate')).toBeVisible()
  await page.getByTestId('add-detonate').click()
  await expect(page.getByTestId('browser-count-detonate')).toContainText('1')
  await page.getByTestId('tab-collection').click()
  await page.getByTestId('expand-detonate').click()
  await expect(page.getByTestId('card-drawer')).toContainText('031')
})
