// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listDecks, exportDeckText, importDeckText } from '../../src/ui/storage'
import { listDeckVersions, saveDeckVersion } from '../../src/ui/deckVersions'
import { loadCardDb } from '../../src/engine/cardDb'
import { validateDeck, deckFormat } from '../../src/engine/deck'
import { isDeckPickable } from '../../src/ui/deckPicker'
const db=loadCardDb()
// These cases are about a deck that carries the `demo` flag, so they name the
// bundled demo deck rather than taking `listDecks()[0]` — the bundled list
// also holds the constructed-legal 43-card starter decks, and its order is a
// presentation choice, not a contract.
const DEMO_DECK_NAME='Arasaka — Embracing Power'
const demoDeck=()=>{const deck=listDecks().find(d=>d.name===DEMO_DECK_NAME);if(!deck)throw new Error(`missing bundled deck ${DEMO_DECK_NAME}`);return deck}
beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())
describe('deck formats and versions', () => {
  it('explicit constructed overrides an inherited demo flag in validation and pickers', () => {
    const deck = { ...demoDeck(), format: 'constructed' as const }
    expect(deck.demo).toBe(true)
    expect(deckFormat(deck)).toBe('constructed')
    expect(validateDeck(db,deck).join()).toContain('minimum is 40')
    expect(isDeckPickable(db,deck)).toBe(false)
  })
  it('retains immutable prior snapshots and exports notes/format/version metadata', () => {
    const first = saveDeckVersion({ ...demoDeck(), notes: 'Original\nplan', versionLabel:'v1', format:'demo' })
    const second = saveDeckVersion({ ...first, notes:'Revised', versionLabel:'v2', cards:{...first.cards,'mantis-blades':2} })
    expect(listDeckVersions(first.name)).toHaveLength(3)
    expect(listDeckVersions(first.name).find(d=>d.revisionId===first.revisionId)?.notes).toBe('Original\nplan')
    expect(second.revisionId).not.toBe(first.revisionId)
    expect(importDeckText(db,exportDeckText(db,second))).toEqual(second)
  })
  it('does not overwrite the active deck if archiving a new version fails', () => {
    const first=saveDeckVersion(demoDeck())
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('Quota')})
    expect(()=>saveDeckVersion({...first,notes:'Unsaved'})).toThrow('Quota')
    expect(demoDeck().notes).not.toBe('Unsaved')
    expect(listDeckVersions(first.name).find(d=>d.revisionId===first.revisionId)).toEqual(first)
  })
})
