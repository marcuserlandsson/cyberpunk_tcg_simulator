// Stats strip + buy-list copy + backup (export/import) for the Collection
// tab. Exports download as files; import accepts pasted JSON or text (format
// sniffed by first non-whitespace character) with an explicit replace/merge
// choice. Import errors are shown but never write partial data — the Task 6
// import functions already guarantee all-or-nothing.

import { useMemo, useState, type ReactElement } from 'react'
import type { CardDb } from '../engine/types'
import type { Printing } from './printings'
import {
  useCollection,
  completionStats,
  buildBuyList,
  exportCollectionJson,
  exportCollectionText,
  previewCollectionImport, getCollection, replaceCollection,
} from './collection'
import { collectionChanges } from './collectionJournal'
import { useSyncStatus, retryCollection, resolveConflict, confirmEmptySave, ownershipAvailable } from './collectionSync'

/** Sum of raw per-printing counts — the same arithmetic `completionStats`
 *  uses for `totalOwned`, applied to the disk-side counts a conflict hands
 *  back, so the two numbers shown side by side in the conflict chooser are
 *  actually comparable. */
function totalCount(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, n) => sum + n, 0)
}

/**
 * This is the player's ONLY backup path for what can be hours of manual
 * entry, so the two easy ways to lose the file are both closed here:
 * the anchor is appended to the document before `.click()` (a detached
 * anchor's click is ignored outright by Firefox and by some Safari
 * versions), and the Blob URL is revoked on a later tick rather than
 * synchronously — revoking it in the same task can invalidate the URL
 * before the browser has finished starting the download.
 */
