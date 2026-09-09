// src/ui/PlanPurchasesMode.tsx
//
// Plan purchases: pick the decks you want to own physically, choose whether
// cards are shared between them or kept in every deck, optionally reserve
// one copy of each artwork for the binder, and get a table plus a shopping
// list. The three collection-goal lists (playset / artwork / both) live here
// too — they are purchase lists, not header decoration. The arithmetic is
// acquisitionPlan.ts and buildBuyList, unchanged.
import { useMemo, useState, type ReactElement } from 'react'
import type { CardDb } from '../engine/types'
import { deckSize, validateDeck } from '../engine/deck'
import type { Printing } from './printings'
import { acquisitionPlan } from './acquisitionPlan'
import { buildBuyList, playsetGaps, useCollection } from './collection'
import { missingArtworks } from './artworks'
import { buildDisplayNames, useDecks } from './storage'

export function PlanPurchasesMode({ db, printings, known }: { db: CardDb; printings: Printing[]; known: boolean }): ReactElement {
  const decks = useDecks()
  const collection = useCollection()
  const names = useMemo(() => buildDisplayNames(db), [db])
  const [selected, setSelected] = useState<string[]>([])
  const [mode, setMode] = useState<'shared' | 'assembled'>('shared')
  const [reserve, setReserve] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const chosen = decks.filter(d => selected.includes(d.name))
  const rows = useMemo(() => acquisitionPlan(db, chosen, printings, collection.counts, mode, reserve), [db, chosen, printings, collection, mode, reserve])
  const missing = rows.filter(r => r.missing > 0)
  const text = missing.map(r => `${r.missing}x ${names.get(r.id) ?? r.id}${!reserve && r.missingArts.length ? ' — a missing artwork would also count' : ''}`).join('\n')
  const gaps = useMemo(() => playsetGaps(db, printings, collection).reduce((n, g) => n + g.missing, 0), [db, printings, collection])
  const arts = useMemo(() => missingArtworks(printings, collection.counts).length, [printings, collection])
  const both = useMemo(() => buildBuyList(db, printings, collection, { playset: true, arts: true }).split('\n').filter(l => l.trim() && !l.startsWith('#')).length, [db, printings, collection])
  const copy = (what: string, value: string) => navigator.clipboard.writeText(value).then(() => setStatus({ kind: 'ok', text: `Copied ${what} ${new Date().toLocaleTimeString()}` })).catch(err => setStatus({ kind: 'error', text: `Could not copy to clipboard: ${err instanceof Error ? err.message : String(err)}` }))

  return (
    <div className="plan" data-testid="acquisition-planner">
      <section className="card">
        <h3>Decks to build <span className="card__meta">pick the decks you want to own physically</span></h3>
        <div className="card__in">
          <div className="tool-actions">
            {decks.length === 0 && <span className="tool-note">No saved decks yet.</span>}
            {decks.map(d => { const errors = validateDeck(db, d).length; return (
              <label key={d.name} className={`check-chip deckchip${selected.includes(d.name) ? ' deckchip--on' : ''}`}>
                <input type="checkbox" aria-label={d.name} data-testid={`acquisition-deck-${d.name}`} checked={selected.includes(d.name)} onChange={e => setSelected(old => e.target.checked ? [...old, d.name] : old.filter(n => n !== d.name))} />
                {d.name}<span className={`deckchip__st${errors ? ' deckchip__st--bad' : ''}`}>{errors ? `${errors} error${errors === 1 ? '' : 's'}` : `${deckSize(d)} cards`}</span>
              </label>) })}
          </div>
          <div className="tool-actions">
            <div className="field"><span className="field__label">Cards are</span><div className="seg">
              <button type="button" data-testid="acquisition-mode-shared" aria-pressed={mode === 'shared'} onClick={() => setMode('shared')}>Shared between decks</button>
              <button type="button" data-testid="acquisition-mode-assembled" aria-pressed={mode === 'assembled'} onClick={() => setMode('assembled')}>Kept in every deck</button>
            </div></div>
            <label className="check-chip"><input type="checkbox" data-testid="reserve-artwork" checked={reserve} onChange={e => setReserve(e.target.checked)} />Keep one of each artwork in the binder</label>
          </div>
          <p className="tool-note">Shared: buy the maximum any one deck needs. Kept: add every deck's requirement. Binder copies are taken out of what decks can use{reserve ? '; a newly bought missing artwork kept in the binder needs an extra playable copy to fill a deck gap' : ''}. Playset progress still counts all owned copies.</p>
          {chosen.filter(d => validateDeck(db, d).length > 0).map(d => <p key={d.name} className="tool-error">{d.name} has deck validation errors; this list does not make it legal.</p>)}
          {!known ? <p className="tool-note">Ownership unavailable — load the collection before calculating purchases.</p> : chosen.length === 0 ? <p className="tool-note">Select decks to calculate requirements.</p> : (
            <>
              <p className="tool-figure" data-testid="acquisition-total">{missing.reduce((n, r) => n + r.missing, 0)} copies to buy · {missing.length} distinct cards</p>
              <div className="tool-table-wrap"><table className="data-table">
                <thead><tr><th>Card</th><th className="num">Need</th><th className="num">Own</th><th className="num">Binder</th><th className="num">Buy</th><th>Also fills</th></tr></thead>
                <tbody>{rows.map(r => <tr key={r.identity} data-testid="acquisition-row" data-card-id={r.id}><td className="session-name">{names.get(r.id) ?? r.id}</td><td className="num">{r.required}</td><td className="num">{r.owned}</td><td className="num">{r.reserved}</td><td className={`num${r.missing ? ' plan__buy' : ''}`}>{r.missing}</td><td className="tool-note">{[r.playsetMissing ? `playset gap ${r.playsetMissing}` : '', ...r.missingArts.map((a, i) => `artwork ${i + 1} (${a.choices.join(' or ')})`)].filter(Boolean).join(' · ') || '—'}</td></tr>)}</tbody>
              </table></div>
            </>
          )}
        </div>
      </section>
      <div className="plan__side">
        <section className="card">
          <h3>Shopping list</h3>
          <div className="card__in">
            <textarea className="plan__shop" readOnly data-testid="acquisition-list" value={text} placeholder="Select decks above." />
            <div className="tool-actions"><button type="button" className="btn--primary" data-testid="acquisition-copy" disabled={!text} onClick={() => copy('the shopping list', text)}>Copy list</button></div>
          </div>
        </section>
        <section className="card">
          <h3>Collection goals <span className="card__meta">independent of decks</span></h3>
          <div className="card__in">
            <div className="plan__lists">
              <div className="lst"><span className="goal__k">Playset gaps</span><span className="goal__v">{known ? gaps : '?'}<small>copies</small></span><button type="button" data-testid="copy-playset-list" disabled={!known} onClick={() => copy('the playset list', buildBuyList(db, printings, collection, { playset: true, arts: false }))}>Copy list</button></div>
              <div className="lst"><span className="goal__k">Missing artworks</span><span className="goal__v">{known ? arts : '?'}<small>arts</small></span><button type="button" data-testid="copy-artwork-list" disabled={!known} onClick={() => copy('the artwork list', buildBuyList(db, printings, collection, { playset: false, arts: true }))}>Copy list</button></div>
              <div className="lst"><span className="goal__k">Both goals</span><span className="goal__v">{known ? both : '?'}<small>cards</small></span><button type="button" data-testid="copy-buylist" disabled={!known} onClick={() => copy('both lists', buildBuyList(db, printings, collection, { playset: true, arts: true }))}>Copy list</button></div>
            </div>
            <p className="tool-note">One purchase can close a playset gap and a missing artwork at once; the combined list says which.</p>
            {status && <p className={status.kind === 'error' ? 'tool-error' : 'tool-status'} role="status" data-testid={status.kind === 'error' ? 'copy-error' : 'copy-status'}>{status.text}</p>}
          </div>
        </section>
      </div>
    </div>
  )
}
