// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { loadCardDb } from '../../src/engine/cardDb'
import { loadPrintings } from '../../src/ui/printings'
import { _resetCollectionCacheForTests } from '../../src/ui/collection'
import { _resetDraftForTests, stageLine } from '../../src/ui/sessionDraft'
import { CollectionView } from '../../src/ui/CollectionView'

const db = loadCardDb()
const printings = loadPrintings()
const multi = printings.find((p) => printings.filter((q) => q.cardId === p.cardId).length >= 2)!
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); _resetCollectionCacheForTests(); _resetDraftForTests() })
afterEach(cleanup)

describe('CollectionView shell', () => {
  it('opens in Browse with the grid and the header strip', () => {
    render(<CollectionView db={db} useOfficialImages={false} />)
    expect(screen.getByTestId('collection-grid')).toBeTruthy()
    expect(screen.getByTestId('collection-mode-browse').getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByTestId('acquisition-planner')).toBeNull()
  })
  it('switches modes, keeps Browse mounted, and remembers the mode in this tab', async () => {
    const user = userEvent.setup()
    render(<CollectionView db={db} useOfficialImages={false} />)
    await user.type(screen.getByTestId('collection-search'), 'mantis')
    fireEvent.click(screen.getByTestId('collection-mode-plan'))
    expect(screen.getByTestId('acquisition-planner')).toBeTruthy()
    expect(screen.getByTestId('collection-grid').closest('[hidden]')).not.toBeNull()
    fireEvent.click(screen.getByTestId('collection-mode-browse'))
    expect((screen.getByTestId('collection-search') as HTMLInputElement).value).toBe('mantis')
    fireEvent.click(screen.getByTestId('collection-mode-history'))
    cleanup(); render(<CollectionView db={db} useOfficialImages={false} />)
    expect(screen.getByTestId('collection-mode-history').getAttribute('aria-pressed')).toBe('true')
  })
  it('the staged pill jumps to Add cards', () => {
    stageLine({ key: multi.key, delta: 1 })
    render(<CollectionView db={db} useOfficialImages={false} />)
    fireEvent.click(screen.getByTestId('staged-pill'))
    expect(screen.getByTestId('session-lines')).toBeTruthy()
  })
  it('shows the storage-error banner when a write fails, and clears it on the next success', async () => {
    const user = userEvent.setup()
    render(<CollectionView db={db} useOfficialImages={false} />)
    await user.click(screen.getByTestId(`expand-${multi.cardId}`))
    expect(screen.queryByTestId('collection-storage-error')).toBeNull()
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = () => { throw new Error('QuotaExceededError') }
    try {
      await user.click(screen.getByTestId(`printing-inc-${multi.key}`))
      expect(screen.getByTestId('collection-storage-error').textContent).toContain('Could not save the collection')
    } finally { Storage.prototype.setItem = original }
    await user.click(screen.getByTestId(`printing-inc-${multi.key}`))
    expect(screen.queryByTestId('collection-storage-error')).toBeNull()
  })
})
