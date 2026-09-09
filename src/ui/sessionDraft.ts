//
// The one entry path for adding cards to the collection: quick add (Browse),
// the add line and paste box (Add cards) and the whole-product buttons all
// stage SessionLines here; nothing writes the collection until Apply.
//
// Structured lines replace the free-text draft the sessions panel used to
// keep, but the text format stays the interchange form (Task 2's
// `parseDraftLines`/`draftToText`), so the paste box, the legacy draft and
// the existing parsers (`sessionCounts`, `parseBulkCounts`) all keep working
// unchanged. Same store shape as collection.ts: a module-level snapshot,
// `useSyncExternalStore`, and a memory fallback when localStorage refuses.
import { useSyncExternalStore } from 'react'
import { z } from 'zod'
import type { Printing } from './printings'
import { getCollection, replaceCollection } from './collection'
import { collectionChanges } from './collectionJournal'
import { sessionCounts } from './sessionCounts'
import { parseBulkCounts } from './collectionEntry'

export type SessionKind = 'Acquisition' | 'Trade' | 'Correction'
export type SessionMode = 'signed' | 'exact'
export interface SessionLine { key: string; delta?: number; exact?: number; group?: string }
export interface SessionDraft {
  kind: SessionKind
  date: string
  source: string
  cost: string
  mode: SessionMode
  lines: SessionLine[]
  /** A legacy text draft that did not parse: shown in the paste box so the
   *  owner can fix it, never silently dropped. */
  legacyText?: string
}

export const DRAFT_KEY = 'ctcg:collectionSession:v1'

const lineSchema = z.object({ key: z.string().min(1), delta: z.number().int().optional(), exact: z.number().int().nonnegative().optional(), group: z.string().optional() })
const draftSchema = z.object({
  kind: z.enum(['Acquisition', 'Trade', 'Correction']), date: z.string(), source: z.string(), cost: z.string(),
  mode: z.enum(['signed', 'exact']), lines: z.array(lineSchema), legacyText: z.string().optional(),
})
const legacySchema = z.object({ text: z.string(), date: z.string(), source: z.string(), cost: z.string(), kind: z.string() })

export function emptyDraft(today = new Date()): SessionDraft {
  return { kind: 'Acquisition', date: today.toISOString().slice(0, 10), source: '', cost: '', mode: 'signed', lines: [] }
}

/** Text → lines, in the mode's grammar. Throws with a line number on the
 *  first bad line; exported for Task 2's paste box. */
export function parseDraftLines(text: string, mode: SessionMode): SessionLine[] {
  const lines: SessionLine[] = []
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    if (!raw.trim()) continue
    const match = raw.trim().match(mode === 'signed' ? /^(.+?)[,\t]\s*([+-]?\d+)$/ : /^(.+?)[,\t]\s*(\d+)$/)
    if (!match) throw new Error(mode === 'signed' ? `Line ${i + 1}: use printing-key,+count or printing-key,-count.` : `Line ${i + 1}: use printing-key,whole-number-count.`)
    const n = Number(match[2])
    if (!Number.isSafeInteger(n)) throw new Error(`Line ${i + 1}: invalid count.`)
    lines.push(mode === 'signed' ? { key: match[1].trim(), delta: n } : { key: match[1].trim(), exact: n })
  }
  return lines
}

function migrateLegacy(raw: unknown): SessionDraft | undefined {
  const legacy = legacySchema.safeParse(raw)
  if (!legacy.success) return undefined
  const kind: SessionKind = legacy.data.kind === 'Trade' || legacy.data.kind === 'Correction' ? legacy.data.kind : 'Acquisition'
  const base: SessionDraft = { ...emptyDraft(), kind, date: legacy.data.date, source: legacy.data.source, cost: legacy.data.cost }
  try { return mergeLines(base, parseDraftLines(legacy.data.text, 'signed')) }
  catch { return legacy.data.text.trim() ? { ...base, legacyText: legacy.data.text } : base }
}

let snapshot: SessionDraft | undefined
let memoryDraft: SessionDraft | undefined
let storageError = ''
let touchedThisLoad = false
const listeners = new Set<() => void>()

function readDraft(): SessionDraft {
  let raw: unknown
  try { raw = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') } catch { return memoryDraft ?? emptyDraft() }
  const parsed = draftSchema.safeParse(raw)
  if (parsed.success) return parsed.data
  return migrateLegacy(raw) ?? memoryDraft ?? emptyDraft()
}

export function getDraft(): SessionDraft {
  if (snapshot === undefined) snapshot = readDraft()
  return snapshot
}

function write(next: SessionDraft): void {
  snapshot = next
  touchedThisLoad = true
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(next)); memoryDraft = undefined; storageError = '' }
  catch { memoryDraft = next; storageError = 'Session draft is held in memory. Copy its text before closing this tab.' }
  for (const listener of listeners) listener()
}

export function subscribeDraft(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener) }
export function useDraft(): SessionDraft { return useSyncExternalStore(subscribeDraft, getDraft) }
export function getDraftStorageError(): string { return storageError }

export function updateDraft(patch: Partial<Pick<SessionDraft, 'kind' | 'date' | 'source' | 'cost' | 'mode' | 'legacyText'>>): void {
  const current = getDraft()
  if (patch.mode !== undefined && patch.mode !== current.mode && current.lines.length > 0) throw new Error('Apply or clear the draft to change mode.')
  write({ ...current, ...patch })
}

