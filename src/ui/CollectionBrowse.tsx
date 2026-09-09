//
// Browse mode: filter rail | toolbar + grid/list | card drawer. Owns the
// filter state so the rail, the result count and the grid agree; the drawer
// replaces the old inline printings expansion so opening a card no longer
// reflows the grid. Tile footers replace the corner badge and spell out the
// two goals, so the ✓/★ legend paragraph is gone. Cards sort by collector
// number (the binder order) by default, or by name; the drawer lists only the
// printings the current filters match, with a Show-all toggle.
import { useMemo, useState, type CSSProperties, type ReactElement } from 'react'
import type { CardDb, CardDef } from '../engine/types'
import { listSets, type Printing } from './printings'
import { CardFrame, ramColorVar } from './CardFrame'
import { AddLine } from './AddLine'
import { CardDrawer } from './CardDrawer'
import { CollectionFilterRail, EMPTY_FILTERS, type CollectionFilters } from './CollectionFilterRail'
import { PrintingCount } from './PrintingCount'
import { matchesPrinting } from './collectionEntry'
import { artworkGroups, ownedArtworkIds } from './artworks'
import { getPrintingImageUrl } from './images'
import { ownedByCard, playsetTarget, useCollection, type Collection } from './collection'
import { biggestSet, compareCards, comparePrintings, type CollectionSort } from './collectionSort'

interface Rollup { def: CardDef; printings: Printing[]; matching: Printing[]; owned: number; target: number; artOwned: number; artTarget: number; playsetDone: boolean; artsDone: boolean }
function rollup(def: CardDef, prints: Printing[], collection: Collection, owned: number, matching: Printing[]): Rollup {
  const target = playsetTarget(def), artTarget = artworkGroups(prints).length, artOwned = ownedArtworkIds(prints, collection.counts).size
  return { def, printings: prints, matching, owned, target, artOwned, artTarget, playsetDone: target > 0 && owned >= target, artsDone: prints.every(p => !!p.artworkId) && artTarget > 0 && artOwned === artTarget }
}

