// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { loadCardDb } from '../../src/engine/cardDb'
import { loadPrintings } from '../../src/ui/printings'
import { _resetCollectionCacheForTests, getCollection, setCount } from '../../src/ui/collection'
import { CollectionHeader } from '../../src/ui/CollectionHeader'
import * as sync from '../../src/ui/collectionSync'

const db = loadCardDb()
const printings = loadPrintings()

beforeEach(() => {
  localStorage.clear()
  _resetCollectionCacheForTests()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

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

describe('sync status', () => {
  it('shows a saved state when idle, with the last-saved time', () => {
    vi.spyOn(sync, 'useSyncStatus').mockReturnValue({
      state: 'idle',
      pendingCount: 0,
      lastSavedAt: '2026-09-05T00:00:00.000Z',
    })
    render(<CollectionHeader db={db} printings={printings} />)
    expect(screen.getByTestId('sync-status').textContent).toMatch(/saved/i)
  })

  it('shows an in-progress state while saving', () => {
    vi.spyOn(sync, 'useSyncStatus').mockReturnValue({ state: 'saving', pendingCount: 1 })
    render(<CollectionHeader db={db} printings={printings} />)
    expect(screen.getByTestId('sync-status').textContent).toMatch(/saving/i)
  })

  it('shows the unsaved count and a retry button', () => {
    vi.spyOn(sync, 'useSyncStatus').mockReturnValue({ state: 'unsaved', pendingCount: 300 })
    render(<CollectionHeader db={db} printings={printings} />)
    expect(screen.getByTestId('sync-status').textContent).toContain('300')
    expect(screen.getByTestId('sync-retry')).toBeTruthy()
    expect(screen.getByTestId('sync-download')).toBeTruthy()
  })

  it('surfaces the server-provided message on unsaved (e.g. a corrupt collection file)', () => {
    vi.spyOn(sync, 'useSyncStatus').mockReturnValue({
      state: 'unsaved',
      pendingCount: 2,
      message: 'The collection file on disk is corrupt.',
    })
    render(<CollectionHeader db={db} printings={printings} />)
    expect(screen.getByTestId('sync-status').textContent).toContain('The collection file on disk is corrupt.')
  })

  it('retry calls flushNow', () => {
    vi.spyOn(sync, 'useSyncStatus').mockReturnValue({ state: 'unsaved', pendingCount: 2 })
    const flush = vi.spyOn(sync, 'flushNow').mockResolvedValue(undefined)
    render(<CollectionHeader db={db} printings={printings} />)
    fireEvent.click(screen.getByTestId('sync-retry'))
    expect(flush).toHaveBeenCalledOnce()
  })

  it('download escape hatch downloads the current collection as JSON, via a Blob download', () => {
    setCount(printings[0].key, 3)
    vi.spyOn(sync, 'useSyncStatus').mockReturnValue({ state: 'unsaved', pendingCount: 3 })
    const blobSpy = vi.spyOn(globalThis, 'Blob')
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-collection')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<CollectionHeader db={db} printings={printings} />)
    fireEvent.click(screen.getByTestId('sync-download'))
    expect(clickSpy).toHaveBeenCalledOnce()
    const [parts] = blobSpy.mock.calls[0] as [BlobPart[]]
    expect(String(parts[0])).toContain(printings[0].key)
  })

  it('offers both choices on a conflict, shows what each side holds, and never resolves it automatically', () => {
    setCount(printings[0].key, 3)
    const resolve = vi.spyOn(sync, 'resolveConflict').mockResolvedValue(undefined)
    vi.spyOn(sync, 'useSyncStatus').mockReturnValue({
      state: 'conflict',
      pendingCount: 4,
      message: 'moved',
      conflictDisk: { counts: { [printings[0].key]: 10 }, revision: 5 },
    })
    render(<CollectionHeader db={db} printings={printings} />)
    const conflictBox = screen.getByTestId('sync-conflict')
    expect(conflictBox).toBeTruthy()
    // The owner must be able to tell what each choice means before picking —
    // at minimum, the disk total versus the local total.
    expect(conflictBox.textContent).toContain('10')
    expect(conflictBox.textContent).toContain('3')
    // The server's explanation of the conflict is surfaced too, not swallowed.
    expect(screen.getByTestId('sync-status').textContent).toContain('moved')
    expect(resolve).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('sync-keep-mine'))
    expect(resolve).toHaveBeenCalledWith('mine')
    fireEvent.click(screen.getByTestId('sync-take-disk'))
    expect(resolve).toHaveBeenCalledWith('disk')
  })

  it('notes a failed git push without claiming the save failed', () => {
    vi.spyOn(sync, 'useSyncStatus').mockReturnValue({ state: 'idle', pendingCount: 0, git: 'failed' })
    render(<CollectionHeader db={db} printings={printings} />)
    expect(screen.getByTestId('sync-status').textContent).toMatch(/saved/i)
    expect(screen.getByTestId('sync-status').textContent).toMatch(/push/i)
    // The failed-push note must never read as a failed save.
    expect(screen.getByTestId('sync-status').textContent).not.toMatch(/save failed|not saved/i)
  })

  it('explains a would-empty refusal and requires an explicit confirmation to proceed', () => {
    const confirm = vi.spyOn(sync, 'confirmEmptySave').mockResolvedValue(undefined)
    vi.spyOn(sync, 'useSyncStatus').mockReturnValue({
      state: 'would-empty',
      pendingCount: 0,
      message: 'This save would empty a non-empty collection.',
    })
    render(<CollectionHeader db={db} printings={printings} />)
    expect(screen.getByTestId('sync-status').textContent).toMatch(/empty/i)
    expect(confirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('sync-confirm-empty'))
    expect(confirm).toHaveBeenCalledOnce()
  })
})
