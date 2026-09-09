//
// One card, opened from a Browse tile: its two goals as figures, then its
// printings grouped by artwork with +/− steppers. The steppers are the one
// direct-edit path left in the app (everything else stages into a session):
// a correction to a count you are looking at should not need a review step.
// Only the exact printing's image is shown — substituting base art would
// misidentify alternate illustrations.
//
// The rows follow the Browse filters (`visible`): with a set chosen, only
// that set's printings are listed, with a one-line note and a "Show all"
// toggle. The two goal figures always cover every printing — a set filter
// narrows what you look at, never what you own.
import { useState, type CSSProperties, type ReactElement } from 'react'
import type { CardDef } from '../engine/types'
import type { Printing } from './printings'
import { adjustCount, playsetTarget, type Collection } from './collection'
import { artworkGroups, ownedArtworkIds } from './artworks'
import { getPrintingImageUrl } from './images'
import { ramColorVar } from './CardFrame'
import { PrintingCount } from './PrintingCount'
import { comparePrintings } from './collectionSort'

export function CardDrawer({ def, printings, visible, preferredSet = '', setOrder = [], collection, known, onClose }: {
  def: CardDef; printings: Printing[]; visible?: Printing[]; preferredSet?: string; setOrder?: readonly string[]
  collection: Collection; known: boolean; onClose: () => void
}): ReactElement {
  const [showAll, setShowAll] = useState(false)
  const target = playsetTarget(def)
  const owned = printings.filter(p => p.playable !== false).reduce((n, p) => n + (collection.counts[p.key] ?? 0), 0)
  const groups = artworkGroups(printings)
  const ownedArts = ownedArtworkIds(printings, collection.counts)
  const unreviewed = printings.filter(p => !p.artworkId)
  const filtered = visible !== undefined && visible.length > 0 && visible.length < printings.length
  const shownKeys = new Set((filtered && !showAll ? visible : printings).map(p => p.key))
  const order = (list: Printing[]) => [...list].filter(p => shownKeys.has(p.key)).sort((a, b) => comparePrintings(a, b, preferredSet, setOrder))
  const sections = [
    ...groups.map((g, i) => ({ title: `Artwork ${i + 1}${g.printings[0].artist ? ` · ${g.printings[0].artist}` : ''}`, status: ownedArts.has(g.id) ? 'owned' as const : 'missing' as const, printings: order(g.printings) })),
    ...(unreviewed.length ? [{ title: 'Artwork identity awaiting review', status: undefined, printings: order(unreviewed) }] : []),
  ].filter(s => s.printings.length > 0)
  const artDone = groups.length > 0 && unreviewed.length === 0 && ownedArts.size === groups.length
  return (
    <aside className="drawer" data-testid="card-drawer" aria-label="Card printings" style={{ '--c': ramColorVar(def.color) } as CSSProperties}>
      <div className="drawer__head">
        <h3>{def.name}{def.subtitle && <span className="drawer__sub">{def.subtitle}</span>}</h3>
        <button type="button" className="drawer__close" data-testid="drawer-close" aria-label="Close" onClick={onClose}>✕ close</button>
      </div>
      <div className="drawer__body">
        <div className="drawer__goals">
          <div className={`goal${known && target > 0 && owned >= target ? ' goal--done' : ''}`} data-testid="drawer-playset"><span className="goal__k">Playset</span><span className="goal__v">{target === 0 ? 'Collection only' : `${known ? owned : '?'} / ${target}`}<small>{def.type === 'legend' ? 'Legend · 1 copy' : 'any playable printing'}</small></span></div>
          <div className={`goal goal--art${known && artDone ? ' goal--done' : ''}`} data-testid="drawer-artworks"><span className="goal__k">Artworks</span><span className="goal__v">{known ? ownedArts.size : '?'} / {groups.length}<small>{unreviewed.length ? `${unreviewed.length} awaiting review` : 'any printing'}</small></span></div>
        </div>
        {filtered && (
          <div className="drawer__filter" data-testid="drawer-filter">
            <span>{showAll ? `All ${printings.length} printings` : `${visible!.length} of ${printings.length} printings match the current filters`}</span>
            <button type="button" data-testid="drawer-show-all" aria-pressed={showAll} onClick={() => setShowAll(v => !v)}>{showAll ? 'Show filtered' : 'Show all'}</button>
          </div>
        )}
        {sections.map(s => (
          <div className="artgrp" key={s.title}>
            <div className="artgrp__head"><span>{s.title}</span>{s.status && <span className={`artgrp__status artgrp__status--${s.status}`}>{known ? s.status : '?'}</span>}</div>
            {s.printings.map(p => {
              const count = collection.counts[p.key] ?? 0
              const image = getPrintingImageUrl(p.key)
              const artIndex = groups.findIndex(g => g.id === p.artworkId) + 1
              return (
                <div key={p.key} className={`prow${p.playable === false ? ' prow--only' : ''}`} data-testid={`printing-row-${p.key}`}>
                  {image !== undefined ? <a href={image} target="_blank" rel="noreferrer" title="View this printing"><img src={image} alt={`${p.setName} ${p.collectorNumber}`} width={34} loading="lazy" /></a> : <span className="prow__img" aria-hidden="true" />}
                  <span className="prow__meta">
                    <b>{p.setName}{p.finish && <span className="tag tag--foil">{p.finish}</span>}{p.playable === false && <span className="tag">Collection only</span>}</b>
                    <span>{p.collectorNumber} · {p.rarity} · {artIndex > 0 ? `Artwork ${artIndex}${known ? (ownedArts.has(p.artworkId!) ? ' · owned' : ' · missing') : ''}` : 'artwork unreviewed'}</span>
                    <span className="prow__key">{p.key}</span>
                  </span>
                  <span className="collection-view__stepper">
                    <button type="button" data-testid={`printing-dec-${p.key}`} disabled={!known || count === 0} onClick={() => adjustCount(p.key, -1)}>−</button>
                    <PrintingCount printingKey={p.key} count={count} known={known} />
                    <button type="button" data-testid={`printing-inc-${p.key}`} disabled={!known} onClick={() => adjustCount(p.key, 1)}>+</button>
                  </span>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </aside>
  )
}
