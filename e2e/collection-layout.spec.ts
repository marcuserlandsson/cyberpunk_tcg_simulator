import { test, expect } from './fixtures'

test('collection cards and expanded printings fit at desktop and phone sizes', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('tab-collection').click()
  for (const width of [1270, 390]) {
    await page.setViewportSize({ width, height: 800 })
    for (const images of [false, true]) {
      await page.getByLabel('Use official card images').setChecked(images)
      const overflow = await page.getByTestId('collection-cell').evaluateAll((cells) =>
        cells.some((cell) => {
          const card = cell.querySelector('.card-frame')!
          const bounds = cell.getBoundingClientRect()
          const face = card.getBoundingClientRect()
          return face.right > bounds.right + 1 || face.width > bounds.width + 1
        }))
      expect(overflow).toBe(false)
    }
    await page.getByTestId('expand-animals-wrecker').click()
    const row = page.getByTestId('card-drawer')
    expect(await row.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    await page.getByTestId('drawer-close').click()
  }
})
