// Pushes the collection to disk through the dev-server endpoint, in the
// background, so the store itself can stay synchronous.
//
// The one rule everything else serves: a failed save must never discard the
// player's work. The pending buffer (src/ui/collection.ts) is cleared only
// after the server confirms a write, so 300 cards entered while the server
// was down survive a reload and are retried until they land.
//
// Every path that adopts a confirmed on-disk state (a successful flush, a
// startup load with no unsaved buffer, "take the disk copy" on conflict)
// goes through `setCollectionFromFile` / `replaceCollection`, never a raw
// buffer clear or a raw localStorage write. Both of those store functions
// update the snapshot cache and notify subscribers in the same call that
// changes storage; clearing the buffer any other way would leave the UI
// showing a stale (possibly empty) collection until the next unrelated
// cache miss — i.e. the durable copy of unsaved work would be gone before
// anything repopulated what the screen shows.
//
// Two invariants a naive implementation misses, both about a PUT that is
// in flight:
//
//  1. NEVER adopt the snapshot a PUT was SENT with over whatever the buffer
//     holds by the time the response comes back. `await`ing the network
//     request is exactly the window in which the player can keep typing (or
//     `visibilitychange`/`beforeunload` can fire another flush), and a
//     `setCollectionFromFile(sentCounts, ...)` on top of a since-updated
//     buffer would silently revert what they just entered — a *successful*
//     save destroying work, which inverts the one rule above. `flushNow`
//     re-reads the buffer after the PUT resolves and compares it to what was
//     sent; if it changed, the sent counts are banked as confirmed and the
//     newer buffer is re-stamped at the new base revision and re-queued,
//     never discarded.
//
//  2. Only ONE PUT may be in flight at a time. A retry timer, the Retry
//     button, `visibilitychange`, and `resolveConflict('mine')` can all call
//     `flushNow` around the same moment; without coalescing, two requests
//     race with the *same* baseRevision, the server correctly serializes
//     them, and the second gets a 409 against a file that already holds the
//     player's own data — a spurious conflict with no real divergence behind
//     it. `flushNow` holds the in-flight request in a module variable and
//     hands every concurrent caller the same promise instead of issuing a
//     second PUT.

import { useSyncExternalStore } from 'react'
import { collectionFileSchema } from '../collection/format'
import {
  getBaseRevision,
  readLegacyCollection,
  readPendingBuffer,
  replaceCollection,
  setBaseRevision,
  setCollectionFromFile,
  subscribeCollection,
} from './collection'

const ROUTE = '/__collection'
const DEBOUNCE_MS = 1000
const BACKOFF_MS = [1000, 2000, 5000, 15000, 30000]

export interface SyncStatus {
  /** `error` is deliberately distinct from `unsaved`: the server answered but
   *  we could not read a collection out of it (a corrupt file, a malformed
   *  body) and there is no pending buffer to fall back on, so the app does
   *  NOT know what the player owns. Rendering the empty in-memory fallback as
   *  fact there would print "0 cards owned" and a buy-list demanding every
   *  card in the game — numbers the owner might act on that nothing measured.
   *  Consumers must suppress derived figures in this state, not show zeros. */
  state: 'idle' | 'saving' | 'unsaved' | 'conflict' | 'would-empty' | 'error'
  pendingCount: number
  lastSavedAt?: string
  message?: string
  git?: 'ok' | 'skipped' | 'failed'
  /** True only when a flush or backoff retry is actually armed. The banner
   *  says "retrying…" from this flag rather than from `state === 'unsaved'`,
   *  because several terminal refusals (400 invalid, 405, a 409 whose body
   *  did not validate) leave the buffer unsaved with nothing scheduled — and
   *  a banner that claims to be retrying when it is not is how a stalled save
   *  goes unnoticed for a whole entry session. */
  retrying?: boolean
  /** Populated only in the `conflict` state: what the server actually holds,
   *  so a chooser UI can show what "keep mine" would overwrite and what
   *  "take theirs" would adopt, without a second round trip. */
  conflictDisk?: { counts: Record<string, number>; revision: number }
}

let status: SyncStatus = { state: 'idle', pendingCount: 0 }
const syncListeners = new Set<() => void>()

// What disk last confirmed as written — the baseline `countPending()` diffs
// the buffer against. Updated on every confirmed load and confirmed write,
// never on a merely-attempted one.
let lastConfirmed: Record<string, number> = {}

// The disk-side counts/revision handed back by a 409 conflict, held so
// `resolveConflict('disk')` can adopt them without a second round trip.
// Mirrored into `status.conflictDisk` for consumers that only read status.
let diskVersion: { counts: Record<string, number>; revision: number } | undefined

