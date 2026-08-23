// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { loadCardDb } from '../../src/engine/cardDb'
import type { DeckList } from '../../src/engine/deck'
import arasakaDeck from '../../data/decks/arasaka-embracing-power.json'
import {
  deleteDeck,
  exportDeckText,
  getLastSimResult,
  getSettings,
  importDeckText,
  listDecks,
  listGameRecords,
  saveDeck,
  saveGameRecord,
  saveSettings,
  saveSimResult,
  type GameRecord,
} from '../../src/ui/storage'

const db = loadCardDb()
const STARTER_DECK = arasakaDeck as unknown as DeckList

beforeEach(() => {
  localStorage.clear()
})

describe('listDecks', () => {
  it('includes the bundled starter decks even with nothing in localStorage', () => {
    const names = listDecks().map((deck) => deck.name)
    expect(names).toContain('Arasaka — Embracing Power')
    expect(names).toContain('Mercs — The Heist')
  })
})

describe('saveDeck / listDecks / deleteDeck round trip', () => {
  const customDeck: DeckList = {
    name: 'My Test Deck',
    legends: [
      'goro-takemura-hands-unclean',
      'yorinobu-arasaka-embracing-destruction',
      'saburo-arasaka-stubborn-patriarch',
    ],
    cards: { 'mantis-blades': 3 },
  }

  it('saves a deck so it appears in listDecks', () => {
    saveDeck(customDeck)
    const found = listDecks().find((deck) => deck.name === customDeck.name)
    expect(found).toEqual(customDeck)
  })

  it('deletes a saved deck so it no longer appears in listDecks', () => {
    saveDeck(customDeck)
    deleteDeck(customDeck.name)
    expect(listDecks().find((deck) => deck.name === customDeck.name)).toBeUndefined()
  })

  it('refuses to delete a bundled starter deck with no localStorage override', () => {
    expect(() => deleteDeck(STARTER_DECK.name)).toThrow()
  })

  it('silently no-ops deleting a name that does not exist anywhere', () => {
    expect(() => deleteDeck('Not A Real Deck')).not.toThrow()
  })

  it('reverts to the bundled deck after deleting a localStorage save that shadowed it by name', () => {
    const shadow: DeckList = { ...STARTER_DECK, cards: { 'mantis-blades': 1 } }
    saveDeck(shadow)
    // The localStorage save overrides the bundled deck of the same name...
    expect(listDecks().find((deck) => deck.name === STARTER_DECK.name)).toEqual(shadow)

    deleteDeck(STARTER_DECK.name)
    // ...and deleting it reveals the original bundled deck again, unchanged.
    expect(listDecks().find((deck) => deck.name === STARTER_DECK.name)).toEqual(STARTER_DECK)
  })
})

