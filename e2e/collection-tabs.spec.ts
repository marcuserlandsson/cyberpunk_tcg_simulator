import { test, expect } from './fixtures'
import printings from '../data/printings.json' with { type: 'json' }

test('only one tab edits the collection and a waiting tab takes over without losing cards', async ({ page, context }) => {
  const cardId = 'animals-wrecker'
  const key = printings.find((p) => p.cardId === cardId)!.key
  await page.goto('/')
  await page.getByTestId('tab-collection').click()
  await page.getByTestId(`expand-${cardId}`).click()
  const increment = page.getByTestId(`printing-inc-${key}`)
  await expect(increment).toBeEnabled()
  await increment.click()
  const before = await page.getByTestId(`collection-count-${cardId}`).innerText()

  const other = await context.newPage()
  await other.goto('/')
  await other.getByTestId('tab-collection').click()
  await expect(other.getByTestId('collection-readonly')).toBeVisible()
  await expect(other.getByTestId('quick-add-input')).toBeDisabled()
  await expect(other.getByTestId(`collection-count-${cardId}`)).toHaveText(before)

  await increment.click()
  const latest = await page.getByTestId(`collection-count-${cardId}`).innerText()
  await expect(other.getByTestId(`collection-count-${cardId}`)).toHaveText(latest)
  await page.close()
  await expect(other.getByTestId('quick-add-input')).toBeEnabled()
  await expect(other.getByTestId(`collection-count-${cardId}`)).toHaveText(latest)
  await other.getByTestId(`expand-${cardId}`).click()
  await other.getByTestId(`printing-inc-${key}`).click()
  await expect(other.getByTestId(`collection-count-${cardId}`)).not.toHaveText(latest)
  await expect(other.getByTestId('sync-status')).toContainText('Saved to disk')
})
