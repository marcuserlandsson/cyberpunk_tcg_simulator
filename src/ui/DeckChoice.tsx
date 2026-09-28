//
// The "which decks, shared or kept" controls Plan purchases and Sell share.
// `idPrefix` keeps each mode's test ids (`acquisition-…`, `sell-…`) distinct.
import type { ReactElement } from 'react'
import type { CardDb } from '../engine/types'
import { deckSize, validateDeck, type DeckList } from '../engine/deck'
import type { DeckMode } from './acquisitionPlan'

export function DeckChips({ db, decks, selected, onSelected, idPrefix }: { db: CardDb; decks: DeckList[]; selected: string[]; onSelected: (names: string[]) => void; idPrefix: string }): ReactElement {
  return (
    <div className="tool-actions">
      {decks.length === 0 && <span className="tool-note">No saved decks yet.</span>}
      {decks.map(d => { const errors = validateDeck(db, d).length; return (
        <label key={d.name} className={`check-chip deckchip${selected.includes(d.name) ? ' deckchip--on' : ''}`}>
          <input type="checkbox" aria-label={d.name} data-testid={`${idPrefix}-deck-${d.name}`} checked={selected.includes(d.name)} onChange={e => onSelected(e.target.checked ? [...selected, d.name] : selected.filter(n => n !== d.name))} />
          {d.name}<span className={`deckchip__st${errors ? ' deckchip__st--bad' : ''}`}>{errors ? `${errors} error${errors === 1 ? '' : 's'}` : `${deckSize(d)} cards`}</span>
        </label>) })}
    </div>
  )
}

export function DeckModeSeg({ mode, onMode, idPrefix }: { mode: DeckMode; onMode: (m: DeckMode) => void; idPrefix: string }): ReactElement {
  return (
    <div className="field"><span className="field__label">Cards are</span><div className="seg">
      <button type="button" data-testid={`${idPrefix}-mode-shared`} aria-pressed={mode === 'shared'} onClick={() => onMode('shared')}>Shared between decks</button>
      <button type="button" data-testid={`${idPrefix}-mode-assembled`} aria-pressed={mode === 'assembled'} onClick={() => onMode('assembled')}>Kept in every deck</button>
    </div></div>
  )
}
