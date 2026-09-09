//
// Add cards: the session (kind/date/source/cost), whole-product buttons, the
// shared AddLine, the staged table, a collapsed paste box, and a live review
// column that ends in the one Apply button. Replaces the sessions form and the
// bulk-counts panel: "Set exact counts" is now a mode of the same draft.
// Everything here reads and writes sessionDraft.ts; the review is recomputed
// from the live collection on every render, so another tab's write is never
// applied on stale numbers.
import { useMemo, useState, type ReactElement } from 'react'
import type { CardDb } from '../engine/types'
import type { DeckList } from '../engine/deck'
import type { Printing } from './printings'
import { AddLine } from './AddLine'
import { useCollection } from './collection'
import { collectionChanges } from './collectionJournal'
import { starterEntry } from './sessionCounts'
import { buildDisplayNames } from './storage'
import {
  applyDraft, clearDraft, draftCounts, draftSummary, getDraftStorageError, parseDraftLines, rarityBreakdown, removeGroup, removeLine,
  stageLines, updateDraft, useDraft, type SessionKind, type SessionLine, type SessionMode,
} from './sessionDraft'
import arasaka from '../../data/decks/arasaka-embracing-power.json'
import mercs from '../../data/decks/mercs-the-heist.json'

const KINDS: SessionKind[] = ['Acquisition', 'Trade', 'Correction']
/** Fixed-content products the repo holds lists for. Boosters are entered
 *  card by card on purpose — their contents vary. */
const PRODUCTS: { setCode: string; label: string; deck: DeckList }[] = [
  { setCode: 'arasakademodeck', label: 'Arasaka Demo Deck', deck: arasaka as unknown as DeckList },
  { setCode: 'mercdemodeck', label: 'Merc Demo Deck', deck: mercs as unknown as DeckList },
]

