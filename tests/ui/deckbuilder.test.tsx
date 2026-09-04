// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { DeckBuilderView } from '../../src/ui/DeckBuilderView'
import { DeckPanel } from '../../src/ui/DeckPanel'
import { loadCardDb } from '../../src/engine/cardDb'
import { isReadOnlyDeck, listDecks, saveDeck } from '../../src/ui/storage'
import { _resetCollectionCacheForTests, setCount } from '../../src/ui/collection'
import { loadPrintings } from '../../src/ui/printings'
import arasakaDeck from '../../data/decks/arasaka-embracing-power.json'
import type { DeckList } from '../../src/engine/deck'

const db = loadCardDb()
const ARASAKA = arasakaDeck as unknown as DeckList

// A Blue-ram card, found dynamically rather than hardcoded, used to exercise
// the "over the deck's RAM limit" path without pinning to one card id that
// might change shape later.
const BLUE_RAM_CARD = Object.values(db).find(
  (def) => def.type !== 'legend' && def.ram !== null && def.ram.color === 'Blue'
)
if (BLUE_RAM_CARD === undefined) throw new Error('fixture assumption failed: no Blue-ram card')

// A Green-ram-3 card, found dynamically, paired below with the
// 'goro-takemura-hands-unclean' legend (Green ramLimit 2, already used by the
// tests above) to exercise the RAM budget bar's "used > limit" path.
const GREEN_RAM_3_CARD = Object.values(db).find(
  (def) =>
    def.type !== 'legend' &&
    def.ram !== null &&
    def.ram.color === 'Green' &&
    def.ram.value === 3
)
if (GREEN_RAM_3_CARD === undefined) throw new Error('fixture assumption failed: no Green-ram-3 card')

beforeEach(() => {
  localStorage.clear()
  _resetCollectionCacheForTests()
})

afterEach(cleanup)

function grid(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[data-testid="card-browser-grid"]')
  if (el === null) throw new Error('card-browser-grid not found')
  return el as HTMLElement
}

function browserFrames(container: HTMLElement): HTMLElement[] {
  return Array.from(grid(container).querySelectorAll('[data-testid="card-frame"]'))
}

function browserFrame(container: HTMLElement, id: string): HTMLElement {
  const el = grid(container).querySelector(`[data-def-id="${id}"]`)
  if (el === null) throw new Error(`browser card ${id} not found`)
  return el as HTMLElement
}

function errorsText(container: HTMLElement): string {
  return container.querySelector('[data-testid="deck-errors"]')?.textContent ?? ''
}

describe('DeckBuilderView — CardBrowser', () => {
  it('renders every card in the pool', () => {
    const { container } = render(<DeckBuilderView db={db} useOfficialImages={false} />)
    expect(browserFrames(container)).toHaveLength(Object.keys(db).length)
  })

  it('filters by a case-insensitive name/text substring search', () => {
    const { container } = render(<DeckBuilderView db={db} useOfficialImages={false} />)
    const search = container.querySelector('[data-testid="search-input"]') as HTMLInputElement
    fireEvent.change(search, { target: { value: 'GORO' } })
    const shown = browserFrames(container)
    expect(shown.length).toBeGreaterThan(0)
    expect(shown.length).toBeLessThan(Object.keys(db).length)
    for (const frame of shown) {
      const id = frame.getAttribute('data-def-id') ?? ''
      expect(db[id].name.toLowerCase()).toContain('goro')
    }
  })

  it('disables the art-only promo (rebecca) with a tooltip note, and clicking it does not add it', () => {
    const { container } = render(<DeckBuilderView db={db} useOfficialImages={false} />)
    const cell = grid(container).querySelector(
      '[data-card-id="rebecca-having-a-moment"]'
    ) as HTMLElement
    expect(cell).not.toBeNull()
    expect(cell.className).toContain('disabled')
    expect(cell.getAttribute('title')).toMatch(/art-only/i)

    const frame = browserFrame(container, 'rebecca-having-a-moment')
    fireEvent.click(frame)
    // No legend slot should have been filled by clicking the disabled promo.
    const legendSlots = container.querySelectorAll('[data-testid^="legend-slot-"]')
    for (const slot of Array.from(legendSlots)) {
      expect(slot.textContent ?? '').not.toContain('Rebecca')
    }
  })
})