export function CollectionBrowse({ db, printings, byCard, known, useOfficialImages, narrow }: { db: CardDb; printings: Printing[]; byCard: Map<string, Printing[]>; known: boolean; useOfficialImages: boolean; narrow: boolean }): ReactElement {
  const collection = useCollection()
  const [filters, setFilters] = useState<CollectionFilters>(EMPTY_FILTERS)
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [sort, setSort] = useState<CollectionSort>('number')
  const preferredSet = useMemo(() => biggestSet(printings), [printings])
  const setOrder = useMemo(() => listSets(printings).map(s => s.code), [printings])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [rowLimit, setRowLimit] = useState(60)
  const rarities = useMemo(() => [...new Set(printings.map(p => p.rarity))], [printings])
  const owned = useMemo(() => ownedByCard(printings, collection), [printings, collection])
  const setTotals = useMemo(() => {
    const totals: Record<string, { owned: number; total: number }> = {}
    for (const p of printings) { const t = totals[p.setCode] ?? (totals[p.setCode] = { owned: 0, total: 0 }); t.total += 1; t.owned += collection.counts[p.key] ?? 0 }
    return totals
  }, [printings, collection])

  const rollups = useMemo(() => Object.values(db)
    .filter(def => filters.colors.size === 0 || filters.colors.has(def.color))
    .filter(def => filters.types.size === 0 || filters.types.has(def.type))
    .map(def => { const prints = byCard.get(def.id) ?? []; return rollup(def, prints, collection, owned[def.id] ?? 0, prints.filter(p => matchesPrinting(def, p, filters.search.replace(/^#\s*/, ''), filters.setCode, filters.rarities)).sort((a, b) => comparePrintings(a, b, preferredSet, setOrder))) })
    .filter(r => r.matching.length > 0)
    .filter(r => filters.goal === 'missing-playset' ? !r.playsetDone && r.target > 0 : filters.goal === 'missing-arts' ? !r.artsDone : filters.goal === 'complete' ? r.playsetDone && r.artsDone : true)
    .sort((a, b) => compareCards(a, b, sort, filters.setCode, preferredSet)), [db, byCard, collection, owned, filters, sort, preferredSet, setOrder])

  const matchingRows = rollups.reduce((n, r) => n + r.matching.length, 0)
  const matchingOwned = rollups.reduce((n, r) => n + r.matching.reduce((a, p) => a + (collection.counts[p.key] ?? 0), 0), 0)
  const open = expanded !== null ? rollups.find(r => r.def.id === expanded) ?? (db[expanded] ? rollup(db[expanded], byCard.get(expanded) ?? [], collection, owned[expanded] ?? 0, []) : undefined) : undefined

  return (
    <div className={`browse${open ? ' browse--drawer' : ''}${narrow ? ' browse--narrow' : ''}`}>
      <CollectionFilterRail filters={filters} onChange={f => { setFilters(f); setRowLimit(60) }} printings={printings} rarities={rarities} setTotals={setTotals} collapsed={narrow} />
      <div className="browse__main">
        <div className="browse__toolbar">
          <fieldset disabled={!known} className="collection-editor"><AddLine db={db} printings={printings} testIdPrefix="quick-add" /></fieldset>
          <div className="browse__view">
            <span className="browse__count" data-testid="collection-scope"><b>{rollups.length}</b> cards · <b>{matchingRows}</b> printing rows · <b>{known ? matchingOwned : '?'}</b> physical copies owned</span>
            <div className="seg browse__sort" role="group" aria-label="Sort"><button type="button" data-testid="collection-sort-number" aria-pressed={sort === 'number'} onClick={() => setSort('number')}>Number</button><button type="button" data-testid="collection-sort-name" aria-pressed={sort === 'name'} onClick={() => setSort('name')}>Name</button></div>
            <div className="seg"><button type="button" aria-pressed={view === 'grid'} onClick={() => setView('grid')}>Grid</button><button type="button" data-testid="collection-compact" aria-pressed={view === 'list'} onClick={() => setView(v => v === 'list' ? 'grid' : 'list')}>List</button></div>
          </div>
        </div>
        {view === 'grid' ? (
          <div className="collection-view__grid" data-testid="collection-grid">
            {rollups.map(r => (
              <div key={r.def.id} className={`tile${expanded === r.def.id ? ' tile--open' : ''}${r.target === 0 ? ' tile--only' : ''}`} data-testid="collection-cell" data-card-id={r.def.id} style={{ '--c': ramColorVar(r.def.color) } as CSSProperties}>
                <button type="button" className="tile__hit" data-testid={`expand-${r.def.id}`} aria-expanded={expanded === r.def.id} onClick={() => setExpanded(expanded === r.def.id ? null : r.def.id)}>
                  <CardFrame def={r.def} size="zoom" useOfficialImages={useOfficialImages} imageUrl={r.matching[0] ? getPrintingImageUrl(r.matching[0].key) : undefined} />
                  <span className="tile__ring" aria-hidden="true"><i style={{ width: `${r.target ? Math.min(100, 100 * r.owned / r.target) : 0}%` }} /></span>
                  <span className="tile__own" data-testid={`collection-count-${r.def.id}`}>
                    <span className={`tile__ps${r.target === 0 ? ' tile__ps--only' : known && r.playsetDone ? ' tile__ps--done' : known && r.owned === 0 ? ' tile__ps--zero' : ''}`}>{r.target === 0 ? 'Collection only' : `${known ? r.owned : '?'}/${r.target}`}{known && r.playsetDone && <span title="Playset complete"> ✓</span>}</span>
                    <span className={`tile__art${known && r.artsDone ? ' tile__art--done' : ''}`}>{' · '}Art {known ? r.artOwned : '?'}/{r.artTarget}{known && r.artsDone && <span title="All arts owned"> ★</span>}</span>
                  </span>
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="listview" data-testid="compact-printings">
            <table className="data-table">
              <thead><tr><th></th><th>Card</th><th>Printing</th><th>Rarity</th><th>Artwork</th><th className="num">Owned</th></tr></thead>
              <tbody>{rollups.flatMap(r => r.matching.map(p => ({ r, p }))).slice(0, rowLimit).map(({ r, p }) => {
                const image = getPrintingImageUrl(p.key); const artIndex = artworkGroups(r.printings).findIndex(a => a.id === p.artworkId) + 1
                return (
                  <tr key={p.key} data-testid="compact-printing" data-printing-key={p.key} className={p.playable === false ? 'prow--only' : ''}>
                    <td>{image && <a href={image} target="_blank" rel="noreferrer"><img src={image} alt={p.collectorNumber} width={28} loading="lazy" /></a>}</td>
                    <td className="listview__name">{r.def.name}{r.def.subtitle ? ` — ${r.def.subtitle}` : ''}</td>
                    <td>{p.setName} · <b>{p.collectorNumber}</b>{p.finish && <span className="tag tag--foil">{p.finish}</span>}{p.playable === false && <span className="tag">Collection only</span>}<br /><span className="listview__key">{p.key}</span></td>
                    <td>{p.rarity}</td>
                    <td>{artIndex > 0 ? `Art ${artIndex} · ${known ? (ownedArtworkIds(r.printings, collection.counts).has(p.artworkId!) ? 'owned' : 'missing') : '?'}` : 'unreviewed'}</td>
                    <td className="num"><PrintingCount printingKey={p.key} count={collection.counts[p.key] ?? 0} known={known} /></td>
                  </tr>)
              })}</tbody>
            </table>
            {matchingRows > rowLimit && <button type="button" className="listview__more" onClick={() => setRowLimit(n => n + 60)}>Show 60 more printings</button>}
          </div>
        )}
      </div>
      {open && <CardDrawer def={open.def} printings={open.printings} visible={open.matching} preferredSet={preferredSet} setOrder={setOrder} collection={collection} known={known} onClose={() => setExpanded(null)} />}
    </div>
  )
}
