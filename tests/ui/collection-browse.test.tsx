// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { loadCardDb } from '../../src/engine/cardDb'
import { loadPrintings, printingsByCard } from '../../src/ui/printings'
import { _resetCollectionCacheForTests, getCollection } from '../../src/ui/collection'
import { _resetDraftForTests } from '../../src/ui/sessionDraft'
import { CollectionBrowse } from '../../src/ui/CollectionBrowse'
import { biggestSet, collectorNumberKey, compareNumberKeys } from '../../src/ui/collectionSort'

const db = loadCardDb()
const printings = loadPrintings()
const byCard = printingsByCard(printings)
const multi = printings.find((p) => printings.filter((q) => q.cardId === p.cardId).length >= 2)!
beforeEach(() => { localStorage.clear(); _resetCollectionCacheForTests(); _resetDraftForTests() })
afterEach(cleanup)

function mount(narrow = false) {
  render(<CollectionBrowse db={db} printings={printings} byCard={byCard} known useOfficialImages={false} narrow={narrow} />)
}

describe('CollectionBrowse', () => {
  it('renders a tile per card with the owned/target footer', () => {
    mount()
    expect(screen.getAllByTestId('collection-cell').length).toBe(Object.keys(db).length)
    expect(screen.getByTestId(`collection-count-${multi.cardId}`).textContent).toContain('0/')
  })
  it('clicking a tile opens the drawer; the stepper there increments and the footer follows', async () => {
    const user = userEvent.setup(); mount()
    await user.click(screen.getByTestId(`expand-${multi.cardId}`))
    expect(screen.getByTestId('card-drawer').textContent).toContain(db[multi.cardId].name)
    await user.click(screen.getByTestId(`printing-inc-${multi.key}`))
    expect(getCollection().counts[multi.key]).toBe(1)
    expect(screen.getByTestId(`collection-count-${multi.cardId}`).textContent).toContain('1/')
    await user.click(screen.getByTestId('drawer-close'))
    expect(screen.queryByTestId('card-drawer')).toBeNull()
  })
  it('decrement stops at 0', async () => {
    const user = userEvent.setup(); mount()
    await user.click(screen.getByTestId(`expand-${multi.cardId}`))
    await user.click(screen.getByTestId(`printing-dec-${multi.key}`))
    expect(getCollection().counts[multi.key]).toBeUndefined()
  })
  it('goal "complete" shows nothing on an empty collection', async () => {
    const user = userEvent.setup(); mount()
    await user.click(screen.getByTestId('goal-filter-complete'))
    expect(screen.queryAllByTestId('collection-cell')).toHaveLength(0)
  })
  it('sorts by collector number of the core set by default, and by name on request', async () => {
    const user = userEvent.setup(); mount()
    const core = biggestSet(printings)
    const first = printings.filter(p => p.setCode === core).sort((a, b) => compareNumberKeys(collectorNumberKey(a.collectorNumber), collectorNumberKey(b.collectorNumber)))[0]
    expect(screen.getByTestId('collection-sort-number').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getAllByTestId('collection-cell')[0].getAttribute('data-card-id')).toBe(first.cardId)
    await user.click(screen.getByTestId('collection-sort-name'))
    const names = screen.getAllByTestId('collection-cell').map(el => db[el.getAttribute('data-card-id')!].name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
  })
  it('with a set filter, the drawer lists only that set\'s printings', async () => {
    const user = userEvent.setup(); mount()
    await user.click(screen.getByTestId('set-filter-arasakademodeck'))
    await user.click(screen.getByTestId('expand-industrial-assembly'))
    const rows = screen.getAllByTestId(/^printing-row-/)
    expect(rows.length).toBe(printings.filter(p => p.cardId === 'industrial-assembly' && p.setCode === 'arasakademodeck').length)
    expect(screen.getByTestId('drawer-filter')).toBeTruthy()
  })
  it('set filter narrows the grid', async () => {
    const user = userEvent.setup(); mount()
    await user.click(screen.getByTestId(`set-filter-${multi.setCode}`))
    const shown = screen.getAllByTestId('collection-cell').length
    expect(shown).toBeGreaterThan(0); expect(shown).toBeLessThanOrEqual(Object.keys(db).length)
  })
  it('List view shows one row per matching printing with a count input', async () => {
    const user = userEvent.setup(); mount()
    await user.type(screen.getByTestId('collection-search'), 'Industrial 006')
    await user.click(screen.getByTestId(`set-filter-arasakademodeck`))
    await user.click(screen.getByTestId('collection-compact'))
    expect(screen.getAllByTestId('compact-printing')).toHaveLength(1)
    expect(screen.getByTestId('printing-count-arasakademodeck/006')).toBeTruthy()
    expect(screen.getByTestId('collection-scope').textContent).toContain('1 printing')
  })
  it('narrow layout collapses the rail behind a Filters summary', () => {
    mount(true)
    expect(within(screen.getByTestId('filter-rail')).getByText(/Filters/)).toBeTruthy()
  })
})
