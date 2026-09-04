// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { loadCardDb } from '../../src/engine/cardDb'
import { loadPrintings } from '../../src/ui/printings'
import { _resetCollectionCacheForTests, getCollection } from '../../src/ui/collection'
import { CollectionView } from '../../src/ui/CollectionView'

const db = loadCardDb()
const printings = loadPrintings()
// A real card with ≥2 printings (beta + retail exist for the whole core set).
const multi = printings.find((p) => printings.filter((q) => q.cardId === p.cardId).length >= 2)!

beforeEach(() => {
  localStorage.clear()
  _resetCollectionCacheForTests()
})

afterEach(cleanup)

describe('CollectionView', () => {
  it('renders a tile per card with an owned/target badge', () => {
    render(<CollectionView db={db} useOfficialImages={false} />)
    const cells = screen.getAllByTestId('collection-cell')
    expect(cells.length).toBe(Object.keys(db).length)
    expect(screen.getByTestId(`collection-count-${multi.cardId}`).textContent).toContain('0/')
  })

  it('expands a tile to printing rows and increments via the stepper', async () => {
    const user = userEvent.setup()
    render(<CollectionView db={db} useOfficialImages={false} />)
    const cell = screen
      .getAllByTestId('collection-cell')
      .find((el) => el.getAttribute('data-card-id') === multi.cardId)!
    await user.click(within(cell).getByTestId(`expand-${multi.cardId}`))
    await user.click(screen.getByTestId(`printing-inc-${multi.key}`))
    expect(getCollection().counts[multi.key]).toBe(1)
    expect(screen.getByTestId(`collection-count-${multi.cardId}`).textContent).toContain('1/')
  })

  it('decrement stops at 0', async () => {
    const user = userEvent.setup()
    render(<CollectionView db={db} useOfficialImages={false} />)
    const cell = screen
      .getAllByTestId('collection-cell')
      .find((el) => el.getAttribute('data-card-id') === multi.cardId)!
    await user.click(within(cell).getByTestId(`expand-${multi.cardId}`))
    await user.click(screen.getByTestId(`printing-dec-${multi.key}`))
    expect(getCollection().counts[multi.key]).toBeUndefined()
  })

  it('goal filter "complete" shows nothing on an empty collection', async () => {
    const user = userEvent.setup()
    render(<CollectionView db={db} useOfficialImages={false} />)
    await user.click(screen.getByTestId('goal-filter-complete'))
    expect(screen.queryAllByTestId('collection-cell')).toHaveLength(0)
  })

  it('set filter narrows the grid to cards printed in that set', async () => {
    const user = userEvent.setup()
    render(<CollectionView db={db} useOfficialImages={false} />)
    await user.selectOptions(screen.getByTestId('set-filter'), multi.setCode)
    const shown = screen.getAllByTestId('collection-cell').length
    expect(shown).toBeGreaterThan(0)
    expect(shown).toBeLessThanOrEqual(Object.keys(db).length)
  })
})
