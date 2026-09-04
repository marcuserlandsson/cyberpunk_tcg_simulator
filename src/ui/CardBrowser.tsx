// The Deck Builder's left pane: search + filter chips over the whole card
// pool, sorted into a grid of small CardFrames. Clicking a card adds it to
// the deck (a legend into the next empty slot, anything else as +1 copy);
// the per-cell "-"/zoom buttons handle everything a bare click can't. Pure
// presentational component — all deck mutation happens in the caller
// (DeckBuilderView), which is also why `counts`/`legends` are read-only
// inputs rather than state here.

import { useMemo, useState, type CSSProperties, type ReactElement } from 'react'
import type { CardDb, CardDef, CardType } from '../engine/types'
import { CardFrame, ramColorVar } from './CardFrame'
import { playsetTarget } from './collection'

export interface CardBrowserProps {
  db: CardDb
  useOfficialImages: boolean
  /** Current copy count per non-legend card id, for the count badge. */
  counts: Record<string, number>
  /** The deck's 3 legend slots (possibly `''` for an empty slot), so a
   * legend already chosen can be shown as such. */
  legends: readonly [string, string, string]
  /** Card id -> copies owned (any printing), from `collection.ts`'s shared
   *  `ownedByCard`. Optional so this stays a pure presentational component
   *  usable without the collection feature at all; absent = badge hidden.
   *  `DeckBuilderView` is its only caller today, and does pass it. */
  owned?: Record<string, number>
  onAdd: (id: string) => void
  onRemove: (id: string) => void
  onZoom: (id: string) => void
}

const COLORS = ['Red', 'Yellow', 'Green', 'Blue'] as const
const TYPES: CardType[] = ['legend', 'unit', 'program', 'gear']
// The brief's "mechanical keyword" filter chips — the four printed timing/
// ability keywords in the `Keyword` union, as opposed to the many inert
// faction/role tags that also live in `keywords`.
const MECHANICAL_KEYWORDS = ['adrenaline', 'quick', 'blocker', 'go-solo'] as const

/** "This Unit is an art-only promo (no printed ramLimit or rules text)". */
export function isArtOnlyPromo(def: CardDef): boolean {
  return def.type === 'legend' && def.ramLimit === null && def.text === ''
}

function colorSortRank(color: string): number {
  const index = COLORS.indexOf(color as (typeof COLORS)[number])
  return index === -1 ? COLORS.length : index
}

function compareCards(a: CardDef, b: CardDef): number {
  const colorDiff = colorSortRank(a.color) - colorSortRank(b.color)
  if (colorDiff !== 0) return colorDiff
  const costDiff = a.cost - b.cost
  if (costDiff !== 0) return costDiff
  return a.name.localeCompare(b.name)
}

function matchesSearch(def: CardDef, query: string): boolean {
  if (query === '') return true
  const needle = query.toLowerCase()
  return def.name.toLowerCase().includes(needle) || def.text.toLowerCase().includes(needle)
}

