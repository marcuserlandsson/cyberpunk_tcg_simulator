// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { loadCardDb } from '../../src/engine/cardDb'
import { loadPrintings, printingsByCard } from '../../src/ui/printings'
import { _resetCollectionCacheForTests, getCollection, setCount } from '../../src/ui/collection'
import { CardDrawer } from '../../src/ui/CardDrawer'
import { artworkGroups } from '../../src/ui/artworks'

const db = loadCardDb()
const printings = loadPrintings()
const byCard = printingsByCard(printings)
const cardId = 'industrial-assembly'
const prints = byCard.get(cardId)!
beforeEach(() => { localStorage.clear(); _resetCollectionCacheForTests() })
afterEach(cleanup)

function mount(onClose = vi.fn()) {
  render(<CardDrawer def={db[cardId]} printings={prints} collection={getCollection()} known onClose={onClose} />)
  return onClose
}

describe('CardDrawer', () => {
  it('shows both goals and one row per printing grouped by artwork', () => {
    mount()
    expect(screen.getByTestId('drawer-playset').textContent).toMatch(/0 \/ 3/)
    expect(screen.getByTestId('drawer-artworks').textContent).toMatch(/0 \/ \d+/)
    for (const p of prints) expect(screen.getByTestId(`printing-row-${p.key}`)).toBeTruthy()
  })
  it('steppers write immediately', () => {
    mount()
    fireEvent.click(screen.getByTestId(`printing-inc-${prints[0].key}`))
    expect(getCollection().counts[prints[0].key]).toBe(1)
  })
  it('names a printing row "Artwork n · owned/missing" and tags collection-only printings', () => {
    setCount('arasakademodeck/006', 1)
    render(<CardDrawer def={db[cardId]} printings={prints} collection={getCollection()} known onClose={() => {}} />)
    expect(screen.getByTestId('printing-row-arasakademodeck/006').textContent).toMatch(/Artwork 1 · owned/)
    const only = printings.find(p => p.playable === false)
    if (only) { cleanup(); render(<CardDrawer def={db[only.cardId]} printings={byCard.get(only.cardId)!} collection={getCollection()} known onClose={() => {}} />); expect(screen.getByTestId(`printing-row-${only.key}`).textContent).toMatch(/Collection only/) }
  })
  it('lists only the printings the Browse filters match, with a Show-all toggle; goals still cover every printing', () => {
    const visible = prints.filter(p => p.setCode === 'arasakademodeck')
    expect(visible.length).toBeGreaterThan(0)
    expect(visible.length).toBeLessThan(prints.length)
    render(<CardDrawer def={db[cardId]} printings={prints} visible={visible} collection={getCollection()} known onClose={() => {}} />)
    expect(screen.getAllByTestId(/^printing-row-/)).toHaveLength(visible.length)
    expect(screen.getByTestId('drawer-filter').textContent).toContain(`${visible.length} of ${prints.length}`)
    // Goals ignore the filter: the artwork total is over every printing.
    expect(screen.getByTestId('drawer-artworks').textContent).toContain(`/ ${artworkGroups(prints).length}`)
    fireEvent.click(screen.getByTestId('drawer-show-all'))
    expect(screen.getAllByTestId(/^printing-row-/)).toHaveLength(prints.length)
    fireEvent.click(screen.getByTestId('drawer-show-all'))
    expect(screen.getAllByTestId(/^printing-row-/)).toHaveLength(visible.length)
  })
  it('shows every printing and no filter note when the filters match them all', () => {
    render(<CardDrawer def={db[cardId]} printings={prints} visible={prints} collection={getCollection()} known onClose={() => {}} />)
    expect(screen.getAllByTestId(/^printing-row-/)).toHaveLength(prints.length)
    expect(screen.queryByTestId('drawer-filter')).toBeNull()
  })
  it('close calls back', () => {
    const onClose = mount()
    fireEvent.click(screen.getByTestId('drawer-close'))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
