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

import { useSyncExternalStore } from 'react'
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
  state: 'idle' | 'saving' | 'unsaved' | 'conflict'
  pendingCount: number
  lastSavedAt?: string
  message?: string
  git?: 'ok' | 'skipped' | 'failed'
}

let status: SyncStatus = { state: 'idle', pendingCount: 0 }
const syncListeners = new Set<() => void>()

// What disk last confirmed as written — the baseline `countPending()` diffs
// the buffer against. Updated on every confirmed load and confirmed write,
// never on a merely-attempted one.
let lastConfirmed: Record<string, number> = {}

// The disk-side counts/revision handed back by a 409 conflict, held so
// `resolveConflict('disk')` can adopt them without a second round trip.
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

export async function flushNow(): Promise<void> {
  if (timer !== undefined) {
    clearTimeout(timer)
    timer = undefined
  }
  const buffer = readPendingBuffer()
  if (buffer === undefined) return
  // A conflict is resolved by the user, never by the retry loop.
  if (status.state === 'conflict') return

  setStatus({ state: 'saving' })
  let response: Response
  try {
    response = await fetch(ROUTE, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseRevision: getBaseRevision(), counts: buffer.counts }),
      keepalive: true,
    })
  } catch (err) {
    scheduleRetry()
    setStatus({ state: 'unsaved', pendingCount: countPending(), message: String(err) })
    return
  }

  const body = (await response.json().catch(() => ({}))) as {
    reason?: string
    message?: string
    current?: { counts: Record<string, number>; revision: number }
    revision?: number
    savedAt?: string
    git?: { status: 'ok' | 'skipped' | 'failed' }
  }

  if (response.status === 200 && typeof body.revision === 'number') {
    // Ruling: adopt the confirmed write through setCollectionFromFile, which
    // sets the revision, clears the buffer, refreshes the snapshot, and
    // notifies subscribers in one call — never clearPendingBuffer() +
    // setBaseRevision() alone, which would leave the cache stale.
    lastConfirmed = { ...buffer.counts }
    setCollectionFromFile(buffer.counts, body.revision)
    attempt = 0
    setStatus({
      state: 'idle',
      pendingCount: 0,
      lastSavedAt: body.savedAt,
      message: undefined,
      git: body.git?.status,
    })
    return
  }

  if (response.status === 409 && body.reason === 'conflict') {
    diskVersion = body.current
    setStatus({ state: 'conflict', pendingCount: countPending(), message: body.message })
    return
  }

  // 400 invalid, 409 would-empty, 500 corrupt: retrying unchanged data will
  // not help, but the buffer is still the player's work — keep it and say
  // so. No automatic retry is scheduled here on purpose (see BACKOFF_MS
  // usage in scheduleRetry, which only fires for network-level failures).
  setStatus({
    state: 'unsaved',
    pendingCount: countPending(),
    message: body.message ?? 'The collection endpoint returned an unexpected response.',
  })
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
  if (status.state === 'conflict') return
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
    setStatus({ state: 'idle', pendingCount: 0, message: undefined })
    return
  }
  // Keep mine: re-base onto the disk revision and flush again.
  setBaseRevision(diskVersion.revision)
  diskVersion = undefined
  setStatus({ state: 'unsaved', pendingCount: countPending(), message: undefined })
  await flushNow()
}

export async function initCollectionSync(): Promise<void> {
  const buffer = readPendingBuffer()

  let file: { counts: Record<string, number>; revision: number } | undefined
  try {
    const response = await fetch(ROUTE)
    if (response.ok) file = (await response.json()) as { counts: Record<string, number>; revision: number }
  } catch {
    file = undefined
  }

  if (file !== undefined) {
    lastConfirmed = { ...file.counts }
    if (buffer === undefined) {
      setCollectionFromFile(file.counts, file.revision)
      // Migration: an empty file plus a legacy key means a pre-file collection.
      const legacy = readLegacyCollection()
      if (Object.keys(file.counts).length === 0 && legacy !== undefined && Object.keys(legacy.counts).length > 0) {
        // Ruling: setBaseRevision must run BEFORE replaceCollection, so the
        // buffer it writes records the correct base revision.
        setBaseRevision(file.revision)
        // Ruling: write through replaceCollection, not a raw
        // localStorage.setItem(PENDING_KEY, ...) — a raw write bypasses the
        // store's cache invalidation and listener notification, so the UI
        // would keep showing an empty collection after migrating.
        replaceCollection({ counts: legacy.counts })
        setStatus({ state: 'unsaved', pendingCount: countPending() })
        scheduleFlush()
      } else {
        setStatus({ state: 'idle', pendingCount: 0 })
      }
    } else {
      // The buffer is unsaved work and therefore newer than the file.
      setBaseRevision(file.revision)
      setStatus({ state: 'unsaved', pendingCount: countPending() })
      scheduleFlush()
    }
  } else {
    setStatus({
      state: 'unsaved',
      pendingCount: countPending(),
      message: 'Cannot reach the dev server — changes are kept in this browser until it returns.',
    })
    if (buffer !== undefined) scheduleRetry()
  }

  if (!started) {
    started = true
    unsubscribeCollection = subscribeCollection(() => {
      if (readPendingBuffer() !== undefined) {
        setStatus({ state: status.state === 'conflict' ? 'conflict' : 'unsaved', pendingCount: countPending() })
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
}

export function _resetSyncForTests(): void {
  if (timer !== undefined) clearTimeout(timer)
  timer = undefined
  attempt = 0
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