/** Merge rules: signed adds deltas (dropping a zero); exact replaces. A
 *  grouped line never merges with an ungrouped one for the same key. */
function mergeLines(draft: SessionDraft, incoming: SessionLine[]): SessionDraft {
  let lines = [...draft.lines]
  const newLines: SessionLine[] = []
  for (const line of incoming) {
    const index = lines.findIndex(l => l.key === line.key && (l.group ?? '') === (line.group ?? ''))
    if (index === -1) { newLines.push(line); continue }
    const existing = lines[index]
    if (draft.mode === 'signed') {
      const delta = (existing.delta ?? 0) + (line.delta ?? 0)
      lines = delta === 0 ? lines.filter((_, i) => i !== index) : lines.map((l, i) => i === index ? { ...l, delta } : l)
    } else {
      lines = lines.map((l, i) => i === index ? { ...l, exact: line.exact } : l)
    }
  }
  return { ...draft, lines: [...newLines, ...lines] }
}

export function stageLines(lines: SessionLine[]): void { write(mergeLines(getDraft(), lines)) }
export function stageLine(line: SessionLine): void { stageLines([line]) }
export function removeLine(key: string): void { const d = getDraft(); write({ ...d, lines: d.lines.filter(l => !(l.key === key && l.group === undefined)) }) }
export function removeGroup(group: string): void { const d = getDraft(); write({ ...d, lines: d.lines.filter(l => l.group !== group) }) }
export function clearDraft(): void { const d = getDraft(); write({ ...d, lines: [], legacyText: undefined }) }

/** True when the draft has lines that were read from storage and nothing has
 *  been staged or edited in this page load — the pill turns yellow. */
export function isDraftStale(): boolean { return getDraft().lines.length > 0 && !touchedThisLoad }

export function _resetDraftForTests(): void { snapshot = undefined; memoryDraft = undefined; storageError = ''; touchedThisLoad = false }

/** Lines → the text grammar the existing parsers read. Group labels are a
 *  display concern and are not serialized. Line order is irrelevant to both
 *  parsers (sessionCounts/parseBulkCounts sum per key and reject duplicates by
 *  key alone), so storage order (newest first) is used as-is. */
export function draftToText(draft: SessionDraft): string {
  return draft.lines.map(l => draft.mode === 'signed' ? `${l.key},${(l.delta ?? 0) >= 0 ? '+' : ''}${l.delta ?? 0}` : `${l.key},${l.exact ?? 0}`).join('\n')
}

/** The counts Apply would write. Delegates the arithmetic and every check
 *  (unknown key, negative result, duplicate exact row) to the two existing
 *  parsers so the panel and the paste box can never disagree. */
export function draftCounts(draft: SessionDraft, printings: Printing[], before: Record<string, number>): Record<string, number> {
  const text = draftToText(draft)
  if (draft.mode === 'signed') return sessionCounts(text, printings, before)
  return { ...before, ...parseBulkCounts(text, printings) }
}

export interface DraftSummary { copies: number; printings: number; before: number; after: number }
export function draftSummary(before: Record<string, number>, after: Record<string, number>): DraftSummary {
  const sum = (c: Record<string, number>) => Object.values(c).reduce((n, v) => n + v, 0)
  return { copies: sum(after) - sum(before), printings: Object.keys(collectionChanges(before, after)).length, before: sum(before), after: sum(after) }
}

export interface RarityRow { rarity: string; copies: number }
/** "What did I pull": positive deltas per rarity. Negative rows (trades out)
 *  are not pulls and are left out. */
export function rarityBreakdown(changes: Record<string, { before: number; after: number }>, printings: Printing[]): RarityRow[] {
  const rarity = new Map(printings.map(p => [p.key, p.rarity]))
  const totals = new Map<string, number>()
  for (const [key, c] of Object.entries(changes)) {
    const gained = c.after - c.before
    if (gained <= 0) continue
    const name = rarity.get(key) ?? 'Unknown'
    totals.set(name, (totals.get(name) ?? 0) + gained)
  }
  return [...totals].map(([r, copies]) => ({ rarity: r, copies })).sort((a, b) => b.copies - a.copies || a.rarity.localeCompare(b.rarity))
}

/** One write, one journal entry, then the draft is emptied. Throws (and
 *  leaves the draft alone) when the computation refuses.
 *
 *  When `expectedBefore` is given (the counts the review was computed
 *  against), Apply refuses if the collection has changed since — "the
 *  collection unchanged since the preview was computed" — rather than
 *  silently writing on top of a write from another tab. */
export function applyDraft(printings: Printing[], expectedBefore?: Record<string, number>): void {
  const draft = getDraft()
  const before = getCollection().counts
  if (expectedBefore !== undefined && JSON.stringify(before) !== JSON.stringify(expectedBefore)) throw new Error('Collection changed; review again.')
  const after = draftCounts(draft, printings, before)
  replaceCollection({ counts: after }, { kind: draft.mode === 'exact' ? 'Bulk counts' : draft.kind, date: draft.date, source: draft.source, cost: draft.cost })
  clearDraft()
}
