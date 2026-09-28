import { readFile } from 'node:fs/promises'
import { test, expect } from './fixtures'
const starter = { demo: true, legends: ['goro-takemura-hands-unclean', 'yorinobu-arasaka-embracing-destruction', 'saburo-arasaka-stubborn-patriarch'] }
const KEY = 'arasakademodeck/006'

test('lists surplus against a kept deck, exports a CSV and records the sale', async ({ page }) => {
  await page.addInitScript(({ starter }) => localStorage.setItem('ctcg:decks:v1', JSON.stringify({
    'Keep A': { ...starter, name: 'Keep A', cards: { 'industrial-assembly': 1 } },
  })), { starter })
  await page.goto('/')
  await page.getByTestId('tab-collection').click()
  await expect(page.getByTestId('sync-status')).toContainText('Saved to disk')
  await page.getByTestId('expand-industrial-assembly').click()
  for (let i = 0; i < 3; i++) await page.getByTestId(`printing-inc-${KEY}`).click()
  await page.getByTestId('collection-mode-sell').click()
  const sell = page.getByTestId('sell-mode')
  await sell.getByLabel('Keep A', { exact: true }).check()
  const row = sell.locator('[data-testid="sell-row"][data-card-id="industrial-assembly"]')
  await expect(row.locator('td').nth(4)).toHaveText('2')
  await page.getByTestId('sell-add-all').click()
  await expect(page.getByTestId('collection-mode-sell')).toContainText('1')
  const download = page.waitForEvent('download')
  await page.getByTestId('sell-csv-0').click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^cardmarket-sell-\d{4}-\d{2}-\d{2}-.+\.csv$/)
  const csv = await readFile((await file.path())!, 'utf8')
  expect(csv).toContain('name,quantity,condition,language')
  expect(csv).toContain('Industrial Assembly,2,Near Mint,English')
  await page.getByTestId(`sell-line-check-${KEY}`).check()
  await page.getByTestId('sell-mark').click()
  await expect(page.getByTestId('sell-confirm')).toContainText('3 → 1')
  await page.getByTestId('sell-confirm-ok').click()
  await expect(page.getByTestId('sell-status')).toContainText('2 copies sold')
  await expect(row).toHaveCount(0)
  await page.getByTestId('collection-mode-history').click()
  await expect(page.getByTestId('collection-history-entry').first()).toContainText('Sale')
})
