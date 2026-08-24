// The Deck Builder's right pane: the 3 legend slots, per-color RAM limit
// chips (computed live from the chosen legends), the card list grouped by
// type, every `validateDeck` error, and the deck-management controls (New /
// Save / Load / Delete / Export / Import).
//
// Design decision (docs/rulings.md §152): adding a card NEVER refuses. The
// deck is always allowed to go invalid — a 4th copy, an over-RAM card, a
// short/long deck, an unfilled legend slot — and every `validateDeck` error
// is listed live, in red. Saving an invalid deck is also allowed (a later
// task's Play/Simulate views are the ones that should only *offer* valid
// decks; this view's job is to let you build and see why something doesn't
// pass yet).

import { useEffect, useState, type CSSProperties, type ReactElement } from 'react'
import type { CardDb, CardType } from '../engine/types'
import { deckSize, validateDeck, type DeckList } from '../engine/deck'
import { exportDeckText, importDeckText } from './storage'
import { CardFrame, ramColorVar } from './CardFrame'

export interface DeckPanelProps {
  db: CardDb
  deck: DeckList
  decks: DeckList[]
  isReadOnly: boolean
  useOfficialImages: boolean
  deleteError: string | null
  onChangeDeck: (deck: DeckList) => void
  onSave: (name: string) => void
  onLoad: (name: string) => void
  onDelete: () => void
  onNew: () => void
}

const TYPE_ORDER: CardType[] = ['unit', 'program', 'gear']
const TYPE_LABELS: Record<CardType, string> = {
  legend: 'Legends',
  unit: 'Units',
  program: 'Programs',
  gear: 'Gear',
}
const RAM_COLORS = ['Red', 'Yellow', 'Green', 'Blue']

function ramLimitsByColor(db: CardDb, legends: readonly string[]): Record<string, number> {
  const limits: Record<string, number> = {}
  for (const id of legends) {
    const def = db[id]
    if (def?.ramLimit) {
      limits[def.ramLimit.color] = (limits[def.ramLimit.color] ?? 0) + def.ramLimit.value
    }
  }
  return limits
}

/** Per-color RAM demand: the highest single `ram.value` among the deck's
 * cards of that color (not a sum — one card's printed RAM cost is what has
 * to fit under the legends' pooled limit at any one time, not the total
 * across every copy/card of that color). 0 for a color with no such cards. */
function ramUsage(db: CardDb, cards: Record<string, number>): Record<string, number> {
  const usage: Record<string, number> = {}
  for (const id of Object.keys(cards)) {
    const def = db[id]
    if (def?.ram) {
      usage[def.ram.color] = Math.max(usage[def.ram.color] ?? 0, def.ram.value)
    }
  }
  return usage
}

/** Percent width for a RAM budget bar's fill, per the brief:
 * `min(100%, used/limit * 100%)`, with a `limit === 0` divide-by-zero
 * treated as "maxed out the instant there's any usage, otherwise empty". */
function ramBarFillPercent(used: number, limit: number): number {
  if (limit <= 0) return used > 0 ? 100 : 0
  return Math.min(100, (used / limit) * 100)
}

// The empty-legend-slot artifact `validateDeck` (src/engine/deck.ts) emits
// for each of the 3 legend slots while a deck is new/in-progress — engine
// code is correct to flag an empty slot as "unknown card id ''", but that
// string is meaningless to a person building a deck, so it's filtered from
// what's *displayed* here (validateDeck itself stays untouched: a later
// Play/Simulate view still needs the real, unfiltered validation result).
const EMPTY_LEGEND_SLOT_ERROR = 'Unknown card id: "".'

const MIN_DECK_SIZE = 40
const MAX_DECK_SIZE = 50
// The meter's visual scale extends a bit past MAX_DECK_SIZE so the 40-50
// legal band doesn't sit flush against the track's right edge (an
// over-sized deck should visibly overflow the band, not the whole meter).
const SIZE_METER_SCALE_MAX = 60

