// The player's owned-cards collection: a flat printingKey -> count map in
// localStorage. Counts are the only stored state; everything else (playset
// gaps, missing arts, buy-lists — Task 5) derives from (db, printings,
// collection). Unknown printing keys found in storage are preserved, never
// dropped: they are the player's data even when printings.json can no longer
// display them, and exports still round-trip them.

import { useSyncExternalStore } from 'react'
import { z } from 'zod'

const COLLECTION_KEY = 'ctcg:collection:v1'

export interface Collection {
  counts: Record<string, number>
}

const collectionSchema = z.object({
  counts: z.record(z.string(), z.number().int().nonnegative()),
})

const EMPTY: Collection = { counts: {} }

// Snapshot cache: useSyncExternalStore requires getSnapshot to return the
// same reference until the store actually changes, so reads go through this
// cache and every write invalidates it.
let cache: Collection | undefined

// Mirrors storage.ts's private readJson posture (forgiving read, fallback on
// junk) — an *explicit import* (Task 6) errors loudly instead.
function readCollection(): Collection {
  const raw = localStorage.getItem(COLLECTION_KEY)
  if (raw === null) return EMPTY
  try {
    const parsed = collectionSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : EMPTY
  } catch {
    return EMPTY
  }
}

const listeners = new Set<() => void>()

// Set when a write fails (localStorage quota, blocked storage). Surfaced by
// CollectionView as a visible banner (spec §5) rather than lost in the
// console; cleared by the next successful write.
let storageError = ''

export function getStorageError(): string {
  return storageError
}

function writeCollection(collection: Collection): void {
  // Prune zero counts: absence means 0.
  const counts: Record<string, number> = {}
  for (const [key, count] of Object.entries(collection.counts)) {
    if (count > 0) counts[key] = count
  }
  try {
    localStorage.setItem(COLLECTION_KEY, JSON.stringify({ counts }))
    storageError = ''
  } catch (err) {
    storageError = `Could not save the collection (browser storage full or blocked): ${String(err)}`
  }
  cache = undefined
  for (const listener of listeners) listener()
}

export function getCollection(): Collection {
  if (cache === undefined) cache = readCollection()
  return cache
}

export function setCount(key: string, count: number): void {
  const next = { counts: { ...getCollection().counts } }
  next.counts[key] = Math.max(0, count)
  writeCollection(next)
}

export function adjustCount(key: string, delta: number): void {
  setCount(key, (getCollection().counts[key] ?? 0) + delta)
}

export function subscribeCollection(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Live collection for components: re-renders on any collection write, in
 *  whichever tab the write happened (Collection tab edits update the Deck
 *  Builder badge live — both stay mounted). */
export function useCollection(): Collection {
  return useSyncExternalStore(subscribeCollection, getCollection)
}

/** Replaces the whole collection in one write (used by import — Task 6). */
export function replaceCollection(collection: Collection): void {
  writeCollection(collection)
}

/** Test-only: drops the snapshot cache so localStorage seeding/clearing in a
 *  test is observed. Underscore-prefixed by convention; not for app code. */
export function _resetCollectionCacheForTests(): void {
  cache = undefined
}
