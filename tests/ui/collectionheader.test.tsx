// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { loadCardDb } from '../../src/engine/cardDb'
import { loadPrintings } from '../../src/ui/printings'
import { _resetCollectionCacheForTests, getCollection, setCount } from '../../src/ui/collection'
import { CollectionHeader } from '../../src/ui/CollectionHeader'

const db = loadCardDb()
const printings = loadPrintings()

beforeEach(() => {
  localStorage.clear()
  _resetCollectionCacheForTests()
})

afterEach(cleanup)

describe('CollectionHeader', () => {
  it('renders live stats', () => {
    render(<CollectionHeader db={db} printings={printings} />)
    expect(screen.getByTestId('collection-stats').textContent).toContain('0 cards owned')
  })

  it('copies the buy-list to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<CollectionHeader db={db} printings={printings} />)
    fireEvent.click(screen.getByTestId('copy-buylist'))
    expect(writeText).toHaveBeenCalledOnce()
    expect(writeText.mock.calls[0][0]).toContain('## Missing for playset')
  })

  it('imports pasted JSON with merge mode', () => {
    setCount(printings[0].key, 1)
    render(<CollectionHeader db={db} printings={printings} />)
    fireEvent.click(screen.getByTestId('import-mode-merge'))
    fireEvent.change(screen.getByTestId('import-input'), {
      target: { value: JSON.stringify({ version: 1, counts: { [printings[0].key]: 2 } }) },
    })
    fireEvent.click(screen.getByTestId('import-submit'))
    expect(getCollection().counts[printings[0].key]).toBe(3)
  })

  it('shows the error and keeps data on a bad import', () => {
    setCount(printings[0].key, 1)
    render(<CollectionHeader db={db} printings={printings} />)
    fireEvent.change(screen.getByTestId('import-input'), { target: { value: 'garbage' } })
    fireEvent.click(screen.getByTestId('import-submit'))
    expect(screen.getByTestId('import-error').textContent).toContain('Could not import')
    expect(getCollection().counts[printings[0].key]).toBe(1)
  })
})
