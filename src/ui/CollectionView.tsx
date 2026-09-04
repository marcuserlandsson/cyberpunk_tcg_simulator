// The Collection tab: every card in the pool as a tile (CardFrame + owned/
// target badge), expandable into per-printing rows with +/− steppers.
// Filters mirror CardBrowser's chip pattern, plus rarity/set/goal filters
// that only make sense here. The header strip (stats/buy-list/export) and
// the quick-add bar are separate components slotted in above the grid
// (Tasks 8 and 9); this file owns the grid and filter state.

import { useMemo, useState, type CSSProperties, type ReactElement } from 'react'
import type { CardDb, CardDef, CardType } from '../engine/types'
import { CardFrame, ramColorVar } from './CardFrame'
import {
  loadPrintings,
  printingsByCard,
  listSets,
  type Printing,
} from './printings'
import { getPrintingImageUrl } from './images'
import { useCollection, adjustCount, getStorageError, playsetTarget, type Collection } from './collection'
import { QuickAddBar } from './QuickAddBar'
import { CollectionHeader } from './CollectionHeader'

const COLORS = ['Red', 'Yellow', 'Green', 'Blue'] as const
const TYPES: CardType[] = ['legend', 'unit', 'program', 'gear']
type GoalFilter = 'all' | 'missing-playset' | 'missing-arts' | 'complete'
const GOALS: { id: GoalFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'missing-playset', label: 'Missing for playset' },
  { id: 'missing-arts', label: 'Missing arts' },
  { id: 'complete', label: 'Complete' },
]

interface CardRollup {
  def: CardDef
  printings: Printing[]
  owned: number
  target: number
  playsetDone: boolean
  artsDone: boolean
}

function rollup(def: CardDef, prints: Printing[], collection: Collection): CardRollup {
  const owned = prints.reduce((sum, p) => sum + (collection.counts[p.key] ?? 0), 0)
  const target = playsetTarget(def)
  return {
    def,
    printings: prints,
    owned,
    target,
    playsetDone: owned >= target,
    artsDone: prints.every((p) => (collection.counts[p.key] ?? 0) > 0),
  }
}

