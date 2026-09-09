// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { loadCardDb } from '../../src/engine/cardDb'
import { loadPrintings } from '../../src/ui/printings'
import { _resetCollectionCacheForTests, setCount } from '../../src/ui/collection'
import { DRAFT_KEY, _resetDraftForTests, emptyDraft, stageLine } from '../../src/ui/sessionDraft'
import { CollectionModeHeader } from '../../src/ui/CollectionModeHeader'
import * as sync from '../../src/ui/collectionSync'

const db = loadCardDb()
const printings = loadPrintings()
beforeEach(() => { localStorage.clear(); _resetCollectionCacheForTests(); _resetDraftForTests() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

function mount(mode: 'browse' | 'add' | 'plan' | 'history' = 'browse', onMode = vi.fn()) {
  render(<CollectionModeHeader db={db} printings={printings} mode={mode} onMode={onMode} />)
  return onMode
}

describe('mode control', () => {
  it('marks the active mode and reports clicks', () => {
    const onMode = mount('browse')
    expect(screen.getByTestId('collection-mode-browse').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByTestId('collection-mode-plan'))
    expect(onMode).toHaveBeenCalledWith('plan')
  })
})

describe('staged pill', () => {
  it('is absent with an empty draft, present with lines, and opens Add cards', () => {
    const onMode = mount()
    expect(screen.queryByTestId('staged-pill')).toBeNull()
    cleanup()
    stageLine({ key: printings[0].key, delta: 2 })
    mount('browse', onMode)
    expect(screen.getByTestId('staged-pill').textContent).toContain('2 staged')
    expect(screen.getByTestId('staged-pill').className).not.toContain('staged-pill--stale')
    fireEvent.click(screen.getByTestId('staged-pill'))
    expect(onMode).toHaveBeenCalledWith('add')
  })
  it('turns stale when the draft came back from storage untouched', () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...emptyDraft(), lines: [{ key: printings[0].key, delta: 1 }] }))
    mount()
    expect(screen.getByTestId('staged-pill').className).toContain('staged-pill--stale')
  })
})

describe('meters', () => {
  it('renders live stats', () => {
    mount()
    expect(screen.getByTestId('collection-stats').textContent).toContain('0')
    expect(screen.getByTestId('playset-progress').textContent).toMatch(/0 \/ \d+/)
  })
  it('suppresses the meters in the error state rather than showing zeros', () => {
    vi.spyOn(sync, 'useSyncStatus').mockReturnValue({ state: 'error', pendingCount: 0, message: 'data/collection.json is not valid JSON.' })
    mount()
    expect(screen.queryByTestId('collection-stats')).toBeNull()
    const text = screen.getByTestId('sync-status').textContent ?? ''
    expect(text).toMatch(/could not be read/i)
    expect(text).toContain('data/collection.json is not valid JSON.')
    expect(text).not.toMatch(/not yet saved/i)
  })
})

describe('sync chip', () => {
  it('shows a saved state when idle', () => {
    vi.spyOn(sync, 'useSyncStatus').mockReturnValue({ state: 'idle', pendingCount: 0, lastSavedAt: '2026-09-05T00:00:00.000Z' })
    mount()
    expect(screen.getByTestId('sync-status').textContent).toMatch(/saved/i)
    expect(screen.getByTestId('sync-status').className).toContain('collection-header__sync--idle')
  })
  it('shows the unsaved count, retry and download', () => {
    vi.spyOn(sync, 'useSyncStatus').mockReturnValue({ state: 'unsaved', pendingCount: 300, retrying: true })
    mount()
    expect(screen.getByTestId('sync-status').textContent).toContain('300')
    expect(screen.getByTestId('sync-status').textContent).toMatch(/retrying/i)
    expect(screen.getByTestId('sync-retry')).toBeTruthy()
    expect(screen.getByTestId('sync-download')).toBeTruthy()
  })
  it('does NOT claim to be retrying when no retry is armed', () => {
    vi.spyOn(sync, 'useSyncStatus').mockReturnValue({ state: 'unsaved', pendingCount: 12, retrying: false, message: 'Refusing to save invalid counts' })
    mount()
    const text = screen.getByTestId('sync-status').textContent ?? ''
    expect(text).toContain('12 changes not yet saved to disk')
    expect(text).not.toMatch(/retrying/i)
  })
  it('does not say "0 changes" when there is no pending work', () => {
    vi.spyOn(sync, 'useSyncStatus').mockReturnValue({ state: 'unsaved', pendingCount: 0, retrying: false, message: 'Cannot reach the dev server' })
    mount()
    const text = screen.getByTestId('sync-status').textContent ?? ''
    expect(text).not.toContain('0 changes'); expect(text).toContain('Not yet saved to disk')
  })
  it('retry calls the recovery entry point', () => {
    vi.spyOn(sync, 'useSyncStatus').mockReturnValue({ state: 'unsaved', pendingCount: 2 })
    const flush = vi.spyOn(sync, 'retryCollection').mockResolvedValue(undefined)
    mount()
    fireEvent.click(screen.getByTestId('sync-retry'))
    expect(flush).toHaveBeenCalledOnce()
  })
  it('download hands the local collection to a Blob', () => {
    setCount(printings[0].key, 3)
    vi.spyOn(sync, 'useSyncStatus').mockReturnValue({ state: 'unsaved', pendingCount: 3 })
    const blobSpy = vi.spyOn(globalThis, 'Blob')
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    mount()
    fireEvent.click(screen.getByTestId('sync-download'))
    expect(clickSpy).toHaveBeenCalledOnce()
    expect(String((blobSpy.mock.calls[0] as [BlobPart[]])[0][0])).toContain(printings[0].key)
  })
  it('offers both conflict choices with both totals, and Download', () => {
    setCount(printings[0].key, 3)
    const resolve = vi.spyOn(sync, 'resolveConflict').mockResolvedValue(undefined)
    vi.spyOn(sync, 'useSyncStatus').mockReturnValue({ state: 'conflict', pendingCount: 4, message: 'moved', conflictDisk: { counts: { [printings[0].key]: 10 }, revision: 5 } })
    mount()
    const box = screen.getByTestId('sync-conflict')
    expect(box.textContent).toContain('10'); expect(box.textContent).toContain('3')
    expect(screen.getByTestId('sync-status').textContent).toContain('moved')
    expect(screen.getByTestId('sync-download')).toBeTruthy()
    fireEvent.click(screen.getByTestId('sync-keep-mine')); expect(resolve).toHaveBeenCalledWith('mine')
    fireEvent.click(screen.getByTestId('sync-take-disk')); expect(resolve).toHaveBeenCalledWith('disk')
  })
  it('notes a failed git push without claiming the save failed', () => {
    vi.spyOn(sync, 'useSyncStatus').mockReturnValue({ state: 'idle', pendingCount: 0, git: 'failed' })
    mount()
    const text = screen.getByTestId('sync-status').textContent ?? ''
    expect(text).toMatch(/saved/i); expect(text).toMatch(/backup failed/i); expect(text).not.toMatch(/save failed|not saved/i)
  })
  it('explains a would-empty refusal and requires confirmation', () => {
    const confirm = vi.spyOn(sync, 'confirmEmptySave').mockResolvedValue(undefined)
    vi.spyOn(sync, 'useSyncStatus').mockReturnValue({ state: 'would-empty', pendingCount: 0, message: 'This save would empty a non-empty collection.' })
    mount()
    expect(screen.getByTestId('sync-status').textContent).toMatch(/empty/i)
    fireEvent.click(screen.getByTestId('sync-confirm-empty'))
    expect(confirm).toHaveBeenCalledOnce()
  })
})