describe('DeckBuilderView — adding cards & live validation', () => {
  it('increments a card copy count on click, and flags (does not silently allow) a 4th copy', () => {
    const { container } = render(<DeckBuilderView db={db} useOfficialImages={false} />)
    const frame = browserFrame(container, 'mantis-blades')

    fireEvent.click(frame)
    fireEvent.click(frame)
    fireEvent.click(frame)
    expect(container.querySelector('[data-testid="card-row-count-mantis-blades"]')?.textContent).toBe(
      '3'
    )
    expect(errorsText(container)).not.toMatch(/mantis-blades.*copies/)

    // Design decision (docs/rulings.md §152): adds are never blocked. A 4th
    // copy IS added, and the deck becomes invalid — the violation surfaces as
    // a live validateDeck error rather than refusing the click.
    fireEvent.click(frame)
    expect(container.querySelector('[data-testid="card-row-count-mantis-blades"]')?.textContent).toBe(
      '4'
    )
    expect(errorsText(container)).toMatch(/"mantis-blades".*4 copies/)
  })

  it('selecting 3 legends live-updates the per-color RAM chips', () => {
    const { container } = render(<DeckBuilderView db={db} useOfficialImages={false} />)
    fireEvent.click(browserFrame(container, 'goro-takemura-hands-unclean')) // Green 2
    fireEvent.click(browserFrame(container, 'yorinobu-arasaka-embracing-destruction')) // Red 2
    fireEvent.click(browserFrame(container, 'saburo-arasaka-stubborn-patriarch')) // Green 2

    expect(container.querySelector('[data-testid="ram-chip-Green"]')?.textContent).toContain('4')
    expect(container.querySelector('[data-testid="ram-chip-Red"]')?.textContent).toContain('2')
    expect(
      container.querySelector('[data-testid="legend-slot-0"]')?.textContent ?? ''
    ).toContain('Goro')
    expect(
      container.querySelector('[data-testid="legend-slot-1"]')?.textContent ?? ''
    ).toContain('Yorinobu')
    expect(
      container.querySelector('[data-testid="legend-slot-2"]')?.textContent ?? ''
    ).toContain('Saburo')
  })

  it('adding a card over the available RAM limit shows the validateDeck error live', () => {
    const { container } = render(<DeckBuilderView db={db} useOfficialImages={false} />)
    // No Blue legend chosen -> Blue RAM limit is 0.
    fireEvent.click(browserFrame(container, 'goro-takemura-hands-unclean'))
    fireEvent.click(browserFrame(container, 'yorinobu-arasaka-embracing-destruction'))
    fireEvent.click(browserFrame(container, 'saburo-arasaka-stubborn-patriarch'))

    fireEvent.click(browserFrame(container, BLUE_RAM_CARD.id))
    expect(errorsText(container)).toMatch(/Blue RAM/)
  })
})

describe('DeckBuilderView — RAM budget bars & the empty-slot error fix', () => {
  it('a new empty deck shows no Unknown-card-id errors, and shows the legend hint', () => {
    const { container } = render(<DeckBuilderView db={db} useOfficialImages={false} />)
    fireEvent.click(container.querySelector('[data-testid="new-deck-button"]') as HTMLElement)

    const errors = container.querySelector('[data-testid="deck-errors"]')?.textContent ?? ''
    expect(errors).not.toMatch(/Unknown card id: ""/)
    expect(container.querySelector('[data-testid="legend-hint"]')).not.toBeNull()
  })

  it('the legend hint disappears once all 3 legend slots are filled', () => {
    const { container } = render(<DeckBuilderView db={db} useOfficialImages={false} />)
    fireEvent.click(browserFrame(container, 'goro-takemura-hands-unclean'))
    fireEvent.click(browserFrame(container, 'yorinobu-arasaka-embracing-destruction'))
    fireEvent.click(browserFrame(container, 'saburo-arasaka-stubborn-patriarch'))

    expect(container.querySelector('[data-testid="legend-hint"]')).toBeNull()
  })

  it('ram bar reflects highest card demand vs legend budget, and flags is-over', () => {
    const { container } = render(<DeckBuilderView db={db} useOfficialImages={false} />)
    fireEvent.click(browserFrame(container, 'goro-takemura-hands-unclean')) // Green ramLimit 2
    fireEvent.click(browserFrame(container, GREEN_RAM_3_CARD.id)) // Green ram 3

    const bar = container.querySelector('[data-testid="ram-bar-Green"]')
    expect(bar).not.toBeNull()
    expect(bar?.getAttribute('data-used')).toBe('3')
    expect(bar?.getAttribute('data-limit')).toBe('2')
    expect(bar?.className).toContain('is-over')
    // `ram-chip-<Color>` testids survive, on the numerals inside the bar row.
    expect(container.querySelector('[data-testid="ram-chip-Green"]')?.textContent).toContain('3')
    expect(container.querySelector('[data-testid="ram-chip-Green"]')?.textContent).toContain('2')
  })

  it('a color with no legend and no deck cards shows used 0 / limit 0, not is-over', () => {
    const { container } = render(<DeckBuilderView db={db} useOfficialImages={false} />)
    const bar = container.querySelector('[data-testid="ram-bar-Yellow"]')
    expect(bar).not.toBeNull()
    expect(bar?.getAttribute('data-used')).toBe('0')
    expect(bar?.getAttribute('data-limit')).toBe('0')
    expect(bar?.className).not.toContain('is-over')
  })

  it('renders a deck size meter alongside the existing counter text', () => {
    const { container } = render(<DeckBuilderView db={db} useOfficialImages={false} />)
    expect(container.querySelector('[data-testid="deck-size-meter"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="deck-size-counter"]')?.textContent).toContain(
      '40'
    )
  })

  it('filters exactly the empty-legend-slot artifact but keeps a real unknown-id error verbatim', () => {
    const deck: DeckList = {
      name: 'Test',
      legends: ['', '', ''],
      cards: { 'not-a-real-card': 1 },
    }
    const { container } = render(
      <DeckPanel
        db={db}
        deck={deck}
        decks={[]}
        isReadOnly={false}
        useOfficialImages={false}
        deleteError={null}
        onChangeDeck={() => {}}
        onSave={() => {}}
        onLoad={() => {}}
        onDelete={() => {}}
        onNew={() => {}}
      />
    )
    const errors = container.querySelector('[data-testid="deck-errors"]')?.textContent ?? ''
    expect(errors).not.toMatch(/Unknown card id: ""/)
    expect(errors).toMatch(/Unknown card id: "not-a-real-card"/)
    expect(container.querySelector('[data-testid="legend-hint"]')).not.toBeNull()
  })
})