export function AddCardsMode({ db, printings, known }: { db: CardDb; printings: Printing[]; known: boolean }): ReactElement {
  const draft = useDraft()
  const collection = useCollection()
  const names = useMemo(() => buildDisplayNames(db), [db])
  const byKey = useMemo(() => new Map(printings.map(p => [p.key, p])), [printings])
  const [paste, setPaste] = useState(draft.legacyText ?? '')
  const [error, setError] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)

  const review = useMemo(() => {
    if (draft.lines.length === 0) return null
    try {
      const before = collection.counts, after = draftCounts(draft, printings, before), changes = collectionChanges(before, after)
      return { before, after, changes, summary: draftSummary(before, after), rarity: draft.mode === 'signed' ? rarityBreakdown(changes, printings) : [] , error: '' }
    } catch (e) { return { before: collection.counts, after: collection.counts, changes: {}, summary: null, rarity: [], error: String(e) } }
  }, [draft, printings, collection])

  const groups = [...new Set(draft.lines.map(l => l.group).filter((g): g is string => g !== undefined))]
  const ungrouped = draft.lines.filter(l => l.group === undefined)
  const setMode = (mode: SessionMode) => { try { updateDraft({ mode }); setError('') } catch (e) { setError(String(e)) } }
  const describe = (l: SessionLine) => { const p = byKey.get(l.key); return p ? { name: names.get(p.cardId) ?? p.cardId, where: `${p.setName} · ${p.collectorNumber}${p.finish ? ` · ${p.finish}` : ''}`, ok: true } : { name: l.key, where: 'unknown printing', ok: false } }
  const amount = (l: SessionLine) => draft.mode === 'signed' ? `${(l.delta ?? 0) > 0 ? '+' : ''}${l.delta ?? 0}` : String(l.exact ?? 0)
  const nowAfter = (l: SessionLine) => review ? `${review.before[l.key] ?? 0} → ${review.after[l.key] ?? 0}` : ''

  return (
    <div className="addcards">
      <section className="card">
        <h3>Session <span className="card__meta">{getDraftStorageError() || 'draft saved in this browser'}</span></h3>
        <div className="card__in">
          <div className="fields">
            <div className="field"><span className="field__label">Kind</span><div className="seg">{KINDS.map(k => <button type="button" key={k} data-testid={`session-kind-${k}`} aria-pressed={draft.kind === k} onClick={() => updateDraft({ kind: k })}>{k}</button>)}</div></div>
            <label className="field"><span className="field__label">Date</span><input type="date" data-testid="session-date" value={draft.date} onChange={e => updateDraft({ date: e.target.value })} /></label>
            <label className="field"><span className="field__label">Source</span><input data-testid="session-source" value={draft.source} placeholder="Where these came from" onChange={e => updateDraft({ source: e.target.value })} /></label>
            <label className="field"><span className="field__label">Total cost</span><input data-testid="session-cost" value={draft.cost} placeholder="e.g. 200 SEK" onChange={e => updateDraft({ cost: e.target.value })} /></label>
          </div>
          <div className="field field--wide"><span className="field__label">Add a whole product</span>
            <div className="tool-actions">
              {PRODUCTS.map(pr => { const added = groups.includes(pr.label); return <button type="button" key={pr.setCode} data-testid={`product-${pr.setCode}`} disabled={!known || added || draft.mode === 'exact'} title={draft.mode === 'exact' ? 'Switch to Add / remove copies to add a whole product' : 'Bundled demo list, not a retail box manifest — check the quantities against what you received'} onClick={() => { try { stageLines(parseDraftLines(starterEntry(pr.deck, pr.setCode, printings), 'signed').map(l => ({ ...l, group: pr.label }))); setError('') } catch (e) { setError(String(e)) } }}>{pr.label}{added ? ' ✓ added' : ''}</button> })}
              <span className="tool-note">Fixed-content products only; boosters are entered card by card below.</span>
            </div>
          </div>
          <div className="field field--wide"><span className="field__label">Add cards one by one</span>
            <fieldset disabled={!known} className="collection-editor"><AddLine db={db} printings={printings} testIdPrefix="add-line" /></fieldset>
          </div>
          {draft.lines.length > 0 && (
            <div className="tool-table-wrap"><table className="data-table" data-testid="session-lines">
              <thead><tr><th>Card</th><th>Printing</th><th className="num">{draft.mode === 'signed' ? 'Change' : 'Set to'}</th><th className="num">Now → after</th><th></th></tr></thead>
              <tbody>
                {groups.map(g => { const lines = draft.lines.filter(l => l.group === g); const total = lines.reduce((n, l) => n + (l.delta ?? l.exact ?? 0), 0); return (
                  <tr key={g} className="session-group" data-testid={`session-group-${g}`}><td colSpan={2}>▾ {g} <span className="tool-note">· whole product · {lines.length} printings</span></td><td className="num plus">{draft.mode === 'signed' ? `+${total}` : total}</td><td className="num">{lines.map(nowAfter).filter(Boolean).length ? `${lines.reduce((n, l) => n + (review?.before[l.key] ?? 0), 0)} → ${lines.reduce((n, l) => n + (review?.after[l.key] ?? 0), 0)}` : ''}</td><td><button type="button" className="session-x" data-testid={`session-remove-group-${g}`} aria-label={`Remove ${g}`} onClick={() => removeGroup(g)}>✕</button></td></tr>) })}
                {ungrouped.map(l => { const d = describe(l); return (
                  <tr key={l.key} data-testid={`session-line-${l.key}`} className={d.ok ? '' : 'session-bad'}><td className="session-name">{d.name}</td><td className="tool-note">{d.where}</td><td className={`num ${(l.delta ?? 0) < 0 ? 'minus' : 'plus'}`}>{amount(l)}</td><td className="num">{nowAfter(l)}</td><td><button type="button" className="session-x" data-testid={`session-remove-${l.key}`} aria-label={`Remove ${d.name}`} onClick={() => removeLine(l.key)}>✕</button></td></tr>) })}
              </tbody>
            </table></div>
          )}
          <details className="tool-panel tool-panel--nested" open={!!draft.legacyText}><summary>Paste lines or set exact counts instead</summary>
            <div className="tool-panel__body">
              <div className="field"><span className="field__label">Counting mode</span><div className="seg">
                <button type="button" data-testid="session-mode-signed" aria-pressed={draft.mode === 'signed'} disabled={draft.lines.length > 0 && draft.mode !== 'signed'} title={draft.lines.length > 0 ? 'Apply or clear the draft to change mode' : undefined} onClick={() => setMode('signed')}>Add / remove copies (+3, −1)</button>
                <button type="button" data-testid="session-mode-exact" aria-pressed={draft.mode === 'exact'} disabled={draft.lines.length > 0 && draft.mode !== 'exact'} title={draft.lines.length > 0 ? 'Apply or clear the draft to change mode' : undefined} onClick={() => setMode('exact')}>Set exact counts</button>
              </div></div>
              <p className="tool-note">One <code>printing-key,{draft.mode === 'signed' ? '±count' : 'count'}</code> per line, e.g. <code>arasakademodeck/006,{draft.mode === 'signed' ? '+3' : '3'}</code>. Lines join the table above.</p>
              <label className="field field--wide"><span className="field__label">Lines</span><textarea data-testid="session-input" value={paste} placeholder={`arasakademodeck/006,${draft.mode === 'signed' ? '+3' : '3'}`} onChange={e => setPaste(e.target.value)} /></label>
              <div className="tool-actions"><button type="button" data-testid="session-paste-add" disabled={!paste.trim()} onClick={() => { try { stageLines(parseDraftLines(paste, draft.mode)); setPaste(''); if (draft.legacyText) updateDraft({ legacyText: undefined }); setError('') } catch (e) { setError(String(e)) } }}>Add lines to the session</button></div>
            </div>
          </details>
          {error && <p className="tool-error" role="alert" data-testid="session-error">{error}</p>}
        </div>
      </section>

      <section className="card">
        <h3>Review &amp; apply <span className="card__meta">live</span></h3>
        <div className="card__in">
          {!review && <p className="tool-note">Nothing staged yet. Add a product, type card names, or paste lines.</p>}
          {review?.error && <p className="tool-error" role="alert" data-testid="session-review-error">{review.error}</p>}
          {review?.summary && (
            <>
              <p className="tool-figure">{review.summary.copies >= 0 ? '+' : ''}{review.summary.copies} copies · {review.summary.printings} printings · {review.summary.before} → {review.summary.after} owned</p>
              <div className="change-list" data-testid="session-changes">{Object.entries(review.changes).map(([key, c]) => <p key={key}><span>{key}</span><span>{c.before} → {c.after}</span></p>)}</div>
              {review.rarity.length > 0 && (
                <div className="field field--wide"><span className="field__label">Pulled by rarity</span>
                  <table className="data-table" data-testid="session-rarity"><tbody>{review.rarity.map(r => <tr key={r.rarity}><td>{r.rarity}</td><td className="num">{r.copies}</td><td><meter min={0} max={Math.max(1, review.rarity[0].copies)} value={r.copies} /></td></tr>)}</tbody></table>
                </div>
              )}
              <p className="tool-note">Applying writes the collection file once and records this session in History as one entry — undoable as one step, with the cost and source kept on it.</p>
            </>
          )}
          <div className="tool-actions">
            <button type="button" className="btn--primary" data-testid="session-apply" disabled={!known || !review || !!review.error} onClick={() => { try { applyDraft(printings); setConfirmClear(false); setError('') } catch (e) { setError(String(e)) } }}>Apply session{review?.summary ? ` · ${review.summary.copies >= 0 ? '+' : ''}${review.summary.copies}` : ''}</button>
            <button type="button" className={confirmClear ? 'btn--danger' : ''} data-testid="session-clear" disabled={draft.lines.length === 0} onClick={() => { if (confirmClear) { clearDraft(); setConfirmClear(false) } else setConfirmClear(true) }}>{confirmClear ? `Clear ${draft.lines.length} line${draft.lines.length === 1 ? '' : 's'}?` : 'Clear draft'}</button>
          </div>
        </div>
      </section>
    </div>
  )
}
