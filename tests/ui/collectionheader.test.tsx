// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

  it('disables import-submit while the textarea is blank or whitespace-only', () => {
    render(<CollectionHeader db={db} printings={printings} />)
    const submit = screen.getByTestId('import-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByTestId('import-input'), { target: { value: '   \n  ' } })
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByTestId('import-input'), {
      target: { value: `1x whatever [${printings[0].key}]` },
    })
    expect(submit.disabled).toBe(false)
  })

  it('surfaces a rejected clipboard write as a visible error outside the Import panel', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<CollectionHeader db={db} printings={printings} />)
    fireEvent.click(screen.getByTestId('copy-buylist'))
    await waitFor(() => {
      expect(screen.getByTestId('copy-error').textContent).toContain('Could not copy to clipboard')
    })
    // The whole point of this test: a plain getByTestId presence check
    // passes even for a node buried in a closed <details> (the round-1
    // regression), so pin visibility by asserting the error node is NOT a
    // descendant of the collapsed Import panel.
    const importPanel = screen.getByTestId('import-panel')
    const copyError = screen.getByTestId('copy-error')
    expect(importPanel.contains(copyError)).toBe(false)
  })

  it('clears a prior copy error on a subsequent successful copy', async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<CollectionHeader db={db} printings={printings} />)
    fireEvent.click(screen.getByTestId('copy-buylist'))
    await waitFor(() => {
      expect(screen.getByTestId('copy-error')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('copy-buylist'))
    await waitFor(() => {
      expect(screen.queryByTestId('copy-error')).toBeNull()
    })
  })
})
