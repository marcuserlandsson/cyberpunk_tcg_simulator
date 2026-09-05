// The player's owned-cards collection: a flat printingKey -> count map in
// localStorage. Counts are the only stored state; everything else (playset
// gaps, missing arts, buy-lists — Task 5) derives from (db, printings,
// collection). Unknown printing keys found in storage are preserved, never
// dropped: they are the player's data even when printings.json can no longer
// display them, and exports still round-trip them.
//
// Reads and writes are validated against the SAME schema on purpose: the read
// side is forgiving (a malformed blob falls back to empty), so the write side
// has to be strict, or one out-of-schema count could make the next page load
// discard every other key with nothing said about it.

import { useSyncExternalStore } from 'react'
import { z } from 'zod'
import type { CardDb, CardDef } from '../engine/types'
import { collectionSchema, type Collection } from '../collection/format'
import { formatZodIssues, getPrinting, type Printing } from './printings'
import { buildDisplayNames } from './storage'

const COLLECTION_KEY = 'ctcg:collection:v1'

export type { Collection }

/** Snapshots handed to components are frozen: `useSyncExternalStore` shares
 *  one reference across every consumer until the next write, so a consumer
 *  that mutated `counts` in place (bypassing setCount) would corrupt the
 *  cache for everyone and never reach localStorage. */
function freeze(collection: Collection): Collection {
  Object.freeze(collection.counts)
  return Object.freeze(collection)
}

/**
 * A FRESH empty collection each call, deliberately not one shared `EMPTY`
 * singleton. `useSyncExternalStore` re-renders only when `getSnapshot`'s
 * reference changes, and the cache below guarantees the reference is stable
 * until a write invalidates it — so identity per *read* is unnecessary, but
 * identity per *write* is load-bearing. With a shared singleton, a write that
 * failed while the collection was empty produced snapshot === snapshot and
 * React bailed out of the re-render, which meant the `getStorageError()`
 * banner (spec §5) never appeared for the very first failed write. A write
 * attempt is a store event; the snapshot has to be able to say so.
 */
function emptyCollection(): Collection {
  return freeze({ counts: {} })
}

// Snapshot cache: useSyncExternalStore requires getSnapshot to return the
// same reference until the store actually changes, so reads go through this
// cache and every write invalidates it.
let cache: Collection | undefined

