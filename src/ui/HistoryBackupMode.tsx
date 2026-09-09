// History & backup: the change journal as a timeline (one row per entry,
// undo/reapply as a whole, details on demand with the same pulled-by-rarity
// table the review column shows), and the backup cards — export, import with
// preview, history-metadata restore, and the on-disk state in long form.
// Import/export moved here from CollectionHeader unchanged in behaviour; the
// all-or-nothing guarantees live in collection.ts.
import { useState, type ReactElement } from 'react'
import type { CardDb } from '../engine/types'
import type { Printing } from './printings'
import { exportCollectionJson, exportCollectionText, getCollection, previewCollectionImport, replaceCollection, useCollection } from './collection'
import { collectionChanges, importCollectionJournal, readCollectionJournal, restoreJournalChange, type CollectionChange } from './collectionJournal'
import { retryCollection, useSyncStatus } from './collectionSync'
import { rarityBreakdown } from './sessionDraft'
import { downloadFile } from './CollectionModeHeader'

const PAGE = 20
function kindClass(kind: string): string {
  const k = kind.toLowerCase()
  return k.startsWith('acqui') ? 'kind--acq' : k === 'trade' ? 'kind--trade' : k === 'undo' ? 'kind--undo' : 'kind--grey'
}
function when(iso: string): string {
  const d = new Date(iso), today = new Date().toDateString() === d.toDateString()
  return today ? `Today ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function copies(entry: CollectionChange): number { return Object.values(entry.changes).reduce((n, c) => n + c.after - c.before, 0) }

export function HistoryBackupMode({ db, printings, known }: { db: CardDb; printings: Printing[]; known: boolean }): ReactElement {
  const collection = useCollection()
  const syncStatus = useSyncStatus()
  const [revision, setRevision] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [error, setError] = useState('')
  const [importText, setImportText] = useState('')
  const [mode, setMode] = useState<'replace' | 'merge'>('replace')
  const [preview, setPreview] = useState<ReturnType<typeof previewCollectionImport> | null>(null)
  const [importError, setImportError] = useState('')
  const [historyText, setHistoryText] = useState('')
  const journal = readCollectionJournal()
  // `revision` has no reader: it exists only so bumping it after a
  // history-metadata import (which mutates the journal in place, not the
  // collection, so useCollection() would not re-render this screen) forces
  // this component to re-render and pick up the mutated journal.
  void revision
  // An entry is "undone" when a later Undo entry points at it and no later
  // Reapply does. Derived, not stored: the journal format does not change.
  const undone = new Set<string>()
  for (const e of [...journal.entries].reverse()) { if (e.relatedId) { if (e.kind === 'Undo') undone.add(e.relatedId); else if (e.kind === 'Reapply') undone.delete(e.relatedId) } }
  const restore = (entry: CollectionChange, direction: 'undo' | 'reapply') => {
    try { replaceCollection({ counts: restoreJournalChange(getCollection().counts, entry, direction) }, { kind: direction === 'undo' ? 'Undo' : 'Reapply', relatedId: entry.id, source: entry.source }); setError(''); setRevision(r => r + 1) }
    catch (e) { setError(String(e)) }
  }
  const visible = showAll ? journal.entries : journal.entries.slice(0, PAGE)

  return (
    <div className="history">
      <section className="card">
        <h3>Change history <span className="card__meta">{journal.entries.length} entries · newest first</span></h3>
        <div className="card__in">
          {journal.warning && <p className="tool-error" role="alert">{journal.warning}</p>}
          {error && <p className="tool-error" role="alert" data-testid="history-error">{error}</p>}
          {journal.entries.length === 0 && <p className="tool-note">No recorded changes yet.</p>}
          <div className="tl" data-testid="collection-history">
            {visible.map(entry => { const isUndone = undone.has(entry.id), n = copies(entry), isOpen = open === entry.id; return (
              <div key={entry.id} className={`ev${isUndone ? ' ev--undone' : ''}`} data-testid="collection-history-entry">
                <span className="ev__when">{when(entry.createdAt)}</span>
                <div className="ev__what">
                  <span className="ev__t"><span className={`kind ${kindClass(entry.kind)}`}>{entry.kind}</span>{entry.source || (entry.kind === 'Undo' || entry.kind === 'Reapply' ? 'of an earlier entry' : '—')}</span>
                  <span className="ev__d">{Object.keys(entry.changes).length} printings · {n >= 0 ? '+' : ''}{n} copies{entry.cost ? ` · ${entry.cost}` : ''}{entry.date ? ` · ${entry.date}` : ''}</span>
                  {isOpen && (
                    <div className="ev__details">
                      <div className="change-list">{Object.entries(entry.changes).map(([key, c]) => <p key={key}><span>{key}</span><span>{c.before} → {c.after}</span></p>)}</div>
                      {rarityBreakdown(entry.changes, printings).length > 0 && <table className="data-table" data-testid="history-rarity"><tbody>{rarityBreakdown(entry.changes, printings).map(r => <tr key={r.rarity}><td>{r.rarity}</td><td className="num">{r.copies}</td></tr>)}</tbody></table>}
                    </div>
                  )}
                </div>
                <div className="ev__ops">
                  <button type="button" className="btn--ghost ev__quiet" data-testid="history-details" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : entry.id)}>Details</button>
                  {entry.kind !== 'Undo' && entry.kind !== 'Reapply' && (isUndone
                    ? <button type="button" data-testid="history-reapply" disabled={!known} onClick={() => restore(entry, 'reapply')}>Reapply</button>
                    : <button type="button" data-testid="history-undo" disabled={!known} onClick={() => restore(entry, 'undo')}>Undo</button>)}
                </div>
              </div>) })}
          </div>
          {journal.entries.length > PAGE && !showAll && <div className="tool-actions"><button type="button" data-testid="history-show-all" onClick={() => setShowAll(true)}>Show all {journal.entries.length}</button></div>}
        </div>
      </section>

      <section className="card">
        <h3>Backup</h3>
        <div className="card__in">
          <div className="bk">
            <div className="bk__b"><span className="bk__k">Export</span><p className="tool-note">Download what you own as JSON (exact, re-importable) or as a readable text list.</p>
              <div className="tool-actions">
                <button type="button" data-testid="export-json" onClick={() => downloadFile('collection.json', exportCollectionJson(collection))}>JSON</button>
                <button type="button" data-testid="export-text" onClick={() => downloadFile('collection.txt', exportCollectionText(db, printings, collection))}>Text</button>
                <button type="button" data-testid="export-history" onClick={() => downloadFile('collection-history.json', JSON.stringify({ version: 1, counts: collection.counts, entries: journal.entries }, null, 2), 'application/json')}>JSON + history</button>
              </div>
            </div>
            <div className="bk__b" data-testid="import-panel"><span className="bk__k">Import</span><p className="tool-note">Paste an export. Nothing changes until you apply the preview.</p>
              <textarea data-testid="import-input" value={importText} placeholder="Paste a collection JSON or text export…" onChange={e => { setImportText(e.target.value); setPreview(null) }} />
              <div className="tool-actions">
                <div className="seg"><button type="button" data-testid="import-mode-replace" aria-pressed={mode === 'replace'} onClick={() => { setMode('replace'); setPreview(null) }}>Replace</button><button type="button" data-testid="import-mode-merge" aria-pressed={mode === 'merge'} onClick={() => { setMode('merge'); setPreview(null) }}>Merge</button></div>
                <button type="button" data-testid="import-submit" disabled={!known || importText.trim() === ''} onClick={() => { try { setPreview(previewCollectionImport(importText, mode)); setImportError('') } catch (e) { setImportError(e instanceof Error ? e.message : String(e)) } }}>Preview</button>
              </div>
              {preview && <div className="tool-preview" data-testid="import-preview">
                <p className="tool-figure">{mode} import: {Object.keys(collectionChanges(preview.before, preview.after)).length} changed printing rows</p>
                <div className="change-list">{Object.entries(collectionChanges(preview.before, preview.after)).map(([key, c]) => <p key={key}><span>{key}</span><span>{c.before} → {c.after}</span></p>)}</div>
                <div className="tool-actions"><button type="button" className="btn--primary" data-testid="import-apply" disabled={!known} onClick={() => { try { if (JSON.stringify(getCollection().counts) !== JSON.stringify(preview.before)) throw new Error('Collection changed; preview again.'); replaceCollection({ counts: preview.after }, { kind: mode + ' import' }); setPreview(null); setImportText(''); setImportError('') } catch (e) { setImportError(String(e)) } }}>Apply import</button></div>
              </div>}
              {importError && <p className="tool-error" role="alert" data-testid="import-error">{importError}</p>}
            </div>
            <div className="bk__b"><span className="bk__k">Restore history</span><p className="tool-note">Restores session notes and costs only; counts come from the collection import above.</p>
              <textarea data-testid="history-import-input" value={historyText} placeholder="Paste a JSON + history export…" onChange={e => setHistoryText(e.target.value)} />
              <div className="tool-actions"><button type="button" data-testid="history-import" disabled={!historyText.trim()} onClick={() => { try { importCollectionJournal(historyText); setHistoryText(''); setError(''); setRevision(r => r + 1) } catch (e) { setError(String(e)) } }}>Import history entries</button></div>
            </div>
            <div className="bk__b"><span className="bk__k">On disk</span>
              <p className="tool-note">data/collection.json{syncStatus.lastSavedAt ? ` · last write ${new Date(syncStatus.lastSavedAt).toLocaleTimeString()}` : ''}{syncStatus.git ? ` · git backup ${syncStatus.git}` : ''}{syncStatus.gitDetail ? ` · ${syncStatus.gitDetail}` : ''}</p>
              {(syncStatus.state === 'unsaved' || syncStatus.state === 'error' || syncStatus.git === 'failed') && <div className="tool-actions"><button type="button" onClick={() => void retryCollection()}>Retry now</button></div>}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