let timer: ReturnType<typeof setTimeout> | undefined
let attempt = 0
let started = false
let unsubscribeCollection: (() => void) | undefined
// Same leak class as unsubscribeCollection: added once per `started` guard,
// so they must be torn down in _resetSyncForTests too, or every test after
// the first accumulates another pair of window listeners.
let onVisibilityChange: (() => void) | undefined
let onBeforeUnload: (() => void) | undefined

// The single in-flight PUT, if any. `flushNow` hands every concurrent caller
// this same promise instead of starting a second request — see file header,
// invariant 2.
let inFlight: Promise<void> | undefined

function setStatus(next: Partial<SyncStatus>): void {
  status = { ...status, ...next }
  for (const listener of syncListeners) listener()
}

/** Unsaved copies: how far the buffer is from what disk last confirmed. */
function countPending(): number {
  const buffer = readPendingBuffer()
  if (buffer === undefined) return 0
  const keys = new Set([...Object.keys(buffer.counts), ...Object.keys(lastConfirmed)])
  let total = 0
  for (const key of keys) {
    total += Math.abs((buffer.counts[key] ?? 0) - (lastConfirmed[key] ?? 0))
  }
  return total
}

/** Structural equality for count maps — used to detect whether the buffer
 *  changed while a PUT carrying an earlier snapshot of it was in flight. */
function sameCounts(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if ((a[key] ?? 0) !== (b[key] ?? 0)) return false
  }
  return true
}

/** A 409's `current` field is what makes conflict resolution possible; a
 *  response claiming `reason: 'conflict'` without a well-shaped `current`
 *  must NOT enter the conflict state, because nothing could ever leave it
 *  (`resolveConflict` no-ops without a `diskVersion`). Falling through to
 *  the generic-failure branch instead keeps the buffer and stays retryable. */
function isCurrentPayload(value: unknown): value is { counts: Record<string, number>; revision: number } {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { counts?: unknown; revision?: unknown }
  return (
    typeof candidate.revision === 'number' &&
    typeof candidate.counts === 'object' &&
    candidate.counts !== null
  )
}

/** Reference-stable between changes: `useSyncExternalStore` re-renders only
 *  when this returns a new reference, so `setStatus` is the only place
 *  allowed to replace it. */
export function getSyncStatus(): SyncStatus {
  return status
}

export function subscribeSync(listener: () => void): () => void {
  syncListeners.add(listener)
  return () => syncListeners.delete(listener)
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeSync, getSyncStatus)
}

/** The actual PUT-and-react-to-it logic. Only ever called from `flushNow`,
 *  which is responsible for making sure at most one of these runs at a time
 *  (invariant 2 above) — never call this directly. */
