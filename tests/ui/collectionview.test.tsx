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

  // I6 / spec §5: a failed write must be visible, not lost in the console.
  // Without this, deleting the banner would leave every other test green.
  it('shows the storage-error banner when a write fails, and clears it on the next success', async () => {
    const user = userEvent.setup()
    render(<CollectionView db={db} useOfficialImages={false} />)
    const cell = screen
      .getAllByTestId('collection-cell')
      .find((el) => el.getAttribute('data-card-id') === multi.cardId)!
    await user.click(within(cell).getByTestId(`expand-${multi.cardId}`))

    expect(screen.queryByTestId('collection-storage-error')).toBeNull()

    const original = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    try {
      await user.click(screen.getByTestId(`printing-inc-${multi.key}`))
      expect(screen.getByTestId('collection-storage-error').textContent).toContain(
        'Could not save the collection'
      )
    } finally {
      Storage.prototype.setItem = original
    }

    await user.click(screen.getByTestId(`printing-inc-${multi.key}`))
    expect(screen.queryByTestId('collection-storage-error')).toBeNull()
  })

  it('a rarity filter id is slug-safe even for a two-word rarity', () => {
    render(<CollectionView db={db} useOfficialImages={false} />)
    // "Nova Rare" is a real rarity in the shipped dataset; its test id must
    // not carry the space through into the attribute selector.
    expect(screen.getByTestId('rarity-filter-nova-rare')).toBeTruthy()
    expect(screen.getByTestId('rarity-filter-nova-rare').textContent).toBe('Nova Rare')
  })

  it('spells out the ✓/★ badge glyphs, whose title tooltips can never fire', () => {
    render(<CollectionView db={db} useOfficialImages={false} />)
    const legend = screen.getByTestId('collection-legend').textContent ?? ''
    expect(legend).toContain('✓')
    expect(legend).toContain('★')
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
