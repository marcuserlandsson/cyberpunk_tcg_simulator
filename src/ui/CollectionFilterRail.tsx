import type { CSSProperties, ReactElement } from 'react'
import type { CardType } from '../engine/types'
import { ramColorVar } from './CardFrame'
import { listSets, type Printing } from './printings'

export type GoalFilter = 'all' | 'missing-playset' | 'missing-arts' | 'complete'
export interface CollectionFilters { search: string; goal: GoalFilter; colors: Set<string>; types: Set<CardType>; rarities: Set<string>; setCode: string }
export const EMPTY_FILTERS: CollectionFilters = { search: '', goal: 'all', colors: new Set(), types: new Set(), rarities: new Set(), setCode: '' }

const COLORS = ['Red', 'Yellow', 'Green', 'Blue'] as const
const TYPES: CardType[] = ['legend', 'unit', 'program', 'gear']
const GOALS: { id: GoalFilter; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'missing-playset', label: 'Need copies' }, { id: 'missing-arts', label: 'Need art' }, { id: 'complete', label: 'Complete' },
]
/** Rarity chips in a fixed, familiar order; anything the dataset adds that is
 *  not listed here lands at the end of the second row. */
const RARITY_ROWS: string[][] = [['Common', 'Uncommon', 'Rare', 'Epic', 'Nova Rare', 'Secret'], ['Iconic Legend', 'Iconic Other', 'Iconic Secret']]

export function slug(value: string): string { return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') }
export function activeFilterCount(f: CollectionFilters): number {
  return (f.search.trim() ? 1 : 0) + (f.goal !== 'all' ? 1 : 0) + f.colors.size + f.types.size + f.rarities.size + (f.setCode ? 1 : 0)
}
function toggled<T>(set: Set<T>, value: T): Set<T> { const next = new Set(set); if (next.has(value)) next.delete(value); else next.add(value); return next }

export function CollectionFilterRail({ filters, onChange, printings, rarities, setTotals, collapsed }: {
  filters: CollectionFilters; onChange: (next: CollectionFilters) => void; printings: Printing[]; rarities: string[]
  setTotals: Record<string, { owned: number; total: number }>; collapsed: boolean
}): ReactElement {
  const sets = listSets(printings)
  const known = new Set(RARITY_ROWS.flat())
  const rows = [RARITY_ROWS[0].filter(r => rarities.includes(r)), [...RARITY_ROWS[1].filter(r => rarities.includes(r)), ...rarities.filter(r => !known.has(r))]]
  const allOwned = Object.values(setTotals).reduce((n, s) => n + s.owned, 0)

  const clear = (id: string, patch: Partial<CollectionFilters>, active: boolean) => active
    ? <button type="button" className="rail__clear" data-testid={`clear-${id}`} onClick={() => onChange({ ...filters, ...patch })}>clear</button> : null

  const groups = (
    <>
      <div className="rail__group">
        <input type="search" data-testid="collection-search" aria-label="Search cards or printing numbers" value={filters.search} placeholder="Search name, subtitle, #number, artist…" onChange={e => onChange({ ...filters, search: e.target.value })} />
      </div>
      <div className="rail__group"><h4>Goal</h4>
        <div className="seg seg--goal">{GOALS.map(g => <button type="button" key={g.id} data-testid={`goal-filter-${g.id}`} aria-pressed={filters.goal === g.id} onClick={() => onChange({ ...filters, goal: g.id })}>{g.label}</button>)}</div>
      </div>
      <div className="rail__group"><h4>Color {clear('colors', { colors: new Set() }, filters.colors.size > 0)}</h4>
        <div className="card-browser__chips">{COLORS.map(c => <button type="button" key={c} data-testid={`collection-color-${c}`} aria-pressed={filters.colors.has(c)} className="filter-chip filter-chip--ram" style={{ '--ram-chip-color': ramColorVar(c) } as CSSProperties} onClick={() => onChange({ ...filters, colors: toggled(filters.colors, c) })}><span className="filter-chip__swatch" aria-hidden="true" />{c}</button>)}</div>
      </div>
      <div className="rail__group"><h4>Type {clear('types', { types: new Set() }, filters.types.size > 0)}</h4>
        <div className="card-browser__chips">{TYPES.map(t => <button type="button" key={t} data-testid={`collection-type-${t}`} aria-pressed={filters.types.has(t)} className="filter-chip" onClick={() => onChange({ ...filters, types: toggled(filters.types, t) })}>{t}</button>)}</div>
      </div>
      <div className="rail__group"><h4>Rarity {clear('rarities', { rarities: new Set() }, filters.rarities.size > 0)}</h4>
        {rows.map((row, i) => <div className="card-browser__chips" key={i}>{row.map(r => <button type="button" key={r} data-testid={`rarity-filter-${slug(r)}`} aria-pressed={filters.rarities.has(r)} className="filter-chip" onClick={() => onChange({ ...filters, rarities: toggled(filters.rarities, r) })}>{r}</button>)}</div>)}
      </div>
      <div className="rail__group"><h4>Set {clear('set', { setCode: '' }, filters.setCode !== '')}</h4>
        <div className="rail__sets" data-testid="set-filter" role="listbox">
          <button type="button" role="option" className="setrow" data-testid="set-filter-all" aria-selected={filters.setCode === ''} onClick={() => onChange({ ...filters, setCode: '' })}><span>All sets</span><span className="setrow__n">{allOwned} / {printings.length}</span></button>
          {sets.map(s => { const t = setTotals[s.code] ?? { owned: 0, total: 0 }; return (
            <button type="button" role="option" key={s.code} className="setrow" data-testid={`set-filter-${s.code}`} aria-selected={filters.setCode === s.code} onClick={() => onChange({ ...filters, setCode: s.code })}>
              <span>{s.name}</span><span className="setrow__n">{t.owned} / {t.total}</span>
              <span className="setrow__bar"><i style={{ width: `${t.total ? Math.min(100, Math.round(100 * t.owned / t.total)) : 0}%` }} /></span>
            </button>) })}
        </div>
      </div>
      <p className="rail__foot" data-testid="collection-legend">Goal and totals always cover the whole collection. Set, rarity and search narrow which printings are shown.</p>
    </>
  )

  if (collapsed) {
    const n = activeFilterCount(filters)
    return <details className="tool-panel rail rail--collapsed" data-testid="filter-rail"><summary>Filters<span className="tool-panel__meta">{n} active</span></summary><div className="tool-panel__body rail__body">{groups}</div></details>
  }
  return <aside className="rail" data-testid="filter-rail" aria-label="Filters">{groups}</aside>
}