export function CardBrowser(props: CardBrowserProps): ReactElement {
  const { db, useOfficialImages, counts, legends, owned, onAdd, onRemove, onZoom } = props

  const [search, setSearch] = useState('')
  const [colors, setColors] = useState<Set<string>>(new Set())
  const [types, setTypes] = useState<Set<CardType>>(new Set())
  const [keywords, setKeywords] = useState<Set<string>>(new Set())
  const [costMin, setCostMin] = useState('')
  const [costMax, setCostMax] = useState('')

  function toggle<T>(set: Set<T>, value: T, setter: (next: Set<T>) => void): void {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    setter(next)
  }

  const cards = useMemo(() => {
    const min = costMin.trim() === '' ? -Infinity : Number(costMin)
    const max = costMax.trim() === '' ? Infinity : Number(costMax)
    return Object.values(db)
      .filter((def) => matchesSearch(def, search))
      .filter((def) => colors.size === 0 || colors.has(def.color))
      .filter((def) => types.size === 0 || types.has(def.type))
      .filter((def) => keywords.size === 0 || def.keywords.some((k) => keywords.has(k)))
      .filter((def) => Number.isFinite(min) === false || def.cost >= min)
      .filter((def) => Number.isFinite(max) === false || def.cost <= max)
      .sort(compareCards)
  }, [db, search, colors, types, keywords, costMin, costMax])

  return (
    <div className="card-browser" data-testid="card-browser">
      <div className="card-browser__filters">
        <input
          type="text"
          data-testid="search-input"
          placeholder="Search name or text…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="card-browser__chips" data-testid="color-filters">
          {COLORS.map((color) => (
            <button
              type="button"
              key={color}
              data-testid={`filter-color-${color}`}
              aria-pressed={colors.has(color)}
              className="filter-chip filter-chip--ram"
              style={{ '--ram-chip-color': ramColorVar(color) } as CSSProperties}
              onClick={() => toggle(colors, color, setColors)}
            >
              <span className="filter-chip__swatch" aria-hidden="true" />
              {color}
            </button>
          ))}
        </div>
        <div className="card-browser__chips" data-testid="type-filters">
          {TYPES.map((type) => (
            <button
              type="button"
              key={type}
              data-testid={`filter-type-${type}`}
              aria-pressed={types.has(type)}
              className="filter-chip"
              onClick={() => toggle(types, type, setTypes)}
            >
              {type}
            </button>
          ))}
        </div>
        <div className="card-browser__chips" data-testid="keyword-filters">
          {MECHANICAL_KEYWORDS.map((keyword) => (
            <button
              type="button"
              key={keyword}
              data-testid={`filter-keyword-${keyword}`}
              aria-pressed={keywords.has(keyword)}
              className="filter-chip"
              onClick={() => toggle(keywords, keyword, setKeywords)}
            >
              {keyword}
            </button>
          ))}
        </div>
        <label className="card-browser__cost-range">
          Cost
          <input
            type="number"
            data-testid="cost-min"
            placeholder="min"
            value={costMin}
            onChange={(event) => setCostMin(event.target.value)}
          />
          <input
            type="number"
            data-testid="cost-max"
            placeholder="max"
            value={costMax}
            onChange={(event) => setCostMax(event.target.value)}
          />
        </label>
      </div>

      <div className="card-browser__grid" data-testid="card-browser-grid">
        {cards.map((def) => {
          const disabled = isArtOnlyPromo(def)
          const count = def.type === 'legend' ? (legends.includes(def.id) ? 1 : 0) : counts[def.id] ?? 0
          return (
            <div
              key={def.id}
              className={disabled ? 'card-browser__cell disabled' : 'card-browser__cell'}
              data-testid="browser-cell"
              data-card-id={def.id}
              title={disabled ? 'Art-only promo — no printed ramLimit or rules text; cannot be included in a deck.' : undefined}
            >
              <CardFrame
                def={def}
                size="zoom"
                useOfficialImages={useOfficialImages}
                onClick={disabled ? undefined : () => onAdd(def.id)}
              />
              {count > 0 && (
                <span className="card-browser__count" data-testid={`browser-count-${def.id}`}>
                  x{count}
                </span>
              )}
              {owned !== undefined && (
                <span className="card-browser__owned" data-testid={`owned-${def.id}`}>
                  owned {owned[def.id] ?? 0}/{playsetTarget(def)}
                </span>
              )}
              <div className="card-browser__overlay">
                <button
                  type="button"
                  data-testid={`add-${def.id}`}
                  disabled={disabled}
                  onClick={() => onAdd(def.id)}
                >
                  +
                </button>
                <button
                  type="button"
                  data-testid={`remove-${def.id}`}
                  disabled={disabled || count === 0}
                  onClick={() => onRemove(def.id)}
                >
                  −
                </button>
                <button type="button" data-testid={`zoom-${def.id}`} onClick={() => onZoom(def.id)}>
                  🔍
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