export function DeckPanel(props: DeckPanelProps): ReactElement {
  const {
    db,
    deck,
    decks,
    isReadOnly,
    useOfficialImages,
    deleteError,
    onChangeDeck,
    onSave,
    onLoad,
    onDelete,
    onNew,
  } = props

  const [saveName, setSaveName] = useState(deck.name)
  useEffect(() => {
    setSaveName(deck.name)
  }, [deck.name])

  const [loadName, setLoadName] = useState(decks[0]?.name ?? '')
  const [exportOpen, setExportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState<string | null>(null)

  const errors = validateDeck(db, deck)
  const displayedErrors = errors.filter((error) => error !== EMPTY_LEGEND_SLOT_ERROR)
  const size = deckSize(deck)
  const limits = ramLimitsByColor(db, deck.legends)
  const usage = ramUsage(db, deck.cards)
  const hasEmptyLegendSlot = deck.legends.some((id) => id === '')
  const sizeMeterPercent = Math.min(100, (size / SIZE_METER_SCALE_MAX) * 100)
  const bandStartPercent = (MIN_DECK_SIZE / SIZE_METER_SCALE_MAX) * 100
  const bandWidthPercent = ((MAX_DECK_SIZE - MIN_DECK_SIZE) / SIZE_METER_SCALE_MAX) * 100

  function setLegend(index: 0 | 1 | 2, id: string): void {
    const legends = [...deck.legends] as [string, string, string]
    legends[index] = id
    onChangeDeck({ ...deck, legends })
  }

  function setCount(id: string, count: number): void {
    const cards = { ...deck.cards }
    if (count <= 0) delete cards[id]
    else cards[id] = count
    onChangeDeck({ ...deck, cards })
  }

  // `exportDeckText` throws on an unknown/blank card id, which an in-progress
  // deck can easily have (an empty legend slot, mid-edit) — computed
  // defensively rather than crashing the whole panel's render.
  let exportText: { ok: true; text: string } | { ok: false; error: string }
  try {
    exportText = { ok: true, text: exportDeckText(db, deck) }
  } catch (err) {
    exportText = { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  function doImport(): void {
    try {
      const imported = importDeckText(db, importText)
      onChangeDeck(imported)
      setImportError(null)
      setImportText('')
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err))
    }
  }

  const grouped = TYPE_ORDER.map((type) => ({
    type,
    entries: Object.entries(deck.cards)
      .filter(([id]) => db[id]?.type === type)
      .sort(([a], [b]) => (db[a]?.name ?? a).localeCompare(db[b]?.name ?? b)),
  })).filter((group) => group.entries.length > 0)

  return (
    <div className="deck-panel" data-testid="deck-panel">
      <div className="deck-panel__header">
        <input
          type="text"
          data-testid="deck-name-input"
          value={deck.name}
          onChange={(event) => onChangeDeck({ ...deck, name: event.target.value })}
        />
        {deck.demo && (
          <span className="deck-panel__badge" data-testid="demo-badge">
            Demo (size limits relaxed)
          </span>
        )}
        {isReadOnly && (
          <span className="deck-panel__badge deck-panel__badge--readonly" data-testid="readonly-badge">
            Bundled — Save will create a local copy
          </span>
        )}
      </div>

      <div className="deck-panel__legends" data-testid="legend-slots">
        {[0, 1, 2].map((index) => {
          const id = deck.legends[index]
          const def = id ? db[id] : undefined
          return (
            <div
              key={index}
              className={def !== undefined ? 'deck-panel__legend-slot' : 'deck-panel__legend-slot is-empty'}
              data-testid={`legend-slot-${index}`}
              onClick={() => def !== undefined && setLegend(index as 0 | 1 | 2, '')}
            >
              {def !== undefined ? (
                <CardFrame def={def} size="small" useOfficialImages={useOfficialImages} />
              ) : (
                <div className="deck-panel__legend-slot-inner">
                  <span className="deck-panel__legend-slot-ghost" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className="deck-panel__legend-empty">Empty legend slot</span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {hasEmptyLegendSlot && (
        <p className="deck-panel__legend-hint" data-testid="legend-hint">
          Choose 3 Legends — cards unlock RAM in their colors.
        </p>
      )}

      <div className="deck-panel__ram-bars" data-testid="ram-chips">
        {RAM_COLORS.map((color) => {
          const used = usage[color] ?? 0
          const limit = limits[color] ?? 0
          const isOver = used > limit
          return (
            <div
              key={color}
              className={isOver ? 'ram-bar is-over' : 'ram-bar'}
              data-testid={`ram-bar-${color}`}
              data-used={used}
              data-limit={limit}
              style={{ '--ram-bar-color': ramColorVar(color) } as CSSProperties}
            >
              <div className="ram-bar__label">
                <span className="ram-bar__color-name">{color} RAM</span>
                <span
                  className="ram-bar__numerals chip"
                  data-testid={`ram-chip-${color}`}
                >
                  {used} / {limit}
                </span>
              </div>
              <div className="ram-bar__track">
                <div
                  className="ram-bar__fill"
                  style={{ width: `${ramBarFillPercent(used, limit)}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>

      <div className="deck-panel__size-meter-row">
        <div
          className="deck-size-meter"
          data-testid="deck-size-meter"
          data-size={size}
        >
          <div
            className="deck-size-meter__band"
            style={{ left: `${bandStartPercent}%`, width: `${bandWidthPercent}%` }}
          />
          <div className="deck-size-meter__fill" style={{ width: `${sizeMeterPercent}%` }} />
        </div>
        <div className="deck-panel__counter" data-testid="deck-size-counter">
          Cards: {size}/40–50
        </div>
      </div>

      {displayedErrors.length > 0 && (
        <ul className="deck-panel__errors" data-testid="deck-errors">
          {displayedErrors.map((error, index) => (
            <li key={index} className="deck-error">
              {error}
            </li>
          ))}
        </ul>
      )}

      <div className="deck-panel__cards" data-testid="deck-cards">
        {grouped.map((group) => (
          <div key={group.type} className="deck-panel__group">
            <h4>{TYPE_LABELS[group.type]}</h4>
            {group.entries.map(([id, count]) => {
              const def = db[id]
              return (
                <div
                  key={id}
                  className="deck-panel__row"
                  data-testid={`card-row-${id}`}
                  style={def ? ({ '--card-border-color': ramColorVar(def.color) } as CSSProperties) : undefined}
                >
                  <span className="deck-panel__row-cost" aria-hidden="true">
                    {def?.cost ?? '?'}
                  </span>
                  <span className="deck-panel__row-name">{def?.name ?? id}</span>
                  <div className="deck-panel__row-stepper">
                    <button
                      type="button"
                      data-testid={`card-row-minus-${id}`}
                      onClick={() => setCount(id, count - 1)}
                    >
                      −
                    </button>
                    <span className="deck-panel__row-count" data-testid={`card-row-count-${id}`}>
                      {count}
                    </span>
                    <button
                      type="button"
                      data-testid={`card-row-plus-${id}`}
                      onClick={() => setCount(id, count + 1)}
                    >
                      +
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <div className="deck-panel__controls">
        <button type="button" data-testid="new-deck-button" onClick={onNew}>
          New
        </button>

        <input
          type="text"
          data-testid="save-name-input"
          value={saveName}
          onChange={(event) => setSaveName(event.target.value)}
        />
        <button
          type="button"
          data-testid="save-deck-button"
          onClick={() => onSave(saveName.trim() === '' ? deck.name : saveName.trim())}
        >
          Save
        </button>

        <select
          data-testid="deck-select"
          value={loadName}
          onChange={(event) => setLoadName(event.target.value)}
        >
          {decks.map((d) => (
            <option key={d.name} value={d.name}>
              {d.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-testid="load-deck-button"
          disabled={loadName === ''}
          onClick={() => onLoad(loadName)}
        >
          Load
        </button>

        <button type="button" data-testid="delete-deck-button" onClick={onDelete}>
          Delete
        </button>
        {deleteError !== null && (
          <span className="deck-panel__delete-error" data-testid="delete-error">
            {deleteError}
          </span>
        )}
      </div>

      <div className="deck-panel__export">
        <button
          type="button"
          data-testid="export-button"
          onClick={() => setExportOpen((open) => !open)}
        >
          Export
        </button>
        {exportOpen && exportText.ok && (
          <>
            <textarea readOnly data-testid="export-textarea" value={exportText.text} />
            <button
              type="button"
              data-testid="copy-export-button"
              onClick={() => {
                if (typeof navigator !== 'undefined' && navigator.clipboard) {
                  navigator.clipboard.writeText(exportText.text).catch(() => {})
                }
              }}
            >
              Copy
            </button>
          </>
        )}
        {exportOpen && !exportText.ok && (
          <p className="deck-panel__export-error" data-testid="export-error">
            Cannot export yet: {exportText.error}
          </p>
        )}
      </div>

      <div className="deck-panel__import">
        <textarea
          data-testid="import-textarea"
          placeholder="Paste exported deck text…"
          value={importText}
          onChange={(event) => setImportText(event.target.value)}
        />
        <button type="button" data-testid="import-button" onClick={doImport}>
          Import
        </button>
        {importError !== null && (
          <p className="deck-panel__import-error" data-testid="import-error">
            {importError}
          </p>
        )}
      </div>
    </div>
  )
}
