// Ordering for the Collection tab's Browse mode.
//
// "Number" order is the default because it is how a binder is laid out:
// cards in the set's collector-number sequence. A card has several printings
// with different numbers, so the key used is its lowest number in the set
// currently filtered — or, with no set chosen, in the core set (the one with
// the most printings, which is the Beta base set on the shipped data). Cards
// with no printing in that set (promos, box toppers) sort after the rest,
// among themselves by their own numbers. "Name" order is the old alphabetical
// grid. Pure functions; no React, no storage.
import type { CardDef } from '../engine/types'
import { listSets, type Printing } from './printings'

export type CollectionSort = 'number' | 'name'

/** `"β005a"` → `{ n: 5, suffix: 'a' }`; `"033"` → `{ n: 33, suffix: '' }`. A
 *  number with no digits sorts last, by its raw text. */
export interface NumberKey { n: number; suffix: string }
export function collectorNumberKey(collectorNumber: string): NumberKey {
  const match = collectorNumber.match(/(\d+)(.*)$/)
  if (match === null) return { n: Number.POSITIVE_INFINITY, suffix: collectorNumber }
  return { n: Number(match[1]), suffix: match[2] }
}
export function compareNumberKeys(a: NumberKey, b: NumberKey): number {
  return a.n - b.n || a.suffix.localeCompare(b.suffix)
}

/** The set with the most printings (ties: first in `listSets` order). */
export function biggestSet(printings: Printing[]): string {
  const counts = new Map<string, number>()
  for (const p of printings) counts.set(p.setCode, (counts.get(p.setCode) ?? 0) + 1)
  let best: { code: string; count: number } | undefined
  for (const s of listSets(printings)) {
    const count = counts.get(s.code) ?? 0
    if (best === undefined || count > best.count) best = { code: s.code, count }
  }
  return best?.code ?? ''
}

/** A card's place in number order. `tier` 0 = has a printing in the chosen
 *  (or core) set, 1 = numbered only in other sets; within a tier, the lowest
 *  collector number in the pool. `undefined` for a card with no printings. */
export interface CardNumberKey extends NumberKey { tier: 0 | 1 }
export function cardNumberKey(prints: Printing[], setCode: string, preferredSet: string): CardNumberKey | undefined {
  const anchor = setCode || preferredSet
  const inAnchor = prints.filter(p => p.setCode === anchor)
  const pool = inAnchor.length > 0 ? inAnchor : prints
  let best: NumberKey | undefined
  for (const p of pool) {
    const key = collectorNumberKey(p.collectorNumber)
    if (best === undefined || compareNumberKeys(key, best) < 0) best = key
  }
  return best === undefined ? undefined : { ...best, tier: inAnchor.length > 0 ? 0 : 1 }
}

export function compareCards(
  a: { def: CardDef; printings: Printing[] }, b: { def: CardDef; printings: Printing[] },
  sort: CollectionSort, setCode: string, preferredSet: string,
): number {
  if (sort === 'number') {
    const ka = cardNumberKey(a.printings, setCode, preferredSet), kb = cardNumberKey(b.printings, setCode, preferredSet)
    if (ka !== undefined && kb !== undefined) {
      const c = ka.tier - kb.tier || compareNumberKeys(ka, kb)
      if (c !== 0) return c
    } else if (ka !== undefined) return -1
    else if (kb !== undefined) return 1
  }
  return a.def.name.localeCompare(b.def.name) || (a.def.subtitle ?? '').localeCompare(b.def.subtitle ?? '')
}

/** Printings of one card, or rows of the list: the preferred set first,
 *  then the dataset's set order, then collector number. */
export function comparePrintings(a: Printing, b: Printing, preferredSet: string, setOrder: readonly string[]): number {
  if (a.setCode !== b.setCode) {
    if (a.setCode === preferredSet) return -1
    if (b.setCode === preferredSet) return 1
    return setOrder.indexOf(a.setCode) - setOrder.indexOf(b.setCode)
  }
  return compareNumberKeys(collectorNumberKey(a.collectorNumber), collectorNumberKey(b.collectorNumber))
}
