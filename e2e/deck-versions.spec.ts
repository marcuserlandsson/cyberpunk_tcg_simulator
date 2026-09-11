import { expect, test } from './fixtures'

test('converts a starter, restores deck versions, and selects it for Play', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('tab-deckBuilder').click()
  // Name the demo deck rather than loading whatever the picker defaults to:
  // the bundled list also holds the constructed-legal 43-card starter decks,
  // and this case is specifically about converting a demo deck.
  await page.getByTestId('deck-select').selectOption('Arasaka — Embracing Power')
  await page.getByTestId('load-deck-button').click()
  await expect(page.getByTestId('deck-format')).toHaveValue('demo')
  await page.getByTestId('deck-format').selectOption('constructed')
  await expect(page.getByTestId('deck-errors')).toContainText('minimum is 40')
  await expect(page.getByTestId('play-this-deck')).toBeDisabled()
  await page.getByTestId('deck-format').selectOption('demo')
  await page.getByTestId('deck-name-input').fill('Version workflow')
  await page.getByTestId('deck-version-label').fill('v1')
  await page.getByTestId('deck-notes').fill('Keep this plan')
  await page.getByTestId('save-deck-button').click()
  await page.getByTestId('deck-version-label').fill('v2')
  await page.getByTestId('deck-notes').fill('Different plan')
  await page.getByTestId('save-deck-button').click()
  await page.getByTestId('deck-versions').locator('summary').click()
  await page.getByTestId('deck-versions').getByRole('button', { name: /v1/ }).click()
  await expect(page.getByTestId('deck-notes')).toHaveValue('Keep this plan')
  await page.getByTestId('play-this-deck').click()
  await expect(page.getByTestId('play-setup')).toBeVisible()
  await expect(page.getByTestId('deck-human')).toHaveValue('Version workflow')
  await page.reload()
  await page.getByTestId('tab-deckBuilder').click()
  await page.getByTestId('deck-select').selectOption('Version workflow')
  await page.getByTestId('load-deck-button').click()
  await expect(page.getByTestId('deck-notes')).toHaveValue('Keep this plan')
})