async function performFlush(confirmEmpty: boolean): Promise<void> {
  const buffer = readPendingBuffer()
  if (buffer === undefined) return
  // A conflict is resolved by the user, never by the retry loop.
  if (status.state === 'conflict') return
  // A would-empty refusal is resolved by an explicit confirmEmptySave(),
  // never by the retry loop re-sending the same refused body.
  if (status.state === 'would-empty' && !confirmEmpty) return

  setStatus({ state: 'saving' })
  let response: Response
  try {
    response = await fetch(ROUTE, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseRevision: getBaseRevision(), counts: buffer.counts, confirmEmpty }),
      keepalive: true,
    })
  } catch (err) {
    scheduleRetry()
    setStatus({ state: 'unsaved', pendingCount: countPending(), message: String(err), retrying: true })
    return
  }

  const body = (await response.json().catch(() => ({}))) as {
    reason?: string
    message?: string
    current?: unknown
    revision?: number
    savedAt?: string
    git?: { status: 'ok' | 'skipped' | 'failed' }
  }

  if (response.status === 200 && typeof body.revision === 'number') {
    // Invariant 1: never trust that `buffer` (what was SENT) is still what
    // the player wants. Re-read the live buffer and compare.
    const live = readPendingBuffer()
    const liveCounts = live?.counts ?? buffer.counts
    attempt = 0

    if (sameCounts(liveCounts, buffer.counts)) {
      // Nothing changed while the PUT was in flight — adopt normally.
      // Ruling: through setCollectionFromFile, which sets the revision,
      // clears the buffer, refreshes the snapshot, and notifies subscribers
      // in one call — never clearPendingBuffer() + setBaseRevision() alone,
      // which would leave the cache stale.
      lastConfirmed = { ...buffer.counts }
      setCollectionFromFile(buffer.counts, body.revision)
      setStatus({
        state: 'idle',
        pendingCount: 0,
        lastSavedAt: body.savedAt,
        message: undefined,
        git: body.git?.status,
        retrying: false,
      })
    } else {
      // The buffer moved on while this PUT was in flight. The sent counts
      // are still confirmed-on-disk truth — bank them as `lastConfirmed` —
      // but the NEWER buffer is the player's actual current work and must
      // not be discarded or overwritten with the stale sent snapshot.
      // Re-stamp it at the new base revision (setBaseRevision before
      // replaceCollection, same ordering reason as the migration ruling:
      // writeCollection stamps the buffer with the module-live
      // baseRevision) and queue it for its own flush.
      lastConfirmed = { ...buffer.counts }
      setBaseRevision(body.revision)
      replaceCollection({ counts: liveCounts })
      setStatus({
        state: 'unsaved',
        pendingCount: countPending(),
        lastSavedAt: body.savedAt,
        message: undefined,
        git: body.git?.status,
        retrying: true,
      })
      scheduleFlush()
    }
    return
  }

  if (response.status === 409 && body.reason === 'conflict' && isCurrentPayload(body.current)) {
    diskVersion = body.current
    setStatus({
      state: 'conflict',
      pendingCount: countPending(),
      message: body.message,
      conflictDisk: diskVersion,
      retrying: false,
    })
    return
  }

  if (response.status === 409 && body.reason === 'would-empty') {
    setStatus({ state: 'would-empty', pendingCount: countPending(), message: body.message, retrying: false })
    return
  }

  // A 5xx is the server failing to do something it was willing to try — the
  // most likely cause on the owner's machine is a transient EPERM/EBUSY on
  // the backup copy (OneDrive or antivirus holding collection.backup.json
  // open), which `writeCollectionFile` deliberately propagates. That clears
  // on its own, so it IS worth retrying; without a retry here the save is
  // silently stalled until someone happens to press Retry.
  const retryable = response.status >= 500
  if (retryable) scheduleRetry()

  // 400 invalid, 405, a 409 whose body didn't validate as a real conflict:
  // retrying unchanged data will not help, but the buffer is still the
  // player's work — keep it, say so, and (via `retrying: false`) do not let
  // the banner claim a retry is coming when none is armed.
  setStatus({
    state: 'unsaved',
    pendingCount: countPending(),
    message: body.message ?? 'The collection endpoint returned an unexpected response.',
    retrying: retryable,
  })
}

/** Used by the Retry button, mutation-triggered auto-flush, and tests.
 *  Coalesces concurrent calls onto a single in-flight PUT (invariant 2). */
export function flushNow(options?: { confirmEmpty?: boolean }): Promise<void> {
  if (timer !== undefined) {
    clearTimeout(timer)
    timer = undefined
  }
  if (inFlight !== undefined) return inFlight
  const confirmEmpty = options?.confirmEmpty === true
  inFlight = performFlush(confirmEmpty).finally(() => {
    inFlight = undefined
  })
  return inFlight
}

/** Explicit user confirmation of a `would-empty` refusal — re-sends the
 *  current buffer with `confirmEmpty: true`. */
export function confirmEmptySave(): Promise<void> {
  return flushNow({ confirmEmpty: true })
}

function scheduleRetry(): void {
  const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]
  attempt += 1
  if (timer !== undefined) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = undefined
    void flushNow()
  }, delay)
}

function scheduleFlush(): void {
  // Neither state resolves itself automatically — see performFlush's guards.
  if (status.state === 'conflict' || status.state === 'would-empty') return
  attempt = 0
  if (timer !== undefined) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = undefined
    void flushNow()
  }, DEBOUNCE_MS)
}

export async function resolveConflict(choice: 'mine' | 'disk'): Promise<void> {
  if (diskVersion === undefined) return
  if (choice === 'disk') {
    setCollectionFromFile(diskVersion.counts, diskVersion.revision)
    lastConfirmed = { ...diskVersion.counts }
    diskVersion = undefined
    setStatus({
      state: 'idle',
      pendingCount: 0,
      message: undefined,
      conflictDisk: undefined,
      retrying: false,
    })
    return
  }
  // Keep mine: re-base onto the disk revision and flush again.
  const revision = diskVersion.revision
  setBaseRevision(revision)
  diskVersion = undefined
  setStatus({
    state: 'unsaved',
    pendingCount: countPending(),
    message: undefined,
    conflictDisk: undefined,
    retrying: true,
  })
  // Re-stamp the DURABLE buffer at the chosen revision too, not just the
  // module-level baseRevision. The buffer still carries the base it was
  // written against, and `initCollectionSync` now compares that field to the
  // file's revision — so without this, a "keep mine" whose flush does not
  // land (server down) would come back as the same conflict banner on the
  // next reload, asking the player to make a decision they already made.
  const buffer = readPendingBuffer()
  if (buffer !== undefined) replaceCollection({ counts: buffer.counts })
  await flushNow()
}

