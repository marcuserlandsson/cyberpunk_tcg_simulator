// Task 14: the Deck Builder view. Left pane browses the whole card pool
// (`CardBrowser`); right pane is the deck under construction (`DeckPanel`).
// This component owns the one piece of state both panes share — the
// `DeckList` being edited — plus the deck library (`listDecks()`) and the
// optional zoom overlay.
//
// See docs/rulings.md §152 for the two policy decisions made here:
//   * adds are never refused — an invalid deck is allowed to exist and is
//     shown with its `validateDeck` errors live, and CAN be saved;
//   * editing a bundled starter deck and hitting Save forks a local copy
//     under the same name (storage.ts's ordinary "a save shadows a starter
//     by name" behavior) rather than mutating anything checked into the repo.

import { useMemo, useState, type ReactElement } from 'react'
import type { CardDb } from '../engine/types'
import type { DeckList } from '../engine/deck'
import { CardBrowser, isArtOnlyPromo } from './CardBrowser'
import { DeckPanel } from './DeckPanel'
import { CardFrame } from './CardFrame'
import { deleteDeck, isReadOnlyDeck, listDecks, saveDeck } from './storage'

export interface DeckBuilderViewProps {
  db: CardDb
  useOfficialImages: boolean
}

function blankDeck(): DeckList {
  return { name: 'New Deck', legends: ['', '', ''], cards: {} }
}

export function DeckBuilderView({ db, useOfficialImages }: DeckBuilderViewProps): ReactElement {
  const [deck, setDeck] = useState<DeckList>(blankDeck)
  const [decks, setDecks] = useState<DeckList[]>(() => listDecks())
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [zoomId, setZoomId] = useState<string | null>(null)

  const isReadOnly = isReadOnlyDeck(deck.name)

  function handleAdd(id: string): void {
    const def = db[id]
    if (def === undefined || isArtOnlyPromo(def)) return
    if (def.type === 'legend') {
      if (deck.legends.includes(id)) return
      const index = deck.legends.findIndex((slot) => slot === '')
      if (index === -1) return // all 3 slots filled; clear one first
      const legends = [...deck.legends] as [string, string, string]
      legends[index] = id
      setDeck({ ...deck, legends })
      return
    }
    const cards = { ...deck.cards }
    cards[id] = (cards[id] ?? 0) + 1
    setDeck({ ...deck, cards })
  }

  function handleRemove(id: string): void {
    const def = db[id]
    if (def === undefined) return
    if (def.type === 'legend') {
      const legends = deck.legends.map((slot) => (slot === id ? '' : slot)) as [
        string,
        string,
        string,
      ]
      setDeck({ ...deck, legends })
      return
    }
    const cards = { ...deck.cards }
    const current = cards[id] ?? 0
    if (current <= 1) delete cards[id]
    else cards[id] = current - 1
    setDeck({ ...deck, cards })
  }

  function handleNew(): void {
    setDeck(blankDeck())
    setDeleteError(null)
  }

  function handleSave(name: string): void {
    const toSave: DeckList = { ...deck, name }
    saveDeck(toSave)
    setDecks(listDecks())
    setDeck(toSave)
    setDeleteError(null)
  }

  function handleLoad(name: string): void {
    const found = decks.find((candidate) => candidate.name === name)
    if (found !== undefined) setDeck(found)
    setDeleteError(null)
  }

  function handleDelete(): void {
    try {
      deleteDeck(deck.name)
      const refreshed = listDecks()
      setDecks(refreshed)
      // Deleting a local override that shadowed a bundled starter reveals
      // the bundled deck again under the same name; reflect that in the
      // editor rather than leaving it pointed at a name that no longer has
      // a saved local copy.
      const revealed = refreshed.find((candidate) => candidate.name === deck.name)
      if (revealed !== undefined) setDeck(revealed)
      setDeleteError(null)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err))
    }
  }

  const zoomDef = useMemo(() => (zoomId === null ? undefined : db[zoomId]), [db, zoomId])

  return (
    <div className="deck-builder" data-testid="deck-builder">
      <CardBrowser
        db={db}
        useOfficialImages={useOfficialImages}
        counts={deck.cards}
        legends={deck.legends}
        onAdd={handleAdd}
        onRemove={handleRemove}
        onZoom={setZoomId}
      />
      <DeckPanel
        db={db}
        deck={deck}
        decks={decks}
        isReadOnly={isReadOnly}
        useOfficialImages={useOfficialImages}
        deleteError={deleteError}
        onChangeDeck={setDeck}
        onSave={handleSave}
        onLoad={handleLoad}
        onDelete={handleDelete}
        onNew={handleNew}
      />
      {zoomDef !== undefined && (
        <div className="deck-builder__zoom" data-testid="zoom-panel">
          <button type="button" data-testid="zoom-close" onClick={() => setZoomId(null)}>
            Close
          </button>
          <CardFrame def={zoomDef} size="zoom" useOfficialImages={useOfficialImages} />
        </div>
      )}
    </div>
  )
}
