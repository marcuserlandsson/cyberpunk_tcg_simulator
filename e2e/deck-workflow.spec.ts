import { test, expect } from '@playwright/test'

test('a deck saved while Play is mounted appears immediately in its picker', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('tab-deckBuilder').click()
  await page.getByTestId('load-deck-button').click()
  await page.getByTestId('save-name-input').fill('Fresh deck')
  await page.getByTestId('save-deck-button').click()
  await page.getByTestId('tab-play').click()
  await page.getByTestId('deck-human').selectOption('Fresh deck')
  await expect(page.getByTestId('deck-human')).toHaveValue('Fresh deck')
  await expect(page.getByTestId('start-game')).toBeEnabled()
})

test('failed collection loads do not produce ownership badges or a buy-list', async ({ page }) => {
  await page.route('**/__collection', (route) => route.fulfill({ status: 500, json: { message: 'Unreadable collection' } }))
  await page.goto('/')
  await page.getByTestId('tab-deckBuilder').click()
  await page.getByTestId('load-deck-button').click()
  await expect(page.getByTestId('deck-missing-summary')).toContainText('Ownership unavailable')
  await expect(page.getByTestId('owned-mantis-blades')).toHaveCount(0)
  await expect(page.getByTestId('copy-deck-buylist')).toHaveCount(0)
  await page.getByTestId('tab-collection').click()
  await expect(page.getByTestId('collection-count-mantis-blades')).toContainText('?')
  await expect(page.getByTestId('copy-buylist')).toHaveCount(0)
})