describe('exportDeckText / importDeckText', () => {
  it('round-trips a bundled starter deck', () => {
    const text = exportDeckText(db, STARTER_DECK)
    expect(text).toContain('# Arasaka — Embracing Power [demo]')
    expect(text).toContain('## Legends')
    expect(text).toContain('## Cards')
    expect(text).toContain('3x Mantis Blades')

    const roundTripped = importDeckText(db, text)
    expect(roundTripped).toEqual(STARTER_DECK)
  })

  it('rejects unknown card names with a helpful error', () => {
    const text = [
      '# Bad Deck',
      '## Legends',
      'Goro Takemura — Hands Unclean',
      'Yorinobu Arasaka — Embracing Destruction',
      'Saburo Arasaka — Stubborn Patriarch',
      '## Cards',
      '2x Not A Real Card',
    ].join('\n')
    expect(() => importDeckText(db, text)).toThrowError(/Not A Real Card/)
  })

  it('collects and reports every unknown/ambiguous name in one error, not just the first', () => {
    const text = [
      '# Bad Deck',
      '## Legends',
      'Not A Real Legend',
      'Yorinobu Arasaka — Embracing Destruction',
      'Saburo Arasaka — Stubborn Patriarch',
      '## Cards',
      '2x Not A Real Card One',
      '1x Not A Real Card Two',
    ].join('\n')

    let message = ''
    try {
      importDeckText(db, text)
      throw new Error('importDeckText should have thrown')
    } catch (err) {
      message = err instanceof Error ? err.message : String(err)
    }

    // All three bad names are reported together, from a single thrown error.
    expect(message).toContain('Not A Real Legend')
    expect(message).toContain('Not A Real Card One')
    expect(message).toContain('Not A Real Card Two')
  })

  it('round-trips ambiguous card names using the "Name — Subtitle" form', () => {
    const deck: DeckList = {
      name: 'Ambiguous Names Deck',
      legends: [
        'goro-takemura-hands-unclean', // "Goro Takemura" — 3 cards share this name
        'viktor-vektor-sit-down-and-relax', // "Viktor Vektor" — 3 cards share this name
        'jackie-welles-pour-one-out-for-me', // "Jackie Welles" — 3 cards share this name
      ],
      cards: {
        'v-roamer-of-the-badlands': 2, // "V" — 3 cards share this name
        'mantis-blades': 3, // unambiguous
      },
    }

    const text = exportDeckText(db, deck)
    // Ambiguous names are disambiguated with "Name — Subtitle" on export.
    expect(text).toContain('Goro Takemura — Hands Unclean')
    expect(text).toContain('Viktor Vektor — Sit Down and Relax')
    expect(text).toContain('Jackie Welles — Pour One Out For Me')
    expect(text).toContain('2x V — Roamer of the Badlands')
    // Unambiguous names stay bare.
    expect(text).toContain('3x Mantis Blades')

    expect(importDeckText(db, text)).toEqual(deck)
  })

  it('accepts a bare ambiguous name on import only when it resolves uniquely, and rejects it otherwise', () => {
    // "V" is ambiguous across 3 cards; a bare "V" legend line cannot resolve.
    const text = [
      '# Ambiguous Bare Deck',
      '## Legends',
      'V',
      'Viktor Vektor — Sit Down and Relax',
      'Jackie Welles — Pour One Out For Me',
      '## Cards',
      '3x Mantis Blades',
    ].join('\n')
    expect(() => importDeckText(db, text)).toThrowError(/ambiguous/i)
  })
})

describe('settings', () => {
  it('round-trips useOfficialImages', () => {
    expect(getSettings()).toEqual({ useOfficialImages: false })
    saveSettings({ useOfficialImages: true })
    expect(getSettings()).toEqual({ useOfficialImages: true })
  })
})

describe('game records', () => {
  it('round-trips saved game records', () => {
    // `GameRecord` is now the engine's real shape (src/engine/replay.ts), so
    // the fixture carries a real `NewGameConfig` — a starter deck on both
    // seats plus a seed. This module only persists the blob; it never replays
    // it, so the action list can stay a single token action.
    const deck = listDecks()[0]
    const record: GameRecord = {
      config: { decks: [deck, deck], seed: 1 },
      actions: [{ type: 'endTurn' }],
    }
    saveGameRecord('game-1', record)
    expect(listGameRecords()).toEqual([{ name: 'game-1', record }])
  })
})

describe('sim result', () => {
  it('round-trips the last sim result', () => {
    expect(getLastSimResult()).toBeUndefined()
    const result = { games: 100, wins: [55, 45] }
    saveSimResult(result)
    expect(getLastSimResult()).toEqual(result)
  })
})

describe('corrupt localStorage', () => {
  // Every reader goes through the same internal `readJson` helper, which
  // must fall back to its default rather than throwing when a key holds
  // non-JSON garbage (e.g. from a manual edit, a botched migration, or a
  // future format change). Exercised here through two different public
  // readers backed by two different keys/fallback shapes.
  it('getSettings falls back to the default settings when its key holds invalid JSON', () => {
    localStorage.setItem('ctcg:settings:v1', '{not valid json')
    expect(() => getSettings()).not.toThrow()
    expect(getSettings()).toEqual({ useOfficialImages: false })
  })

  it('listDecks falls back to just the bundled decks when the decks key holds invalid JSON', () => {
    localStorage.setItem('ctcg:decks:v1', '{not valid json')
    expect(() => listDecks()).not.toThrow()
    const names = listDecks().map((deck) => deck.name)
    expect(names).toContain(STARTER_DECK.name)
  })

  it('saveDeck still works normally after a prior read tolerated corrupt JSON', () => {
    localStorage.setItem('ctcg:decks:v1', 'garbage')
    listDecks() // tolerates the garbage, falling back to {}
    const deck: DeckList = {
      name: 'Recovered Deck',
      legends: [
        'goro-takemura-hands-unclean',
        'yorinobu-arasaka-embracing-destruction',
        'saburo-arasaka-stubborn-patriarch',
      ],
      cards: { 'mantis-blades': 1 },
    }
    saveDeck(deck)
    expect(listDecks().find((d) => d.name === deck.name)).toEqual(deck)
  })
})