export function CollectionView({
  db,
  useOfficialImages,
}: {
  db: CardDb
  useOfficialImages: boolean
}): ReactElement {
  const collection = useCollection()

  const loadResult = useMemo(() => {
    try {
      const printings = loadPrintings()
      return { printings, byCard: printingsByCard(printings), error: undefined }
    } catch (err) {
      return { printings: [] as Printing[], byCard: new Map<string, Printing[]>(), error: String(err) }
    }
  }, [])

  const [colors, setColors] = useState<Set<string>>(new Set())
  const [types, setTypes] = useState<Set<CardType>>(new Set())
  const [rarities, setRarities] = useState<Set<string>>(new Set())
  const [setCode, setSetCode] = useState('')
  const [goal, setGoal] = useState<GoalFilter>('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  const allRarities = useMemo(
    () => [...new Set(loadResult.printings.map((p) => p.rarity))],
    [loadResult]
  )
  const sets = useMemo(() => listSets(loadResult.printings), [loadResult])

  const rollups = useMemo(() => {
    return Object.values(db)
      .map((def) => rollup(def, loadResult.byCard.get(def.id) ?? [], collection))
      .filter((r) => colors.size === 0 || colors.has(r.def.color))
      .filter((r) => types.size === 0 || types.has(r.def.type))
      .filter((r) => rarities.size === 0 || r.printings.some((p) => rarities.has(p.rarity)))
      .filter((r) => setCode === '' || r.printings.some((p) => p.setCode === setCode))
      .filter((r) => {
        if (goal === 'missing-playset') return !r.playsetDone
        if (goal === 'missing-arts') return !r.artsDone
        if (goal === 'complete') return r.playsetDone && r.artsDone
        return true
      })
      .sort((a, b) => a.def.name.localeCompare(b.def.name))
  }, [db, loadResult, collection, colors, types, rarities, setCode, goal])

  if (loadResult.error !== undefined) {
    return <div data-testid="collection-error">Collection unavailable: {loadResult.error}</div>
  }

  function toggle<T>(set: Set<T>, value: T, setter: (next: Set<T>) => void): void {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    setter(next)
  }

  return (
    <div className="collection-view" data-testid="collection-view">
      {/* useCollection above re-renders this component on every collection
          write, so a failed write's error appears (and clears) live. */}
      {getStorageError() !== '' && (
        <div className="collection-view__storage-error" data-testid="collection-storage-error">
          {getStorageError()}
        </div>
      )}
      <CollectionHeader db={db} printings={loadResult.printings} />
      <QuickAddBar db={db} printings={loadResult.printings} />

      <div className="collection-view__filters">
        <div className="card-browser__chips">
          {COLORS.map((color) => (
            <button type="button" key={color} data-testid={`collection-color-${color}`}
              aria-pressed={colors.has(color)} className="filter-chip filter-chip--ram"
              style={{ '--ram-chip-color': ramColorVar(color) } as CSSProperties}
              onClick={() => toggle(colors, color, setColors)}>
              <span className="filter-chip__swatch" aria-hidden="true" />
              {color}
            </button>
          ))}
          {TYPES.map((type) => (
            <button type="button" key={type} data-testid={`collection-type-${type}`}
              aria-pressed={types.has(type)} className="filter-chip"
              onClick={() => toggle(types, type, setTypes)}>
              {type}
            </button>
          ))}
          {allRarities.map((rarity) => (
            <button type="button" key={rarity} data-testid={`rarity-filter-${rarity}`}
              aria-pressed={rarities.has(rarity)} className="filter-chip"
              onClick={() => toggle(rarities, rarity, setRarities)}>
              {rarity}
            </button>
          ))}
          {GOALS.map((g) => (
            <button type="button" key={g.id} data-testid={`goal-filter-${g.id}`}
              aria-pressed={goal === g.id} className="filter-chip"
              onClick={() => setGoal(g.id)}>
              {g.label}
            </button>
          ))}
          <select data-testid="set-filter" value={setCode}
            onChange={(e) => setSetCode(e.target.value)}>
            <option value="">All sets</option>
            {sets.map((s) => (
              <option key={s.code} value={s.code}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="collection-view__grid" data-testid="collection-grid">
        {rollups.map((r) => (
          <div key={r.def.id} className="collection-view__cell" data-testid="collection-cell"
            data-card-id={r.def.id}>
            <CardFrame def={r.def} size="zoom" useOfficialImages={useOfficialImages}
              onClick={() => setExpanded(expanded === r.def.id ? null : r.def.id)} />
            <span className="collection-view__count" data-testid={`collection-count-${r.def.id}`}>
              {r.owned}/{r.target}
              {r.playsetDone && <span title="Playset complete"> ✓</span>}
              {r.artsDone && <span title="All arts owned"> ★</span>}
            </span>
            <button type="button" className="collection-view__expand"
              data-testid={`expand-${r.def.id}`}
              onClick={() => setExpanded(expanded === r.def.id ? null : r.def.id)}>
              printings
            </button>
            {expanded === r.def.id && (
              <div className="collection-view__printings">
                {r.printings.map((p) => {
                  const count = collection.counts[p.key] ?? 0
                  const imageUrl = getPrintingImageUrl(p.key)
                  return (
                    <div key={p.key} className="collection-view__printing-row"
                      data-testid={`printing-row-${p.key}`}>
                      {imageUrl !== undefined && <img src={imageUrl} alt="" width={40} />}
                      <span>{p.setName} · {p.collectorNumber} · {p.rarity}{p.finish ? ` · ${p.finish}` : ''}</span>
                      <span className="collection-view__stepper">
                        <button type="button" data-testid={`printing-dec-${p.key}`}
                          disabled={count === 0}
                          onClick={() => adjustCount(p.key, -1)}>
                          −
                        </button>
                        <span>{count}</span>
                        <button type="button" data-testid={`printing-inc-${p.key}`}
                          onClick={() => adjustCount(p.key, 1)}>
                          +
                        </button>
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