function download(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function CollectionHeader({ db, printings }: { db: CardDb; printings: Printing[] }): ReactElement {
  const collection = useCollection()
  const syncStatus = useSyncStatus()
  const stats = useMemo(
    () => completionStats(db, printings, collection),
    [db, printings, collection]
  )
  const [importText, setImportText] = useState('')
  const [mode, setMode] = useState<'replace' | 'merge'>('replace')
  const [preview,setPreview] = useState<ReturnType<typeof previewCollectionImport>|null>(null)
  const [error, setError] = useState('')
  const [copyError, setCopyError] = useState('')
  const derivedUnavailable = !ownershipAvailable(syncStatus)

  function runImport(): void {
    try {
      setPreview(previewCollectionImport(importText,mode))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="collection-header">
      <span
        className={`collection-header__sync collection-header__sync--${syncStatus.state}`}
        data-testid="sync-status"
      >
        {syncStatus.state === 'loading' && <>Loading collection…</>}
        {syncStatus.state === 'idle' && (
          <>
            Saved to disk
            {syncStatus.lastSavedAt !== undefined
              ? ` · ${new Date(syncStatus.lastSavedAt).toLocaleTimeString()}`
              : ''}
            {syncStatus.git === 'failed' && (
              <span className="collection-header__sync-note">
                {' '}
                · git backup failed — your data is safe on disk
              </span>
            )}
          </>
        )}
        {syncStatus.git === 'pending' && <> · Background backup pending…</>}
        {syncStatus.gitDetail && <span className="collection-header__sync-note"> · {syncStatus.gitDetail}</span>}
        {syncStatus.state === 'saving' && <>Saving…</>}
        {syncStatus.state === 'unsaved' && (
          <>
            {/* Two things this must not lie about. The count: with no pending
                buffer there are no changes, and "0 changes not yet saved"
                reads like a bug. And the retry: several refusals (400, 405, a
                409 whose body did not validate) arm nothing, so "retrying…"
                is gated on the flusher actually having scheduled one — a
                banner that claims a retry that is not coming is how a stalled
                save goes unnoticed through a whole entry session. */}
            <strong>
              {syncStatus.pendingCount > 0
                ? `${syncStatus.pendingCount} changes not yet saved to disk`
                : 'Not yet saved to disk'}
            </strong>
            {syncStatus.retrying === true ? ' — retrying…' : ''}
            {syncStatus.message !== undefined && (
              <span className="collection-header__sync-note"> · {syncStatus.message}</span>
            )}
          </>
        )}
        {syncStatus.state === 'error' && (
          <>
            <strong>The collection could not be read from disk.</strong> Nothing has been
            overwritten, and no totals are shown below because this tab does not know what you
            own.
            {syncStatus.message !== undefined && (
              <span className="collection-header__sync-note"> · {syncStatus.message}</span>
            )}
          </>
        )}
        {syncStatus.state === 'conflict' && (
          <>
            The collection on disk changed while you were editing.
            {syncStatus.message !== undefined && (
              <span className="collection-header__sync-note"> · {syncStatus.message}</span>
            )}
          </>
        )}
        {syncStatus.state === 'would-empty' && (
          <>
            Refused to save: this would empty a collection that still has cards on disk. Nothing is
            saved until you confirm.
          </>
        )}
      </span>
      {(syncStatus.state === 'unsaved' || syncStatus.state === 'error') && (
        <button type="button" data-testid="sync-retry" onClick={() => void retryCollection()}>
          Retry now
        </button>
      )}
      {/* The escape hatch belongs in `conflict` as much as in `unsaved`:
          "Take disk" deliberately discards local work, so this is the moment
          the owner most needs a file copy of what they are about to lose. */}
      {(syncStatus.state === 'unsaved' || syncStatus.state === 'conflict') && (
        <button
          type="button"
          data-testid="sync-download"
          onClick={() => download('collection.json', exportCollectionJson(collection))}
        >
          Download JSON
        </button>
      )}
      {syncStatus.state === 'conflict' && (
        <span className="collection-header__conflict" data-testid="sync-conflict">
          {syncStatus.conflictDisk !== undefined && (
            <>
              Disk has {totalCount(syncStatus.conflictDisk.counts)} cards total; yours has{' '}
              {stats.totalOwned}.{' '}
            </>
          )}
          Choose which copy to keep — this cannot be undone.
          <button type="button" data-testid="sync-keep-mine" onClick={() => void resolveConflict('mine')}>
            Keep mine
          </button>
          <button type="button" data-testid="sync-take-disk" onClick={() => void resolveConflict('disk')}>
            Take disk
          </button>
        </span>
      )}
      {syncStatus.state === 'would-empty' && (
        <button type="button" data-testid="sync-confirm-empty" onClick={() => void confirmEmptySave()}>
          Yes, save an empty collection
        </button>
      )}
      {/* Both of these are derived from `collection`, which in the `error`
          state is the empty in-memory fallback rather than anything measured.
          Rendering them would print "Playset 0% · 0 cards owned" and a
          buy-list demanding every card in the game, next to a banner saying
          the collection could not be read — numbers the owner might act on
          that nothing measured. Suppress them instead of inventing them. */}
      {!derivedUnavailable && (
        <>
          <span data-testid="collection-stats">
            <span data-testid="playset-progress">Playset {stats.playsetOwned}/{stats.playsetTarget} copies ({stats.playsetPct}%)</span>
            {' · '}<span data-testid="artwork-progress">Artwork {stats.artsOwned}/{stats.artsTarget} ({stats.artsPct}%)</span>
            {' · '}{stats.totalOwned} physical cards owned
            {stats.unreviewedPrintings > 0 && <strong> · {stats.unreviewedPrintings} printings await artwork review; artwork goal is incomplete.</strong>}
          </span>
          <button
            type="button"
            data-testid="copy-buylist"
            onClick={() =>
              navigator.clipboard
                .writeText(buildBuyList(db, printings, collection, { playset: true, arts: true }))
                .then(() => setCopyError(''))
                .catch((err: unknown) =>
                  setCopyError(`Could not copy to clipboard: ${err instanceof Error ? err.message : String(err)}`)
                )
            }
          >
            Copy both goal lists
          </button>
          {(['playset', 'artwork'] as const).map(goal => <button type="button" key={goal} data-testid={'copy-' + goal + '-list'}
            onClick={() => navigator.clipboard.writeText(buildBuyList(db, printings, collection, { playset: goal === 'playset', arts: goal === 'artwork' }))
              .then(() => setCopyError('')).catch(error => setCopyError('Could not copy to clipboard: ' + String(error)))}>
            Copy {goal} list
          </button>)}
          <small>Goals are separate. One purchase can fill both a playset gap and a missing artwork.</small>
        </>
      )}
      {copyError !== '' && (
        <div data-testid="copy-error" className="collection-header__error">
          {copyError}
        </div>
      )}
      <button
        type="button"
        data-testid="export-json"
        onClick={() => download('collection.json', exportCollectionJson(collection))}
      >
        Export JSON
      </button>
      <button
        type="button"
        data-testid="export-text"
        onClick={() => download('collection.txt', exportCollectionText(db, printings, collection))}
      >
        Export text
      </button>
      {/* The summary is styled as a ghost button so it sits in the export
          button row; the open body drops to its own full-width row below. */}
      <details className="collection-header__import" data-testid="import-panel">
        <summary>Import</summary>
        <div className="collection-header__import-body">
          <label className="field field--wide">
            <span className="field__label">Collection export to import</span>
            <textarea
              data-testid="import-input"
              value={importText}
              placeholder="Paste a collection JSON or text export…"
              onChange={(event) => {setImportText(event.target.value);setPreview(null)}}
            />
          </label>
          <div className="tool-actions">
            <label className="check-chip">
              <input
                type="radio"
                name="import-mode"
                data-testid="import-mode-replace"
                checked={mode === 'replace'}
                onChange={() => {setMode('replace');setPreview(null)}}
              />
              Replace
            </label>
            <label className="check-chip">
              <input
                type="radio"
                name="import-mode"
                data-testid="import-mode-merge"
                checked={mode === 'merge'}
                onChange={() => {setMode('merge');setPreview(null)}}
              />
              Merge (add counts)
            </label>
            <button
              type="button"
              data-testid="import-submit"
              disabled={derivedUnavailable || importText.trim() === ''}
              onClick={runImport}
            >
              Preview import
            </button>
          </div>
          {preview && <div className="tool-preview" data-testid="import-preview">
            <p className="tool-figure">{mode} import: {Object.keys(collectionChanges(preview.before,preview.after)).length} changed printing rows · total {totalCount(preview.before)} → {totalCount(preview.after)}</p>
            <details className="tool-panel tool-panel--nested"><summary>Changed counts</summary><div className="tool-panel__body"><div className="change-list">{Object.entries(collectionChanges(preview.before,preview.after)).map(([key,c])=><p key={key}><span>{key}</span><span>{c.before} → {c.after}</span></p>)}</div></div></details>
            <div className="tool-actions"><button type="button" className="btn--primary" disabled={derivedUnavailable} data-testid="import-apply" onClick={()=>{try{if(JSON.stringify(getCollection().counts)!==JSON.stringify(preview.before))throw new Error("Collection changed; preview again.");replaceCollection({counts:preview.after},{kind:mode+" import"});setPreview(null);setImportText("");setError("")}catch(e){setError(String(e))}}}>Apply reviewed import</button></div>
          </div>}
          {error !== '' && (
            <div data-testid="import-error" className="collection-header__error">
              {error}
            </div>
          )}
        </div>
      </details>
    </div>
  )
}
