// The Collection tab shell: loads the printings dataset once, owns the active
// mode, and mounts the header strip plus the four mode screens. A mode mounts
// the first time it is opened, then stays mounted (behind `hidden`) for the
// rest of the session, so its filters, a half-typed quick add and the review
// column survive switching away and back; a mode that has never been opened
// renders nothing. The mode is remembered per browser tab in sessionStorage.
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type { CardDb } from '../engine/types'
import { loadPrintings, printingsByCard, type Printing } from './printings'
import { getStorageError, useCollection } from './collection'
import { useCollectionAccess } from './collectionAccess'
import { ownershipAvailable, useSyncStatus } from './collectionSync'
import { CollectionModeHeader, type CollectionMode } from './CollectionModeHeader'
import { CollectionBrowse } from './CollectionBrowse'
import { AddCardsMode } from './AddCardsMode'
import { PlanPurchasesMode } from './PlanPurchasesMode'
import { HistoryBackupMode } from './HistoryBackupMode'

const MODE_KEY = 'ctcg:collectionMode:v1'
const MODES: CollectionMode[] = ['browse', 'add', 'plan', 'history']
const NARROW = 860

function readMode(): CollectionMode {
  try { const saved = sessionStorage.getItem(MODE_KEY); return MODES.includes(saved as CollectionMode) ? (saved as CollectionMode) : 'browse' } catch { return 'browse' }
}
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth <= NARROW)
  useEffect(() => { const on = () => setNarrow(window.innerWidth <= NARROW); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on) }, [])
  return narrow
}

export function CollectionView({ db, useOfficialImages }: { db: CardDb; useOfficialImages: boolean }): ReactElement {
  useCollection() // re-render on every write so the storage-error banner is live
  const access = useCollectionAccess()
  const known = ownershipAvailable(useSyncStatus())
  const narrow = useNarrow()
  const [mode, setModeState] = useState<CollectionMode>(readMode)
  // Each mode screen mounts only once it has been visited (starting with the
  // initial mode) so an unvisited screen contributes nothing to the DOM —
  // `hidden` alone isn't enough, since `queryByTestId` still finds hidden
  // elements. Once visited, a screen stays mounted (behind `hidden`) so its
  // filters, a half-typed quick add and the review column survive a switch.
  const [visited, setVisited] = useState<Set<CollectionMode>>(() => new Set([mode]))
  const setMode = (m: CollectionMode) => {
    setModeState(m)
    setVisited((prev) => (prev.has(m) ? prev : new Set(prev).add(m)))
    try { sessionStorage.setItem(MODE_KEY, m) } catch { /* per-tab convenience only */ }
  }
  const loadResult = useMemo(() => {
    try { const printings = loadPrintings(); return { printings, byCard: printingsByCard(printings), error: undefined } }
    catch (err) { return { printings: [] as Printing[], byCard: new Map<string, Printing[]>(), error: String(err) } }
  }, [])
  if (loadResult.error !== undefined) return <div data-testid="collection-error">Collection unavailable: {loadResult.error}</div>

  return (
    <div className="collection-view" data-testid="collection-view">
      {access !== 'writer' && <p role="status" className="tool-error" data-testid="collection-readonly">{access === 'waiting' ? 'Collection is read-only while another tab is editing. Close that tab to continue here.' : 'Safe collection editing requires a browser with Web Locks on localhost or HTTPS.'}</p>}
      <CollectionModeHeader db={db} printings={loadResult.printings} mode={mode} onMode={setMode} />
      <fieldset disabled={access !== 'writer'} className="collection-editor">
        {getStorageError() !== '' && <div className="collection-view__storage-error" data-testid="collection-storage-error">{getStorageError()}</div>}
        <div hidden={mode !== 'browse'}>{visited.has('browse') && <CollectionBrowse db={db} printings={loadResult.printings} byCard={loadResult.byCard} known={known} useOfficialImages={useOfficialImages} narrow={narrow} />}</div>
        <div hidden={mode !== 'add'}>{visited.has('add') && <AddCardsMode db={db} printings={loadResult.printings} known={known} />}</div>
        <div hidden={mode !== 'plan'}>{visited.has('plan') && <PlanPurchasesMode db={db} printings={loadResult.printings} known={known} />}</div>
        <div hidden={mode !== 'history'}>{visited.has('history') && <HistoryBackupMode db={db} printings={loadResult.printings} known={known} />}</div>
      </fieldset>
    </div>
  )
}
