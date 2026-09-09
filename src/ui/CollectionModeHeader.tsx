//
// The strip under the app nav on the Collection tab: which of the four modes
// is open, whether the file is saved, whether a session draft is waiting, and
// how far the two goals have got. The sync-status block is moved here from
// CollectionHeader verbatim — its states, wording and CSS classes are pinned
// by tests and by e2e (`collection-header__sync--idle`).
import { useMemo, type ReactElement } from 'react'
import type { CardDb } from '../engine/types'
import type { Printing } from './printings'
import { completionStats, exportCollectionJson, useCollection } from './collection'
import { useSyncStatus, retryCollection, resolveConflict, confirmEmptySave, ownershipAvailable } from './collectionSync'
import { readCollectionJournal } from './collectionJournal'
import { isDraftStale, useDraft } from './sessionDraft'

export type CollectionMode = 'browse' | 'add' | 'plan' | 'history'
const MODES: { id: CollectionMode; label: string }[] = [
  { id: 'browse', label: 'Browse' }, { id: 'add', label: 'Add cards' }, { id: 'plan', label: 'Plan purchases' }, { id: 'history', label: 'History & backup' },
]

function totalCount(counts: Record<string, number>): number { return Object.values(counts).reduce((sum, n) => sum + n, 0) }

/** Appended before click and revoked on a later tick: a detached anchor's
 *  click is ignored by Firefox/Safari, and a synchronous revoke can race the
 *  download. Same shape as the old CollectionHeader's helper. */
export function downloadFile(filename: string, content: string, mime = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = filename; anchor.style.display = 'none'
  document.body.appendChild(anchor); anchor.click(); anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function CollectionModeHeader({ db, printings, mode, onMode }: { db: CardDb; printings: Printing[]; mode: CollectionMode; onMode: (m: CollectionMode) => void }): ReactElement {
  const collection = useCollection()
  const syncStatus = useSyncStatus()
  const draft = useDraft()
  const stats = useMemo(() => completionStats(db, printings, collection), [db, printings, collection])
  const historyCount = readCollectionJournal().entries.length
  const staged = draft.lines.reduce((n, l) => n + Math.abs(l.delta ?? (l.exact !== undefined ? 1 : 0)), 0)
  const derivedUnavailable = !ownershipAvailable(syncStatus)

  return (
    <div className="colhead">
      <div className="colhead__modes" role="group" aria-label="Collection modes">
        {MODES.map(m => (
          <button type="button" key={m.id} data-testid={`collection-mode-${m.id}`} aria-pressed={mode === m.id} onClick={() => onMode(m.id)}>
            {m.label}{m.id === 'history' && historyCount > 0 && <span className="colhead__count">{historyCount}</span>}
          </button>
        ))}
      </div>
      <div className="colhead__status">
        <span className={`collection-header__sync collection-header__sync--${syncStatus.state} chip chip--sync`} data-testid="sync-status">
          {syncStatus.state === 'loading' && <>Loading collection…</>}
          {syncStatus.state === 'idle' && <>Saved to disk{syncStatus.lastSavedAt !== undefined ? ` · ${new Date(syncStatus.lastSavedAt).toLocaleTimeString()}` : ''}{syncStatus.git === 'failed' && <span className="collection-header__sync-note"> · git backup failed — your data is safe on disk</span>}</>}
          {syncStatus.git === 'pending' && <> · Background backup pending…</>}
          {syncStatus.gitDetail && <span className="collection-header__sync-note"> · {syncStatus.gitDetail}</span>}
          {syncStatus.state === 'saving' && <>Saving…</>}
          {syncStatus.state === 'unsaved' && <><strong>{syncStatus.pendingCount > 0 ? `${syncStatus.pendingCount} changes not yet saved to disk` : 'Not yet saved to disk'}</strong>{syncStatus.retrying === true ? ' — retrying…' : ''}{syncStatus.message !== undefined && <span className="collection-header__sync-note"> · {syncStatus.message}</span>}</>}
          {syncStatus.state === 'error' && <><strong>The collection could not be read from disk.</strong> Nothing has been overwritten, and no totals are shown because this tab does not know what you own.{syncStatus.message !== undefined && <span className="collection-header__sync-note"> · {syncStatus.message}</span>}</>}
          {syncStatus.state === 'conflict' && <>The collection on disk changed while you were editing.{syncStatus.message !== undefined && <span className="collection-header__sync-note"> · {syncStatus.message}</span>}</>}
          {syncStatus.state === 'would-empty' && <>Refused to save: this would empty a collection that still has cards on disk. Nothing is saved until you confirm.</>}
        </span>
        {(syncStatus.state === 'unsaved' || syncStatus.state === 'error') && <button type="button" data-testid="sync-retry" onClick={() => void retryCollection()}>Retry now</button>}
        {(syncStatus.state === 'unsaved' || syncStatus.state === 'conflict') && <button type="button" data-testid="sync-download" onClick={() => downloadFile('collection.json', exportCollectionJson(collection))}>Download JSON</button>}
        {syncStatus.state === 'conflict' && (
          <span className="collection-header__conflict" data-testid="sync-conflict">
            {syncStatus.conflictDisk !== undefined && <>Disk has {totalCount(syncStatus.conflictDisk.counts)} cards total; yours has {stats.totalOwned}. </>}
            Choose which copy to keep — this cannot be undone.
            <button type="button" data-testid="sync-keep-mine" onClick={() => void resolveConflict('mine')}>Keep mine</button>
            <button type="button" data-testid="sync-take-disk" onClick={() => void resolveConflict('disk')}>Take disk</button>
          </span>
        )}
        {syncStatus.state === 'would-empty' && <button type="button" data-testid="sync-confirm-empty" onClick={() => void confirmEmptySave()}>Yes, save an empty collection</button>}
        {draft.lines.length > 0 && (
          <button type="button" className={`staged-pill${isDraftStale() ? ' staged-pill--stale' : ''}`} data-testid="staged-pill" title={isDraftStale() ? 'This draft survived a reload and has not been applied' : 'Open the draft session'} onClick={() => onMode('add')}>
            <b>{staged}</b> staged <span className="staged-pill__go">review →</span>
          </button>
        )}
        {!derivedUnavailable && (
          <div className="colhead__meters" data-testid="collection-stats">
            <div className="meter"><span className="meter__k">Playset</span><span className="meter__v" data-testid="playset-progress">{stats.playsetOwned} / {stats.playsetTarget} · {stats.playsetPct}%</span><span className="meter__track"><i style={{ width: `${stats.playsetPct}%` }} /></span></div>
            <div className="meter meter--art"><span className="meter__k">Artwork</span><span className="meter__v" data-testid="artwork-progress">{stats.artsOwned} / {stats.artsTarget} · {stats.artsPct}%</span><span className="meter__track"><i style={{ width: `${stats.artsPct}%` }} /></span>{stats.unreviewedPrintings > 0 && <span className="meter__note">{stats.unreviewedPrintings} printings await artwork review</span>}</div>
            <div className="meter meter--phys"><span className="meter__k">Cards owned</span><span className="meter__v meter__v--big">{stats.totalOwned}</span></div>
          </div>
        )}
      </div>
    </div>
  )
}