// Mirrors storage.ts's private readJson posture (forgiving read, fallback on
// junk) — an *explicit import* (Task 6) errors loudly instead.
function readCollection(): Collection {
  const raw = localStorage.getItem(COLLECTION_KEY)
  if (raw === null) return emptyCollection()
  try {
    const parsed = collectionSchema.safeParse(JSON.parse(raw))
    return parsed.success ? freeze(parsed.data) : emptyCollection()
  } catch {
    return emptyCollection()
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
  // Never persist a blob `readCollection` would refuse. The reader validates
  // against `collectionSchema` and falls back to EMPTY on failure, so a single
  // out-of-schema count (e.g. 1e20 — an integer, but not a *safe* integer,
  // which is what zod's `.int()` demands) written here would silently discard
  // the player's *entire* collection on the next page load. Refuse the write
  // and say why instead. The cache invalidation + notify below still run on
  // this path on purpose: the UI must snap back to what is actually in
  // storage rather than keep showing a phantom count.
  const validated = collectionSchema.safeParse({ counts })
  if (!validated.success) {
    storageError = `Could not save the collection (invalid counts, nothing was written):\n${formatZodIssues(validated.error)}`
  } else {
    try {
      localStorage.setItem(COLLECTION_KEY, JSON.stringify({ counts }))
      storageError = ''
    } catch (err) {
      storageError = `Could not save the collection (browser storage full or blocked): ${String(err)}`
    }
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

// ---------------------------------------------------------------------------
// Derived queries — pure functions over (db, printings, collection); no
// localStorage access, so they test without jsdom state and memoize cleanly
// in components.
// ---------------------------------------------------------------------------

/**
 * Owned copies per `cardId`, summed across every printing of that card, in a
 * single O(printings) pass. THE one implementation of "how many of this card
 * do I own" — the Collection grid badge, the Deck Builder badge, `playsetGaps`
 * and `completionStats` all route through it, so the two badges can never
 * answer the same question with two different numbers. Absent key means 0
 * (zero counts are never materialized); callers read it with `?? 0`.
 *
 * (Replaces the spec §2.2 `cardTotal(cardId)` single-card lookup: every real
 * caller needs the whole map, and 141 × O(426) scans is the wrong shape.)
 */
export function ownedByCard(printings: Printing[], collection: Collection): Record<string, number> {
  const owned: Record<string, number> = {}
  for (const printing of printings) {
    const count = collection.counts[printing.key] ?? 0
    if (count > 0) owned[printing.cardId] = (owned[printing.cardId] ?? 0) + count
  }
  return owned
}

/** Deck rules allow 3 copies of a card but decks run single legends; a
 *  playset of a legend is 1. */
export function playsetTarget(def: CardDef): number {
  return def.type === 'legend' ? 1 : 3
}

export interface PlaysetGap {
  cardId: string
  owned: number
  target: number
  missing: number
}

export function playsetGaps(db: CardDb, printings: Printing[], collection: Collection): PlaysetGap[] {
  const owned = ownedByCard(printings, collection)
  const gaps: PlaysetGap[] = []
  for (const def of Object.values(db)) {
    const have = owned[def.id] ?? 0
    const target = playsetTarget(def)
    if (have < target) gaps.push({ cardId: def.id, owned: have, target, missing: target - have })
  }
  return gaps
}

export function missingPrintings(printings: Printing[], collection: Collection): Printing[] {
  return printings.filter((printing) => (collection.counts[printing.key] ?? 0) === 0)
}

export interface CompletionStats {
  playsetPct: number
  artsPct: number
  totalOwned: number
}

export function completionStats(db: CardDb, printings: Printing[], collection: Collection): CompletionStats {
  const owned = ownedByCard(printings, collection)
  let targetSum = 0
  let ownedTowardTarget = 0
  for (const def of Object.values(db)) {
    const target = playsetTarget(def)
    targetSum += target
    ownedTowardTarget += Math.min(owned[def.id] ?? 0, target)
  }
  const ownedPrintings = printings.filter((p) => (collection.counts[p.key] ?? 0) > 0).length
  const totalOwned = Object.values(collection.counts).reduce((sum, n) => sum + n, 0)
  return {
    playsetPct: targetSum === 0 ? 0 : Math.round((ownedTowardTarget / targetSum) * 100),
    artsPct: printings.length === 0 ? 0 : Math.round((ownedPrintings / printings.length) * 100),
    totalOwned,
  }
}

/** Plain-text want-list: playset shortfalls as "Nx Name", missing printings
 *  as "Name [printingKey]". Copy-paste friendly for trades. */
export function buildBuyList(
  db: CardDb,
  printings: Printing[],
  collection: Collection,
  options: { playset: boolean; arts: boolean }
): string {
  const names = buildDisplayNames(db)
  const lines: string[] = []
  if (options.playset) {
    lines.push('## Missing for playset')
    for (const gap of playsetGaps(db, printings, collection)) {
      lines.push(`${gap.missing}x ${names.get(gap.cardId) ?? gap.cardId}`)
    }
  }
  if (options.arts) {
    if (lines.length > 0) lines.push('')
    lines.push('## Missing printings')
    for (const printing of missingPrintings(printings, collection)) {
      lines.push(`${names.get(printing.cardId) ?? printing.cardId} [${printing.key}]`)
    }
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Export / import. JSON is the backup format (full fidelity, includes unknown
// keys); text is the human/trade format ("2x Name [printingKey]" — the
// bracketed key is authoritative on import, the name decorative). Imports are
// all-or-nothing: every error is collected and thrown together, and nothing
// is written unless the whole input parses (importDeckText's posture).
// ---------------------------------------------------------------------------

const exportSchema = z.object({
  version: z.literal(1),
  counts: z.record(z.string(), z.number().int().nonnegative()),
})

export function exportCollectionJson(collection: Collection): string {
  return JSON.stringify({ version: 1, counts: collection.counts }, null, 1)
}

function applyImport(counts: Record<string, number>, mode: 'replace' | 'merge'): void {
  if (mode === 'replace') {
    replaceCollection({ counts })
    return
  }
  const merged = { ...getCollection().counts }
  for (const [key, count] of Object.entries(counts)) {
    merged[key] = (merged[key] ?? 0) + count
  }
  replaceCollection({ counts: merged })
}

export function importCollectionJson(text: string, mode: 'replace' | 'merge'): void {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('Could not import collection: not valid JSON.')
  }
  const result = exportSchema.safeParse(raw)
  if (!result.success) {
    throw new Error(`Could not import collection:\n${formatZodIssues(result.error)}`)
  }
  applyImport(result.data.counts, mode)
}

export function exportCollectionText(
  db: CardDb,
  printings: Printing[],
  collection: Collection
): string {
  const names = buildDisplayNames(db)
  const lines: string[] = []
  for (const [key, count] of Object.entries(collection.counts)) {
    const printing = getPrinting(printings, key)
    const name = printing ? names.get(printing.cardId) ?? printing.cardId : '???'
    lines.push(`${count}x ${name} [${key}]`)
  }
  return lines.join('\n')
}

export function importCollectionText(text: string, mode: 'replace' | 'merge'): void {
  const counts: Record<string, number> = {}
  const errors: string[] = []
  // Distinct from "counts stayed empty": a well-formed text export can only
  // ever describe owned printings (there is no way to write "counts: {}" in
  // this format, unlike JSON), so blank/whitespace-only input is ambiguous
  // between "the user meant an empty collection" and "nothing was pasted" —
  // treat it as the latter and refuse rather than silently wipe.
  let sawLine = false
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '') continue
    sawLine = true
    const match = line.match(/^(\d+)\s*x\s+.*\[(.+)\]$/i)
    if (!match) {
      errors.push(`malformed line "${line}" (expected "Nx Name [printingKey]")`)
      continue
    }
    const [, count, key] = match
    // `\d+` is unbounded, so a mangled line can carry a count that survives
    // parsing but not `collectionSchema` (`.int()` is zod 4's *safe* integer):
    // `Number("99999999999999999999")` is 1e20. Report it here, through the
    // same all-or-nothing error collection as a malformed line, rather than
    // letting writeCollection refuse the write with nothing said about which
    // line caused it.
    const parsed = Number(count)
    if (!Number.isSafeInteger(parsed)) {
      errors.push(
        `count out of range on line "${line}" (must be a whole number up to ${Number.MAX_SAFE_INTEGER})`
      )
      continue
    }
    counts[key] = (counts[key] ?? 0) + parsed
  }
  if (errors.length > 0) {
    throw new Error(`Could not import collection:\n${errors.join('\n')}`)
  }
  if (!sawLine) {
    throw new Error('Could not import collection: no card lines found.')
  }
  applyImport(counts, mode)
}
