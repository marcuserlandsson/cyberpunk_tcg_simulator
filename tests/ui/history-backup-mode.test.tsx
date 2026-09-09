// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { loadCardDb } from '../../src/engine/cardDb'
import { loadPrintings } from '../../src/ui/printings'
import { _resetCollectionCacheForTests, getCollection, replaceCollection, setCount } from '../../src/ui/collection'
import { readCollectionJournal } from '../../src/ui/collectionJournal'
import { HistoryBackupMode } from '../../src/ui/HistoryBackupMode'

const db = loadCardDb()
const printings = loadPrintings()
const KEY = 'arasakademodeck/006'
beforeEach(() => { localStorage.clear(); _resetCollectionCacheForTests() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })
const mount = () => render(<HistoryBackupMode db={db} printings={printings} known />)

describe('timeline', () => {
  it('lists entries newest first with kind, source and cost, and undoes one as a whole', () => {
    replaceCollection({ counts: { [KEY]: 3 } }, { kind: 'Acquisition', source: 'Launch boosters', cost: '100 SEK', date: '2026-09-09' })
    mount()
    const entry = screen.getAllByTestId('collection-history-entry')[0]
    expect(entry.textContent).toContain('Acquisition'); expect(entry.textContent).toContain('Launch boosters')
    fireEvent.click(within(entry).getByTestId('history-details'))
    expect(entry.textContent).toContain('100 SEK'); expect(entry.textContent).toContain('0 → 3')
    expect(within(entry).getByTestId('history-rarity').textContent).toContain(printings.find(p => p.key === KEY)!.rarity)
    fireEvent.click(within(entry).getByTestId('history-undo'))
    expect(getCollection().counts[KEY]).toBeUndefined()
  })
  it('an undone entry is struck through and offers Reapply', () => {
    replaceCollection({ counts: { [KEY]: 3 } }, { kind: 'Acquisition' })
    mount()
    fireEvent.click(within(screen.getAllByTestId('collection-history-entry')[0]).getByTestId('history-undo'))
    cleanup(); mount()
    const original = screen.getAllByTestId('collection-history-entry').find(e => e.textContent!.includes('Acquisition'))!
    expect(original.className).toContain('ev--undone')
    fireEvent.click(within(original).getByTestId('history-reapply'))
    expect(getCollection().counts[KEY]).toBe(3)
  })
  it('shows a refusal when the rows moved since the entry', () => {
    replaceCollection({ counts: { [KEY]: 3 } }, { kind: 'Acquisition' })
    setCount(KEY, 9)
    mount()
    const entry = screen.getAllByTestId('collection-history-entry').find(e => e.textContent!.includes('Acquisition'))!
    fireEvent.click(within(entry).getByTestId('history-undo'))
    expect(screen.getByTestId('history-error').textContent).toMatch(/changed since/)
    expect(getCollection().counts[KEY]).toBe(9)
  })
})

describe('backup', () => {
  it('imports pasted JSON with merge mode after a preview', () => {
    setCount(printings[0].key, 1)
    mount()
    fireEvent.click(screen.getByTestId('import-mode-merge'))
    fireEvent.change(screen.getByTestId('import-input'), { target: { value: JSON.stringify({ version: 1, counts: { [printings[0].key]: 2 } }) } })
    fireEvent.click(screen.getByTestId('import-submit'))
    expect(getCollection().counts[printings[0].key]).toBe(1)
    expect(screen.getByTestId('import-preview').textContent).toContain('1 → 3')
    fireEvent.click(screen.getByTestId('import-apply'))
    expect(getCollection().counts[printings[0].key]).toBe(3)
  })
  it('shows the error and keeps data on a bad import', () => {
    setCount(printings[0].key, 1)
    mount()
    fireEvent.change(screen.getByTestId('import-input'), { target: { value: 'garbage' } })
    fireEvent.click(screen.getByTestId('import-submit'))
    expect(screen.getByTestId('import-error').textContent).toContain('Could not import')
    expect(getCollection().counts[printings[0].key]).toBe(1)
  })
  it('disables Preview while the textarea is blank', () => {
    mount()
    expect((screen.getByTestId('import-submit') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByTestId('import-input'), { target: { value: `1x whatever [${printings[0].key}]` } })
    expect((screen.getByTestId('import-submit') as HTMLButtonElement).disabled).toBe(false)
  })
  it('exports JSON, text and JSON + history through Blob downloads', () => {
    setCount(printings[0].key, 3)
    const blobSpy = vi.spyOn(globalThis, 'Blob')
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    mount()
    fireEvent.click(screen.getByTestId('export-json')); fireEvent.click(screen.getByTestId('export-text')); fireEvent.click(screen.getByTestId('export-history'))
    expect(blobSpy).toHaveBeenCalledTimes(3)
    expect(String((blobSpy.mock.calls[2] as [BlobPart[]])[0][0])).toContain('"entries"')
  })
  it('restores history metadata without touching counts', () => {
    setCount(printings[0].key, 2)
    mount()
    fireEvent.change(screen.getByTestId('history-import-input'), { target: { value: JSON.stringify({ version: 1, entries: [{ id: 'x1', createdAt: '2026-09-01T00:00:00.000Z', kind: 'Trade', changes: { [printings[0].key]: { before: 0, after: 2 } } }] }) } })
    fireEvent.click(screen.getByTestId('history-import'))
    expect(readCollectionJournal().entries.some(e => e.id === 'x1')).toBe(true)
    expect(getCollection().counts[printings[0].key]).toBe(2)
  })
})
