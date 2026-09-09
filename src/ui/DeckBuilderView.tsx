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
import { deckFormat, type DeckList } from '../engine/deck'
import { listDeckVersions, saveDeckVersion } from './deckVersions'
import { isDeckPickable } from './deckPicker'
import { DeckDiagnostics } from './DeckDiagnostics'
import { CardBrowser, isArtOnlyPromo } from './CardBrowser'
import { DeckPanel } from './DeckPanel'
import { CardFrame } from './CardFrame'
import { deleteDeck, isReadOnlyDeck, listDecks, buildDisplayNames, useDecks } from './storage'
import { ownershipAvailable, useSyncStatus } from './collectionSync'
import { useCollection, ownedByCard } from './collection'
import { loadPrintings } from './printings'

export interface DeckBuilderViewProps {
  db: CardDb
  useOfficialImages: boolean
  onPlayDeck?: (name: string) => void
}

function blankDeck(): DeckList {
  return { name: 'New Deck', legends: ['', '', ''], cards: {}, format: 'constructed' }
}

export function DeckBuilderView({ db, useOfficialImages, onPlayDeck }: DeckBuilderViewProps): ReactElement {
  const [deck, setDeck] = useState<DeckList>(blankDeck)
  const decks = useDecks()
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [zoomId, setZoomId] = useState<string | null>(null)

  const isReadOnly = isReadOnlyDeck(deck.name)

  // Ownership is informational only (docs/rulings.md §152's "invalid decks
  // may exist and be saved" philosophy extends to unaffordable ones too) —
  // never blocks an add, never touches validateDeck.
  const collection = useCollection()
  const syncStatus = useSyncStatus()
  const printings = useMemo(() => {
    try {
      return loadPrintings()
    } catch {
      return []
    }
  }, [])
  // Shared with the Collection tab's tile badge (collection.ts's ownedByCard)
  // so the two badges are the same number by construction, not by agreement.
  const owned = useMemo(() => ownedByCard(printings, collection), [printings, collection])
  const ownershipKnown = printings.length > 0 && ownershipAvailable(syncStatus)

  const missing = useMemo(() => {
    const shortfalls: { id: string; missing: number }[] = []
    for (const [id, count] of Object.entries(deck.cards)) {
      const short = Math.max(0, count - (owned[id] ?? 0))
      if (short > 0) shortfalls.push({ id, missing: short })
    }
    for (const id of deck.legends) {
      if (id !== '' && (owned[id] ?? 0) === 0) shortfalls.push({ id, missing: 1 })
    }
    return shortfalls
  }, [deck, owned])

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
    try { setDeck(saveDeckVersion(toSave)); setDeleteError(null) } catch (error) { setDeleteError(`Save failed; the edited deck is still here. ${String(error)}`) }
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
  const missingTotal = missing.reduce((sum, m) => sum + m.missing, 0)

  // `.deck-builder` is strictly the two-pane row and nothing else: its flex
  // rule predates this feature (and the two density passes that closed the
  // 1366x768 board overflow), so the missing-cards strip gets its own row
  // from this column wrapper rather than by teaching that row to wrap.
  return (
    <div className="deck-builder-view">
      <div className="panel">
        {onPlayDeck && <button data-testid="play-this-deck" disabled={!isDeckPickable(db, deck)} onClick={() => { try { const saved = saveDeckVersion(deck); setDeck(saved); setDeleteError(null); onPlayDeck(saved.name) } catch (error) { setDeleteError(String(error)) } }}>Save and play this deck</button>}
        <details data-testid="deck-versions"><summary>Saved versions of {deck.name}</summary>{(() => { try { return listDeckVersions(deck.name).map(version => <button key={version.revisionId} onClick={() => setDeck(structuredClone(version))}>{version.versionLabel || 'Untitled version'} · {version.updatedAt} · Restore in editor</button>) } catch { return <p>Version history cannot be read.</p> } })()}</details>
      </div>
      <div className="deck-builder" data-testid="deck-builder">
        <CardBrowser pool={deckFormat(deck)==="sealed"?deck.sealedPool:undefined} ignoreRam={deckFormat(deck)==="sealed"}
          db={db}
          useOfficialImages={useOfficialImages}
          counts={deck.cards}
          legends={deck.legends}
          owned={ownershipKnown ? owned : undefined}
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
      </div>
      <DeckDiagnostics db={db} deck={deck} useOfficialImages={useOfficialImages} />
      <div className="deck-missing" data-testid="deck-missing-summary">
        {!ownershipKnown ? 'Ownership unavailable — collection has not been loaded.' : missing.length === 0
          ? 'You own all cards for this deck'
          : `Missing ${missingTotal} card${missingTotal === 1 ? '' : 's'} for this deck`}
        {ownershipKnown && missing.length > 0 && (
          <button
            type="button"
            data-testid="copy-deck-buylist"
            onClick={() => {
              const names = buildDisplayNames(db)
              const text = missing.map((m) => `${m.missing}x ${names.get(m.id) ?? m.id}`).join('\n')
              if (typeof navigator !== 'undefined' && navigator.clipboard) {
                navigator.clipboard.writeText(text).catch(() => {})
              }
            }}
          >
            Copy buy-list
          </button>
        )}
      </div>
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
