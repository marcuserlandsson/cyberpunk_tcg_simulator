// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { loadCardDb } from '../../src/engine/cardDb'
import { loadPrintings } from '../../src/ui/printings'
import { _resetCollectionCacheForTests, getCollection, setCount } from '../../src/ui/collection'
import { readCollectionJournal } from '../../src/ui/collectionJournal'
import { _resetDraftForTests, getDraft, stageLine, updateDraft } from '../../src/ui/sessionDraft'
import { AddCardsMode } from '../../src/ui/AddCardsMode'

const db = loadCardDb()
const printings = loadPrintings()
const DEMO = 'arasakademodeck/006'
beforeEach(() => { localStorage.clear(); _resetCollectionCacheForTests(); _resetDraftForTests() })
afterEach(cleanup)
const mount = () => render(<AddCardsMode db={db} printings={printings} known />)

describe('AddCardsMode', () => {
  it('edits the session strip into the draft', () => {
    mount()
    fireEvent.click(screen.getByTestId('session-kind-Trade'))
    fireEvent.change(screen.getByTestId('session-source'), { target: { value: 'Launch boosters' } })
    fireEvent.change(screen.getByTestId('session-cost'), { target: { value: '100 SEK' } })
    expect(getDraft()).toMatchObject({ kind: 'Trade', source: 'Launch boosters', cost: '100 SEK' })
  })

  it('pasting lines stages them, and the live review shows before → after', () => {
    mount()
    fireEvent.change(screen.getByTestId('session-input'), { target: { value: `${DEMO},+3` } })
    fireEvent.click(screen.getByTestId('session-paste-add'))
    expect(screen.getByTestId(`session-line-${DEMO}`).textContent).toContain('+3')
    expect(screen.getByTestId('session-changes').textContent).toContain('0 → 3')
    expect((screen.getByTestId('session-input') as HTMLTextAreaElement).value).toBe('')
  })

  it('a bad paste shows the parser error and stages nothing', () => {
    mount()
    fireEvent.change(screen.getByTestId('session-input'), { target: { value: 'garbage' } })
    fireEvent.click(screen.getByTestId('session-paste-add'))
    expect(screen.getByTestId('session-error').textContent).toMatch(/Line 1/)
    expect(getDraft().lines).toEqual([])
  })

  it('a whole product stages one grouped block and the button reads added', () => {
    mount()
    fireEvent.click(screen.getByTestId('product-arasakademodeck'))
    expect(screen.getByTestId('session-group-Arasaka Demo Deck').textContent).toMatch(/whole product/)
    expect((screen.getByTestId('product-arasakademodeck') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByTestId('session-remove-group-Arasaka Demo Deck'))
    expect(getDraft().lines).toEqual([])
  })

  it('stages a full starter deck and treats its retail and beta printings as separate products', () => {
    mount()
    fireEvent.click(screen.getByTestId('product-embracingpowerretailstarterdeck'))
    expect((screen.getByTestId('product-embracingpowerretailstarterdeck') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('product-embracingpowerbetastarterdeck') as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByTestId('product-embracingpowerbetastarterdeck'))
    const lines = getDraft().lines
    expect(lines.reduce((total, line) => total + (line.delta ?? 0), 0)).toBe(86)
    expect(new Set(lines.map(line => line.key)).size).toBe(40)
  })

  it('the mode toggle is disabled while lines are staged', () => {
    stageLine({ key: DEMO, delta: 1 })
    mount()
    expect((screen.getByTestId('session-mode-exact') as HTMLButtonElement).disabled).toBe(true)
  })

  it('exact mode labels the column "Set to" and applies as Bulk counts', () => {
    updateDraft({ mode: 'exact' }); stageLine({ key: DEMO, exact: 5 })
    mount()
    expect(screen.getByTestId('session-lines').textContent).toContain('Set to')
    fireEvent.click(screen.getByTestId('session-apply'))
    expect(getCollection().counts[DEMO]).toBe(5)
    expect(readCollectionJournal().entries[0].kind).toBe('Bulk counts')
  })

  it('Apply writes once with metadata, records the pulled-by-rarity rows, and empties the draft', async () => {
    const user = userEvent.setup()
    setCount(DEMO, 1)
    mount()
    await user.type(screen.getByTestId('session-source'), 'Box')
    fireEvent.change(screen.getByTestId('session-input'), { target: { value: `${DEMO},+2` } })
    fireEvent.click(screen.getByTestId('session-paste-add'))
    expect(screen.getByTestId('session-rarity').textContent).toContain(printings.find(p => p.key === DEMO)!.rarity)
    fireEvent.click(screen.getByTestId('session-apply'))
    expect(getCollection().counts[DEMO]).toBe(3)
    expect(getDraft().lines).toEqual([])
    expect(readCollectionJournal().entries[0].source).toBe('Box')
  })

  it('the review follows a write made elsewhere while lines are staged', () => {
    mount()
    fireEvent.change(screen.getByTestId('session-input'), { target: { value: `${DEMO},+2` } })
    fireEvent.click(screen.getByTestId('session-paste-add'))
    act(() => { setCount(DEMO, 7) })   // someone else wrote in between (another tab)
    // The review recomputes from the live collection, so Apply is still
    // correct: 7 + 2. Nothing is refused, but the shown "before" must follow.
    expect(screen.getByTestId('session-changes').textContent).toContain('7 → 9')
  })

  it('Clear needs a second click', () => {
    stageLine({ key: DEMO, delta: 1 })
    mount()
    fireEvent.click(screen.getByTestId('session-clear'))
    expect(getDraft().lines).toHaveLength(1)
    expect(screen.getByTestId('session-clear').textContent).toMatch(/Clear 1 line\?/)
    fireEvent.click(screen.getByTestId('session-clear'))
    expect(getDraft().lines).toEqual([])
  })

  it('shows the staged AddLine instance under its own prefix', () => {
    mount()
    expect(screen.getByTestId('add-line-input')).toBeTruthy()
  })

  it('the review error and a paste error can both show at once, each under its own test id', () => {
    stageLine({ key: 'nope/1', delta: 1 })
    mount()
    fireEvent.change(screen.getByTestId('session-input'), { target: { value: 'garbage' } })
    fireEvent.click(screen.getByTestId('session-paste-add'))
    expect(screen.getByTestId('session-review-error').textContent).toMatch(/unknown printing/)
    expect(screen.getByTestId('session-error').textContent).toMatch(/Line 1/)
  })
})
