// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { loadCardDb } from '../../src/engine/cardDb'
import { loadPrintings, printingsByCard } from '../../src/ui/printings'
import { _resetCollectionCacheForTests, getCollection, setCount } from '../../src/ui/collection'
import { CardDrawer } from '../../src/ui/CardDrawer'

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
  it('close calls back', () => {
    const onClose = mount()
    fireEvent.click(screen.getByTestId('drawer-close'))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