export async function initCollectionSync(): Promise<void> {
  // Registered SYNCHRONOUSLY, before the GET is even issued. Two reasons,
  // both about the await window below:
  //
  //  * a mutation that lands while the GET is in flight would otherwise be
  //    neither noticed nor scheduled — no listener exists yet — so it would
  //    sit in the buffer with nothing arranged to send it;
  //  * anything that throws before the registration (a malformed response, a
  //    schema change, a future edit to this function) would leave the session
  //    with NO auto-save at all while the status line still reads "Saved to
  //    disk". Registration first makes that impossible.
  //
  // The listener is safe to have running during init: it acts only when a
  // pending buffer exists, and `scheduleFlush` is a debounce, so at worst it
  // arms a timer that the code below re-evaluates a few milliseconds later.
  if (!started) {
    started = true
    unsubscribeCollection = subscribeCollection(() => {
      if (readPendingBuffer() !== undefined) {
        const next = status.state === 'conflict' ? 'conflict' : 'unsaved'
        setStatus({ state: next, pendingCount: countPending(), retrying: next === 'unsaved' })
        scheduleFlush()
      }
    })
    if (typeof window !== 'undefined') {
      onVisibilityChange = () => {
        if (document.visibilityState === 'hidden') void flushNow()
      }
      onBeforeUnload = () => void flushNow()
      window.addEventListener('visibilitychange', onVisibilityChange)
      window.addEventListener('beforeunload', onBeforeUnload)
    }
  }

  let file: { counts: Record<string, number>; revision: number } | undefined
  let unreachable = false
  let serverMessage: string | undefined
  try {
    const response = await fetch(ROUTE)
    if (response.ok) {
      // Parsed with the SHARED schema rather than cast. An unvalidated cast
      // means a 200 that happens to lack `counts` throws at the first
      // `Object.keys(file.counts)` below — inside init, before anything has
      // been decided — which is precisely the "session with no auto-save"
      // hole the synchronous registration above closes from the other side.
      const parsed = collectionFileSchema.safeParse(await response.json().catch(() => undefined))
      if (parsed.success) file = parsed.data
      else serverMessage = 'The collection endpoint returned something that is not a collection file.'
    } else {
      // Responded, just not with 2xx — e.g. a 500 for a corrupt collection
      // file. This is NOT "unreachable": the server is there and told us
      // something specific, so surface that instead of the generic
      // can't-reach-the-server text.
      const errorBody = (await response.json().catch(() => ({}))) as { message?: string }
      serverMessage = errorBody.message ?? `The collection endpoint returned ${response.status}.`
    }
  } catch {
    unreachable = true
  }

  // Read AFTER the response: a mutation made during the GET is real unsaved
  // work and must be seen here, not missed because the buffer was sampled
  // before the await.
  const buffer = readPendingBuffer()

  // A GET issued before a flush can resolve AFTER it. Registering the
  // listeners synchronously (above) made that reachable: the player can edit
  // during a slow GET, the debounce — or a visibilitychange/beforeunload
  // flush — can PUT and succeed, and only then does this response arrive,
  // still describing the file as it was BEFORE that write. Adopting it would
  // roll the just-saved card off the screen and regress `baseRevision` behind
  // what disk actually holds, with the banner reading "Saved to disk"; the
  // next flush would then 409, and a "Keep mine" there would discard the card.
  //
  // `getBaseRevision()` is the revision this client last CONFIRMED (a
  // successful PUT, or an earlier adopted file), so a response older than it
  // is describing a past we have already moved beyond. Comparing against our
  // own confirmed revision — rather than a timestamp or a request sequence —
  // cannot skip a legitimately newer file, because a newer file always has a
  // revision >= the one we confirmed.
  if (file !== undefined && file.revision < getBaseRevision()) {
    return
  }

  if (file !== undefined) {
    lastConfirmed = { ...file.counts }
    if (buffer === undefined) {
      setCollectionFromFile(file.counts, file.revision)
      // Migration: a never-written file (revision 0) with empty counts plus a
      // legacy key means a pre-file collection. The `revision === 0` half is
      // load-bearing: a collection the owner deliberately emptied lives on
      // disk at some high revision with empty counts, and re-seeding THAT
      // from a stale legacy key would resurrect cards they removed on
      // purpose, on every load.
      const legacy = readLegacyCollection()
      if (
        file.revision === 0 &&
        Object.keys(file.counts).length === 0 &&
        legacy !== undefined &&
        Object.keys(legacy.counts).length > 0
      ) {
        // Ruling: write through replaceCollection, not a raw
        // localStorage.setItem(PENDING_KEY, ...) — a raw write bypasses the
        // store's cache invalidation and listener notification, so the UI
        // would keep showing an empty (just-adopted-from-file) collection
        // after migrating, until some unrelated cache miss happened to
        // repaint it. replaceCollection invalidates the cache and notifies
        // subscribers in the same call. (baseRevision is already
        // file.revision here — setCollectionFromFile just above set it —
        // so there is no separate setBaseRevision call to sequence.)
        replaceCollection({ counts: legacy.counts })
        setStatus({ state: 'unsaved', pendingCount: countPending(), retrying: true })
        scheduleFlush()
      } else {
        setStatus({ state: 'idle', pendingCount: 0, retrying: false })
      }
    } else if (buffer.baseRevision === file.revision) {
      // The ordinary single-tab case: the buffer was derived from exactly
      // the state that is on disk, so it is a descendant of the file and
      // flushing it loses nothing. (`writeCollection` stamps every mutation
      // with the module-level baseRevision, which tracks the last confirmed
      // file revision, so this is the normal path — no false conflicts.)
      setBaseRevision(file.revision)
      setStatus({ state: 'unsaved', pendingCount: countPending(), retrying: true })
      scheduleFlush()
    } else if (sameCounts(buffer.counts, file.counts)) {
      // Diverged bases, but identical contents: whatever happened, there is
      // nothing in the buffer the file does not already hold. Adopt the file
      // and clear the buffer rather than bothering the player about a
      // difference that does not exist.
      setCollectionFromFile(file.counts, file.revision)
      setStatus({ state: 'idle', pendingCount: 0, retrying: false })
    } else {
      // The buffer is NEWER IN TIME but not a descendant of what is on disk:
      // it was derived from revision `buffer.baseRevision`, and the file has
      // since moved to `file.revision`. Flushing it would silently overwrite
      // whatever produced that newer revision (another tab's save; a file
      // that arrived while a startup GET was failing). The spec reserves
      // exactly this for the player — "Revision conflict → user chooses;
      // nothing overwritten automatically" — so hand it to the same chooser
      // a 409 uses, which already shows both totals.
      diskVersion = { counts: file.counts, revision: file.revision }
      setStatus({
        state: 'conflict',
        pendingCount: countPending(),
        message: `Unsaved changes in this browser were made against revision ${buffer.baseRevision}, but the file on disk is at revision ${file.revision}.`,
        conflictDisk: diskVersion,
        retrying: false,
      })
    }
  } else if (buffer === undefined && !unreachable) {
    // The server answered and could not give us a collection (a corrupt file
    // on disk, a malformed body), and there is no buffer either — so nothing
    // in this tab knows what the player owns. Refuse the tab rather than
    // presenting the empty fallback as fact; see SyncStatus.state.
    setStatus({
      state: 'error',
      pendingCount: 0,
      message: serverMessage ?? 'The collection endpoint returned an unexpected response.',
      retrying: false,
    })
  } else {
    setStatus({
      state: 'unsaved',
      pendingCount: countPending(),
      message: unreachable
        ? 'Cannot reach the dev server — changes are kept in this browser until it returns.'
        : (serverMessage ?? 'The collection endpoint returned an unexpected response.'),
      retrying: buffer !== undefined,
    })
    if (buffer !== undefined) scheduleRetry()
  }
}

export function _resetSyncForTests(): void {
  if (timer !== undefined) clearTimeout(timer)
  timer = undefined
  attempt = 0
  inFlight = undefined
  // Ruling: unsubscribe before clearing `started`, or every test's init adds
  // another live listener on src/ui/collection.ts's module-level listener
  // set, and by the end of a test file one mutation schedules N flushes.
  if (unsubscribeCollection !== undefined) {
    unsubscribeCollection()
    unsubscribeCollection = undefined
  }
  if (typeof window !== 'undefined') {
    if (onVisibilityChange !== undefined) window.removeEventListener('visibilitychange', onVisibilityChange)
    if (onBeforeUnload !== undefined) window.removeEventListener('beforeunload', onBeforeUnload)
  }
  onVisibilityChange = undefined
  onBeforeUnload = undefined
  started = false
  diskVersion = undefined
  lastConfirmed = {}
  status = { state: 'idle', pendingCount: 0 }
  syncListeners.clear()
}