describe('DeckBuilderView — export / import', () => {
  it('exports text containing "3x" lines, and importing it reproduces the deck', () => {
    const { container } = render(<DeckBuilderView db={db} useOfficialImages={false} />)
    fireEvent.click(browserFrame(container, 'goro-takemura-hands-unclean'))
    fireEvent.click(browserFrame(container, 'yorinobu-arasaka-embracing-destruction'))
    fireEvent.click(browserFrame(container, 'saburo-arasaka-stubborn-patriarch'))
    const mantis = browserFrame(container, 'mantis-blades')
    fireEvent.click(mantis)
    fireEvent.click(mantis)
    fireEvent.click(mantis)

    fireEvent.click(container.querySelector('[data-testid="export-button"]') as HTMLElement)
    const exportArea = container.querySelector(
      '[data-testid="export-textarea"]'
    ) as HTMLTextAreaElement
    expect(exportArea.value).toContain('3x Mantis Blades')

    const exported = exportArea.value

    // New deck, then import the exported text back in.
    fireEvent.click(container.querySelector('[data-testid="new-deck-button"]') as HTMLElement)
    const importArea = container.querySelector(
      '[data-testid="import-textarea"]'
    ) as HTMLTextAreaElement
    fireEvent.change(importArea, { target: { value: exported } })
    fireEvent.click(container.querySelector('[data-testid="import-button"]') as HTMLElement)

    expect(container.querySelector('[data-testid="card-row-count-mantis-blades"]')?.textContent).toBe(
      '3'
    )
    expect(
      container.querySelector('[data-testid="legend-slot-0"]')?.textContent ?? ''
    ).toContain('Goro')
  })

  it('surfaces import errors inline instead of throwing', () => {
    const { container } = render(<DeckBuilderView db={db} useOfficialImages={false} />)
    const importArea = container.querySelector(
      '[data-testid="import-textarea"]'
    ) as HTMLTextAreaElement
    fireEvent.change(importArea, {
      target: { value: '# Bad\n## Legends\nNope\nNope\nNope\n## Cards\n1x Not A Real Card' },
    })
    expect(() =>
      fireEvent.click(container.querySelector('[data-testid="import-button"]') as HTMLElement)
    ).not.toThrow()
    expect(container.querySelector('[data-testid="import-error"]')?.textContent ?? '').toMatch(
      /Not A Real Card/
    )
  })
})

