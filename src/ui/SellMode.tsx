//
// Sell: choose what to keep (decks, a binder copy of each artwork, a
// playset), see every card with copies beyond that, and move copies onto the
// sell list. The arithmetic is surplus.ts; the list, exports and Mark sold
// are SellList.tsx.
import { useMemo, useState, type ReactElement } from 'react'
import { z } from 'zod'
import type { CardDb } from '../engine/types'
import { cardIdentity, validateDeck } from '../engine/deck'
import type { Printing } from './printings'
import type { DeckMode } from './acquisitionPlan'
import { pendingSplit, surplusPlan, type SurplusRow } from './surplus'
import { addToSellList, useSellList } from './sellDraft'
import { useCollection } from './collection'
import { buildDisplayNames, useDecks } from './storage'
import { DeckChips, DeckModeSeg } from './DeckChoice'
import { SellList } from './SellList'

const PREFS_KEY = 'ctcg:sell:prefs:v1'
interface SellPrefs { decks: string[]; mode: DeckMode; keepBinderArt: boolean; keepPlayset: boolean }
const prefsSchema = z.object({ decks: z.array(z.string()), mode: z.enum(['shared', 'assembled']), keepBinderArt: z.boolean(), keepPlayset: z.boolean() })
function readPrefs(): SellPrefs {
  try { const parsed = prefsSchema.safeParse(JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null')); if (parsed.success) return parsed.data } catch { /* per-browser convenience only */ }
  return { decks: [], mode: 'shared', keepBinderArt: false, keepPlayset: false }
}

export function SellMode({ db, printings, known }: { db: CardDb; printings: Printing[]; known: boolean }): ReactElement {
  const decks = useDecks()
  const collection = useCollection()
  const list = useSellList()
  const names = useMemo(() => buildDisplayNames(db), [db])
  const byKey = useMemo(() => new Map(printings.map(p => [p.key, p])), [printings])
  const [prefs, setPrefsState] = useState(readPrefs)
  const setPrefs = (patch: Partial<SellPrefs>) => {
    // Deck names that no longer exist are dropped the first time anything is saved.
    const next = { ...prefs, ...patch, decks: (patch.decks ?? prefs.decks).filter(n => decks.some(d => d.name === n)) }
    setPrefsState(next)
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)) } catch { /* per-browser convenience only */ }
  }
  const chosen = useMemo(() => decks.filter(d => prefs.decks.includes(d.name)), [decks, prefs.decks])
  const all = useMemo(() => surplusPlan(db, chosen, printings, collection.counts, prefs), [db, chosen, printings, collection, prefs])
  const rows = all.filter(r => r.surplus > 0)
  const surplusByIdentity = useMemo(() => new Map(all.map(r => [r.identity, r.surplus])), [all])
  const identityOf = (key: string) => { const p = byKey.get(key); return p ? (db[p.cardId] ? cardIdentity(db[p.cardId]) : p.cardId) : key }
  const listed: Record<string, number> = {}
  for (const l of list.lines) listed[l.key] = Math.min(l.count, collection.counts[l.key] ?? 0)
  const listedFor = (identity: string) => list.lines.filter(l => identityOf(l.key) === identity).reduce((n, l) => n + (listed[l.key] ?? 0), 0)
  const [want, setWant] = useState<Record<string, number>>({})
  const open = (r: SurplusRow) => Math.max(0, r.surplus - listedFor(r.identity))
  const where = (key: string) => { const p = byKey.get(key); return p ? `${p.setName} ${p.collectorNumber}` : key }

  return (
    <div className="plan" data-testid="sell-mode">
      <section className="card">
        <h3>Keep for <span className="card__meta">everything beyond this is surplus</span></h3>
        <div className="card__in">
          <DeckChips db={db} decks={decks} selected={prefs.decks} onSelected={d => setPrefs({ decks: d })} idPrefix="sell" />
          <div className="tool-actions">
            <DeckModeSeg mode={prefs.mode} onMode={m => setPrefs({ mode: m })} idPrefix="sell" />
            <label className="check-chip"><input type="checkbox" data-testid="sell-keep-binder" checked={prefs.keepBinderArt} onChange={e => setPrefs({ keepBinderArt: e.target.checked })} />One of each artwork in the binder</label>
            <label className="check-chip"><input type="checkbox" data-testid="sell-keep-playset" checked={prefs.keepPlayset} onChange={e => setPrefs({ keepPlayset: e.target.checked })} />A full playset</label>
          </div>
          <p className="tool-note">Keep is the larger of deck need plus binder copies, and a playset. Deck copies count toward the playset.</p>
          {chosen.filter(d => validateDeck(db, d).length > 0).map(d => <p key={d.name} className="tool-error">{d.name} has deck validation errors; its cards are still kept.</p>)}
          {!known ? <p className="tool-note">Ownership unavailable — load the collection before planning sales.</p> : (
            <>
              <div className="tool-actions">
                <p className="tool-figure" data-testid="sell-total">{rows.reduce((n, r) => n + r.surplus, 0)} surplus copies · {rows.length} cards</p>
                <button type="button" className="btn--primary" data-testid="sell-add-all" disabled={rows.every(r => open(r) === 0)} onClick={() => addToSellList(rows.flatMap(r => pendingSplit(r.split, listed, open(r))))}>Add all surplus</button>
              </div>
              <div className="tool-table-wrap"><table className="data-table">
                <thead><tr><th>Card</th><th className="num">Own</th><th className="num">Keep</th><th className="num">Listed</th><th className="num">Surplus</th><th>Suggested split</th><th>Add</th></tr></thead>
                <tbody>{rows.map(r => { const n = Math.min(want[r.identity] ?? open(r), open(r)); return (
                  <tr key={r.identity} data-testid="sell-row" data-card-id={r.id}>
                    <td className="session-name">{names.get(r.id) ?? r.id}</td><td className="num">{r.owned}</td><td className="num">{r.keep}</td><td className="num">{listedFor(r.identity)}</td><td className="num">{r.surplus}</td>
                    <td className="tool-note">{r.split.map(s => `${s.count}× ${where(s.key)}`).join(', ')}</td>
                    <td><span className="collection-view__stepper">
                      <button type="button" disabled={n <= 1} onClick={() => setWant(w => ({ ...w, [r.identity]: n - 1 }))}>−</button>
                      <span>{n}</span>
                      <button type="button" disabled={n >= open(r)} onClick={() => setWant(w => ({ ...w, [r.identity]: n + 1 }))}>+</button>
                      <button type="button" data-testid={`sell-add-${r.id}`} disabled={n === 0} onClick={() => { addToSellList(pendingSplit(r.split, listed, n)); setWant(w => { const next = { ...w }; delete next[r.identity]; return next }) }}>Add</button>
                    </span></td>
                  </tr>) })}</tbody>
              </table></div>
            </>
          )}
        </div>
      </section>
      <div className="plan__side">
        <SellList db={db} printings={printings} known={known} surplusByIdentity={surplusByIdentity} />
      </div>
    </div>
  )
}
