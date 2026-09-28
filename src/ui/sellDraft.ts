//
// The Sell mode's list of copies to put up on Cardmarket: one line per
// printing, with an optional per-line condition over the list's default.
// Same store shape as sessionDraft.ts — a module-level snapshot,
// `useSyncExternalStore`, and a memory fallback when localStorage refuses.
// Nothing here writes the collection except `markSold`, after a confirm.
import { useSyncExternalStore } from 'react'
import { z } from 'zod'
import { getCollection, replaceCollection } from './collection'
import type { SplitLine } from './surplus'

export const CONDITIONS = ['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'] as const
export type Condition = typeof CONDITIONS[number]
export const LANGUAGES = ['English', 'German', 'French', 'Spanish', 'Italian'] as const
export type Language = typeof LANGUAGES[number]
export interface SellLine { key: string; count: number; condition?: Condition }
export interface SellList { version: 1; condition: Condition; language: Language; lines: SellLine[] }
export interface EffectiveLine { key: string; requested: number; count: number; condition: Condition }

export const SELL_KEY = 'ctcg:sellList:v1'

const listSchema = z.object({
  version: z.literal(1), condition: z.enum(CONDITIONS), language: z.enum(LANGUAGES),
  lines: z.array(z.object({ key: z.string().min(1), count: z.number().int().positive(), condition: z.enum(CONDITIONS).optional() })),
})

function emptySellList(): SellList { return { version: 1, condition: 'NM', language: 'English', lines: [] } }

let snapshot: SellList | undefined
let memoryList: SellList | undefined
let storageError = ''
const listeners = new Set<() => void>()

function read(): SellList {
  let text: string | null
  try { text = localStorage.getItem(SELL_KEY) } catch { return memoryList ?? emptySellList() }
  if (text === null) return memoryList ?? emptySellList()
  try { const parsed = listSchema.safeParse(JSON.parse(text)); if (parsed.success) return parsed.data } catch { /* reported below */ }
  storageError = 'The saved sell list could not be read and was reset.'
  return emptySellList()
}

function write(next: SellList): void {
  snapshot = next
  try { localStorage.setItem(SELL_KEY, JSON.stringify(next)); memoryList = undefined; storageError = '' }
  catch { memoryList = next; storageError = 'Sell list is held in memory only; export it before closing this tab.' }
  for (const listener of listeners) listener()
}

export function getSellList(): SellList { if (snapshot === undefined) snapshot = read(); return snapshot }
export function subscribeSellList(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener) }
export function useSellList(): SellList { return useSyncExternalStore(subscribeSellList, getSellList) }
export function getSellListStorageError(): string { getSellList(); return storageError }

export function addToSellList(incoming: SplitLine[]): void {
  const list = getSellList()
  let lines = [...list.lines]
  for (const { key, count } of incoming) {
    if (!Number.isSafeInteger(count) || count < 1) continue
    lines = lines.some(l => l.key === key) ? lines.map(l => l.key === key ? { ...l, count: l.count + count } : l) : [...lines, { key, count }]
  }
  write({ ...list, lines })
}
export function setSellCount(key: string, n: number): void {
  if (!Number.isSafeInteger(n) || n < 1) return
  const list = getSellList(); write({ ...list, lines: list.lines.map(l => l.key === key ? { ...l, count: n } : l) })
}
export function setLineCondition(key: string, condition: Condition | undefined): void {
  const list = getSellList()
  write({ ...list, lines: list.lines.map(l => l.key !== key ? l : condition ? { key: l.key, count: l.count, condition } : { key: l.key, count: l.count }) })
}
export function removeSellLine(key: string): void { const list = getSellList(); write({ ...list, lines: list.lines.filter(l => l.key !== key) }) }
export function setSellDefaults(patch: Partial<Pick<SellList, 'condition' | 'language'>>): void { write({ ...getSellList(), ...patch }) }
export function clearSold(keys: string[]): void { const list = getSellList(); write({ ...list, lines: list.lines.filter(l => !keys.includes(l.key)) }) }

export function _resetSellListForTests(): void { snapshot = undefined; memoryList = undefined; storageError = '' }

/** What a line can actually sell: never more than is owned right now. */
export function effectiveLines(list: SellList, counts: Record<string, number>): EffectiveLine[] {
  return list.lines.map(l => ({ key: l.key, requested: l.count, count: Math.min(l.count, counts[l.key] ?? 0), condition: l.condition ?? list.condition }))
}

function sameCounts(a: Record<string, number>, b: Record<string, number>): boolean {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].every(k => (a[k] ?? 0) === (b[k] ?? 0))
}

export function saleCounts(keys: string[], before: Record<string, number>): Record<string, number> {
  const after = { ...before }
  for (const line of effectiveLines(getSellList(), before)) if (keys.includes(line.key)) after[line.key] = (before[line.key] ?? 0) - line.count
  return after
}

/** One collection write for the chosen lines, journalled as a Sale. The
 *  lines leave the sell list only once the collection really holds the new
 *  counts — `replaceCollection` returns silently in a read-only tab. */
export function markSold(keys: string[], expectedBefore: Record<string, number>, today = new Date()): void {
  const before = getCollection().counts
  if (!sameCounts(before, expectedBefore)) throw new Error('Collection changed; review again.')
  const after = saleCounts(keys, before)
  replaceCollection({ counts: after }, { kind: 'Sale', date: today.toISOString().slice(0, 10), source: 'Cardmarket' })
  if (!sameCounts(getCollection().counts, after)) throw new Error('Could not save the collection; the sell list was kept.')
  clearSold(keys)
}
