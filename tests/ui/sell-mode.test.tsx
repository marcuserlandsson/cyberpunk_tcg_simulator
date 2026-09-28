// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { loadCardDb } from '../../src/engine/cardDb'
import { loadPrintings } from '../../src/ui/printings'
import { _resetCollectionCacheForTests, getCollection, setCount } from '../../src/ui/collection'
import { setCollectionAccess } from '../../src/ui/collectionAccess'
import { readCollectionJournal } from '../../src/ui/collectionJournal'
import { saveDeck } from '../../src/ui/storage'
import { _resetSellListForTests, addToSellList, getSellList } from '../../src/ui/sellDraft'
import { SellMode } from '../../src/ui/SellMode'

const db = loadCardDb(), printings = loadPrintings()
const legends: [string, string, string] = ['goro-takemura-hands-unclean', 'yorinobu-arasaka-embracing-destruction', 'saburo-arasaka-stubborn-patriarch']
const KEY = 'arasakademodeck/006'
beforeEach(() => {
  localStorage.clear(); _resetCollectionCacheForTests(); _resetSellListForTests(); setCollectionAccess('writer')
  saveDeck({ name: 'Keep A', demo: true, legends, cards: { 'industrial-assembly': 1 } })
  setCount(KEY, 3)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
const mount = () => render(<SellMode db={db} printings={printings} known />)
const surplusOf = (id: string) => screen.queryAllByTestId('sell-row').find(r => r.getAttribute('data-card-id') === id)?.querySelectorAll('td')[4].textContent

describe('SellMode', () => {
  it('shrinks surplus as decks are chosen and remembers the choice', () => {
    mount()
    expect(surplusOf('industrial-assembly')).toBe('3')
    fireEvent.click(screen.getByLabelText('Keep A', { exact: true }))
    expect(surplusOf('industrial-assembly')).toBe('2')
    fireEvent.click(screen.getByTestId('sell-keep-playset'))
    expect(surplusOf('industrial-assembly')).toBeUndefined()
    cleanup(); mount()
    expect((screen.getByLabelText('Keep A', { exact: true }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByTestId('sell-keep-playset') as HTMLInputElement).checked).toBe(true)
  })
  it('drops a remembered deck that no longer exists', () => {
    localStorage.setItem('ctcg:sell:prefs:v1', JSON.stringify({ decks: ['Gone', 'Keep A'], mode: 'shared', keepBinderArt: false, keepPlayset: false }))
    mount()
    expect(surplusOf('industrial-assembly')).toBe('2')
    fireEvent.click(screen.getByTestId('sell-mode-assembled'))
    expect(JSON.parse(localStorage.getItem('ctcg:sell:prefs:v1')!).decks).toEqual(['Keep A'])
  })
  it('names surplus-table and sell-list controls for assistive tech', () => {
    mount()
    fireEvent.click(screen.getByLabelText('Keep A', { exact: true }))
    expect(screen.getByTestId(`sell-add-industrial-assembly`).getAttribute('aria-label')).toBe('Add Industrial Assembly to the sell list')
    fireEvent.click(screen.getByTestId('sell-add-all'))
    const row = screen.getByTestId(`sell-line-${KEY}`)
    expect(within(row).getByTestId(`sell-line-check-${KEY}`).getAttribute('aria-label')).toMatch(/^Select/)
    expect(within(row).getByTestId(`sell-line-remove-${KEY}`).getAttribute('aria-label')).toMatch(/^Remove/)
    expect(within(row).getByTestId(`sell-line-dec-${KEY}`).getAttribute('aria-label')).toMatch(/^Fewer/)
    expect(within(row).getByTestId(`sell-line-inc-${KEY}`).getAttribute('aria-label')).toMatch(/^More/)
    expect(within(row).getByTestId(`sell-line-condition-${KEY}`).getAttribute('aria-label')).toMatch(/^Condition for/)
  })
  it('adds all surplus once, however often the button is pressed', () => {
    mount()
    fireEvent.click(screen.getByLabelText('Keep A', { exact: true }))
    fireEvent.click(screen.getByTestId('sell-add-all'))
    fireEvent.click(screen.getByTestId('sell-add-all'))
    expect(getSellList().lines).toEqual([{ key: KEY, count: 2 }])
    expect(screen.getByTestId(`sell-line-${KEY}`)).toBeTruthy()
  })
  it('flags lines that sell below what is kept', () => {
    mount()
    fireEvent.click(screen.getByLabelText('Keep A', { exact: true }))
    fireEvent.click(screen.getByTestId('sell-add-all'))
    fireEvent.click(screen.getByTestId(`sell-line-inc-${KEY}`))
    expect(screen.getByTestId(`sell-line-note-${KEY}`).textContent).toMatch(/below keep/)
  })
  it('shows a reduced line when fewer copies are owned than listed', () => {
    mount()
    fireEvent.click(screen.getByTestId('sell-add-all'))
    setCount(KEY, 1)
    return waitFor(() => expect(screen.getByTestId(`sell-line-note-${KEY}`).textContent).toMatch(/reduced: you now own 1/))
  })
  it('copies the bulk-listing text and downloads a CSV per expansion', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const createObjectURL = vi.fn(() => 'blob:x'); Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
    mount()
    fireEvent.click(screen.getByTestId('sell-add-all'))
    fireEvent.click(screen.getByTestId('sell-copy-text'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('3× Industrial Assembly · #006 · NM · English')))
    fireEvent.click(screen.getByTestId('sell-csv-0'))
    expect(createObjectURL).toHaveBeenCalledTimes(1)
  })
  it('marks checked lines sold after a confirm and journals a Sale', () => {
    mount()
    fireEvent.click(screen.getByLabelText('Keep A', { exact: true }))
    fireEvent.click(screen.getByTestId('sell-add-all'))
    fireEvent.click(screen.getByTestId(`sell-line-check-${KEY}`))
    fireEvent.click(screen.getByTestId('sell-mark'))
    expect(within(screen.getByTestId('sell-confirm')).getByText(/3 → 1/)).toBeTruthy()
    fireEvent.click(screen.getByTestId('sell-confirm-ok'))
    expect(getCollection().counts[KEY]).toBe(1)
    expect(getSellList().lines).toEqual([])
    expect(readCollectionJournal().entries.some(e => e.kind === 'Sale')).toBe(true)
    expect(screen.getByTestId('sell-status').textContent).toMatch(/2 copies sold/)
  })
  it('shows requested counts and disables exports while ownership is unknown', () => {
    addToSellList([{ key: KEY, count: 5 }])
    render(<SellMode db={db} printings={printings} known={false} />)
    const row = screen.getByTestId(`sell-line-${KEY}`)
    expect(within(row).getByText('5')).toBeTruthy()
    expect(screen.queryByTestId(`sell-line-note-${KEY}`)).toBeNull()
    expect((within(row).getByTestId(`sell-line-dec-${KEY}`) as HTMLButtonElement).disabled).toBe(true)
    expect((within(row).getByTestId(`sell-line-inc-${KEY}`) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('sell-copy-text') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('sell-mark') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/Ownership unavailable — load the collection before exporting or marking sales\./)).toBeTruthy()
  })
  it('steps the sell-list count from what is owned, not the requested amount', () => {
    addToSellList([{ key: KEY, count: 5 }])
    render(<SellMode db={db} printings={printings} known />)
    fireEvent.click(screen.getByTestId(`sell-line-dec-${KEY}`))
    expect(within(screen.getByTestId(`sell-line-${KEY}`)).getByText('2')).toBeTruthy()
  })
  it('disables the confirm once ownership becomes unknown, even if it was opened while known', () => {
    const { rerender } = mount()
    fireEvent.click(screen.getByLabelText('Keep A', { exact: true }))
    fireEvent.click(screen.getByTestId('sell-add-all'))
    fireEvent.click(screen.getByTestId(`sell-line-check-${KEY}`))
    fireEvent.click(screen.getByTestId('sell-mark'))
    rerender(<SellMode db={db} printings={printings} known={false} />)
    expect((screen.getByTestId('sell-confirm-ok') as HTMLButtonElement).disabled).toBe(true)
  })
  it('refuses the confirm when the collection changed meanwhile', () => {
    mount()
    fireEvent.click(screen.getByTestId('sell-add-all'))
    fireEvent.click(screen.getByTestId(`sell-line-check-${KEY}`))
    fireEvent.click(screen.getByTestId('sell-mark'))
    setCount('welcometonightcityretail/033', 1)
    fireEvent.click(screen.getByTestId('sell-confirm-ok'))
    expect(screen.getByTestId('sell-error').textContent).toMatch(/Collection changed/)
    expect(getSellList().lines).toHaveLength(1)
  })
})
