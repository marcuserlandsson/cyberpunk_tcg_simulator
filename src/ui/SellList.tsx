//
// The sell list card: defaults, one line per printing, the two Cardmarket
// exports, and Mark sold (an inline confirm, then one Sale write).
import { useMemo, useState, type ReactElement } from 'react'
import type { CardDb } from '../engine/types'
import { cardIdentity } from '../engine/deck'
import type { Printing } from './printings'
import { useCollection } from './collection'
import { buildDisplayNames } from './storage'
import { downloadFile } from './CollectionModeHeader'
import { buildExportGroups, bulkListingText, csvFilename, groupCsv, loadCardmarketMap } from './cardmarketExport'
import {
  CONDITIONS, LANGUAGES, effectiveLines, getSellListStorageError, markSold, removeSellLine, saleCounts,
  setLineCondition, setSellCount, setSellDefaults, useSellList, type Condition, type Language,
} from './sellDraft'

export function SellList({ db, printings, known, surplusByIdentity }: { db: CardDb; printings: Printing[]; known: boolean; surplusByIdentity: Map<string, number> }): ReactElement {
  const list = useSellList()
  const collection = useCollection()
  const names = useMemo(() => buildDisplayNames(db), [db])
  const byKey = useMemo(() => new Map(printings.map(p => [p.key, p])), [printings])
  const map = useMemo(() => { try { return { map: loadCardmarketMap(), error: '' } } catch (err) { return { map: undefined, error: String(err) } } }, [])
  const lines = effectiveLines(list, collection.counts)
  const groups = map.map ? buildExportGroups(lines, printings, db, map.map) : []
  const [checked, setChecked] = useState<string[]>([])
  const [confirm, setConfirm] = useState<Record<string, number> | null>(null)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const identityOf = (key: string) => { const p = byKey.get(key); return p ? (db[p.cardId] ? cardIdentity(db[p.cardId]) : p.cardId) : key }
  const listedByIdentity = new Map<string, number>()
  for (const l of lines) listedByIdentity.set(identityOf(l.key), (listedByIdentity.get(identityOf(l.key)) ?? 0) + l.count)
  const selected = lines.filter(l => checked.includes(l.key))
  const selectedCopies = selected.reduce((n, l) => n + l.count, 0)
  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => setStatus({ kind: 'ok', text: `Copied the bulk-listing text ${new Date().toLocaleTimeString()}` })).catch(err => setStatus({ kind: 'error', text: `Could not copy to clipboard: ${err instanceof Error ? err.message : String(err)}` }))
  const sell = () => {
    try { markSold(selected.map(l => l.key), confirm!); setStatus({ kind: 'ok', text: `Marked ${selectedCopies} ${selectedCopies === 1 ? 'copy' : 'copies'} sold.` }); setChecked([]) }
    catch (err) { setStatus({ kind: 'error', text: err instanceof Error ? err.message : String(err) }) }
    setConfirm(null)
  }
  const unmapped = groups.filter(g => !g.mapped).map(g => g.expansion)
  const storageError = getSellListStorageError()
  const label = (l: { key: string }): string => { const p = byKey.get(l.key); const name = p ? names.get(p.cardId) ?? p.cardId : l.key; return p ? `${name} ${p.setName} ${p.collectorNumber}` : name }

  return (
    <section className="card" data-testid="sell-list">
      <h3>Sell list <span className="card__meta">{lines.length} printings · {lines.reduce((n, l) => n + l.count, 0)} copies</span></h3>
      <div className="card__in">
        {storageError && <p className="tool-error">{storageError}</p>}
        <div className="tool-actions">
          <label className="field"><span className="field__label">Condition</span><select data-testid="sell-default-condition" value={list.condition} onChange={e => setSellDefaults({ condition: e.target.value as Condition })}>{CONDITIONS.map(c => <option key={c}>{c}</option>)}</select></label>
          <label className="field"><span className="field__label">Language</span><select data-testid="sell-default-language" value={list.language} onChange={e => setSellDefaults({ language: e.target.value as Language })}>{LANGUAGES.map(l => <option key={l}>{l}</option>)}</select></label>
        </div>
        {!known && <p className="tool-note">Ownership unavailable — load the collection before exporting or marking sales.</p>}
        {lines.length === 0 ? <p className="tool-note">Add surplus copies, or use Sell +1 in a card's drawer.</p> : (
          <div className="tool-table-wrap"><table className="data-table">
            <thead><tr><th>Sell</th><th>Card</th><th>Printing</th><th>Qty</th><th>Condition</th><th></th></tr></thead>
            <tbody>{lines.map(l => {
              const p = byKey.get(l.key)
              const owned = collection.counts[l.key] ?? 0
              const effective = Math.min(l.requested, owned)
              const below = known && p !== undefined && (listedByIdentity.get(identityOf(l.key)) ?? 0) > (surplusByIdentity.get(identityOf(l.key)) ?? 0)
              const note = known ? [!p && 'unknown printing', effective < l.requested && `reduced: you now own ${effective}`, below && 'below keep'].filter(Boolean).join(' · ') : ''
              return (
                <tr key={l.key} data-testid={`sell-line-${l.key}`}>
                  <td><input type="checkbox" aria-label={`Select ${label(l)}`} data-testid={`sell-line-check-${l.key}`} checked={checked.includes(l.key)} onChange={e => setChecked(c => e.target.checked ? [...c, l.key] : c.filter(k => k !== l.key))} /></td>
                  <td className="session-name">{p ? names.get(p.cardId) ?? p.cardId : l.key}{note && <span className="tool-note" data-testid={`sell-line-note-${l.key}`}> · {note}</span>}</td>
                  <td className="tool-note">{p ? `${p.setName} ${p.collectorNumber}` : ''}</td>
                  <td><span className="collection-view__stepper">
                    <button type="button" aria-label={`Fewer ${label(l)}`} data-testid={`sell-line-dec-${l.key}`} disabled={!known || effective <= 1} onClick={() => setSellCount(l.key, effective - 1)}>−</button>
                    <span>{known ? effective : l.requested}</span>
                    <button type="button" aria-label={`More ${label(l)}`} data-testid={`sell-line-inc-${l.key}`} disabled={!known || effective >= owned} onClick={() => setSellCount(l.key, effective + 1)}>+</button>
                  </span></td>
                  <td><select data-testid={`sell-line-condition-${l.key}`} aria-label={`Condition for ${label(l)}`} value={list.lines.find(x => x.key === l.key)?.condition ?? ''} onChange={e => setLineCondition(l.key, (e.target.value || undefined) as Condition | undefined)}><option value="">{list.condition} (default)</option>{CONDITIONS.map(c => <option key={c}>{c}</option>)}</select></td>
                  <td><button type="button" className="session-x" data-testid={`sell-line-remove-${l.key}`} aria-label={`Remove ${label(l)}`} onClick={() => removeSellLine(l.key)}>✕</button></td>
                </tr>) })}</tbody>
          </table></div>
        )}
        {map.error && <p className="tool-error">Cardmarket expansion map is invalid: {map.error}</p>}
        {unmapped.length > 0 && <p className="tool-error">No Cardmarket expansion recorded for {unmapped.join(', ')} — check these before listing.</p>}
        <div className="tool-actions">
          <button type="button" className="btn--primary" data-testid="sell-copy-text" disabled={!known || groups.length === 0} onClick={() => copy(bulkListingText(groups, list.language))}>Copy for bulk listing</button>
          {groups.map((g, i) => <button type="button" key={g.expansion} data-testid={`sell-csv-${i}`} disabled={!known} onClick={() => downloadFile(csvFilename(g), groupCsv(g, list.language), 'text/csv')}>CSV · {g.expansion}</button>)}
        </div>
        <p className="tool-note">One CSV per Cardmarket expansion, for the Cardmarket Bulk Import extension on that expansion's bulk listing page. Prices are set on Cardmarket.</p>
        <div className="tool-actions">
          <button type="button" data-testid="sell-mark" disabled={!known || selectedCopies === 0} onClick={() => { setStatus(null); setConfirm({ ...collection.counts }) }}>Mark {selectedCopies} sold…</button>
        </div>
        {confirm && (
          <div className="tool-panel" data-testid="sell-confirm">
            <div className="tool-panel__body">
              <table className="data-table"><tbody>{selected.map(l => { const after = saleCounts([l.key], confirm)[l.key]; return <tr key={l.key}><td className="session-name">{byKey.get(l.key) ? names.get(byKey.get(l.key)!.cardId) : l.key}</td><td className="tool-note">{byKey.get(l.key)?.setName} {byKey.get(l.key)?.collectorNumber}</td><td className="num">{confirm[l.key] ?? 0} → {after}</td></tr> })}</tbody></table>
              <div className="tool-actions">
                <button type="button" className="btn--danger" data-testid="sell-confirm-ok" disabled={!known} onClick={sell}>Remove {selectedCopies} {selectedCopies === 1 ? 'copy' : 'copies'} from the collection</button>
                <button type="button" className="btn--ghost" data-testid="sell-confirm-cancel" onClick={() => setConfirm(null)}>Cancel</button>
              </div>
            </div>
          </div>
        )}
        {status && <p className={status.kind === 'error' ? 'tool-error' : 'tool-status'} role="status" data-testid={status.kind === 'error' ? 'sell-error' : 'sell-status'}>{status.text}</p>}
      </div>
    </section>
  )
}