describe('DeckBuilderView — save / load / delete', () => {
  it('saves the current deck under a name, then New + Load reproduces it', () => {
    const { container } = render(<DeckBuilderView db={db} useOfficialImages={false} />)
    fireEvent.click(browserFrame(container, 'goro-takemura-hands-unclean'))
    fireEvent.click(browserFrame(container, 'yorinobu-arasaka-embracing-destruction'))
    fireEvent.click(browserFrame(container, 'saburo-arasaka-stubborn-patriarch'))
    fireEvent.click(browserFrame(container, 'mantis-blades'))

    const nameInput = container.querySelector('[data-testid="save-name-input"]') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'My Saved Deck' } })
    fireEvent.click(container.querySelector('[data-testid="save-deck-button"]') as HTMLElement)

    expect(listDecks().find((d) => d.name === 'My Saved Deck')).toBeDefined()

    fireEvent.click(container.querySelector('[data-testid="new-deck-button"]') as HTMLElement)
    expect(
      container.querySelector('[data-testid="legend-slot-0"]')?.textContent ?? ''
    ).not.toContain('Goro')

    const select = container.querySelector('[data-testid="deck-select"]') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'My Saved Deck' } })
    fireEvent.click(container.querySelector('[data-testid="load-deck-button"]') as HTMLElement)

    expect(
      container.querySelector('[data-testid="legend-slot-0"]')?.textContent ?? ''
    ).toContain('Goro')
    expect(container.querySelector('[data-testid="card-row-count-mantis-blades"]')?.textContent).toBe(
      '1'
    )
  })

  it('deletes a localStorage deck', () => {
    saveDeck({ ...ARASAKA, name: 'Deletable Deck' })
    const { container } = render(<DeckBuilderView db={db} useOfficialImages={false} />)
    const select = container.querySelector('[data-testid="deck-select"]') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'Deletable Deck' } })
    fireEvent.click(container.querySelector('[data-testid="load-deck-button"]') as HTMLElement)
    fireEvent.click(container.querySelector('[data-testid="delete-deck-button"]') as HTMLElement)
    expect(listDecks().find((d) => d.name === 'Deletable Deck')).toBeUndefined()
  })
})

describe('DeckBuilderView — bundled demo deck fork-on-save', () => {
  it('shows a read-only badge for an unmodified bundled deck, and Save forks a local copy', () => {
    const { container } = render(<DeckBuilderView db={db} useOfficialImages={false} />)
    const select = container.querySelector('[data-testid="deck-select"]') as HTMLSelectElement
    fireEvent.change(select, { target: { value: ARASAKA.name } })
    fireEvent.click(container.querySelector('[data-testid="load-deck-button"]') as HTMLElement)

    expect(container.querySelector('[data-testid="demo-badge"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="readonly-badge"]')).not.toBeNull()
    expect(isReadOnlyDeck(ARASAKA.name)).toBe(true)

    fireEvent.click(browserFrame(container, 'mantis-blades')) // edit it
    fireEvent.click(container.querySelector('[data-testid="save-deck-button"]') as HTMLElement)

    // The bundled original is untouched; a local override now shadows it.
    expect(isReadOnlyDeck(ARASAKA.name)).toBe(false)
    expect(container.querySelector('[data-testid="readonly-badge"]')).toBeNull()
    const saved = listDecks().find((d) => d.name === ARASAKA.name)
    expect(saved?.cards['mantis-blades']).toBe(4)
  })
})

describe('DeckBuilderView — collection integration (owned badge + missing summary)', () => {
  it('shows an owned badge on browser cards once you own copies', () => {
    const printing = loadPrintings().find((p) => p.cardId === 'mantis-blades')
    if (printing === undefined) throw new Error('fixture assumption failed: no mantis-blades printing')
    setCount(printing.key, 2)

    const { container } = render(<DeckBuilderView db={db} useOfficialImages={false} />)
    expect(container.querySelector('[data-testid="owned-mantis-blades"]')?.textContent).toBe(
      'owned 2/3'
    )
  })

  it('shows an owned badge of owned 0/T for a card with no copies', () => {
    const { container } = render(<DeckBuilderView db={db} useOfficialImages={false} />)
    expect(container.querySelector('[data-testid="owned-mantis-blades"]')?.textContent).toBe(
      'owned 0/3'
    )
  })

  it('a blank deck (nothing added yet) reports that you own everything for it', () => {
    const { container } = render(<DeckBuilderView db={db} useOfficialImages={false} />)
    const summary = container.querySelector('[data-testid="deck-missing-summary"]')
    expect(summary?.textContent).toContain('You own all cards for this deck')
    expect(container.querySelector('[data-testid="copy-deck-buylist"]')).toBeNull()
  })

  it('summarizes the shortfall once an unowned card is added to the deck', () => {
    const { container } = render(<DeckBuilderView db={db} useOfficialImages={false} />)
    fireEvent.click(container.querySelector('[data-testid="add-mantis-blades"]') as HTMLElement)

    const summary = container.querySelector('[data-testid="deck-missing-summary"]')
    expect(summary?.textContent).toMatch(/Missing 1 cards for this deck/)
    expect(container.querySelector('[data-testid="copy-deck-buylist"]')).not.toBeNull()
  })

  it('owning enough copies clears the shortfall for that card', () => {
    const printing = loadPrintings().find((p) => p.cardId === 'mantis-blades')
    if (printing === undefined) throw new Error('fixture assumption failed: no mantis-blades printing')
    setCount(printing.key, 1)

    const { container } = render(<DeckBuilderView db={db} useOfficialImages={false} />)
    fireEvent.click(container.querySelector('[data-testid="add-mantis-blades"]') as HTMLElement)

    const summary = container.querySelector('[data-testid="deck-missing-summary"]')
    expect(summary?.textContent).toContain('You own all cards for this deck')
  })
})
