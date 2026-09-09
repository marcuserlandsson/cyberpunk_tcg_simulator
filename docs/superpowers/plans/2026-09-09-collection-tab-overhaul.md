# Collection Tab Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Collection tab as four modes (Browse, Add cards, Plan purchases, History & backup) with a grouped filter rail, a card drawer, and a quick add that stages into a reviewable session, keeping every feature the tab has today.

**Architecture:** A new `sessionDraft.ts` store (same `useSyncExternalStore` pattern as `collection.ts`) holds the structured session draft in localStorage and is the single entry path for adding cards; the existing pure parsers (`sessionCounts`, `parseBulkCounts`) remain the arithmetic. `CollectionView` becomes a thin shell that mounts four mode components and a header strip; the old panel components are replaced one at a time, each behind its own tests, and the e2e suite is re-pointed at the new navigation in one task at the end.

**Tech Stack:** React 19, TypeScript, Vite 8, zod 4, Vitest 4 (jsdom for `.tsx` tests), Playwright, plain CSS on the app's tokens (`tokens.css`, `tools.css`).

**Spec:** `docs/superpowers/specs/2026-09-09-collection-tab-overhaul-design.md` — read it first; the mockup `2026-09-09-collection-tab-overhaul-mockup.html` beside it is the visual reference.

## Global Constraints

- Work in a git worktree under `.worktrees/` (gitignored) on branch `feat/collection-overhaul`, branched from **local `HEAD`** (`a591b2e` or later) — the spec and styling commits are local-only. Follow `superpowers:using-git-worktrees`.
- Pure modules are **not modified**: `src/ui/collection.ts`, `collectionSync.ts`, `collectionJournal.ts`, `sessionCounts.ts`, `collectionEntry.ts`, `acquisitionPlan.ts`, `artworks.ts`, `printings.ts`, `images.ts`. Everything new calls into them.
- Storage keys: draft `ctcg:collectionSession:v1` (existing key, new shape, migrated on read); quick-add set `ctcg:quickAddSet:v1` (unchanged); active mode `ctcg:collectionMode:v1` in `sessionStorage`.
- Journal `kind` strings written on apply: `Acquisition` | `Trade` | `Correction` for signed drafts, `Bulk counts` for exact drafts. The journal format does not change.
- Test ids that other specs depend on must survive with the same meaning: `sync-status` (and its `collection-header__sync--<state>` classes), `sync-retry`, `sync-download`, `sync-conflict`, `sync-keep-mine`, `sync-take-disk`, `sync-confirm-empty`, `collection-stats`, `playset-progress`, `artwork-progress`, `collection-readonly`, `collection-search`, `collection-cell`, `collection-grid`, `collection-count-<cardId>`, `expand-<cardId>`, `printing-row-<key>`, `printing-inc-<key>`, `printing-dec-<key>`, `printing-count-<key>`, `compact-printings`, `compact-printing`, `collection-scope`, `collection-legend`, `rarity-filter-<slug>`, `goal-filter-<id>`, `collection-color-<Color>`, `collection-type-<type>`, `quick-add-input`, `quick-add-set`, `quick-add-match-<cardId>`, `quick-add-printing-<key>`, `quick-add-toast`, `session-date`, `session-source`, `session-cost`, `session-input`, `session-changes`, `session-apply`, `session-error`, `collection-history`, `collection-history-entry`, `history-undo`, `history-reapply`, `import-panel`, `import-input`, `import-mode-replace`, `import-mode-merge`, `import-submit`, `import-preview`, `import-apply`, `import-error`, `copy-error`, `copy-buylist`, `copy-playset-list`, `copy-artwork-list`, `export-json`, `export-text`, `acquisition-planner`, `acquisition-row`, `acquisition-total`, `acquisition-list`, `reserve-artwork`.
- New test ids introduced here (used by Task 11's e2e edits): `collection-mode-browse|add|plan|history`, `staged-pill`, `collection-compact` (now a Grid/List toggle **button** with `aria-pressed`), `set-filter` (the set list container) and `set-filter-<setCode>` (rows), `card-drawer`, `drawer-close`, `add-line-input`/`add-line-set`/`add-line-match-<id>`/`add-line-printing-<key>` (the Add-cards instance of the shared component), `session-kind-<Kind>`, `session-mode-signed|exact`, `session-paste-add`, `session-line-<key>`, `session-remove-<key>`, `session-group-<label>`, `product-<setCode>`, `session-clear`, `session-rarity`, `acquisition-mode-shared|assembled`, `acquisition-deck-<name>`, `history-details`, `history-export`, `history-import-input`, `history-import`, `export-history`.
- Colours only through tokens; yellow (`--act`) means "actionable now", red (`--rival`) means a human decision or a failure, green (`--ram-green`) is used only for "complete" counts and "+" deltas, mirroring the existing badge conventions.
- House style: file-header comment saying what the file is for and why the non-obvious choices were made; tests in `tests/ui/`, `// @vitest-environment jsdom` first line for DOM tests, and `afterEach(cleanup)` (no global RTL cleanup in this repo).
- Run a test file with `npx vitest run tests/ui/<file>`; typecheck with `npx tsc -b`; e2e with `CTCG_E2E_PORT=5177 npx playwright test <spec>` (5174 is often held by a stale server on this machine).
- Between Task 3 and Task 11 the collection e2e specs are **expected to fail** (quick add no longer writes immediately). Do not "fix" them mid-way; Task 11 re-points them.
- Commit after every task with a message in the repo's imperative style.
- **Plan clarifications over the spec:** (1) the drawer has no "View card / Open image" footer — the printing thumbnail already opens the image, and the tile is the card; (2) a leading `#` in the search is stripped rather than forcing a number-only match — `matchesPrinting` already matches collector numbers, and it is a pure module this plan does not touch.

## File structure

| File | Responsibility |
|---|---|
| `src/ui/sessionDraft.ts` (new) | Session draft store: schema, migration, staging rules, apply computation, rarity breakdown. |
| `src/ui/AddLine.tsx` (new, replaces `QuickAddBar.tsx`) | Search-to-stage input with set context and disambiguation chips. |
| `src/ui/CollectionModeHeader.tsx` (new) | Mode control, sync chip (moved from `CollectionHeader`), staged pill, meters. |
| `src/ui/CollectionFilterRail.tsx` (new) | Grouped filters; owns no state, receives values and setters. |
| `src/ui/CardDrawer.tsx` (new) | One card's goals and printings grouped by artwork, with steppers. |
| `src/ui/CollectionBrowse.tsx` (new) | Toolbar, grid tiles, list view; composes rail + drawer. |
| `src/ui/AddCardsMode.tsx` (new, replaces `CollectionSessions` form + `BulkCollectionEntry`) | Session strip, whole products, add line, staged table, paste box, review & apply. |
| `src/ui/PlanPurchasesMode.tsx` (new, replaces `AcquisitionPlanner`) | Deck chips, options, plan table, shopping list, collection goal lists. |
| `src/ui/HistoryBackupMode.tsx` (new, replaces `CollectionSessions` history + `CollectionHeader` import/export) | Timeline with undo/reapply/details; export, import, restore-history, on-disk cards. |
| `src/ui/CollectionView.tsx` (rewritten) | Shell: loads printings, holds mode, mounts header + four modes. |
| `src/ui/styles/collection.css` (rewritten) | All Collection-tab CSS; `tools.css` stays shared. |
| Deleted at the end of the task that replaces them | `QuickAddBar.tsx`, `BulkCollectionEntry.tsx`, `CollectionSessions.tsx`, `AcquisitionPlanner.tsx`, `CollectionHeader.tsx`, `tests/ui/quickaddbar.test.tsx`, `tests/ui/collectionheader.test.tsx`. |

---

### Task 1: Session draft store — schema, migration, staging rules

**Files:**
- Create: `src/ui/sessionDraft.ts`
- Test: `tests/ui/session-draft.test.ts`

**Interfaces:**
- Consumes: nothing from the app (localStorage only).
- Produces (used by Tasks 2, 3, 4, 7):
  ```ts
  export type SessionKind = 'Acquisition' | 'Trade' | 'Correction'
  export type SessionMode = 'signed' | 'exact'
  export interface SessionLine { key: string; delta?: number; exact?: number; group?: string }
  export interface SessionDraft { kind: SessionKind; date: string; source: string; cost: string; mode: SessionMode; lines: SessionLine[]; legacyText?: string }
  export const DRAFT_KEY = 'ctcg:collectionSession:v1'
  export function emptyDraft(today?: Date): SessionDraft
  export function getDraft(): SessionDraft
  export function useDraft(): SessionDraft
  export function subscribeDraft(listener: () => void): () => void
  export function updateDraft(patch: Partial<Pick<SessionDraft,'kind'|'date'|'source'|'cost'|'mode'|'legacyText'>>): void
  export function stageLine(line: SessionLine): void
  export function stageLines(lines: SessionLine[]): void
  export function removeLine(key: string): void
  export function removeGroup(group: string): void
  export function clearDraft(): void
  export function parseDraftLines(text: string, mode: SessionMode): SessionLine[]   // throws with a line number
  export function isDraftStale(): boolean        // loaded from storage, untouched this page load
  export function getDraftStorageError(): string
  export function _resetDraftForTests(): void
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/ui/session-draft.test.ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  DRAFT_KEY, _resetDraftForTests, clearDraft, emptyDraft, getDraft, isDraftStale,
  removeGroup, removeLine, stageLine, stageLines, updateDraft,
} from '../../src/ui/sessionDraft'

beforeEach(() => { localStorage.clear(); _resetDraftForTests() })

describe('session draft — shape and persistence', () => {
  it('starts as an empty signed Acquisition dated today', () => {
    const d = getDraft()
    expect(d.kind).toBe('Acquisition')
    expect(d.mode).toBe('signed')
    expect(d.lines).toEqual([])
    expect(d.date).toBe(new Date().toISOString().slice(0, 10))
  })

  it('persists every change under the existing key', () => {
    updateDraft({ source: 'Launch boosters', cost: '100 SEK' })
    stageLine({ key: 'arasakademodeck/006', delta: 3 })
    const stored = JSON.parse(localStorage.getItem(DRAFT_KEY)!)
    expect(stored.source).toBe('Launch boosters')
    expect(stored.lines).toEqual([{ key: 'arasakademodeck/006', delta: 3 }])
  })

  it('migrates a legacy text draft into signed lines', () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      text: 'arasakademodeck/006,+3\nwelcometonightcitybeta/β025,-1', date: '2026-09-01', source: 'old', cost: '', kind: 'Trade',
    }))
    const d = getDraft()
    expect(d.kind).toBe('Trade')
    expect(d.mode).toBe('signed')
    expect(d.lines).toEqual([
      { key: 'arasakademodeck/006', delta: 3 },
      { key: 'welcometonightcitybeta/β025', delta: -1 },
    ])
    expect(d.legacyText).toBeUndefined()
  })

  it('keeps unparsable legacy text for the paste box instead of dropping it', () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ text: 'not a line', date: '2026-09-01', source: '', cost: '', kind: 'Acquisition' }))
    const d = getDraft()
    expect(d.lines).toEqual([])
    expect(d.legacyText).toBe('not a line')
  })

  it('falls back to an empty draft on garbage', () => {
    localStorage.setItem(DRAFT_KEY, '{"nope":true}')
    expect(getDraft().lines).toEqual([])
  })
})

describe('session draft — staging rules', () => {
  it('signed mode merges a repeated key by adding deltas', () => {
    stageLine({ key: 'a/1', delta: 1 })
    stageLine({ key: 'a/1', delta: 2 })
    expect(getDraft().lines).toEqual([{ key: 'a/1', delta: 3 }])
  })

  it('signed mode drops a line whose delta reaches zero', () => {
    stageLine({ key: 'a/1', delta: 1 })
    stageLine({ key: 'a/1', delta: -1 })
    expect(getDraft().lines).toEqual([])
  })

  it('exact mode replaces a repeated key', () => {
    updateDraft({ mode: 'exact' })
    stageLine({ key: 'a/1', exact: 2 })
    stageLine({ key: 'a/1', exact: 5 })
    expect(getDraft().lines).toEqual([{ key: 'a/1', exact: 5 }])
  })

  it('newest lines come first', () => {
    stageLine({ key: 'a/1', delta: 1 })
    stageLine({ key: 'b/2', delta: 1 })
    expect(getDraft().lines.map(l => l.key)).toEqual(['b/2', 'a/1'])
  })

  it('a grouped line and an ungrouped line for the same key stay separate', () => {
    stageLines([{ key: 'a/1', delta: 1, group: 'Arasaka Demo Deck' }])
    stageLine({ key: 'a/1', delta: 2 })
    expect(getDraft().lines).toHaveLength(2)
  })

  it('removeLine removes only the ungrouped line; removeGroup removes the whole group', () => {
    stageLines([{ key: 'a/1', delta: 1, group: 'G' }, { key: 'b/2', delta: 1, group: 'G' }])
    stageLine({ key: 'a/1', delta: 2 })
    removeLine('a/1')
    expect(getDraft().lines.map(l => l.group)).toEqual(['G', 'G'])
    removeGroup('G')
    expect(getDraft().lines).toEqual([])
  })

  it('refuses to change mode while lines are staged', () => {
    stageLine({ key: 'a/1', delta: 1 })
    expect(() => updateDraft({ mode: 'exact' })).toThrow(/Apply or clear/)
    expect(getDraft().mode).toBe('signed')
  })

  it('clearDraft keeps the metadata but empties the lines', () => {
    updateDraft({ source: 'x' })
    stageLine({ key: 'a/1', delta: 1 })
    clearDraft()
    expect(getDraft().lines).toEqual([])
    expect(getDraft().source).toBe('x')
  })
})

describe('session draft — staleness', () => {
  it('a draft read back from storage is stale until touched in this page load', () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...emptyDraft(), lines: [{ key: 'a/1', delta: 1 }] }))
    expect(isDraftStale()).toBe(true)
    stageLine({ key: 'b/2', delta: 1 })
    expect(isDraftStale()).toBe(false)
  })

  it('an empty draft is never stale', () => {
    expect(isDraftStale()).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/ui/session-draft.test.ts`
Expected: FAIL — cannot resolve `../../src/ui/sessionDraft`.

- [ ] **Step 3: Write the store**

```ts
// src/ui/sessionDraft.ts
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
  for (const line of incoming) {
    const index = lines.findIndex(l => l.key === line.key && (l.group ?? '') === (line.group ?? ''))
    if (index === -1) { lines = [line, ...lines]; continue }
    const existing = lines[index]
    if (draft.mode === 'signed') {
      const delta = (existing.delta ?? 0) + (line.delta ?? 0)
      lines = delta === 0 ? lines.filter((_, i) => i !== index) : lines.map((l, i) => i === index ? { ...l, delta } : l)
    } else {
      lines = lines.map((l, i) => i === index ? { ...l, exact: line.exact } : l)
    }
  }
  return { ...draft, lines }
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/ui/session-draft.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/sessionDraft.ts tests/ui/session-draft.test.ts
git commit -m "Add the structured session draft store for collection entry"
```

---

### Task 2: Session draft — apply computation, text round-trip, rarity breakdown

**Files:**
- Modify: `src/ui/sessionDraft.ts` (append)
- Test: `tests/ui/session-draft-apply.test.ts`

**Interfaces:**
- Consumes: `sessionCounts(text, printings, before)` and `parseBulkCounts(text, printings)` (existing), `getCollection`/`replaceCollection` from `collection.ts`, `collectionChanges` from `collectionJournal.ts`, `Printing`.
- Produces (used by Tasks 7 and 9):
  ```ts
  export function draftToText(draft: SessionDraft): string
  export function draftCounts(draft: SessionDraft, printings: Printing[], before: Record<string,number>): Record<string,number>  // throws on bad keys/negative results
  export interface DraftSummary { copies: number; printings: number; before: number; after: number }
  export function draftSummary(before: Record<string,number>, after: Record<string,number>): DraftSummary
  export interface RarityRow { rarity: string; copies: number }
  export function rarityBreakdown(changes: Record<string,{before:number;after:number}>, printings: Printing[]): RarityRow[]  // positive deltas only, sorted by copies desc
  export function applyDraft(printings: Printing[]): void  // computes, replaceCollection with metadata, clears draft
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/ui/session-draft-apply.test.ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { loadPrintings } from '../../src/ui/printings'
import { _resetCollectionCacheForTests, getCollection, setCount } from '../../src/ui/collection'
import { readCollectionJournal } from '../../src/ui/collectionJournal'
import {
  _resetDraftForTests, applyDraft, draftCounts, draftSummary, draftToText, getDraft,
  rarityBreakdown, stageLine, stageLines, updateDraft,
} from '../../src/ui/sessionDraft'

const printings = loadPrintings()
const demo = printings.find(p => p.key === 'arasakademodeck/006')!
const beta = printings.find(p => p.key === 'welcometonightcitybeta/β025')!

beforeEach(() => { localStorage.clear(); _resetCollectionCacheForTests(); _resetDraftForTests() })

describe('draft text round-trip', () => {
  it('serializes signed lines with explicit signs and exact lines bare', () => {
    stageLines([{ key: demo.key, delta: 3 }, { key: beta.key, delta: -1 }])
    expect(draftToText(getDraft())).toBe(`${beta.key},-1\n${demo.key},+3`)
    _resetDraftForTests(); localStorage.clear()
    updateDraft({ mode: 'exact' }); stageLine({ key: demo.key, exact: 4 })
    expect(draftToText(getDraft())).toBe(`${demo.key},4`)
  })
})

describe('draftCounts', () => {
  it('signed: adds deltas onto the current counts', () => {
    stageLines([{ key: demo.key, delta: 3 }])
    expect(draftCounts(getDraft(), printings, { [demo.key]: 1 })).toEqual({ [demo.key]: 4 })
  })
  it('signed: rejects an unknown key and a negative result with the parser messages', () => {
    stageLine({ key: 'nope/1', delta: 1 })
    expect(() => draftCounts(getDraft(), printings, {})).toThrow(/unknown printing/)
    _resetDraftForTests(); localStorage.clear()
    stageLine({ key: demo.key, delta: -2 })
    expect(() => draftCounts(getDraft(), printings, { [demo.key]: 1 })).toThrow(/invalid count/)
  })
  it('exact: replaces only the staged rows', () => {
    updateDraft({ mode: 'exact' }); stageLine({ key: demo.key, exact: 5 })
    expect(draftCounts(getDraft(), printings, { [demo.key]: 1, [beta.key]: 2 })).toEqual({ [demo.key]: 5, [beta.key]: 2 })
  })
})

describe('draftSummary and rarityBreakdown', () => {
  it('summarizes net copies and changed rows', () => {
    expect(draftSummary({ a: 1, b: 2 }, { a: 4, c: 1 })).toEqual({ copies: 2, printings: 3, before: 3, after: 5 })
  })
  it('counts positive deltas per rarity, biggest first', () => {
    const rows = rarityBreakdown({ [demo.key]: { before: 0, after: 3 }, [beta.key]: { before: 1, after: 2 }, ['x/1']: { before: 2, after: 0 } }, printings)
    expect(rows[0]).toEqual({ rarity: demo.rarity, copies: 3 })
    expect(rows).toContainEqual({ rarity: beta.rarity, copies: 1 })
    expect(rows.some(r => r.copies <= 0)).toBe(false)
  })
})

describe('applyDraft', () => {
  it('writes once with the session metadata and clears the draft', () => {
    setCount(demo.key, 1)
    updateDraft({ source: 'Launch boosters', cost: '100 SEK', kind: 'Trade' })
    stageLine({ key: demo.key, delta: 2 })
    applyDraft(printings)
    expect(getCollection().counts[demo.key]).toBe(3)
    expect(getDraft().lines).toEqual([])
    const entry = readCollectionJournal().entries[0]
    expect(entry.kind).toBe('Trade'); expect(entry.source).toBe('Launch boosters'); expect(entry.cost).toBe('100 SEK')
  })
  it('records exact drafts as Bulk counts', () => {
    updateDraft({ mode: 'exact' }); stageLine({ key: demo.key, exact: 2 })
    applyDraft(printings)
    expect(readCollectionJournal().entries[0].kind).toBe('Bulk counts')
  })
  it('leaves the draft intact when the computation throws', () => {
    stageLine({ key: 'nope/1', delta: 1 })
    expect(() => applyDraft(printings)).toThrow()
    expect(getDraft().lines).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/ui/session-draft-apply.test.ts`
Expected: FAIL — `draftToText` is not exported.

- [ ] **Step 3: Append the apply half to the store**

Add these imports at the top of `src/ui/sessionDraft.ts`:

```ts
import type { Printing } from './printings'
import { getCollection, replaceCollection } from './collection'
import { collectionChanges } from './collectionJournal'
import { sessionCounts } from './sessionCounts'
import { parseBulkCounts } from './collectionEntry'
```

Append at the end of the file:

```ts
/** Lines → the text grammar the existing parsers read. Group labels are a
 *  display concern and are not serialized. */
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
 *  leaves the draft alone) when the computation refuses. */
export function applyDraft(printings: Printing[]): void {
  const draft = getDraft()
  const before = getCollection().counts
  const after = draftCounts(draft, printings, before)
  replaceCollection({ counts: after }, { kind: draft.mode === 'exact' ? 'Bulk counts' : draft.kind, date: draft.date, source: draft.source, cost: draft.cost })
  clearDraft()
}
```

- [ ] **Step 4: Run both draft test files**

Run: `npx vitest run tests/ui/session-draft.test.ts tests/ui/session-draft-apply.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/sessionDraft.ts tests/ui/session-draft-apply.test.ts
git commit -m "Compute, summarize and apply the session draft through the existing parsers"
```

---

### Task 3: `AddLine` — the shared search-to-stage input (replaces `QuickAddBar`)

**Files:**
- Create: `src/ui/AddLine.tsx`
- Delete: `src/ui/QuickAddBar.tsx`, `tests/ui/quickaddbar.test.tsx`
- Modify: `src/ui/CollectionView.tsx` (swap the `QuickAddBar` import/usage for `<AddLine db printings testIdPrefix="quick-add" />` — temporary wiring, the shell is rewritten in Task 10)
- Test: `tests/ui/addline.test.tsx`

**Interfaces:**
- Consumes: `stageLine`, `useDraft` (Task 1); `printingsByCard`, `listSets`, `Printing`; `buildDisplayNames`.
- Produces: `export function AddLine({ db, printings, testIdPrefix, autoFocus }: { db: CardDb; printings: Printing[]; testIdPrefix: 'quick-add' | 'add-line'; autoFocus?: boolean }): ReactElement`. Test ids: `<prefix>-input`, `<prefix>-set`, `<prefix>-match-<cardId>`, `<prefix>-printing-<key>`, `<prefix>-toast`. Enter stages +1, Shift+Enter stages −1 (signed mode) or sets exact 1 / exact 0 (exact mode); staging with an empty draft is what "starts a session for today" — `stageLine` on the empty draft already does that.

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/ui/addline.test.tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { loadCardDb } from '../../src/engine/cardDb'
import { loadPrintings, printingsByCard } from '../../src/ui/printings'
import { _resetCollectionCacheForTests, getCollection } from '../../src/ui/collection'
import { _resetDraftForTests, getDraft, updateDraft } from '../../src/ui/sessionDraft'
import { AddLine } from '../../src/ui/AddLine'

const db = loadCardDb()
const printings = loadPrintings()
const target = printings.find((p) => p.cardId === 'mantis-blades')!
const MULTI_SET = 'welcometonightcitybeta'
const MULTI_CARD = 'adam-smasher-ender-of-legends'
const multiInSet = printings.filter((p) => p.cardId === MULTI_CARD && p.setCode === MULTI_SET)
if (multiInSet.length < 2) throw new Error(`fixture assumption failed: ${MULTI_CARD} no longer has 2+ printings in ${MULTI_SET}`)

beforeEach(() => { localStorage.clear(); _resetCollectionCacheForTests(); _resetDraftForTests() })
afterEach(cleanup)

async function typeMantis(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByTestId('quick-add-set'), target.setCode)
  await user.type(screen.getByTestId('quick-add-input'), 'mantis')
}

describe('AddLine', () => {
  it('Enter stages +1 in the session set and never touches the collection', async () => {
    const user = userEvent.setup()
    render(<AddLine db={db} printings={printings} testIdPrefix="quick-add" />)
    await typeMantis(user)
    expect(screen.getByTestId('quick-add-match-mantis-blades')).toBeTruthy()
    await user.keyboard('{Enter}')
    expect(getDraft().lines).toEqual([{ key: target.key, delta: 1 }])
    expect(getCollection().counts).toEqual({})
    expect((screen.getByTestId('quick-add-input') as HTMLInputElement).value).toBe('')
    expect(screen.getByTestId('quick-add-toast').textContent).toContain('+1')
  })

  it('Shift+Enter stages −1', async () => {
    const user = userEvent.setup()
    render(<AddLine db={db} printings={printings} testIdPrefix="quick-add" />)
    await typeMantis(user)
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    expect(getDraft().lines).toEqual([{ key: target.key, delta: -1 }])
  })

  it('in exact mode Enter stages "exactly 1"', async () => {
    updateDraft({ mode: 'exact' })
    const user = userEvent.setup()
    render(<AddLine db={db} printings={printings} testIdPrefix="quick-add" />)
    await typeMantis(user)
    await user.keyboard('{Enter}')
    expect(getDraft().lines).toEqual([{ key: target.key, exact: 1 }])
  })

  it('remembers the session set across mounts', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<AddLine db={db} printings={printings} testIdPrefix="quick-add" />)
    await user.selectOptions(screen.getByTestId('quick-add-set'), target.setCode)
    unmount()
    render(<AddLine db={db} printings={printings} testIdPrefix="quick-add" />)
    expect((screen.getByTestId('quick-add-set') as HTMLSelectElement).value).toBe(target.setCode)
  })

  it('a card absent from the session set offers its printings as chips', async () => {
    const byCard = printingsByCard(printings)
    const outsider = [...byCard.entries()].find(([, list]) => !list.some((p) => p.setCode === target.setCode))
    if (outsider === undefined) throw new Error('fixture assumption failed: every card has a printing in the target set')
    const [cardId, list] = outsider
    const user = userEvent.setup()
    render(<AddLine db={db} printings={printings} testIdPrefix="quick-add" />)
    await user.selectOptions(screen.getByTestId('quick-add-set'), target.setCode)
    await user.type(screen.getByTestId('quick-add-input'), db[cardId].name.slice(0, 6))
    await user.click(screen.getByTestId(`quick-add-printing-${list[0].key}`))
    expect(getDraft().lines).toEqual([{ key: list[0].key, delta: 1 }])
  })

  it('Enter refuses to guess between several printings in the set', async () => {
    const user = userEvent.setup()
    render(<AddLine db={db} printings={printings} testIdPrefix="quick-add" />)
    await user.selectOptions(screen.getByTestId('quick-add-set'), MULTI_SET)
    await user.type(screen.getByTestId('quick-add-input'), 'ender of legends')
    await user.keyboard('{Enter}')
    expect(getDraft().lines).toEqual([])
    for (const p of multiInSet) {
      const chip = screen.getByTestId(`quick-add-printing-${p.key}`)
      expect(chip.textContent).toContain(p.collectorNumber)
      expect(chip.textContent).toContain(p.rarity)
    }
  })

  it('uses the given test-id prefix so two instances can coexist', () => {
    render(<AddLine db={db} printings={printings} testIdPrefix="add-line" />)
    expect(screen.getByTestId('add-line-input')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/ui/addline.test.tsx`
Expected: FAIL — cannot resolve `../../src/ui/AddLine`.

- [ ] **Step 3: Write the component**

```tsx
// src/ui/AddLine.tsx
//
// Pack-cracking entry, shared by Browse (quick add) and Add cards: type a few
// letters, Enter stages 1 copy of the top match's printing in the "session
// set" into the draft (sessionDraft.ts). Nothing here writes the collection;
// Apply in Add cards does. Enter only fires when the session set holds
// EXACTLY ONE printing of the matched card; 0 or 2+ printings show the card's
// printings as chips so the keystroke never guesses which art got the copy
// (31 card+set combinations hold 2-3 printings each).
import { useMemo, useState, type KeyboardEvent, type ReactElement } from 'react'
import type { CardDb } from '../engine/types'
import { printingsByCard, listSets, type Printing } from './printings'
import { buildDisplayNames } from './storage'
import { stageLine, useDraft } from './sessionDraft'

const SESSION_SET_KEY = 'ctcg:quickAddSet:v1'
const MAX_MATCHES = 8

/** Default session set: the set with the MOST printings, so first use does
 *  not answer "not in this set" for most cards (the demo deck comes first in
 *  file order but holds 14 printings against the core sets' 170+). */
function biggestSet(printings: Printing[]): string {
  const counts = new Map<string, number>()
  for (const p of printings) counts.set(p.setCode, (counts.get(p.setCode) ?? 0) + 1)
  let best: { code: string; count: number } | undefined
  for (const s of listSets(printings)) {
    const count = counts.get(s.code) ?? 0
    if (best === undefined || count > best.count) best = { code: s.code, count }
  }
  return best?.code ?? ''
}

export function AddLine({ db, printings, testIdPrefix, autoFocus }: { db: CardDb; printings: Printing[]; testIdPrefix: 'quick-add' | 'add-line'; autoFocus?: boolean }): ReactElement {
  const draft = useDraft()
  const sets = useMemo(() => listSets(printings), [printings])
  const byCard = useMemo(() => printingsByCard(printings), [printings])
  const names = useMemo(() => buildDisplayNames(db), [db])
  const defaultSet = useMemo(() => biggestSet(printings), [printings])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const [sessionSet, setSessionSetState] = useState(() => {
    try { const saved = localStorage.getItem(SESSION_SET_KEY); return saved !== null && sets.some((s) => s.code === saved) ? saved : defaultSet } catch { return defaultSet }
  })
  function setSessionSet(code: string): void {
    setSessionSetState(code)
    try { localStorage.setItem(SESSION_SET_KEY, code) } catch { /* usable in this tab regardless */ }
  }

  const matches = useMemo(() => {
    if (query.trim() === '') return []
    const needle = query.trim().toLowerCase()
    return [...names.entries()].filter(([, name]) => name.toLowerCase().includes(needle)).slice(0, MAX_MATCHES).map(([cardId, name]) => {
      const all = byCard.get(cardId) ?? []
      const inSet = all.filter((p) => p.setCode === sessionSet)
      return { cardId, name, all, inSetCount: inSet.length, unambiguous: inSet.length === 1 ? inSet[0] : undefined }
    })
  }, [query, names, byCard, sessionSet])
  const clamped = matches.length === 0 ? 0 : Math.min(selected, matches.length - 1)

  function stage(printing: Printing, name: string, remove: boolean): void {
    const line = draft.mode === 'signed' ? { key: printing.key, delta: remove ? -1 : 1 } : { key: printing.key, exact: remove ? 0 : 1 }
    stageLine(line)
    const staged = draft.lines.length + 1
    setToast(`${draft.mode === 'signed' ? (remove ? '−1' : '+1') : (remove ? 'set 0' : 'set 1')} ${name} · ${printing.setName} ${printing.collectorNumber} → ${staged} staged`)
    setQuery(''); setSelected(0)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') { event.preventDefault(); setSelected(Math.min(clamped + 1, matches.length - 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setSelected(Math.max(clamped - 1, 0)) }
    else if (event.key === 'Escape') { setQuery(''); setSelected(0) }
    else if (event.key === 'Enter') { const m = matches[clamped]; if (m?.unambiguous !== undefined) stage(m.unambiguous, m.name, event.shiftKey) }
  }

  const p = testIdPrefix
  return (
    <div className="add-line" data-testid={p}>
      <div className="add-line__bar">
        <input type="text" data-testid={`${p}-input`} autoFocus={autoFocus} value={query}
          placeholder={draft.mode === 'signed' ? 'Type a card name — Enter stages 1 copy' : 'Type a card name — Enter stages "exactly 1"'}
          onChange={(e) => { setQuery(e.target.value); setSelected(0) }} onKeyDown={onKeyDown} />
        <label className="add-line__to">to
          <select data-testid={`${p}-set`} value={sessionSet} title="Session set — which printing a name resolves to" onChange={(e) => setSessionSet(e.target.value)}>
            {sets.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select>
        </label>
        <span className="add-line__hint"><kbd>Enter</kbd> +1 · <kbd>Shift</kbd><kbd>Enter</kbd> −1</span>
      </div>
      {matches.length > 0 && (
        <ul className="add-line__matches" role="listbox">
          {matches.map((m, index) => (
            <li key={m.cardId} role="option" aria-selected={index === clamped} data-testid={`${p}-match-${m.cardId}`}>
              {m.unambiguous !== undefined ? (
                <button type="button" onClick={() => stage(m.unambiguous!, m.name, false)}>{m.name}</button>
              ) : (
                <span className="add-line__choices">
                  <span className="add-line__choices-label">{m.name} — {m.inSetCount === 0 ? 'not in this set; pick a printing:' : `${m.inSetCount} printings in this set; pick one:`}</span>
                  {m.all.map((pr) => <button type="button" key={pr.key} className="fchip" data-testid={`${p}-printing-${pr.key}`} onClick={() => stage(pr, m.name, false)}>{pr.setName} {pr.collectorNumber} · {pr.rarity}{pr.finish ? ` · ${pr.finish}` : ''}</button>)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {toast !== null && <div className="add-line__toast" data-testid={`${p}-toast`} role="status">{toast}</div>}
    </div>
  )
}
```

- [ ] **Step 4: Swap the usage, delete the old component and its test**

In `src/ui/CollectionView.tsx` replace `import { QuickAddBar } from './QuickAddBar'` with `import { AddLine } from './AddLine'` and `<QuickAddBar db={db} printings={loadResult.printings} />` with `<AddLine db={db} printings={loadResult.printings} testIdPrefix="quick-add" />`. Then:

```bash
git rm -q src/ui/QuickAddBar.tsx tests/ui/quickaddbar.test.tsx
```

- [ ] **Step 5: Add the CSS** to the end of `src/ui/styles/collection.css` (the old `.quick-add*` rules are removed in Task 10):

```css
/* ---------------------------------------------------------------------- */
/* Add line (shared by Browse quick add and Add cards)                     */
/* ---------------------------------------------------------------------- */
.add-line { position: relative; width: 100%; }
.add-line__bar { display: flex; align-items: stretch; border: 1px solid var(--line-bright); background: var(--panel-2); }
.add-line__bar input { flex: 1 1 auto; min-width: 0; border: 0; background: transparent; padding: 9px 12px; }
.add-line__to { display: flex; align-items: center; gap: 8px; padding: 0 10px; border-left: 1px solid var(--line-bright); font-family: var(--font-display); font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.add-line__to select { border: 0; background: transparent; padding: 6px 0; max-width: 16em; }
.add-line__hint { display: flex; align-items: center; padding: 0 12px; border-left: 1px solid var(--line-bright); font-family: var(--font-mono); font-size: 10px; color: var(--muted); white-space: nowrap; }
.add-line__hint kbd { border: 1px solid var(--line-bright); padding: 0 4px; margin: 0 3px; color: var(--text); }
.add-line__matches { position: absolute; top: 100%; left: 0; right: 0; z-index: 5; margin: 2px 0 0; padding: .3em; list-style: none; background: var(--panel-2); border: 1px solid var(--line); max-height: 16em; overflow-y: auto; }
.add-line__matches li { padding: .2em .3em; font-size: .9em; }
.add-line__matches li[aria-selected='true'] { background: var(--panel); outline: 1px solid var(--act); }
.add-line__matches li > button { font: inherit; text-transform: none; letter-spacing: normal; padding: 2px 6px; clip-path: none; box-shadow: none; color: var(--text); }
.add-line__choices { display: flex; flex-wrap: wrap; align-items: center; gap: .3em; }
.add-line__choices-label { font-family: var(--font-mono); font-size: 11px; color: var(--muted); }
.add-line__choices .fchip { font-family: var(--font-mono); font-size: 11px; font-weight: 400; letter-spacing: normal; text-transform: none; padding: 3px 9px; background: var(--panel-2); border: 1px solid var(--line); color: var(--text); clip-path: none; box-shadow: none; }
.add-line__choices .fchip:hover { border-color: var(--you); }
.add-line__toast { margin-top: .4em; padding: .35em .6em; font-size: .85em; font-family: var(--font-mono); background: var(--panel-2); border: 1px solid var(--line); }
@media (max-width: 860px) { .add-line__bar { flex-wrap: wrap; } .add-line__hint { display: none; } .add-line__to { flex: 1 1 100%; border-left: 0; border-top: 1px solid var(--line-bright); } }
```

- [ ] **Step 6: Run the tests and the typecheck**

Run: `npx vitest run tests/ui/addline.test.tsx && npx tsc -b`
Expected: PASS (7 tests), tsc clean. `tests/ui/collectionview.test.tsx` still passes (it does not use quick add).

- [ ] **Step 7: Commit**

```bash
git add -A src/ui tests/ui
git commit -m "Replace QuickAddBar with AddLine, which stages into the session draft"
```

---

### Task 4: `CollectionModeHeader` — mode control, sync chip, staged pill, meters

**Files:**
- Create: `src/ui/CollectionModeHeader.tsx`
- Test: `tests/ui/collection-mode-header.test.tsx` (the sync-status cases move here from `tests/ui/collectionheader.test.tsx`, which is deleted in Task 9)

**Interfaces:**
- Consumes: `useSyncStatus`, `retryCollection`, `resolveConflict`, `confirmEmptySave`, `ownershipAvailable` (collectionSync); `completionStats`, `exportCollectionJson`, `useCollection` (collection); `useDraft`, `isDraftStale` (Task 1); `readCollectionJournal` (journal).
- Produces:
  ```ts
  export type CollectionMode = 'browse' | 'add' | 'plan' | 'history'
  export function CollectionModeHeader({ db, printings, mode, onMode }: { db: CardDb; printings: Printing[]; mode: CollectionMode; onMode: (m: CollectionMode) => void }): ReactElement
  ```
  Test ids: `collection-mode-<mode>` buttons with `aria-pressed`; `sync-status` span carrying `collection-header__sync collection-header__sync--<state>`; `staged-pill` (class `staged-pill--stale` when `isDraftStale()`); `collection-stats`, `playset-progress`, `artwork-progress`.

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/ui/collection-mode-header.test.tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { loadCardDb } from '../../src/engine/cardDb'
import { loadPrintings } from '../../src/ui/printings'
import { _resetCollectionCacheForTests, setCount } from '../../src/ui/collection'
import { DRAFT_KEY, _resetDraftForTests, emptyDraft, stageLine } from '../../src/ui/sessionDraft'
import { CollectionModeHeader } from '../../src/ui/CollectionModeHeader'
import * as sync from '../../src/ui/collectionSync'

const db = loadCardDb()
const printings = loadPrintings()
beforeEach(() => { localStorage.clear(); _resetCollectionCacheForTests(); _resetDraftForTests() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

function mount(mode: 'browse' | 'add' | 'plan' | 'history' = 'browse', onMode = vi.fn()) {
  render(<CollectionModeHeader db={db} printings={printings} mode={mode} onMode={onMode} />)
  return onMode
}

describe('mode control', () => {
  it('marks the active mode and reports clicks', () => {
    const onMode = mount('browse')
    expect(screen.getByTestId('collection-mode-browse').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByTestId('collection-mode-plan'))
    expect(onMode).toHaveBeenCalledWith('plan')
  })
})

describe('staged pill', () => {
  it('is absent with an empty draft, present with lines, and opens Add cards', () => {
    const onMode = mount()
    expect(screen.queryByTestId('staged-pill')).toBeNull()
    cleanup()
    stageLine({ key: printings[0].key, delta: 2 })
    mount('browse', onMode)
    expect(screen.getByTestId('staged-pill').textContent).toContain('2 staged')
    expect(screen.getByTestId('staged-pill').className).not.toContain('staged-pill--stale')
    fireEvent.click(screen.getByTestId('staged-pill'))
    expect(onMode).toHaveBeenCalledWith('add')
  })
  it('turns stale when the draft came back from storage untouched', () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...emptyDraft(), lines: [{ key: printings[0].key, delta: 1 }] }))
    mount()
    expect(screen.getByTestId('staged-pill').className).toContain('staged-pill--stale')
  })
})

describe('meters', () => {
  it('renders live stats', () => {
    mount()
    expect(screen.getByTestId('collection-stats').textContent).toContain('0')
    expect(screen.getByTestId('playset-progress').textContent).toMatch(/0 \/ \d+/)
  })
  it('suppresses the meters in the error state rather than showing zeros', () => {
    vi.spyOn(sync, 'useSyncStatus').mockReturnValue({ state: 'error', pendingCount: 0, message: 'data/collection.json is not valid JSON.' })
    mount()
    expect(screen.queryByTestId('collection-stats')).toBeNull()
    const text = screen.getByTestId('sync-status').textContent ?? ''
    expect(text).toMatch(/could not be read/i)
    expect(text).toContain('data/collection.json is not valid JSON.')
    expect(text).not.toMatch(/not yet saved/i)
  })
})

describe('sync chip', () => {
  it('shows a saved state when idle', () => {
    vi.spyOn(sync, 'useSyncStatus').mockReturnValue({ state: 'idle', pendingCount: 0, lastSavedAt: '2026-09-05T00:00:00.000Z' })
    mount()
    expect(screen.getByTestId('sync-status').textContent).toMatch(/saved/i)
    expect(screen.getByTestId('sync-status').className).toContain('collection-header__sync--idle')
  })
  it('shows the unsaved count, retry and download', () => {
    vi.spyOn(sync, 'useSyncStatus').mockReturnValue({ state: 'unsaved', pendingCount: 300, retrying: true })
    mount()
    expect(screen.getByTestId('sync-status').textContent).toContain('300')
    expect(screen.getByTestId('sync-status').textContent).toMatch(/retrying/i)
    expect(screen.getByTestId('sync-retry')).toBeTruthy()
    expect(screen.getByTestId('sync-download')).toBeTruthy()
  })
  it('does NOT claim to be retrying when no retry is armed', () => {
    vi.spyOn(sync, 'useSyncStatus').mockReturnValue({ state: 'unsaved', pendingCount: 12, retrying: false, message: 'Refusing to save invalid counts' })
    mount()
    const text = screen.getByTestId('sync-status').textContent ?? ''
    expect(text).toContain('12 changes not yet saved to disk')
    expect(text).not.toMatch(/retrying/i)
  })
  it('does not say "0 changes" when there is no pending work', () => {
    vi.spyOn(sync, 'useSyncStatus').mockReturnValue({ state: 'unsaved', pendingCount: 0, retrying: false, message: 'Cannot reach the dev server' })
    mount()
    const text = screen.getByTestId('sync-status').textContent ?? ''
    expect(text).not.toContain('0 changes'); expect(text).toContain('Not yet saved to disk')
  })
  it('retry calls the recovery entry point', () => {
    vi.spyOn(sync, 'useSyncStatus').mockReturnValue({ state: 'unsaved', pendingCount: 2 })
    const flush = vi.spyOn(sync, 'retryCollection').mockResolvedValue(undefined)
    mount()
    fireEvent.click(screen.getByTestId('sync-retry'))
    expect(flush).toHaveBeenCalledOnce()
  })
  it('download hands the local collection to a Blob', () => {
    setCount(printings[0].key, 3)
    vi.spyOn(sync, 'useSyncStatus').mockReturnValue({ state: 'unsaved', pendingCount: 3 })
    const blobSpy = vi.spyOn(globalThis, 'Blob')
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    mount()
    fireEvent.click(screen.getByTestId('sync-download'))
    expect(clickSpy).toHaveBeenCalledOnce()
    expect(String((blobSpy.mock.calls[0] as [BlobPart[]])[0][0])).toContain(printings[0].key)
  })
  it('offers both conflict choices with both totals, and Download', () => {
    setCount(printings[0].key, 3)
    const resolve = vi.spyOn(sync, 'resolveConflict').mockResolvedValue(undefined)
    vi.spyOn(sync, 'useSyncStatus').mockReturnValue({ state: 'conflict', pendingCount: 4, message: 'moved', conflictDisk: { counts: { [printings[0].key]: 10 }, revision: 5 } })
    mount()
    const box = screen.getByTestId('sync-conflict')
    expect(box.textContent).toContain('10'); expect(box.textContent).toContain('3')
    expect(screen.getByTestId('sync-status').textContent).toContain('moved')
    expect(screen.getByTestId('sync-download')).toBeTruthy()
    fireEvent.click(screen.getByTestId('sync-keep-mine')); expect(resolve).toHaveBeenCalledWith('mine')
    fireEvent.click(screen.getByTestId('sync-take-disk')); expect(resolve).toHaveBeenCalledWith('disk')
  })
  it('notes a failed git push without claiming the save failed', () => {
    vi.spyOn(sync, 'useSyncStatus').mockReturnValue({ state: 'idle', pendingCount: 0, git: 'failed' })
    mount()
    const text = screen.getByTestId('sync-status').textContent ?? ''
    expect(text).toMatch(/saved/i); expect(text).toMatch(/backup failed/i); expect(text).not.toMatch(/save failed|not saved/i)
  })
  it('explains a would-empty refusal and requires confirmation', () => {
    const confirm = vi.spyOn(sync, 'confirmEmptySave').mockResolvedValue(undefined)
    vi.spyOn(sync, 'useSyncStatus').mockReturnValue({ state: 'would-empty', pendingCount: 0, message: 'This save would empty a non-empty collection.' })
    mount()
    expect(screen.getByTestId('sync-status').textContent).toMatch(/empty/i)
    fireEvent.click(screen.getByTestId('sync-confirm-empty'))
    expect(confirm).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/ui/collection-mode-header.test.tsx`
Expected: FAIL — cannot resolve `../../src/ui/CollectionModeHeader`.

- [ ] **Step 3: Write the component**

```tsx
// src/ui/CollectionModeHeader.tsx
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
```

- [ ] **Step 4: Add the CSS** to the end of `src/ui/styles/collection.css` (keep the existing `.collection-header__sync--*` colour rules; they still apply):

```css
/* ---------------------------------------------------------------------- */
/* Collection header strip: modes · sync · staged pill · meters            */
/* ---------------------------------------------------------------------- */
.colhead { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 24px; padding: 10px 12px; margin: 0 -12px 0.8em; border-bottom: 1px solid var(--line); background: var(--panel); }
.colhead__modes { display: inline-flex; border: 1px solid var(--line-bright); }
.colhead__modes button { font-family: var(--font-display); font-weight: 700; text-transform: uppercase; letter-spacing: .1em; font-size: 12px; padding: 8px 18px; border: 0; border-right: 1px solid var(--line-bright); background: transparent; color: var(--muted); box-shadow: none; clip-path: none; }
.colhead__modes button:last-child { border-right: 0; }
.colhead__modes button:hover:not(:disabled) { color: var(--text); background: rgba(0, 229, 255, .06); }
.colhead__modes button[aria-pressed='true'], .colhead__modes button[aria-pressed='true']:hover { background: var(--you); color: var(--void); }
.colhead__count { font-family: var(--font-mono); font-weight: 400; letter-spacing: 0; font-size: 10px; margin-left: .5em; opacity: .8; }
.colhead__status { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; font-family: var(--font-mono); font-size: .85em; }
.chip--sync::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: currentColor; box-shadow: 0 0 6px currentColor; }
.collection-header__sync--idle { color: var(--ram-green); }
.staged-pill { display: inline-flex; align-items: center; gap: 8px; font-family: var(--font-display); font-weight: 700; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; padding: 5px 10px 5px 12px; border: 0; box-shadow: inset 0 0 0 1.5px var(--you); color: var(--you); background: rgba(0, 229, 255, .06); clip-path: none; }
.staged-pill b { font-family: var(--font-mono); font-weight: 500; letter-spacing: 0; font-size: 12px; color: var(--text); }
.staged-pill__go { font-family: var(--font-mono); font-weight: 400; letter-spacing: 0; text-transform: none; font-size: 10px; color: var(--muted); }
.staged-pill--stale, .staged-pill--stale:hover:not(:disabled) { box-shadow: inset 0 0 0 1.5px var(--act); color: var(--act); background: rgba(252, 238, 10, .08); }
.colhead__meters { display: flex; align-items: center; gap: 14px; }
.meter { display: grid; grid-template-columns: auto auto; gap: 2px 10px; align-items: baseline; min-width: 150px; }
.meter__k { font-family: var(--font-display); font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.meter__v { justify-self: end; font-family: var(--font-mono); font-size: 12px; font-variant-numeric: tabular-nums; color: var(--text); }
.meter__track { grid-column: 1 / -1; height: 4px; background: var(--panel-2); border: 1px solid var(--line); }
.meter__track i { display: block; height: 100%; background: var(--you); }
.meter--art .meter__track i { background: var(--act); }
.meter__note { grid-column: 1 / -1; font-size: 10px; color: var(--muted); }
.meter--phys { min-width: 0; }
.meter__v--big { font-family: var(--font-display); font-weight: 700; font-size: 18px; }
@media (max-width: 860px) { .colhead__meters { flex-wrap: wrap; } .meter { min-width: 120px; } }
```

Note: the `.collection-header__sync--idle` colour rule is new (the chip's dot uses `currentColor`; idle was previously uncoloured). The existing `--saving`, `--unsaved`, `--conflict`, `--would-empty` rules in `collection.css` stay.

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run tests/ui/collection-mode-header.test.tsx && npx tsc -b`
Expected: PASS (13 tests), tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/ui/CollectionModeHeader.tsx src/ui/styles/collection.css tests/ui/collection-mode-header.test.tsx
git commit -m "Add the Collection header strip with mode control, sync chip, staged pill and meters"
```

---

### Task 5: `CollectionFilterRail` — grouped filters with a set list

**Files:**
- Create: `src/ui/CollectionFilterRail.tsx`
- Test: `tests/ui/collection-filter-rail.test.tsx`

**Interfaces:**
- Consumes: `ramColorVar` (CardFrame), `listSets`, `Printing`, `CardType`.
- Produces:
  ```ts
  export type GoalFilter = 'all' | 'missing-playset' | 'missing-arts' | 'complete'
  export interface CollectionFilters { search: string; goal: GoalFilter; colors: Set<string>; types: Set<CardType>; rarities: Set<string>; setCode: string }
  export const EMPTY_FILTERS: CollectionFilters
  export function activeFilterCount(f: CollectionFilters): number
  export function CollectionFilterRail({ filters, onChange, printings, rarities, setTotals, collapsed }: {
    filters: CollectionFilters; onChange: (next: CollectionFilters) => void; printings: Printing[]; rarities: string[];
    setTotals: Record<string, { owned: number; total: number }>; collapsed: boolean  // collapsed = narrow layout, render inside a <details className="tool-panel">
  }): ReactElement
  ```
  Test ids kept from today: `collection-search`, `goal-filter-<id>`, `collection-color-<Color>`, `collection-type-<type>`, `rarity-filter-<slug>`, `collection-legend`; new: `set-filter` (container), `set-filter-<code>` rows (`set-filter-all` for all sets), `filter-rail`.

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/ui/collection-filter-rail.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { loadPrintings } from '../../src/ui/printings'
import { CollectionFilterRail, EMPTY_FILTERS, activeFilterCount, type CollectionFilters } from '../../src/ui/CollectionFilterRail'

const printings = loadPrintings()
const rarities = [...new Set(printings.map(p => p.rarity))]
afterEach(cleanup)

function mount(filters: CollectionFilters = EMPTY_FILTERS, collapsed = false) {
  const onChange = vi.fn()
  render(<CollectionFilterRail filters={filters} onChange={onChange} printings={printings} rarities={rarities} setTotals={{ arasakademodeck: { owned: 3, total: 14 } }} collapsed={collapsed} />)
  return onChange
}

describe('CollectionFilterRail', () => {
  it('toggles a colour chip through onChange', () => {
    const onChange = mount()
    fireEvent.click(screen.getByTestId('collection-color-Red'))
    expect(onChange.mock.calls[0][0].colors.has('Red')).toBe(true)
  })
  it('rarity ids are slug-safe for two-word rarities', () => {
    mount()
    expect(screen.getByTestId('rarity-filter-nova-rare').textContent).toBe('Nova Rare')
  })
  it('lists every set with its owned/total and selects one', () => {
    const onChange = mount()
    const row = screen.getByTestId('set-filter-arasakademodeck')
    expect(row.textContent).toContain('3 / 14')
    fireEvent.click(row)
    expect(onChange.mock.calls[0][0].setCode).toBe('arasakademodeck')
    expect(screen.getAllByTestId(/^set-filter-/).length).toBe(new Set(printings.map(p => p.setCode)).size + 1)
  })
  it('the goal control is single-select', () => {
    const onChange = mount()
    fireEvent.click(screen.getByTestId('goal-filter-complete'))
    expect(onChange.mock.calls[0][0].goal).toBe('complete')
  })
  it('search edits go through onChange', () => {
    const onChange = mount()
    fireEvent.change(screen.getByTestId('collection-search'), { target: { value: 'mantis' } })
    expect(onChange.mock.calls[0][0].search).toBe('mantis')
  })
  it('counts active filters and offers clear links only when something is set', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0)
    const f = { ...EMPTY_FILTERS, colors: new Set(['Red', 'Blue']), setCode: 'x' }
    expect(activeFilterCount(f)).toBe(3)
    mount(f)
    expect(screen.getByTestId('clear-colors')).toBeTruthy()
    expect(screen.queryByTestId('clear-types')).toBeNull()
  })
  it('collapsed mode wraps the groups in a summary that names the active count', () => {
    mount({ ...EMPTY_FILTERS, goal: 'missing-arts' }, true)
    expect(screen.getByTestId('filter-rail').querySelector('summary')!.textContent).toContain('1 active')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/ui/collection-filter-rail.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

```tsx
// src/ui/CollectionFilterRail.tsx
//
// The Browse mode's left rail: six labelled filter groups. Stateless — the
// shell owns the filter values so the toolbar's result count and the grid
// read the same object. The set dropdown becomes a list with owned/total per
// set, which doubles as a "where am I" view; goal is single-select, the rest
// multi-select chips (the existing `filter-chip` look from deckbuilder.css).
import type { CSSProperties, ReactElement } from 'react'
import type { CardType } from '../engine/types'
import { ramColorVar } from './CardFrame'
import { listSets, type Printing } from './printings'

export type GoalFilter = 'all' | 'missing-playset' | 'missing-arts' | 'complete'
export interface CollectionFilters { search: string; goal: GoalFilter; colors: Set<string>; types: Set<CardType>; rarities: Set<string>; setCode: string }
export const EMPTY_FILTERS: CollectionFilters = { search: '', goal: 'all', colors: new Set(), types: new Set(), rarities: new Set(), setCode: '' }

const COLORS = ['Red', 'Yellow', 'Green', 'Blue'] as const
const TYPES: CardType[] = ['legend', 'unit', 'program', 'gear']
const GOALS: { id: GoalFilter; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'missing-playset', label: 'Need copies' }, { id: 'missing-arts', label: 'Need art' }, { id: 'complete', label: 'Complete' },
]
/** Rarity chips in a fixed, familiar order; anything the dataset adds that is
 *  not listed here lands at the end of the second row. */
const RARITY_ROWS: string[][] = [['Common', 'Uncommon', 'Rare', 'Epic', 'Nova Rare', 'Secret'], ['Iconic Legend', 'Iconic Other', 'Iconic Secret']]

export function slug(value: string): string { return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') }
export function activeFilterCount(f: CollectionFilters): number {
  return (f.search.trim() ? 1 : 0) + (f.goal !== 'all' ? 1 : 0) + f.colors.size + f.types.size + f.rarities.size + (f.setCode ? 1 : 0)
}
function toggled<T>(set: Set<T>, value: T): Set<T> { const next = new Set(set); if (next.has(value)) next.delete(value); else next.add(value); return next }

export function CollectionFilterRail({ filters, onChange, printings, rarities, setTotals, collapsed }: {
  filters: CollectionFilters; onChange: (next: CollectionFilters) => void; printings: Printing[]; rarities: string[]
  setTotals: Record<string, { owned: number; total: number }>; collapsed: boolean
}): ReactElement {
  const sets = listSets(printings)
  const known = new Set(RARITY_ROWS.flat())
  const rows = [RARITY_ROWS[0].filter(r => rarities.includes(r)), [...RARITY_ROWS[1].filter(r => rarities.includes(r)), ...rarities.filter(r => !known.has(r))]]
  const allOwned = Object.values(setTotals).reduce((n, s) => n + s.owned, 0)

  const clear = (id: string, patch: Partial<CollectionFilters>, active: boolean) => active
    ? <button type="button" className="rail__clear" data-testid={`clear-${id}`} onClick={() => onChange({ ...filters, ...patch })}>clear</button> : null

  const groups = (
    <>
      <div className="rail__group">
        <input type="search" data-testid="collection-search" aria-label="Search cards or printing numbers" value={filters.search} placeholder="Search name, subtitle, #number, artist…" onChange={e => onChange({ ...filters, search: e.target.value })} />
      </div>
      <div className="rail__group"><h4>Goal</h4>
        <div className="seg seg--goal">{GOALS.map(g => <button type="button" key={g.id} data-testid={`goal-filter-${g.id}`} aria-pressed={filters.goal === g.id} onClick={() => onChange({ ...filters, goal: g.id })}>{g.label}</button>)}</div>
      </div>
      <div className="rail__group"><h4>Color {clear('colors', { colors: new Set() }, filters.colors.size > 0)}</h4>
        <div className="card-browser__chips">{COLORS.map(c => <button type="button" key={c} data-testid={`collection-color-${c}`} aria-pressed={filters.colors.has(c)} className="filter-chip filter-chip--ram" style={{ '--ram-chip-color': ramColorVar(c) } as CSSProperties} onClick={() => onChange({ ...filters, colors: toggled(filters.colors, c) })}><span className="filter-chip__swatch" aria-hidden="true" />{c}</button>)}</div>
      </div>
      <div className="rail__group"><h4>Type {clear('types', { types: new Set() }, filters.types.size > 0)}</h4>
        <div className="card-browser__chips">{TYPES.map(t => <button type="button" key={t} data-testid={`collection-type-${t}`} aria-pressed={filters.types.has(t)} className="filter-chip" onClick={() => onChange({ ...filters, types: toggled(filters.types, t) })}>{t}</button>)}</div>
      </div>
      <div className="rail__group"><h4>Rarity {clear('rarities', { rarities: new Set() }, filters.rarities.size > 0)}</h4>
        {rows.map((row, i) => <div className="card-browser__chips" key={i}>{row.map(r => <button type="button" key={r} data-testid={`rarity-filter-${slug(r)}`} aria-pressed={filters.rarities.has(r)} className="filter-chip" onClick={() => onChange({ ...filters, rarities: toggled(filters.rarities, r) })}>{r}</button>)}</div>)}
      </div>
      <div className="rail__group"><h4>Set {clear('set', { setCode: '' }, filters.setCode !== '')}</h4>
        <div className="rail__sets" data-testid="set-filter" role="listbox">
          <button type="button" role="option" className="setrow" data-testid="set-filter-all" aria-selected={filters.setCode === ''} onClick={() => onChange({ ...filters, setCode: '' })}><span>All sets</span><span className="setrow__n">{allOwned} / {printings.length}</span></button>
          {sets.map(s => { const t = setTotals[s.code] ?? { owned: 0, total: 0 }; return (
            <button type="button" role="option" key={s.code} className="setrow" data-testid={`set-filter-${s.code}`} aria-selected={filters.setCode === s.code} onClick={() => onChange({ ...filters, setCode: s.code })}>
              <span>{s.name}</span><span className="setrow__n">{t.owned} / {t.total}</span>
              <span className="setrow__bar"><i style={{ width: `${t.total ? Math.min(100, Math.round(100 * t.owned / t.total)) : 0}%` }} /></span>
            </button>) })}
        </div>
      </div>
      <p className="rail__foot" data-testid="collection-legend">Goal and totals always cover the whole collection. Set, rarity and search narrow which printings are shown.</p>
    </>
  )

  if (collapsed) {
    const n = activeFilterCount(filters)
    return <details className="tool-panel rail rail--collapsed" data-testid="filter-rail"><summary>Filters<span className="tool-panel__meta">{n} active</span></summary><div className="tool-panel__body rail__body">{groups}</div></details>
  }
  return <aside className="rail" data-testid="filter-rail" aria-label="Filters">{groups}</aside>
}
```

- [ ] **Step 4: Add the CSS** to the end of `src/ui/styles/collection.css`:

```css
/* ---------------------------------------------------------------------- */
/* Browse: filter rail                                                     */
/* ---------------------------------------------------------------------- */
.rail { display: flex; flex-direction: column; gap: 18px; padding: 14px 14px 20px; background: var(--panel); border-right: 1px solid var(--line); }
.rail--collapsed { border-right: 0; margin-bottom: .8em; }
.rail__body { gap: 14px; }
.rail__group { display: flex; flex-direction: column; gap: 8px; }
.rail__group > h4 { display: flex; justify-content: space-between; align-items: baseline; margin: 0; font-size: 11px; letter-spacing: .12em; color: var(--muted); }
.rail__clear { font-family: var(--font-mono); font-size: 10px; text-transform: none; letter-spacing: 0; color: var(--you); background: none; border: 0; padding: 0; box-shadow: none; clip-path: none; }
.rail input[type='search'] { width: 100%; }
.seg { display: grid; grid-auto-flow: column; border: 1px solid var(--line); }
.seg button { font-family: var(--font-mono); font-size: 11px; font-weight: 400; letter-spacing: normal; text-transform: none; padding: 6px 4px; border: 0; border-right: 1px solid var(--line); background: var(--panel-2); color: var(--muted); box-shadow: none; clip-path: none; }
.seg button:last-child { border-right: 0; }
.seg button[aria-pressed='true'], .seg button[aria-pressed='true']:hover { background: var(--you); color: var(--void); }
.seg--goal button { font-family: var(--font-display); font-weight: 700; text-transform: uppercase; letter-spacing: .06em; padding: 7px 4px; }
.rail__sets { display: flex; flex-direction: column; gap: 2px; max-height: 260px; overflow-y: auto; }
.setrow { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; align-items: center; padding: 5px 8px; border: 1px solid transparent; background: transparent; color: var(--text); text-align: left; font-family: var(--font-body); font-weight: 400; font-size: 12px; letter-spacing: normal; text-transform: none; box-shadow: none; clip-path: none; }
.setrow:hover:not(:disabled) { background: var(--panel-2); }
.setrow[aria-selected='true'] { border-color: var(--you); background: rgba(0, 229, 255, .08); }
.setrow__n { font-family: var(--font-mono); font-size: 10px; color: var(--muted); font-variant-numeric: tabular-nums; }
.setrow__bar { grid-column: 1 / -1; height: 2px; background: var(--panel-2); }
.setrow__bar i { display: block; height: 100%; background: var(--you); }
.rail__foot { margin: 0; font-family: var(--font-mono); font-size: 10px; line-height: 1.5; color: var(--muted); }
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run tests/ui/collection-filter-rail.test.tsx && npx tsc -b`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/ui/CollectionFilterRail.tsx src/ui/styles/collection.css tests/ui/collection-filter-rail.test.tsx
git commit -m "Add the grouped Collection filter rail with a per-set progress list"
```

---

### Task 6: `CardDrawer` and `CollectionBrowse` — tiles, list view, drawer

**Files:**
- Create: `src/ui/CardDrawer.tsx`, `src/ui/CollectionBrowse.tsx`
- Test: `tests/ui/card-drawer.test.tsx`, `tests/ui/collection-browse.test.tsx`

**Interfaces:**
- Consumes: `CollectionFilterRail`, `CollectionFilters`, `EMPTY_FILTERS` (Task 5); `AddLine` (Task 3); `CardFrame`, `ramColorVar`; `PrintingCount` (existing); `matchesPrinting`; `artworkGroups`, `ownedArtworkIds`; `getPrintingImageUrl`; `adjustCount`, `ownedByCard`, `playsetTarget`, `useCollection`, `Collection`; `printingsByCard`.
- Produces:
  ```ts
  export function CardDrawer({ def, printings, collection, known, useOfficialImages, onClose }: { def: CardDef; printings: Printing[]; collection: Collection; known: boolean; useOfficialImages: boolean; onClose: () => void }): ReactElement
  export function CollectionBrowse({ db, printings, byCard, known, useOfficialImages, narrow }: { db: CardDb; printings: Printing[]; byCard: Map<string, Printing[]>; known: boolean; useOfficialImages: boolean; narrow: boolean }): ReactElement
  ```
  `CollectionBrowse` owns filters, view (grid/list), the expanded card id, and the row limit; it renders the rail (collapsed when `narrow`), the toolbar (`AddLine` with `testIdPrefix="quick-add"`, count `collection-scope`, view toggle `collection-compact`), the grid or list, and the drawer.

- [ ] **Step 1: Write the failing drawer tests**

```tsx
// tests/ui/card-drawer.test.tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { loadCardDb } from '../../src/engine/cardDb'
import { loadPrintings, printingsByCard } from '../../src/ui/printings'
import { _resetCollectionCacheForTests, getCollection, setCount } from '../../src/ui/collection'
import { CardDrawer } from '../../src/ui/CardDrawer'

const db = loadCardDb()
const printings = loadPrintings()
const byCard = printingsByCard(printings)
const cardId = 'industrial-assembly'
const prints = byCard.get(cardId)!
beforeEach(() => { localStorage.clear(); _resetCollectionCacheForTests() })
afterEach(cleanup)

function mount(onClose = vi.fn()) {
  render(<CardDrawer def={db[cardId]} printings={prints} collection={getCollection()} known useOfficialImages={false} onClose={onClose} />)
  return onClose
}

describe('CardDrawer', () => {
  it('shows both goals and one row per printing grouped by artwork', () => {
    mount()
    expect(screen.getByTestId('drawer-playset').textContent).toMatch(/0 \/ 3/)
    expect(screen.getByTestId('drawer-artworks').textContent).toMatch(/0 \/ \d+/)
    for (const p of prints) expect(screen.getByTestId(`printing-row-${p.key}`)).toBeTruthy()
  })
  it('steppers write immediately', () => {
    mount()
    fireEvent.click(screen.getByTestId(`printing-inc-${prints[0].key}`))
    expect(getCollection().counts[prints[0].key]).toBe(1)
  })
  it('names a printing row "Artwork n · owned/missing" and tags collection-only printings', () => {
    setCount('arasakademodeck/006', 1)
    render(<CardDrawer def={db[cardId]} printings={prints} collection={getCollection()} known useOfficialImages={false} onClose={() => {}} />)
    expect(screen.getByTestId('printing-row-arasakademodeck/006').textContent).toMatch(/Artwork 1 · owned/)
    const only = printings.find(p => p.playable === false)
    if (only) { cleanup(); render(<CardDrawer def={db[only.cardId]} printings={byCard.get(only.cardId)!} collection={getCollection()} known useOfficialImages={false} onClose={() => {}} />); expect(screen.getByTestId(`printing-row-${only.key}`).textContent).toMatch(/Collection only/) }
  })
  it('close calls back', () => {
    const onClose = mount()
    fireEvent.click(screen.getByTestId('drawer-close'))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Write the failing browse tests** (these replace the grid cases in `tests/ui/collectionview.test.tsx`, which Task 10 trims)

```tsx
// tests/ui/collection-browse.test.tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { loadCardDb } from '../../src/engine/cardDb'
import { loadPrintings, printingsByCard } from '../../src/ui/printings'
import { _resetCollectionCacheForTests, getCollection } from '../../src/ui/collection'
import { _resetDraftForTests } from '../../src/ui/sessionDraft'
import { CollectionBrowse } from '../../src/ui/CollectionBrowse'

const db = loadCardDb()
const printings = loadPrintings()
const byCard = printingsByCard(printings)
const multi = printings.find((p) => printings.filter((q) => q.cardId === p.cardId).length >= 2)!
beforeEach(() => { localStorage.clear(); _resetCollectionCacheForTests(); _resetDraftForTests() })
afterEach(cleanup)

function mount(narrow = false) {
  render(<CollectionBrowse db={db} printings={printings} byCard={byCard} known useOfficialImages={false} narrow={narrow} />)
}

describe('CollectionBrowse', () => {
  it('renders a tile per card with the owned/target footer', () => {
    mount()
    expect(screen.getAllByTestId('collection-cell').length).toBe(Object.keys(db).length)
    expect(screen.getByTestId(`collection-count-${multi.cardId}`).textContent).toContain('0/')
  })
  it('clicking a tile opens the drawer; the stepper there increments and the footer follows', async () => {
    const user = userEvent.setup(); mount()
    await user.click(screen.getByTestId(`expand-${multi.cardId}`))
    expect(screen.getByTestId('card-drawer').textContent).toContain(db[multi.cardId].name)
    await user.click(screen.getByTestId(`printing-inc-${multi.key}`))
    expect(getCollection().counts[multi.key]).toBe(1)
    expect(screen.getByTestId(`collection-count-${multi.cardId}`).textContent).toContain('1/')
    await user.click(screen.getByTestId('drawer-close'))
    expect(screen.queryByTestId('card-drawer')).toBeNull()
  })
  it('decrement stops at 0', async () => {
    const user = userEvent.setup(); mount()
    await user.click(screen.getByTestId(`expand-${multi.cardId}`))
    await user.click(screen.getByTestId(`printing-dec-${multi.key}`))
    expect(getCollection().counts[multi.key]).toBeUndefined()
  })
  it('goal "complete" shows nothing on an empty collection', async () => {
    const user = userEvent.setup(); mount()
    await user.click(screen.getByTestId('goal-filter-complete'))
    expect(screen.queryAllByTestId('collection-cell')).toHaveLength(0)
  })
  it('set filter narrows the grid', async () => {
    const user = userEvent.setup(); mount()
    await user.click(screen.getByTestId(`set-filter-${multi.setCode}`))
    const shown = screen.getAllByTestId('collection-cell').length
    expect(shown).toBeGreaterThan(0); expect(shown).toBeLessThanOrEqual(Object.keys(db).length)
  })
  it('List view shows one row per matching printing with a count input', async () => {
    const user = userEvent.setup(); mount()
    await user.type(screen.getByTestId('collection-search'), 'Industrial 006')
    await user.click(screen.getByTestId(`set-filter-arasakademodeck`))
    await user.click(screen.getByTestId('collection-compact'))
    expect(screen.getAllByTestId('compact-printing')).toHaveLength(1)
    expect(screen.getByTestId('printing-count-arasakademodeck/006')).toBeTruthy()
    expect(screen.getByTestId('collection-scope').textContent).toContain('1 printing')
  })
  it('narrow layout collapses the rail behind a Filters summary', () => {
    mount(true)
    expect(within(screen.getByTestId('filter-rail')).getByText(/Filters/)).toBeTruthy()
  })
})
```

- [ ] **Step 3: Run both to verify they fail**

Run: `npx vitest run tests/ui/card-drawer.test.tsx tests/ui/collection-browse.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 4: Write `CardDrawer`**

```tsx
// src/ui/CardDrawer.tsx
//
// One card, opened from a Browse tile: its two goals as figures, then its
// printings grouped by artwork with +/− steppers. The steppers are the one
// direct-edit path left in the app (everything else stages into a session):
// a correction to a count you are looking at should not need a review step.
// Only the exact printing's image is shown — substituting base art would
// misidentify alternate illustrations.
import type { CSSProperties, ReactElement } from 'react'
import type { CardDef } from '../engine/types'
import type { Printing } from './printings'
import { adjustCount, playsetTarget, type Collection } from './collection'
import { artworkGroups, ownedArtworkIds } from './artworks'
import { getPrintingImageUrl } from './images'
import { ramColorVar } from './CardFrame'
import { PrintingCount } from './PrintingCount'

export function CardDrawer({ def, printings, collection, known, useOfficialImages, onClose }: { def: CardDef; printings: Printing[]; collection: Collection; known: boolean; useOfficialImages: boolean; onClose: () => void }): ReactElement {
  const target = playsetTarget(def)
  const owned = printings.filter(p => p.playable !== false).reduce((n, p) => n + (collection.counts[p.key] ?? 0), 0)
  const groups = artworkGroups(printings)
  const ownedArts = ownedArtworkIds(printings, collection.counts)
  const unreviewed = printings.filter(p => !p.artworkId)
  const sections: { title: string; status?: 'owned' | 'missing'; printings: Printing[] }[] = [
    ...groups.map((g, i) => ({ title: `Artwork ${i + 1}${g.printings[0].artist ? ` · ${g.printings[0].artist}` : ''}`, status: ownedArts.has(g.id) ? 'owned' as const : 'missing' as const, printings: g.printings })),
    ...(unreviewed.length ? [{ title: 'Artwork identity awaiting review', printings: unreviewed }] : []),
  ]
  const artDone = groups.length > 0 && unreviewed.length === 0 && ownedArts.size === groups.length
  return (
    <aside className="drawer" data-testid="card-drawer" aria-label="Card printings" style={{ '--c': ramColorVar(def.color) } as CSSProperties}>
      <div className="drawer__head">
        <h3>{def.name}{def.subtitle && <span className="drawer__sub">{def.subtitle}</span>}</h3>
        <button type="button" className="drawer__close" data-testid="drawer-close" aria-label="Close" onClick={onClose}>✕ close</button>
      </div>
      <div className="drawer__body">
        <div className="drawer__goals">
          <div className={`goal${known && target > 0 && owned >= target ? ' goal--done' : ''}`} data-testid="drawer-playset"><span className="goal__k">Playset</span><span className="goal__v">{target === 0 ? 'Collection only' : `${known ? owned : '?'} / ${target}`}<small>{def.type === 'legend' ? 'Legend · 1 copy' : 'any playable printing'}</small></span></div>
          <div className={`goal goal--art${known && artDone ? ' goal--done' : ''}`} data-testid="drawer-artworks"><span className="goal__k">Artworks</span><span className="goal__v">{known ? ownedArts.size : '?'} / {groups.length}<small>{unreviewed.length ? `${unreviewed.length} awaiting review` : 'any printing'}</small></span></div>
        </div>
        {sections.map(s => (
          <div className="artgrp" key={s.title}>
            <div className="artgrp__head"><span>{s.title}</span>{s.status && <span className={`artgrp__status artgrp__status--${s.status}`}>{known ? s.status : '?'}</span>}</div>
            {s.printings.map(p => {
              const count = collection.counts[p.key] ?? 0
              const image = getPrintingImageUrl(p.key)
              const artIndex = groups.findIndex(g => g.id === p.artworkId) + 1
              return (
                <div key={p.key} className={`prow${p.playable === false ? ' prow--only' : ''}`} data-testid={`printing-row-${p.key}`}>
                  {image !== undefined ? <a href={image} target="_blank" rel="noreferrer" title="View this printing"><img src={image} alt={`${p.setName} ${p.collectorNumber}`} width={34} loading="lazy" /></a> : <span className="prow__img" aria-hidden="true" />}
                  <span className="prow__meta">
                    <b>{p.setName}{p.finish && <span className="tag tag--foil">{p.finish}</span>}{p.playable === false && <span className="tag">Collection only</span>}</b>
                    <span>{p.collectorNumber} · {p.rarity} · {artIndex > 0 ? `Artwork ${artIndex}${known ? (ownedArts.has(p.artworkId!) ? ' · owned' : ' · missing') : ''}` : 'artwork unreviewed'}</span>
                    <span className="prow__key">{p.key}</span>
                  </span>
                  <span className="collection-view__stepper">
                    <button type="button" data-testid={`printing-dec-${p.key}`} disabled={!known || count === 0} onClick={() => adjustCount(p.key, -1)}>−</button>
                    <PrintingCount printingKey={p.key} count={count} known={known} />
                    <button type="button" data-testid={`printing-inc-${p.key}`} disabled={!known} onClick={() => adjustCount(p.key, 1)}>+</button>
                  </span>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </aside>
  )
}
```

(`useOfficialImages` is accepted for parity with the tiles and reserved for a "View card" zoom; it is unused in this task — prefix the destructured name with an underscore if `noUnusedParameters` complains: `useOfficialImages: _useOfficialImages`.)

- [ ] **Step 5: Write `CollectionBrowse`**

```tsx
// src/ui/CollectionBrowse.tsx
//
// Browse mode: filter rail | toolbar + grid/list | card drawer. Owns the
// filter state so the rail, the result count and the grid agree; the drawer
// replaces the old inline printings expansion so opening a card no longer
// reflows the grid. Tile footers replace the corner badge and spell out the
// two goals, so the ✓/★ legend paragraph is gone.
import { useMemo, useState, type CSSProperties, type ReactElement } from 'react'
import type { CardDb, CardDef } from '../engine/types'
import type { Printing } from './printings'
import { CardFrame, ramColorVar } from './CardFrame'
import { AddLine } from './AddLine'
import { CardDrawer } from './CardDrawer'
import { CollectionFilterRail, EMPTY_FILTERS, type CollectionFilters } from './CollectionFilterRail'
import { PrintingCount } from './PrintingCount'
import { matchesPrinting } from './collectionEntry'
import { artworkGroups, ownedArtworkIds } from './artworks'
import { getPrintingImageUrl } from './images'
import { ownedByCard, playsetTarget, useCollection, type Collection } from './collection'

interface Rollup { def: CardDef; printings: Printing[]; matching: Printing[]; owned: number; target: number; artOwned: number; artTarget: number; playsetDone: boolean; artsDone: boolean }
function rollup(def: CardDef, prints: Printing[], collection: Collection, owned: number, matching: Printing[]): Rollup {
  const target = playsetTarget(def), artTarget = artworkGroups(prints).length, artOwned = ownedArtworkIds(prints, collection.counts).size
  return { def, printings: prints, matching, owned, target, artOwned, artTarget, playsetDone: target > 0 && owned >= target, artsDone: prints.every(p => !!p.artworkId) && artTarget > 0 && artOwned === artTarget }
}

export function CollectionBrowse({ db, printings, byCard, known, useOfficialImages, narrow }: { db: CardDb; printings: Printing[]; byCard: Map<string, Printing[]>; known: boolean; useOfficialImages: boolean; narrow: boolean }): ReactElement {
  const collection = useCollection()
  const [filters, setFilters] = useState<CollectionFilters>(EMPTY_FILTERS)
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [rowLimit, setRowLimit] = useState(60)
  const rarities = useMemo(() => [...new Set(printings.map(p => p.rarity))], [printings])
  const owned = useMemo(() => ownedByCard(printings, collection), [printings, collection])
  const setTotals = useMemo(() => {
    const totals: Record<string, { owned: number; total: number }> = {}
    for (const p of printings) { const t = totals[p.setCode] ?? (totals[p.setCode] = { owned: 0, total: 0 }); t.total += 1; t.owned += collection.counts[p.key] ?? 0 }
    return totals
  }, [printings, collection])

  const rollups = useMemo(() => Object.values(db)
    .filter(def => filters.colors.size === 0 || filters.colors.has(def.color))
    .filter(def => filters.types.size === 0 || filters.types.has(def.type))
    .map(def => { const prints = byCard.get(def.id) ?? []; return rollup(def, prints, collection, owned[def.id] ?? 0, prints.filter(p => matchesPrinting(def, p, filters.search.replace(/^#\s*/, ''), filters.setCode, filters.rarities))) })
    .filter(r => r.matching.length > 0)
    .filter(r => filters.goal === 'missing-playset' ? !r.playsetDone && r.target > 0 : filters.goal === 'missing-arts' ? !r.artsDone : filters.goal === 'complete' ? r.playsetDone && r.artsDone : true)
    .sort((a, b) => a.def.name.localeCompare(b.def.name)), [db, byCard, collection, owned, filters])

  const matchingRows = rollups.reduce((n, r) => n + r.matching.length, 0)
  const matchingOwned = rollups.reduce((n, r) => n + r.matching.reduce((a, p) => a + (collection.counts[p.key] ?? 0), 0), 0)
  const open = expanded !== null ? rollups.find(r => r.def.id === expanded) ?? (db[expanded] ? rollup(db[expanded], byCard.get(expanded) ?? [], collection, owned[expanded] ?? 0, []) : undefined) : undefined

  return (
    <div className={`browse${open ? ' browse--drawer' : ''}${narrow ? ' browse--narrow' : ''}`}>
      <CollectionFilterRail filters={filters} onChange={f => { setFilters(f); setRowLimit(60) }} printings={printings} rarities={rarities} setTotals={setTotals} collapsed={narrow} />
      <div className="browse__main">
        <div className="browse__toolbar">
          <fieldset disabled={!known} className="collection-editor"><AddLine db={db} printings={printings} testIdPrefix="quick-add" /></fieldset>
          <div className="browse__view">
            <span className="browse__count" data-testid="collection-scope"><b>{rollups.length}</b> cards · <b>{matchingRows}</b> printing rows · <b>{known ? matchingOwned : '?'}</b> physical copies owned</span>
            <div className="seg"><button type="button" aria-pressed={view === 'grid'} onClick={() => setView('grid')}>Grid</button><button type="button" data-testid="collection-compact" aria-pressed={view === 'list'} onClick={() => setView(v => v === 'list' ? 'grid' : 'list')}>List</button></div>
          </div>
        </div>
        {view === 'grid' ? (
          <div className="collection-view__grid" data-testid="collection-grid">
            {rollups.map(r => (
              <div key={r.def.id} className={`tile${expanded === r.def.id ? ' tile--open' : ''}${r.target === 0 ? ' tile--only' : ''}`} data-testid="collection-cell" data-card-id={r.def.id} style={{ '--c': ramColorVar(r.def.color) } as CSSProperties}>
                <button type="button" className="tile__hit" data-testid={`expand-${r.def.id}`} aria-expanded={expanded === r.def.id} onClick={() => setExpanded(expanded === r.def.id ? null : r.def.id)}>
                  <CardFrame def={r.def} size="zoom" useOfficialImages={useOfficialImages} />
                </button>
                <span className="tile__ring" aria-hidden="true"><i style={{ width: `${r.target ? Math.min(100, 100 * r.owned / r.target) : 0}%` }} /></span>
                <span className="tile__own" data-testid={`collection-count-${r.def.id}`}>
                  <span className={`tile__ps${r.target === 0 ? ' tile__ps--only' : known && r.playsetDone ? ' tile__ps--done' : known && r.owned === 0 ? ' tile__ps--zero' : ''}`}>{r.target === 0 ? 'Collection only' : `${known ? r.owned : '?'}/${r.target}`}{known && r.playsetDone && <span title="Playset complete"> ✓</span>}</span>
                  <span className={`tile__art${known && r.artsDone ? ' tile__art--done' : ''}`}>Art {known ? r.artOwned : '?'}/{r.artTarget}{known && r.artsDone && <span title="All arts owned"> ★</span>}</span>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="listview" data-testid="compact-printings">
            <table className="data-table">
              <thead><tr><th></th><th>Card</th><th>Printing</th><th>Rarity</th><th>Artwork</th><th className="num">Owned</th></tr></thead>
              <tbody>{rollups.flatMap(r => r.matching.map(p => ({ r, p }))).slice(0, rowLimit).map(({ r, p }) => {
                const image = getPrintingImageUrl(p.key); const artIndex = artworkGroups(r.printings).findIndex(a => a.id === p.artworkId) + 1
                return (
                  <tr key={p.key} data-testid="compact-printing" data-printing-key={p.key} className={p.playable === false ? 'prow--only' : ''}>
                    <td>{image && <a href={image} target="_blank" rel="noreferrer"><img src={image} alt={p.collectorNumber} width={28} loading="lazy" /></a>}</td>
                    <td className="listview__name">{r.def.name}{r.def.subtitle ? ` — ${r.def.subtitle}` : ''}</td>
                    <td>{p.setName} · <b>{p.collectorNumber}</b>{p.finish && <span className="tag tag--foil">{p.finish}</span>}{p.playable === false && <span className="tag">Collection only</span>}<br /><span className="listview__key">{p.key}</span></td>
                    <td>{p.rarity}</td>
                    <td>{artIndex > 0 ? `Art ${artIndex} · ${known ? (ownedArtworkIds(r.printings, collection.counts).has(p.artworkId!) ? 'owned' : 'missing') : '?'}` : 'unreviewed'}</td>
                    <td className="num"><PrintingCount printingKey={p.key} count={collection.counts[p.key] ?? 0} known={known} /></td>
                  </tr>)
              })}</tbody>
            </table>
            {matchingRows > rowLimit && <button type="button" className="listview__more" onClick={() => setRowLimit(n => n + 60)}>Show 60 more printings</button>}
          </div>
        )}
      </div>
      {open && <CardDrawer def={open.def} printings={open.printings} collection={collection} known={known} useOfficialImages={useOfficialImages} onClose={() => setExpanded(null)} />}
    </div>
  )
}
```

- [ ] **Step 6: Add the CSS** to the end of `src/ui/styles/collection.css`:

```css
/* ---------------------------------------------------------------------- */
/* Browse: layout, toolbar, tiles, list, drawer                            */
/* ---------------------------------------------------------------------- */
.browse { display: grid; grid-template-columns: 236px minmax(0, 1fr); align-items: start; margin: 0 -12px; }
.browse--drawer { grid-template-columns: 236px minmax(0, 1fr) 340px; }
.browse--narrow, .browse--narrow.browse--drawer { grid-template-columns: 1fr; margin: 0; }
.browse__main { display: flex; flex-direction: column; gap: 12px; padding: 14px 16px 24px; min-width: 0; }
.browse--narrow .browse__main { padding: 0; }
.browse__toolbar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; }
.browse--narrow .browse__toolbar { grid-template-columns: 1fr; }
.browse__view { display: flex; align-items: center; gap: 12px; }
.browse__count { font-family: var(--font-mono); font-size: 11px; color: var(--muted); white-space: nowrap; }
.browse__count b { color: var(--text); font-weight: 500; }
.tile { position: relative; display: flex; flex-direction: column; min-width: 0; }
.tile__hit { padding: 0; border: 0; background: transparent; box-shadow: none; clip-path: none; text-align: left; display: block; width: 100%; }
.tile__hit .card-frame--zoom { width: 100%; box-sizing: border-box; }
.tile__hit:hover .card-frame { transform: translateY(-3px); box-shadow: 0 10px 22px rgba(0, 0, 0, .65); }
.tile--open .tile__hit .card-frame { outline: 2px solid var(--act); outline-offset: 2px; }
.tile--only .tile__hit { opacity: .55; }
.tile__ring { display: block; height: 3px; margin-top: 4px; background: var(--panel-2); }
.tile__ring i { display: block; height: 100%; background: var(--you); }
.tile__own { display: flex; justify-content: space-between; align-items: center; gap: 6px; padding: 5px 2px 0; font-family: var(--font-mono); font-size: 11px; font-variant-numeric: tabular-nums; color: var(--text); }
.tile__ps--done { color: var(--ram-green); }
.tile__ps--zero, .tile__ps--only { color: var(--muted); }
.tile__art { color: var(--muted); }
.tile__art--done { color: var(--act); }
.listview { border: 1px solid var(--line); background: var(--panel); overflow-x: auto; }
.listview .data-table td { vertical-align: middle; }
.listview__name { font-family: var(--font-body); font-weight: 600; }
.listview__key { color: var(--muted); font-size: 10px; }
.listview__more { margin: .6em; }
.tag { font-family: var(--font-display); font-weight: 700; font-size: 9px; letter-spacing: .12em; text-transform: uppercase; padding: 1px 6px; margin-left: 6px; border: 1px solid var(--line-bright); color: var(--muted); }
.tag--foil { border-color: var(--act); color: var(--act); }
.drawer { position: sticky; top: 0; align-self: start; max-height: calc(100vh - 75px); display: flex; flex-direction: column; border-left: 1px solid var(--line); background: var(--panel); }
.browse--narrow .drawer { position: static; max-height: none; border-left: 0; border-top: 1px solid var(--line); margin-top: 12px; }
.drawer__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 14px 16px 10px; border-bottom: 1px solid var(--line); }
.drawer__head h3 { margin: 0; font-size: 16px; line-height: 1.05; }
.drawer__sub { display: block; font-size: 11px; letter-spacing: .1em; color: var(--c); }
.drawer__close { border: 0; background: transparent; color: var(--muted); font-family: var(--font-mono); font-weight: 400; font-size: 12px; letter-spacing: 0; text-transform: none; padding: 4px 6px; box-shadow: none; clip-path: none; }
.drawer__close:hover:not(:disabled) { color: var(--text); background: transparent; }
.drawer__body { padding: 14px 16px 20px; display: flex; flex-direction: column; gap: 14px; overflow-y: auto; }
.drawer__goals { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.goal { border: 1px solid var(--line); background: var(--panel-2); padding: 8px 10px; display: grid; gap: 4px; }
.goal__k { font-family: var(--font-display); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
.goal__v { font-family: var(--font-display); font-weight: 700; font-size: 18px; }
.goal__v small { display: block; font-family: var(--font-mono); font-size: 10px; font-weight: 400; color: var(--muted); }
.goal--done .goal__v { color: var(--ram-green); }
.goal--art.goal--done .goal__v { color: var(--act); }
.artgrp { border: 1px solid var(--line); }
.artgrp__head { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: var(--panel-2); font-family: var(--font-display); font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.artgrp__status { font-family: var(--font-mono); letter-spacing: 0; text-transform: none; }
.artgrp__status--owned { color: var(--act); }
.prow { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 8px 10px; border-top: 1px solid var(--line); }
.prow--only { opacity: .6; }
.prow img, .prow__img { display: block; width: 34px; height: 48px; object-fit: cover; background: var(--panel-2); border: 1px solid var(--line-bright); }
.prow__meta { display: grid; gap: 2px; min-width: 0; font-size: 12px; }
.prow__meta b { font-weight: 600; }
.prow__meta span { font-family: var(--font-mono); font-size: 10px; color: var(--muted); overflow-wrap: anywhere; }
.prow__key { color: var(--line-bright); }
```

- [ ] **Step 7: Run tests and typecheck**

Run: `npx vitest run tests/ui/card-drawer.test.tsx tests/ui/collection-browse.test.tsx && npx tsc -b`
Expected: PASS (4 + 7 tests), tsc clean. (`tests/ui/collectionview.test.tsx` still targets the old view and still passes; Task 10 replaces it.)

- [ ] **Step 8: Commit**

```bash
git add src/ui/CardDrawer.tsx src/ui/CollectionBrowse.tsx src/ui/styles/collection.css tests/ui/card-drawer.test.tsx tests/ui/collection-browse.test.tsx
git commit -m "Add Browse mode: tile footers, list view and the card drawer"
```

---

### Task 7: `AddCardsMode` — session strip, whole products, staged table, review & apply

**Files:**
- Create: `src/ui/AddCardsMode.tsx`
- Delete: `src/ui/BulkCollectionEntry.tsx`
- Test: `tests/ui/add-cards-mode.test.tsx`

**Interfaces:**
- Consumes: everything exported from `sessionDraft.ts` (Tasks 1–2); `AddLine` (Task 3); `starterEntry` (sessionCounts); `getCollection`, `useCollection`; `collectionChanges`; `buildDisplayNames`; the two bundled deck JSONs (`data/decks/arasaka-embracing-power.json`, `data/decks/mercs-the-heist.json`).
- Produces: `export function AddCardsMode({ db, printings, known }: { db: CardDb; printings: Printing[]; known: boolean }): ReactElement`. Test ids: `session-kind-<Kind>`, `session-date`, `session-source`, `session-cost`, `session-mode-signed`, `session-mode-exact`, `product-<setCode>`, `add-line-*` (the AddLine instance), `session-lines`, `session-line-<key>`, `session-remove-<key>`, `session-group-<label>`, `session-input` (paste textarea), `session-paste-add`, `session-changes`, `session-rarity`, `session-apply`, `session-clear`, `session-error`.

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/ui/add-cards-mode.test.tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { loadCardDb } from '../../src/engine/cardDb'
import { loadPrintings } from '../../src/ui/printings'
import { _resetCollectionCacheForTests, getCollection, setCount } from '../../src/ui/collection'
import { readCollectionJournal } from '../../src/ui/collectionJournal'
import { _resetDraftForTests, getDraft, stageLine, updateDraft } from '../../src/ui/sessionDraft'
import { AddCardsMode } from '../../src/ui/AddCardsMode'

const db = loadCardDb()
const printings = loadPrintings()
const DEMO = 'arasakademodeck/006'
beforeEach(() => { localStorage.clear(); _resetCollectionCacheForTests(); _resetDraftForTests() })
afterEach(cleanup)
const mount = () => render(<AddCardsMode db={db} printings={printings} known />)

describe('AddCardsMode', () => {
  it('edits the session strip into the draft', () => {
    mount()
    fireEvent.click(screen.getByTestId('session-kind-Trade'))
    fireEvent.change(screen.getByTestId('session-source'), { target: { value: 'Launch boosters' } })
    fireEvent.change(screen.getByTestId('session-cost'), { target: { value: '100 SEK' } })
    expect(getDraft()).toMatchObject({ kind: 'Trade', source: 'Launch boosters', cost: '100 SEK' })
  })

  it('pasting lines stages them, and the live review shows before → after', () => {
    mount()
    fireEvent.change(screen.getByTestId('session-input'), { target: { value: `${DEMO},+3` } })
    fireEvent.click(screen.getByTestId('session-paste-add'))
    expect(screen.getByTestId(`session-line-${DEMO}`).textContent).toContain('+3')
    expect(screen.getByTestId('session-changes').textContent).toContain('0 → 3')
    expect((screen.getByTestId('session-input') as HTMLTextAreaElement).value).toBe('')
  })

  it('a bad paste shows the parser error and stages nothing', () => {
    mount()
    fireEvent.change(screen.getByTestId('session-input'), { target: { value: 'garbage' } })
    fireEvent.click(screen.getByTestId('session-paste-add'))
    expect(screen.getByTestId('session-error').textContent).toMatch(/Line 1/)
    expect(getDraft().lines).toEqual([])
  })

  it('a whole product stages one grouped block and the button reads added', () => {
    mount()
    fireEvent.click(screen.getByTestId('product-arasakademodeck'))
    expect(screen.getByTestId('session-group-Arasaka Demo Deck').textContent).toMatch(/whole product/)
    expect((screen.getByTestId('product-arasakademodeck') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByTestId('session-remove-group-Arasaka Demo Deck'))
    expect(getDraft().lines).toEqual([])
  })

  it('the mode toggle is disabled while lines are staged', () => {
    stageLine({ key: DEMO, delta: 1 })
    mount()
    expect((screen.getByTestId('session-mode-exact') as HTMLButtonElement).disabled).toBe(true)
  })

  it('exact mode labels the column "Set to" and applies as Bulk counts', () => {
    updateDraft({ mode: 'exact' }); stageLine({ key: DEMO, exact: 5 })
    mount()
    expect(screen.getByTestId('session-lines').textContent).toContain('Set to')
    fireEvent.click(screen.getByTestId('session-apply'))
    expect(getCollection().counts[DEMO]).toBe(5)
    expect(readCollectionJournal().entries[0].kind).toBe('Bulk counts')
  })

  it('Apply writes once with metadata, records the pulled-by-rarity rows, and empties the draft', async () => {
    const user = userEvent.setup()
    setCount(DEMO, 1)
    mount()
    await user.type(screen.getByTestId('session-source'), 'Box')
    fireEvent.change(screen.getByTestId('session-input'), { target: { value: `${DEMO},+2` } })
    fireEvent.click(screen.getByTestId('session-paste-add'))
    expect(screen.getByTestId('session-rarity').textContent).toContain(printings.find(p => p.key === DEMO)!.rarity)
    fireEvent.click(screen.getByTestId('session-apply'))
    expect(getCollection().counts[DEMO]).toBe(3)
    expect(getDraft().lines).toEqual([])
    expect(readCollectionJournal().entries[0].source).toBe('Box')
  })

  it('the review follows a write made elsewhere while lines are staged', () => {
    mount()
    fireEvent.change(screen.getByTestId('session-input'), { target: { value: `${DEMO},+2` } })
    fireEvent.click(screen.getByTestId('session-paste-add'))
    setCount(DEMO, 7)   // someone else wrote in between (another tab)
    // The review recomputes from the live collection, so Apply is still
    // correct: 7 + 2. Nothing is refused, but the shown "before" must follow.
    expect(screen.getByTestId('session-changes').textContent).toContain('7 → 9')
  })

  it('Clear needs a second click', () => {
    stageLine({ key: DEMO, delta: 1 })
    mount()
    fireEvent.click(screen.getByTestId('session-clear'))
    expect(getDraft().lines).toHaveLength(1)
    expect(screen.getByTestId('session-clear').textContent).toMatch(/Clear 1 line\?/)
    fireEvent.click(screen.getByTestId('session-clear'))
    expect(getDraft().lines).toEqual([])
  })

  it('shows the staged AddLine instance under its own prefix', () => {
    mount()
    expect(screen.getByTestId('add-line-input')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/ui/add-cards-mode.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

```tsx
// src/ui/AddCardsMode.tsx
//
// Add cards: the session (kind/date/source/cost), whole-product buttons, the
// shared AddLine, the staged table, a collapsed paste box, and a live review
// column that ends in the one Apply button. Replaces the sessions form and the
// bulk-counts panel: "Set exact counts" is now a mode of the same draft.
// Everything here reads and writes sessionDraft.ts; the review is recomputed
// from the live collection on every render, so another tab's write is never
// applied on stale numbers.
import { useMemo, useState, type ReactElement } from 'react'
import type { CardDb } from '../engine/types'
import type { DeckList } from '../engine/deck'
import type { Printing } from './printings'
import { AddLine } from './AddLine'
import { useCollection } from './collection'
import { collectionChanges } from './collectionJournal'
import { starterEntry } from './sessionCounts'
import { buildDisplayNames } from './storage'
import {
  applyDraft, clearDraft, draftCounts, draftSummary, getDraftStorageError, parseDraftLines, rarityBreakdown, removeGroup, removeLine,
  stageLines, updateDraft, useDraft, type SessionKind, type SessionLine, type SessionMode,
} from './sessionDraft'
import arasaka from '../../data/decks/arasaka-embracing-power.json'
import mercs from '../../data/decks/mercs-the-heist.json'

const KINDS: SessionKind[] = ['Acquisition', 'Trade', 'Correction']
/** Fixed-content products the repo holds lists for. Boosters are entered
 *  card by card on purpose — their contents vary. */
const PRODUCTS: { setCode: string; label: string; deck: DeckList }[] = [
  { setCode: 'arasakademodeck', label: 'Arasaka Demo Deck', deck: arasaka as unknown as DeckList },
  { setCode: 'mercdemodeck', label: 'Merc Demo Deck', deck: mercs as unknown as DeckList },
]

export function AddCardsMode({ db, printings, known }: { db: CardDb; printings: Printing[]; known: boolean }): ReactElement {
  const draft = useDraft()
  const collection = useCollection()
  const names = useMemo(() => buildDisplayNames(db), [db])
  const byKey = useMemo(() => new Map(printings.map(p => [p.key, p])), [printings])
  const [paste, setPaste] = useState(draft.legacyText ?? '')
  const [error, setError] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)

  const review = useMemo(() => {
    if (draft.lines.length === 0) return null
    try {
      const before = collection.counts, after = draftCounts(draft, printings, before), changes = collectionChanges(before, after)
      return { before, after, changes, summary: draftSummary(before, after), rarity: draft.mode === 'signed' ? rarityBreakdown(changes, printings) : [] , error: '' }
    } catch (e) { return { before: collection.counts, after: collection.counts, changes: {}, summary: null, rarity: [], error: String(e) } }
  }, [draft, printings, collection])

  const groups = [...new Set(draft.lines.map(l => l.group).filter((g): g is string => g !== undefined))]
  const ungrouped = draft.lines.filter(l => l.group === undefined)
  const setMode = (mode: SessionMode) => { try { updateDraft({ mode }); setError('') } catch (e) { setError(String(e)) } }
  const describe = (l: SessionLine) => { const p = byKey.get(l.key); return p ? { name: names.get(p.cardId) ?? p.cardId, where: `${p.setName} · ${p.collectorNumber}${p.finish ? ` · ${p.finish}` : ''}`, ok: true } : { name: l.key, where: 'unknown printing', ok: false } }
  const amount = (l: SessionLine) => draft.mode === 'signed' ? `${(l.delta ?? 0) > 0 ? '+' : ''}${l.delta ?? 0}` : String(l.exact ?? 0)
  const nowAfter = (l: SessionLine) => review ? `${review.before[l.key] ?? 0} → ${review.after[l.key] ?? 0}` : ''

  return (
    <div className="addcards">
      <section className="card">
        <h3>Session <span className="card__meta">{getDraftStorageError() || 'draft saved in this browser'}</span></h3>
        <div className="card__in">
          <div className="fields">
            <div className="field"><span className="field__label">Kind</span><div className="seg">{KINDS.map(k => <button type="button" key={k} data-testid={`session-kind-${k}`} aria-pressed={draft.kind === k} onClick={() => updateDraft({ kind: k })}>{k}</button>)}</div></div>
            <label className="field"><span className="field__label">Date</span><input type="date" data-testid="session-date" value={draft.date} onChange={e => updateDraft({ date: e.target.value })} /></label>
            <label className="field"><span className="field__label">Source</span><input data-testid="session-source" value={draft.source} placeholder="Where these came from" onChange={e => updateDraft({ source: e.target.value })} /></label>
            <label className="field"><span className="field__label">Total cost</span><input data-testid="session-cost" value={draft.cost} placeholder="e.g. 200 SEK" onChange={e => updateDraft({ cost: e.target.value })} /></label>
          </div>
          <div className="field field--wide"><span className="field__label">Add a whole product</span>
            <div className="tool-actions">
              {PRODUCTS.map(pr => { const added = groups.includes(pr.label); return <button type="button" key={pr.setCode} data-testid={`product-${pr.setCode}`} disabled={!known || added} title="Bundled demo list, not a retail box manifest — check the quantities against what you received" onClick={() => { try { stageLines(parseDraftLines(starterEntry(pr.deck, pr.setCode, printings), 'signed').map(l => ({ ...l, group: pr.label }))); setError('') } catch (e) { setError(String(e)) } }}>{pr.label}{added ? ' ✓ added' : ''}</button> })}
              <span className="tool-note">Fixed-content products only; boosters are entered card by card below.</span>
            </div>
          </div>
          <div className="field field--wide"><span className="field__label">Add cards one by one</span>
            <fieldset disabled={!known} className="collection-editor"><AddLine db={db} printings={printings} testIdPrefix="add-line" /></fieldset>
          </div>
          {draft.lines.length > 0 && (
            <div className="tool-table-wrap"><table className="data-table" data-testid="session-lines">
              <thead><tr><th>Card</th><th>Printing</th><th className="num">{draft.mode === 'signed' ? 'Change' : 'Set to'}</th><th className="num">Now → after</th><th></th></tr></thead>
              <tbody>
                {groups.map(g => { const lines = draft.lines.filter(l => l.group === g); const total = lines.reduce((n, l) => n + (l.delta ?? l.exact ?? 0), 0); return (
                  <tr key={g} className="session-group" data-testid={`session-group-${g}`}><td colSpan={2}>▾ {g} <span className="tool-note">· whole product · {lines.length} printings</span></td><td className="num plus">{draft.mode === 'signed' ? `+${total}` : total}</td><td className="num">{lines.map(nowAfter).filter(Boolean).length ? `${lines.reduce((n, l) => n + (review?.before[l.key] ?? 0), 0)} → ${lines.reduce((n, l) => n + (review?.after[l.key] ?? 0), 0)}` : ''}</td><td><button type="button" className="session-x" data-testid={`session-remove-group-${g}`} aria-label={`Remove ${g}`} onClick={() => removeGroup(g)}>✕</button></td></tr>) })}
                {ungrouped.map(l => { const d = describe(l); return (
                  <tr key={l.key} data-testid={`session-line-${l.key}`} className={d.ok ? '' : 'session-bad'}><td className="session-name">{d.name}</td><td className="tool-note">{d.where}</td><td className={`num ${(l.delta ?? 0) < 0 ? 'minus' : 'plus'}`}>{amount(l)}</td><td className="num">{nowAfter(l)}</td><td><button type="button" className="session-x" data-testid={`session-remove-${l.key}`} aria-label={`Remove ${d.name}`} onClick={() => removeLine(l.key)}>✕</button></td></tr>) })}
              </tbody>
            </table></div>
          )}
          <details className="tool-panel tool-panel--nested" open={!!draft.legacyText}><summary>Paste lines or set exact counts instead</summary>
            <div className="tool-panel__body">
              <div className="field"><span className="field__label">Counting mode</span><div className="seg">
                <button type="button" data-testid="session-mode-signed" aria-pressed={draft.mode === 'signed'} disabled={draft.lines.length > 0 && draft.mode !== 'signed'} title={draft.lines.length > 0 ? 'Apply or clear the draft to change mode' : undefined} onClick={() => setMode('signed')}>Add / remove copies (+3, −1)</button>
                <button type="button" data-testid="session-mode-exact" aria-pressed={draft.mode === 'exact'} disabled={draft.lines.length > 0 && draft.mode !== 'exact'} title={draft.lines.length > 0 ? 'Apply or clear the draft to change mode' : undefined} onClick={() => setMode('exact')}>Set exact counts</button>
              </div></div>
              <p className="tool-note">One <code>printing-key,{draft.mode === 'signed' ? '±count' : 'count'}</code> per line, e.g. <code>arasakademodeck/006,{draft.mode === 'signed' ? '+3' : '3'}</code>. Lines join the table above.</p>
              <label className="field field--wide"><span className="field__label">Lines</span><textarea data-testid="session-input" value={paste} placeholder={`arasakademodeck/006,${draft.mode === 'signed' ? '+3' : '3'}`} onChange={e => setPaste(e.target.value)} /></label>
              <div className="tool-actions"><button type="button" data-testid="session-paste-add" disabled={!paste.trim()} onClick={() => { try { stageLines(parseDraftLines(paste, draft.mode)); setPaste(''); if (draft.legacyText) updateDraft({ legacyText: undefined }); setError('') } catch (e) { setError(String(e)) } }}>Add lines to the session</button></div>
            </div>
          </details>
          {error && <p className="tool-error" role="alert" data-testid="session-error">{error}</p>}
        </div>
      </section>

      <section className="card">
        <h3>Review &amp; apply <span className="card__meta">live</span></h3>
        <div className="card__in">
          {!review && <p className="tool-note">Nothing staged yet. Add a product, type card names, or paste lines.</p>}
          {review?.error && <p className="tool-error" role="alert" data-testid="session-error">{review.error}</p>}
          {review?.summary && (
            <>
              <p className="tool-figure">{review.summary.copies >= 0 ? '+' : ''}{review.summary.copies} copies · {review.summary.printings} printings · {review.summary.before} → {review.summary.after} owned</p>
              <div className="change-list" data-testid="session-changes">{Object.entries(review.changes).map(([key, c]) => <p key={key}><span>{key}</span><span>{c.before} → {c.after}</span></p>)}</div>
              {review.rarity.length > 0 && (
                <div className="field field--wide"><span className="field__label">Pulled by rarity</span>
                  <table className="data-table" data-testid="session-rarity"><tbody>{review.rarity.map(r => <tr key={r.rarity}><td>{r.rarity}</td><td className="num">{r.copies}</td><td><meter min={0} max={Math.max(1, review.rarity[0].copies)} value={r.copies} /></td></tr>)}</tbody></table>
                </div>
              )}
              <p className="tool-note">Applying writes the collection file once and records this session in History as one entry — undoable as one step, with the cost and source kept on it.</p>
            </>
          )}
          <div className="tool-actions">
            <button type="button" className="btn--primary" data-testid="session-apply" disabled={!known || !review || !!review.error} onClick={() => { try { applyDraft(printings); setConfirmClear(false); setError('') } catch (e) { setError(String(e)) } }}>Apply session{review?.summary ? ` · ${review.summary.copies >= 0 ? '+' : ''}${review.summary.copies}` : ''}</button>
            <button type="button" className={confirmClear ? 'btn--danger' : ''} data-testid="session-clear" disabled={draft.lines.length === 0} onClick={() => { if (confirmClear) { clearDraft(); setConfirmClear(false) } else setConfirmClear(true) }}>{confirmClear ? `Clear ${draft.lines.length} line${draft.lines.length === 1 ? '' : 's'}?` : 'Clear draft'}</button>
          </div>
        </div>
      </section>
    </div>
  )
}
```

The review reads `collection.counts` from the `useCollection` hook, so it re-renders on other tabs' writes.

- [ ] **Step 4: Add the CSS** to the end of `src/ui/styles/collection.css`:

```css
/* ---------------------------------------------------------------------- */
/* Mode pages: two-column cards (Add cards, Plan purchases, History)       */
/* ---------------------------------------------------------------------- */
.addcards, .plan, .history { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(320px, 1fr); gap: 16px; align-items: start; }
.card { background: var(--panel); border: 1px solid var(--line); }
.card > h3 { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 0; font-size: 13px; letter-spacing: .1em; padding: 10px 14px; border-bottom: 1px solid var(--line); }
.card__meta { font-family: var(--font-mono); font-weight: 400; letter-spacing: 0; text-transform: none; font-size: 11px; color: var(--muted); }
.card__in { padding: 14px; display: flex; flex-direction: column; gap: 12px; align-items: flex-start; }
.card__in > .field--wide, .card__in > .tool-table-wrap, .card__in > .tool-panel, .card__in > .change-list, .card__in > .fields { align-self: stretch; }
.fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.fields .field input { width: 100%; min-width: 0; }
.plus { color: var(--ram-green); }
.minus { color: var(--rival); }
.session-name { font-family: var(--font-body); font-weight: 600; }
.session-group td { background: var(--panel-2); }
.session-bad td { color: var(--rival); }
.session-x { border: 0; background: transparent; color: var(--muted); font-family: var(--font-mono); padding: 0 6px; box-shadow: none; clip-path: none; }
.session-x:hover:not(:disabled) { color: var(--rival); background: transparent; }
@media (max-width: 860px) { .addcards, .plan, .history { grid-template-columns: 1fr; } }
```

- [ ] **Step 5: Delete the bulk panel and run**

```bash
git rm -q src/ui/BulkCollectionEntry.tsx
```
Remove its import and `<BulkCollectionEntry … />` usage from `src/ui/CollectionView.tsx` (the shell is rewritten in Task 10; for now just delete the two lines).

Run: `npx vitest run tests/ui/add-cards-mode.test.tsx && npx tsc -b`
Expected: PASS (10 tests), tsc clean. `tests/ui/collection-entry.test.ts` (pure `parseBulkCounts`) still passes.

- [ ] **Step 6: Commit**

```bash
git add -A src/ui tests/ui
git commit -m "Add the Add cards mode: session strip, whole products, staged table, live review"
```

---

### Task 8: `PlanPurchasesMode` — deck chips, options, plan table, lists

**Files:**
- Create: `src/ui/PlanPurchasesMode.tsx`
- Delete: `src/ui/AcquisitionPlanner.tsx`
- Test: `tests/ui/plan-purchases-mode.test.tsx`

**Interfaces:**
- Consumes: `acquisitionPlan`, `AcquisitionNeed`; `validateDeck`, `deckSize` (engine/deck); `useDecks`, `buildDisplayNames`; `buildBuyList`, `playsetGaps`, `useCollection`; `missingArtworks`.
- Produces: `export function PlanPurchasesMode({ db, printings, known }: { db: CardDb; printings: Printing[]; known: boolean }): ReactElement`. Test ids kept: `acquisition-planner` (root), `acquisition-row`, `acquisition-total`, `acquisition-list`, `reserve-artwork` (checkbox), `copy-buylist`, `copy-playset-list`, `copy-artwork-list`, `copy-error`. New: `acquisition-deck-<name>` (checkbox inside a chip label whose text is the deck name — e2e uses `getByLabel('Plan A', { exact: true })`), `acquisition-mode-shared`, `acquisition-mode-assembled`, `acquisition-copy`.

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/ui/plan-purchases-mode.test.tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { loadCardDb } from '../../src/engine/cardDb'
import { loadPrintings } from '../../src/ui/printings'
import { _resetCollectionCacheForTests, setCount } from '../../src/ui/collection'
import { saveDeck } from '../../src/ui/storage'
import { PlanPurchasesMode } from '../../src/ui/PlanPurchasesMode'

const db = loadCardDb()
const printings = loadPrintings()
const legends: [string, string, string] = ['goro-takemura-hands-unclean', 'yorinobu-arasaka-embracing-destruction', 'saburo-arasaka-stubborn-patriarch']
beforeEach(() => {
  localStorage.clear(); _resetCollectionCacheForTests()
  saveDeck({ name: 'Plan A', demo: true, legends, cards: { 'industrial-assembly': 3 } })
  saveDeck({ name: 'Plan B', demo: true, legends, cards: { 'industrial-assembly': 2 } })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
const mount = () => render(<PlanPurchasesMode db={db} printings={printings} known />)

describe('PlanPurchasesMode', () => {
  it('lists decks as checkbox chips and computes shared vs kept requirements', () => {
    setCount('arasakademodeck/006', 2)
    mount()
    fireEvent.click(screen.getByLabelText('Plan A', { exact: true }))
    fireEvent.click(screen.getByLabelText('Plan B', { exact: true }))
    const buy = () => screen.getAllByTestId('acquisition-row').find(r => r.getAttribute('data-card-id') === 'industrial-assembly')!.querySelectorAll('td')[4].textContent
    expect(buy()).toBe('1')
    fireEvent.click(screen.getByTestId('acquisition-mode-assembled'))
    expect(buy()).toBe('3')
    fireEvent.click(screen.getByTestId('reserve-artwork'))
    expect(buy()).toBe('4')
    expect(screen.getByTestId('acquisition-total').textContent).toMatch(/4 copies/)
    expect((screen.getByTestId('acquisition-list') as HTMLTextAreaElement).value).toMatch(/4x Industrial Assembly/)
  })
  it('flags an invalid deck on its chip', () => {
    saveDeck({ name: 'Broken', legends: ['', '', ''], cards: {} })
    mount()
    expect(screen.getByTestId('acquisition-deck-Broken').closest('label')!.textContent).toMatch(/errors?/)
  })
  it('copies the shopping list and the three goal lists', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    mount()
    fireEvent.click(screen.getByTestId('copy-buylist'))
    fireEvent.click(screen.getByTestId('copy-playset-list'))
    fireEvent.click(screen.getByTestId('copy-artwork-list'))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(3))
    expect(writeText.mock.calls[0][0]).toContain('## Missing for playset')
  })
  it('surfaces a rejected clipboard write', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true })
    mount()
    fireEvent.click(screen.getByTestId('copy-buylist'))
    await waitFor(() => expect(screen.getByTestId('copy-error').textContent).toContain('Could not copy'))
  })
  it('says why nothing is computed when ownership is unknown', () => {
    render(<PlanPurchasesMode db={db} printings={printings} known={false} />)
    expect(screen.getByTestId('acquisition-planner').textContent).toMatch(/Ownership unavailable/)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/ui/plan-purchases-mode.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

```tsx
// src/ui/PlanPurchasesMode.tsx
//
// Plan purchases: pick the decks you want to own physically, choose whether
// cards are shared between them or kept in every deck, optionally reserve
// one copy of each artwork for the binder, and get a table plus a shopping
// list. The three collection-goal lists (playset / artwork / both) live here
// too — they are purchase lists, not header decoration. The arithmetic is
// acquisitionPlan.ts and buildBuyList, unchanged.
import { useMemo, useState, type ReactElement } from 'react'
import type { CardDb } from '../engine/types'
import { deckSize, validateDeck } from '../engine/deck'
import type { Printing } from './printings'
import { acquisitionPlan } from './acquisitionPlan'
import { buildBuyList, playsetGaps, useCollection } from './collection'
import { missingArtworks } from './artworks'
import { buildDisplayNames, useDecks } from './storage'

export function PlanPurchasesMode({ db, printings, known }: { db: CardDb; printings: Printing[]; known: boolean }): ReactElement {
  const decks = useDecks()
  const collection = useCollection()
  const names = useMemo(() => buildDisplayNames(db), [db])
  const [selected, setSelected] = useState<string[]>([])
  const [mode, setMode] = useState<'shared' | 'assembled'>('shared')
  const [reserve, setReserve] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const chosen = decks.filter(d => selected.includes(d.name))
  const rows = useMemo(() => acquisitionPlan(db, chosen, printings, collection.counts, mode, reserve), [db, chosen, printings, collection, mode, reserve])
  const missing = rows.filter(r => r.missing > 0)
  const text = missing.map(r => `${r.missing}x ${names.get(r.id) ?? r.id}${!reserve && r.missingArts.length ? ' — a missing artwork would also count' : ''}`).join('\n')
  const gaps = useMemo(() => playsetGaps(db, printings, collection).reduce((n, g) => n + g.missing, 0), [db, printings, collection])
  const arts = useMemo(() => missingArtworks(printings, collection.counts).length, [printings, collection])
  const copy = (what: string, value: string) => navigator.clipboard.writeText(value).then(() => setStatus({ kind: 'ok', text: `Copied ${what} ${new Date().toLocaleTimeString()}` })).catch(err => setStatus({ kind: 'error', text: `Could not copy to clipboard: ${err instanceof Error ? err.message : String(err)}` }))

  return (
    <div className="plan" data-testid="acquisition-planner">
      <section className="card">
        <h3>Decks to build <span className="card__meta">pick the decks you want to own physically</span></h3>
        <div className="card__in">
          <div className="tool-actions">
            {decks.length === 0 && <span className="tool-note">No saved decks yet.</span>}
            {decks.map(d => { const errors = validateDeck(db, d).length; return (
              <label key={d.name} className={`check-chip deckchip${selected.includes(d.name) ? ' deckchip--on' : ''}`}>
                <input type="checkbox" data-testid={`acquisition-deck-${d.name}`} checked={selected.includes(d.name)} onChange={e => setSelected(old => e.target.checked ? [...old, d.name] : old.filter(n => n !== d.name))} />
                {d.name}<span className={`deckchip__st${errors ? ' deckchip__st--bad' : ''}`}>{errors ? `${errors} error${errors === 1 ? '' : 's'}` : `${deckSize(d)} cards`}</span>
              </label>) })}
          </div>
          <div className="tool-actions">
            <div className="field"><span className="field__label">Cards are</span><div className="seg">
              <button type="button" data-testid="acquisition-mode-shared" aria-pressed={mode === 'shared'} onClick={() => setMode('shared')}>Shared between decks</button>
              <button type="button" data-testid="acquisition-mode-assembled" aria-pressed={mode === 'assembled'} onClick={() => setMode('assembled')}>Kept in every deck</button>
            </div></div>
            <label className="check-chip"><input type="checkbox" data-testid="reserve-artwork" checked={reserve} onChange={e => setReserve(e.target.checked)} />Keep one of each artwork in the binder</label>
          </div>
          <p className="tool-note">Shared: buy the maximum any one deck needs. Kept: add every deck's requirement. Binder copies are taken out of what decks can use{reserve ? '; a newly bought missing artwork kept in the binder needs an extra playable copy to fill a deck gap' : ''}. Playset progress still counts all owned copies.</p>
          {chosen.filter(d => validateDeck(db, d).length > 0).map(d => <p key={d.name} className="tool-error">{d.name} has deck validation errors; this list does not make it legal.</p>)}
          {!known ? <p className="tool-note">Ownership unavailable — load the collection before calculating purchases.</p> : chosen.length === 0 ? <p className="tool-note">Select decks to calculate requirements.</p> : (
            <>
              <p className="tool-figure" data-testid="acquisition-total">{missing.reduce((n, r) => n + r.missing, 0)} copies to buy · {missing.length} distinct cards</p>
              <div className="tool-table-wrap"><table className="data-table">
                <thead><tr><th>Card</th><th className="num">Need</th><th className="num">Own</th><th className="num">Binder</th><th className="num">Buy</th><th>Also fills</th></tr></thead>
                <tbody>{rows.map(r => <tr key={r.identity} data-testid="acquisition-row" data-card-id={r.id}><td className="session-name">{names.get(r.id) ?? r.id}</td><td className="num">{r.required}</td><td className="num">{r.owned}</td><td className="num">{r.reserved}</td><td className={`num${r.missing ? ' plan__buy' : ''}`}>{r.missing}</td><td className="tool-note">{[r.playsetMissing ? `playset gap ${r.playsetMissing}` : '', ...r.missingArts.map((a, i) => `artwork ${i + 1} (${a.choices.join(' or ')})`)].filter(Boolean).join(' · ') || '—'}</td></tr>)}</tbody>
              </table></div>
            </>
          )}
        </div>
      </section>
      <div className="plan__side">
        <section className="card">
          <h3>Shopping list</h3>
          <div className="card__in">
            <textarea className="plan__shop" readOnly data-testid="acquisition-list" value={text} placeholder="Select decks above." />
            <div className="tool-actions"><button type="button" className="btn--primary" data-testid="acquisition-copy" disabled={!text} onClick={() => copy('the shopping list', text)}>Copy list</button></div>
          </div>
        </section>
        <section className="card">
          <h3>Collection goals <span className="card__meta">independent of decks</span></h3>
          <div className="card__in">
            <div className="plan__lists">
              <div className="lst"><span className="goal__k">Playset gaps</span><span className="goal__v">{known ? gaps : '?'}<small>copies</small></span><button type="button" data-testid="copy-playset-list" disabled={!known} onClick={() => copy('the playset list', buildBuyList(db, printings, collection, { playset: true, arts: false }))}>Copy list</button></div>
              <div className="lst"><span className="goal__k">Missing artworks</span><span className="goal__v">{known ? arts : '?'}<small>arts</small></span><button type="button" data-testid="copy-artwork-list" disabled={!known} onClick={() => copy('the artwork list', buildBuyList(db, printings, collection, { playset: false, arts: true }))}>Copy list</button></div>
              <div className="lst"><span className="goal__k">Both goals</span><span className="goal__v">1<small>combined list</small></span><button type="button" data-testid="copy-buylist" disabled={!known} onClick={() => copy('both lists', buildBuyList(db, printings, collection, { playset: true, arts: true }))}>Copy list</button></div>
            </div>
            <p className="tool-note">One purchase can close a playset gap and a missing artwork at once; the combined list says which.</p>
            {status && <p className={status.kind === 'error' ? 'tool-error' : 'tool-status'} role="status" data-testid={status.kind === 'error' ? 'copy-error' : 'copy-status'}>{status.text}</p>}
          </div>
        </section>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add the CSS** to the end of `src/ui/styles/collection.css`:

```css
/* ---------------------------------------------------------------------- */
/* Plan purchases                                                          */
/* ---------------------------------------------------------------------- */
.plan__side { display: grid; gap: 16px; }
.deckchip { padding: 6px 10px; font-family: var(--font-body); font-size: 12px; color: var(--text); }
.deckchip--on { border-color: var(--you); background: rgba(0, 229, 255, .08); }
.deckchip__st { font-family: var(--font-mono); font-size: 10px; color: var(--muted); }
.deckchip__st--bad { color: var(--rival); }
.plan__buy { color: var(--act); font-weight: 500; }
.plan__shop { width: 100%; min-height: 9em; resize: vertical; }
.plan__lists { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; width: 100%; }
.lst { border: 1px solid var(--line); background: var(--panel-2); padding: 10px; display: grid; gap: 6px; align-content: start; }
.lst .goal__v small { display: inline; margin-left: .4em; }
.lst button { font-size: 10px; padding: 5px 10px; justify-self: start; }
@media (max-width: 860px) { .plan__lists { grid-template-columns: 1fr; } }
```

- [ ] **Step 5: Delete the old planner and run**

```bash
git rm -q src/ui/AcquisitionPlanner.tsx
```
Remove its import and usage from `src/ui/CollectionView.tsx`.

Run: `npx vitest run tests/ui/plan-purchases-mode.test.tsx tests/ui/acquisition-plan.test.ts && npx tsc -b`
Expected: PASS (5 + existing), tsc clean.

- [ ] **Step 6: Commit**

```bash
git add -A src/ui tests/ui
git commit -m "Add the Plan purchases mode with deck chips, a buy table and goal lists"
```

---

### Task 9: `HistoryBackupMode` — timeline, export, import, restore history, on disk

**Files:**
- Create: `src/ui/HistoryBackupMode.tsx`
- Delete: `src/ui/CollectionSessions.tsx`, `src/ui/CollectionHeader.tsx`, `tests/ui/collectionheader.test.tsx`
- Test: `tests/ui/history-backup-mode.test.tsx`

**Interfaces:**
- Consumes: `readCollectionJournal`, `restoreJournalChange`, `importCollectionJournal`, `CollectionChange`; `getCollection`, `replaceCollection`, `useCollection`, `exportCollectionJson`, `exportCollectionText`, `previewCollectionImport`; `collectionChanges`; `useSyncStatus`, `retryCollection`; `rarityBreakdown` (Task 2); `downloadFile` (Task 4).
- Produces: `export function HistoryBackupMode({ db, printings, known }: { db: CardDb; printings: Printing[]; known: boolean }): ReactElement`. Test ids kept: `collection-history`, `collection-history-entry`, `history-undo`, `history-reapply`, `import-panel`, `import-input`, `import-mode-replace`, `import-mode-merge`, `import-submit`, `import-preview`, `import-apply`, `import-error`, `export-json`, `export-text`. New: `history-details`, `history-export`, `history-import-input`, `history-import`, `export-history`, `history-show-all`.

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/ui/history-backup-mode.test.tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { loadCardDb } from '../../src/engine/cardDb'
import { loadPrintings } from '../../src/ui/printings'
import { _resetCollectionCacheForTests, getCollection, replaceCollection, setCount } from '../../src/ui/collection'
import { readCollectionJournal } from '../../src/ui/collectionJournal'
import { HistoryBackupMode } from '../../src/ui/HistoryBackupMode'

const db = loadCardDb()
const printings = loadPrintings()
const KEY = 'arasakademodeck/006'
beforeEach(() => { localStorage.clear(); _resetCollectionCacheForTests() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })
const mount = () => render(<HistoryBackupMode db={db} printings={printings} known />)

describe('timeline', () => {
  it('lists entries newest first with kind, source and cost, and undoes one as a whole', () => {
    replaceCollection({ counts: { [KEY]: 3 } }, { kind: 'Acquisition', source: 'Launch boosters', cost: '100 SEK', date: '2026-09-09' })
    mount()
    const entry = screen.getAllByTestId('collection-history-entry')[0]
    expect(entry.textContent).toContain('Acquisition'); expect(entry.textContent).toContain('Launch boosters')
    fireEvent.click(within(entry).getByTestId('history-details'))
    expect(entry.textContent).toContain('100 SEK'); expect(entry.textContent).toContain('0 → 3')
    expect(within(entry).getByTestId('history-rarity').textContent).toContain(printings.find(p => p.key === KEY)!.rarity)
    fireEvent.click(within(entry).getByTestId('history-undo'))
    expect(getCollection().counts[KEY]).toBeUndefined()
  })
  it('an undone entry is struck through and offers Reapply', () => {
    replaceCollection({ counts: { [KEY]: 3 } }, { kind: 'Acquisition' })
    mount()
    fireEvent.click(within(screen.getAllByTestId('collection-history-entry')[0]).getByTestId('history-undo'))
    cleanup(); mount()
    const original = screen.getAllByTestId('collection-history-entry').find(e => e.textContent!.includes('Acquisition'))!
    expect(original.className).toContain('ev--undone')
    fireEvent.click(within(original).getByTestId('history-reapply'))
    expect(getCollection().counts[KEY]).toBe(3)
  })
  it('shows a refusal when the rows moved since the entry', () => {
    replaceCollection({ counts: { [KEY]: 3 } }, { kind: 'Acquisition' })
    setCount(KEY, 9)
    mount()
    const entry = screen.getAllByTestId('collection-history-entry').find(e => e.textContent!.includes('Acquisition'))!
    fireEvent.click(within(entry).getByTestId('history-undo'))
    expect(screen.getByTestId('history-error').textContent).toMatch(/changed since/)
    expect(getCollection().counts[KEY]).toBe(9)
  })
})

describe('backup', () => {
  it('imports pasted JSON with merge mode after a preview', () => {
    setCount(printings[0].key, 1)
    mount()
    fireEvent.click(screen.getByTestId('import-mode-merge'))
    fireEvent.change(screen.getByTestId('import-input'), { target: { value: JSON.stringify({ version: 1, counts: { [printings[0].key]: 2 } }) } })
    fireEvent.click(screen.getByTestId('import-submit'))
    expect(getCollection().counts[printings[0].key]).toBe(1)
    expect(screen.getByTestId('import-preview').textContent).toContain('1 → 3')
    fireEvent.click(screen.getByTestId('import-apply'))
    expect(getCollection().counts[printings[0].key]).toBe(3)
  })
  it('shows the error and keeps data on a bad import', () => {
    setCount(printings[0].key, 1)
    mount()
    fireEvent.change(screen.getByTestId('import-input'), { target: { value: 'garbage' } })
    fireEvent.click(screen.getByTestId('import-submit'))
    expect(screen.getByTestId('import-error').textContent).toContain('Could not import')
    expect(getCollection().counts[printings[0].key]).toBe(1)
  })
  it('disables Preview while the textarea is blank', () => {
    mount()
    expect((screen.getByTestId('import-submit') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByTestId('import-input'), { target: { value: `1x whatever [${printings[0].key}]` } })
    expect((screen.getByTestId('import-submit') as HTMLButtonElement).disabled).toBe(false)
  })
  it('exports JSON, text and JSON + history through Blob downloads', () => {
    setCount(printings[0].key, 3)
    const blobSpy = vi.spyOn(globalThis, 'Blob')
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    mount()
    fireEvent.click(screen.getByTestId('export-json')); fireEvent.click(screen.getByTestId('export-text')); fireEvent.click(screen.getByTestId('export-history'))
    expect(blobSpy).toHaveBeenCalledTimes(3)
    expect(String((blobSpy.mock.calls[2] as [BlobPart[]])[0][0])).toContain('"entries"')
  })
  it('restores history metadata without touching counts', () => {
    setCount(printings[0].key, 2)
    mount()
    fireEvent.change(screen.getByTestId('history-import-input'), { target: { value: JSON.stringify({ version: 1, entries: [{ id: 'x1', createdAt: '2026-09-01T00:00:00.000Z', kind: 'Trade', changes: { [printings[0].key]: { before: 0, after: 2 } } }] }) } })
    fireEvent.click(screen.getByTestId('history-import'))
    expect(readCollectionJournal().entries.some(e => e.id === 'x1')).toBe(true)
    expect(getCollection().counts[printings[0].key]).toBe(2)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/ui/history-backup-mode.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

```tsx
// src/ui/HistoryBackupMode.tsx
//
// History & backup: the change journal as a timeline (one row per entry,
// undo/reapply as a whole, details on demand with the same pulled-by-rarity
// table the review column shows), and the backup cards — export, import with
// preview, history-metadata restore, and the on-disk state in long form.
// Import/export moved here from CollectionHeader unchanged in behaviour; the
// all-or-nothing guarantees live in collection.ts.
import { useState, type ReactElement } from 'react'
import type { CardDb } from '../engine/types'
import type { Printing } from './printings'
import { exportCollectionJson, exportCollectionText, getCollection, previewCollectionImport, replaceCollection, useCollection } from './collection'
import { collectionChanges, importCollectionJournal, readCollectionJournal, restoreJournalChange, type CollectionChange } from './collectionJournal'
import { retryCollection, useSyncStatus } from './collectionSync'
import { rarityBreakdown } from './sessionDraft'
import { downloadFile } from './CollectionModeHeader'

const PAGE = 20
function kindClass(kind: string): string {
  const k = kind.toLowerCase()
  return k.startsWith('acqui') ? 'kind--acq' : k === 'trade' ? 'kind--trade' : k === 'undo' ? 'kind--undo' : 'kind--grey'
}
function when(iso: string): string {
  const d = new Date(iso), today = new Date().toDateString() === d.toDateString()
  return today ? `Today ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function copies(entry: CollectionChange): number { return Object.values(entry.changes).reduce((n, c) => n + c.after - c.before, 0) }

export function HistoryBackupMode({ db, printings, known }: { db: CardDb; printings: Printing[]; known: boolean }): ReactElement {
  const collection = useCollection()
  const syncStatus = useSyncStatus()
  const [revision, setRevision] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [error, setError] = useState('')
  const [importText, setImportText] = useState('')
  const [mode, setMode] = useState<'replace' | 'merge'>('replace')
  const [preview, setPreview] = useState<ReturnType<typeof previewCollectionImport> | null>(null)
  const [importError, setImportError] = useState('')
  const [historyText, setHistoryText] = useState('')
  const journal = readCollectionJournal()
  void revision
  // An entry is "undone" when a later Undo entry points at it and no later
  // Reapply does. Derived, not stored: the journal format does not change.
  const undone = new Set<string>()
  for (const e of [...journal.entries].reverse()) { if (e.relatedId) { if (e.kind === 'Undo') undone.add(e.relatedId); else if (e.kind === 'Reapply') undone.delete(e.relatedId) } }
  const restore = (entry: CollectionChange, direction: 'undo' | 'reapply') => {
    try { replaceCollection({ counts: restoreJournalChange(getCollection().counts, entry, direction) }, { kind: direction === 'undo' ? 'Undo' : 'Reapply', relatedId: entry.id, source: entry.source }); setError(''); setRevision(r => r + 1) }
    catch (e) { setError(String(e)) }
  }
  const visible = showAll ? journal.entries : journal.entries.slice(0, PAGE)

  return (
    <div className="history">
      <section className="card">
        <h3>Change history <span className="card__meta">{journal.entries.length} entries · newest first</span></h3>
        <div className="card__in">
          {journal.warning && <p className="tool-error" role="alert">{journal.warning}</p>}
          {error && <p className="tool-error" role="alert" data-testid="history-error">{error}</p>}
          {journal.entries.length === 0 && <p className="tool-note">No recorded changes yet.</p>}
          <div className="tl" data-testid="collection-history">
            {visible.map(entry => { const isUndone = undone.has(entry.id), n = copies(entry), isOpen = open === entry.id; return (
              <div key={entry.id} className={`ev${isUndone ? ' ev--undone' : ''}`} data-testid="collection-history-entry">
                <span className="ev__when">{when(entry.createdAt)}</span>
                <div className="ev__what">
                  <span className="ev__t"><span className={`kind ${kindClass(entry.kind)}`}>{entry.kind}</span>{entry.source || (entry.kind === 'Undo' || entry.kind === 'Reapply' ? 'of an earlier entry' : '—')}</span>
                  <span className="ev__d">{Object.keys(entry.changes).length} printings · {n >= 0 ? '+' : ''}{n} copies{entry.cost ? ` · ${entry.cost}` : ''}{entry.date ? ` · ${entry.date}` : ''}</span>
                  {isOpen && (
                    <div className="ev__details">
                      <div className="change-list">{Object.entries(entry.changes).map(([key, c]) => <p key={key}><span>{key}</span><span>{c.before} → {c.after}</span></p>)}</div>
                      {rarityBreakdown(entry.changes, printings).length > 0 && <table className="data-table" data-testid="history-rarity"><tbody>{rarityBreakdown(entry.changes, printings).map(r => <tr key={r.rarity}><td>{r.rarity}</td><td className="num">{r.copies}</td></tr>)}</tbody></table>}
                    </div>
                  )}
                </div>
                <div className="ev__ops">
                  <button type="button" className="btn--ghost ev__quiet" data-testid="history-details" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : entry.id)}>Details</button>
                  {entry.kind !== 'Undo' && entry.kind !== 'Reapply' && (isUndone
                    ? <button type="button" data-testid="history-reapply" disabled={!known} onClick={() => restore(entry, 'reapply')}>Reapply</button>
                    : <button type="button" data-testid="history-undo" disabled={!known} onClick={() => restore(entry, 'undo')}>Undo</button>)}
                </div>
              </div>) })}
          </div>
          {journal.entries.length > PAGE && !showAll && <div className="tool-actions"><button type="button" data-testid="history-show-all" onClick={() => setShowAll(true)}>Show all {journal.entries.length}</button></div>}
        </div>
      </section>

      <section className="card">
        <h3>Backup</h3>
        <div className="card__in">
          <div className="bk">
            <div className="bk__b"><span className="bk__k">Export</span><p className="tool-note">Download what you own as JSON (exact, re-importable) or as a readable text list.</p>
              <div className="tool-actions">
                <button type="button" data-testid="export-json" onClick={() => downloadFile('collection.json', exportCollectionJson(collection))}>JSON</button>
                <button type="button" data-testid="export-text" onClick={() => downloadFile('collection.txt', exportCollectionText(db, printings, collection))}>Text</button>
                <button type="button" data-testid="export-history" onClick={() => downloadFile('collection-history.json', JSON.stringify({ version: 1, counts: collection.counts, entries: journal.entries }, null, 2), 'application/json')}>JSON + history</button>
              </div>
            </div>
            <div className="bk__b" data-testid="import-panel"><span className="bk__k">Import</span><p className="tool-note">Paste an export. Nothing changes until you apply the preview.</p>
              <textarea data-testid="import-input" value={importText} placeholder="Paste a collection JSON or text export…" onChange={e => { setImportText(e.target.value); setPreview(null) }} />
              <div className="tool-actions">
                <div className="seg"><button type="button" data-testid="import-mode-replace" aria-pressed={mode === 'replace'} onClick={() => { setMode('replace'); setPreview(null) }}>Replace</button><button type="button" data-testid="import-mode-merge" aria-pressed={mode === 'merge'} onClick={() => { setMode('merge'); setPreview(null) }}>Merge</button></div>
                <button type="button" data-testid="import-submit" disabled={!known || importText.trim() === ''} onClick={() => { try { setPreview(previewCollectionImport(importText, mode)); setImportError('') } catch (e) { setImportError(e instanceof Error ? e.message : String(e)) } }}>Preview</button>
              </div>
              {preview && <div className="tool-preview" data-testid="import-preview">
                <p className="tool-figure">{mode} import: {Object.keys(collectionChanges(preview.before, preview.after)).length} changed printing rows</p>
                <div className="change-list">{Object.entries(collectionChanges(preview.before, preview.after)).map(([key, c]) => <p key={key}><span>{key}</span><span>{c.before} → {c.after}</span></p>)}</div>
                <div className="tool-actions"><button type="button" className="btn--primary" data-testid="import-apply" disabled={!known} onClick={() => { try { if (JSON.stringify(getCollection().counts) !== JSON.stringify(preview.before)) throw new Error('Collection changed; preview again.'); replaceCollection({ counts: preview.after }, { kind: mode + ' import' }); setPreview(null); setImportText(''); setImportError('') } catch (e) { setImportError(String(e)) } }}>Apply import</button></div>
              </div>}
              {importError && <p className="tool-error" role="alert" data-testid="import-error">{importError}</p>}
            </div>
            <div className="bk__b"><span className="bk__k">Restore history</span><p className="tool-note">Restores session notes and costs only; counts come from the collection import above.</p>
              <textarea data-testid="history-import-input" value={historyText} placeholder="Paste a JSON + history export…" onChange={e => setHistoryText(e.target.value)} />
              <div className="tool-actions"><button type="button" data-testid="history-import" disabled={!historyText.trim()} onClick={() => { try { importCollectionJournal(historyText); setHistoryText(''); setError(''); setRevision(r => r + 1) } catch (e) { setError(String(e)) } }}>Import history entries</button></div>
            </div>
            <div className="bk__b"><span className="bk__k">On disk</span>
              <p className="tool-note">data/collection.json{syncStatus.lastSavedAt ? ` · last write ${new Date(syncStatus.lastSavedAt).toLocaleTimeString()}` : ''}{syncStatus.git ? ` · git backup ${syncStatus.git}` : ''}{syncStatus.gitDetail ? ` · ${syncStatus.gitDetail}` : ''}</p>
              {(syncStatus.state === 'unsaved' || syncStatus.state === 'error' || syncStatus.git === 'failed') && <div className="tool-actions"><button type="button" onClick={() => void retryCollection()}>Retry now</button></div>}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
```

The import error message must contain "Could not import" for the kept test: `previewCollectionImport` already throws that wording (it is what `CollectionHeader` displayed); if your run shows a different message, wrap it: `setImportError(\`Could not import: ${message}\`)` only when the message does not already start with "Could not import".

- [ ] **Step 4: Add the CSS** to the end of `src/ui/styles/collection.css`:

```css
/* ---------------------------------------------------------------------- */
/* History & backup                                                        */
/* ---------------------------------------------------------------------- */
.tl { display: flex; flex-direction: column; width: 100%; }
.ev { display: grid; grid-template-columns: 96px 1fr auto; gap: 12px; align-items: start; padding: 10px 0; border-bottom: 1px solid var(--line); }
.ev__when { font-family: var(--font-mono); font-size: 11px; color: var(--muted); padding-top: 3px; }
.ev__what { display: grid; gap: 4px; min-width: 0; }
.ev__t { display: flex; gap: 8px; align-items: center; font-weight: 600; font-size: 13px; }
.ev__d { font-family: var(--font-mono); font-size: 11px; color: var(--muted); }
.ev__details { display: grid; gap: 8px; margin-top: 6px; }
.ev--undone .ev__t { text-decoration: line-through; color: var(--muted); }
.ev__ops { display: flex; gap: 6px; }
.ev__ops button { font-size: 10px; padding: 5px 10px; }
.ev__quiet { color: var(--muted); box-shadow: inset 0 0 0 1.5px var(--line-bright); }
.kind { font-family: var(--font-display); font-weight: 700; font-size: 9px; letter-spacing: .12em; text-transform: uppercase; padding: 1px 7px; clip-path: polygon(5px 0, 100% 0, calc(100% - 5px) 100%, 0 100%); }
.kind--acq { background: var(--ram-green); color: #06140b; }
.kind--trade { background: var(--ram-blue); color: #061019; }
.kind--grey { background: var(--line-bright); color: var(--text); }
.kind--undo { background: var(--rival); color: #1a0509; }
.bk { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; width: 100%; }
.bk__b { border: 1px solid var(--line); background: var(--panel-2); padding: 12px; display: grid; gap: 8px; align-content: start; }
.bk__b textarea { width: 100%; min-height: 70px; resize: vertical; }
.bk__k { font-family: var(--font-display); font-size: 11px; letter-spacing: .12em; text-transform: uppercase; }
.bk__b .tool-actions button { font-size: 10px; padding: 5px 10px; }
@media (max-width: 860px) { .bk { grid-template-columns: 1fr; } .ev { grid-template-columns: 1fr; } }
```

- [ ] **Step 5: Delete the replaced components and their test, run**

```bash
git rm -q src/ui/CollectionSessions.tsx src/ui/CollectionHeader.tsx tests/ui/collectionheader.test.tsx
```
In `src/ui/CollectionView.tsx` remove the `CollectionSessions` and `CollectionHeader` imports and usages (the shell is rewritten next task; it may render nothing but the grid for now).

Run: `npx vitest run tests/ui/history-backup-mode.test.tsx && npx tsc -b`
Expected: PASS (9 tests), tsc clean.

- [ ] **Step 6: Commit**

```bash
git add -A src/ui tests/ui
git commit -m "Add the History & backup mode; retire CollectionSessions and CollectionHeader"
```

---

### Task 10: `CollectionView` shell — modes, narrow layout, CSS cleanup

**Files:**
- Rewrite: `src/ui/CollectionView.tsx`
- Modify: `src/ui/styles/collection.css` (remove dead rules), `tests/ui/collectionview.test.tsx` (rewrite), `tests/ui/collectionerror.test.tsx` (unchanged assertions; verify)

**Interfaces:**
- Consumes: `CollectionModeHeader`/`CollectionMode` (Task 4), `CollectionBrowse` (Task 6), `AddCardsMode` (7), `PlanPurchasesMode` (8), `HistoryBackupMode` (9); `useCollectionAccess`; `ownershipAvailable`, `useSyncStatus`; `loadPrintings`, `printingsByCard`; `getStorageError`.
- Produces: `export function CollectionView({ db, useOfficialImages }: { db: CardDb; useOfficialImages: boolean }): ReactElement` — the same props App.tsx passes today. Test ids kept: `collection-view`, `collection-readonly`, `collection-storage-error`, `collection-error`.

- [ ] **Step 1: Rewrite the view test**

Replace the whole of `tests/ui/collectionview.test.tsx` with:

```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { loadCardDb } from '../../src/engine/cardDb'
import { loadPrintings } from '../../src/ui/printings'
import { _resetCollectionCacheForTests } from '../../src/ui/collection'
import { _resetDraftForTests, stageLine } from '../../src/ui/sessionDraft'
import { CollectionView } from '../../src/ui/CollectionView'

const db = loadCardDb()
const printings = loadPrintings()
const multi = printings.find((p) => printings.filter((q) => q.cardId === p.cardId).length >= 2)!
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); _resetCollectionCacheForTests(); _resetDraftForTests() })
afterEach(cleanup)

describe('CollectionView shell', () => {
  it('opens in Browse with the grid and the header strip', () => {
    render(<CollectionView db={db} useOfficialImages={false} />)
    expect(screen.getByTestId('collection-grid')).toBeTruthy()
    expect(screen.getByTestId('collection-mode-browse').getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByTestId('acquisition-planner')).toBeNull()
  })
  it('switches modes, keeps Browse mounted, and remembers the mode in this tab', async () => {
    const user = userEvent.setup()
    render(<CollectionView db={db} useOfficialImages={false} />)
    await user.type(screen.getByTestId('collection-search'), 'mantis')
    fireEvent.click(screen.getByTestId('collection-mode-plan'))
    expect(screen.getByTestId('acquisition-planner')).toBeTruthy()
    expect(screen.getByTestId('collection-grid').closest('[hidden]')).not.toBeNull()
    fireEvent.click(screen.getByTestId('collection-mode-browse'))
    expect((screen.getByTestId('collection-search') as HTMLInputElement).value).toBe('mantis')
    fireEvent.click(screen.getByTestId('collection-mode-history'))
    cleanup(); render(<CollectionView db={db} useOfficialImages={false} />)
    expect(screen.getByTestId('collection-mode-history').getAttribute('aria-pressed')).toBe('true')
  })
  it('the staged pill jumps to Add cards', () => {
    stageLine({ key: multi.key, delta: 1 })
    render(<CollectionView db={db} useOfficialImages={false} />)
    fireEvent.click(screen.getByTestId('staged-pill'))
    expect(screen.getByTestId('session-lines')).toBeTruthy()
  })
  it('shows the storage-error banner when a write fails, and clears it on the next success', async () => {
    const user = userEvent.setup()
    render(<CollectionView db={db} useOfficialImages={false} />)
    await user.click(screen.getByTestId(`expand-${multi.cardId}`))
    expect(screen.queryByTestId('collection-storage-error')).toBeNull()
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = () => { throw new Error('QuotaExceededError') }
    try {
      await user.click(screen.getByTestId(`printing-inc-${multi.key}`))
      expect(screen.getByTestId('collection-storage-error').textContent).toContain('Could not save the collection')
    } finally { Storage.prototype.setItem = original }
    await user.click(screen.getByTestId(`printing-inc-${multi.key}`))
    expect(screen.queryByTestId('collection-storage-error')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/ui/collectionview.test.tsx`
Expected: FAIL — no `collection-mode-browse` in the old view.

- [ ] **Step 3: Rewrite the shell**

```tsx
// src/ui/CollectionView.tsx
//
// The Collection tab shell: loads the printings dataset once, owns the active
// mode, and mounts the header strip plus the four mode screens. All four stay
// mounted and are toggled with `hidden` (the same pattern App.tsx uses for the
// tabs) so filters, a half-typed quick add and the review column survive a
// switch. The mode is remembered per browser tab in sessionStorage.
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
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < NARROW)
  useEffect(() => { const on = () => setNarrow(window.innerWidth < NARROW); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on) }, [])
  return narrow
}

export function CollectionView({ db, useOfficialImages }: { db: CardDb; useOfficialImages: boolean }): ReactElement {
  useCollection() // re-render on every write so the storage-error banner is live
  const access = useCollectionAccess()
  const known = ownershipAvailable(useSyncStatus())
  const narrow = useNarrow()
  const [mode, setModeState] = useState<CollectionMode>(readMode)
  const setMode = (m: CollectionMode) => { setModeState(m); try { sessionStorage.setItem(MODE_KEY, m) } catch { /* per-tab convenience only */ } }
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
        <div hidden={mode !== 'browse'}><CollectionBrowse db={db} printings={loadResult.printings} byCard={loadResult.byCard} known={known} useOfficialImages={useOfficialImages} narrow={narrow} /></div>
        <div hidden={mode !== 'add'}><AddCardsMode db={db} printings={loadResult.printings} known={known} /></div>
        <div hidden={mode !== 'plan'}><PlanPurchasesMode db={db} printings={loadResult.printings} known={known} /></div>
        <div hidden={mode !== 'history'}><HistoryBackupMode db={db} printings={loadResult.printings} known={known} /></div>
      </fieldset>
    </div>
  )
}
```

- [ ] **Step 4: Remove dead CSS** from `src/ui/styles/collection.css`. Delete these rule blocks (they styled components that no longer exist): `.collection-view__filters`, `.collection-view__legend`, `.collection-header` (the flex strip), `.collection-header__import*` (all four blocks, including the ones appended on 2026-09-09), `.collection-header__error` → keep (still used by nothing? it is not; delete), `.quick-add*` (all seven blocks), `.collection-view__cell`, `.collection-view__count`, `.collection-view__expand`, `.collection-view__printings`, `.collection-view__printing-row`, `.compact-printings`, `.compact-printing*`, `.collection-view__search`, `.compact-printings__more`, and the `@media (max-width: 600px)` block. **Keep:** `.collection-view__storage-error`, `.collection-editor`, `.collection-header__sync*` (all state colours and `--sync-note`), `.collection-header__conflict`, `.collection-view__grid`, `.collection-view__stepper` (+ its button rule), `.printing-count`, `.collection-view { padding }`, and everything appended by Tasks 3–9. Then run `npx tsc -b` and `grep -n "quick-add\|collection-header__import\|compact-printing\|collection-view__printings" src/ui/styles/collection.css` — expected: no matches.

- [ ] **Step 5: Run the whole UI test folder and typecheck**

Run: `npx vitest run tests/ui && npx tsc -b`
Expected: PASS. `tests/ui/collectionerror.test.tsx` passes unchanged (the error state and test id are kept).

- [ ] **Step 6: Look at it once in the browser**

Start `npm run dev -- --port 5178` in the worktree, open `http://localhost:5178/`, Collection tab, and check: header strip on one row at ≥1280px; rail on the left; clicking a tile opens the drawer on the right without the grid reflowing; each mode tab shows its screen; at 390px the rail is a collapsed "Filters" panel above the grid and the drawer appears under the grid. Fix layout issues in `collection.css` only. Stop the server.

- [ ] **Step 7: Commit**

```bash
git add -A src/ui tests/ui
git commit -m "Rebuild CollectionView as a four-mode shell and drop the retired CSS"
```

---

### Task 11: Re-point the e2e suite and add the delivery scenario

**Files:**
- Modify: `e2e/collection.spec.ts`, `e2e/collection-file.spec.ts`, `e2e/collection-tabs.spec.ts`, `e2e/collection-entry.spec.ts`, `e2e/collection-history.spec.ts`, `e2e/acquisition-plan.spec.ts`, `e2e/artwork-goals.spec.ts`, `e2e/collection-layout.spec.ts`, `e2e/catalog.spec.ts`
- Create: `e2e/collection-delivery.spec.ts`

**Interfaces:**
- Consumes: the test ids listed under Global Constraints.
- Produces: a green e2e suite against the new tab.

Quick add no longer writes; every spec that typed a name and pressed Enter now also applies the session. Add this helper at the top of each spec that needs it (a local function, not a shared module — the e2e folder keeps specs self-contained):

```ts
async function applySession(page: import('@playwright/test').Page) {
  await page.getByTestId('staged-pill').click()
  await page.getByTestId('session-apply').click()
  await page.getByTestId('collection-mode-browse').click()
}
```

- [ ] **Step 1: `e2e/collection.spec.ts`** — after the two `quick-add-input` lines insert `await applySession(page)`; keep every assertion. The `quick-add-set` default assertion is unchanged.

- [ ] **Step 2: `e2e/collection-file.spec.ts`** — same insertion after each `press('Enter')` in both tests. In the failure-path test the `sync-status` "not yet saved" assertion still follows the apply, because Apply is the write that the broken PUT refuses.

- [ ] **Step 3: `e2e/collection-tabs.spec.ts`** — no quick add is used; the two `quick-add-input` disabled/enabled assertions still hold because `AddLine` sits inside the `collection-editor` fieldset. No change expected; run to confirm.

- [ ] **Step 4: `e2e/collection-entry.spec.ts`** — replace the filter and bulk steps:

```ts
  await page.getByTestId('collection-compact').click()               // was .check()
  await page.getByTestId('collection-search').fill('Industrial 006')
  await page.getByTestId('set-filter-arasakademodeck').click()        // was set-filter.selectOption
  await expect(page.getByTestId('compact-printing')).toHaveCount(1)
  const input=page.getByTestId('printing-count-arasakademodeck/006')
  await input.fill('3');await input.blur()
  await expect(page.getByTestId('collection-scope')).toContainText('1 printing rows · 3 physical copies')
  const row=page.getByTestId('compact-printing')
  expect(await row.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true)
  // Exact counts now live in the session (Add cards → "Set exact counts").
  await page.getByTestId('collection-mode-add').click()
  await page.getByTestId('session-mode-exact').click()
  await page.getByTestId('session-input').fill('arasakademodeck/006,5\nwelcometonightcityretail/033,2')
  await page.getByTestId('session-paste-add').click()
  await expect(page.getByTestId('session-changes')).toContainText('3 → 5')
  await expect(input).toHaveCount(0)                                   // Browse is hidden; the count is untouched until Apply
  await page.getByTestId('session-apply').click()
  await page.getByTestId('collection-mode-browse').click()
  await expect(page.getByTestId('printing-count-arasakademodeck/006')).toHaveValue('5')
```
The reload half stays, replacing `.check()` with `.click()` on `collection-compact`. At 390px the rail is collapsed: before `collection-search` add `await page.getByTestId('filter-rail').locator('summary').click()` (once per page load).

- [ ] **Step 5: `e2e/collection-history.spec.ts`** — rewrite the middle:

```ts
  await page.getByTestId('collection-compact').click()
  await page.getByTestId('collection-search').fill('arasakademodeck/006')
  const initialCount=page.getByTestId('printing-count-arasakademodeck/006')
  await initialCount.fill('0');await initialCount.blur()
  await page.getByTestId('collection-mode-add').click()
  await page.getByTestId('session-source').fill('Launch boosters')
  await page.getByTestId('session-cost').fill('100 SEK')
  await page.getByTestId('session-input').fill('arasakademodeck/006,+3')
  await page.getByTestId('session-paste-add').click()
  await page.reload()
  await page.getByTestId('tab-collection').click()
  await expect(page.getByTestId('staged-pill')).toHaveClass(/staged-pill--stale/)
  await page.getByTestId('collection-mode-add').click()
  await expect(page.getByTestId('session-line-arasakademodeck/006')).toContainText('+3')
  await expect(page.getByTestId('session-source')).toHaveValue('Launch boosters')
  await expect(page.getByTestId('session-changes')).toContainText('0 → 3')
  await page.getByTestId('session-apply').click()
  await page.getByTestId('collection-mode-history').click()
  const acquisition=page.getByTestId('collection-history-entry').filter({hasText:'Acquisition'}).first()
  await acquisition.getByTestId('history-details').click()
  await expect(acquisition).toContainText('100 SEK')
  await acquisition.getByTestId('history-undo').click()
  await page.getByTestId('collection-mode-browse').click()
  const count=page.getByTestId('printing-count-arasakademodeck/006')
  await expect(count).toHaveValue('0')
  await page.getByTestId('collection-mode-history').click()
  await acquisition.getByTestId('history-reapply').click()
  await page.getByTestId('collection-mode-browse').click()
  await expect(count).toHaveValue('3')
  await page.getByTestId('collection-mode-history').click()
  await page.getByTestId('import-input').fill(JSON.stringify({version:1,counts:{'arasakademodeck/006':1}}))
  await page.getByTestId('import-submit').click()
  await expect(page.getByTestId('import-preview')).toContainText('3 → 1')
  await page.getByTestId('import-apply').click()
  await page.getByTestId('collection-mode-browse').click()
  await expect(count).toHaveValue('1')
  await expect(page.getByTestId('sync-status')).toContainText('Saved to disk')
```

- [ ] **Step 6: `e2e/acquisition-plan.spec.ts`** — replace the planner section:

```ts
  await page.getByTestId('collection-mode-plan').click()
  const planner=page.getByTestId('acquisition-planner')
  await planner.getByLabel('Plan A',{exact:true}).check()
  await planner.getByLabel('Plan B',{exact:true}).check()
  const row=planner.locator('[data-card-id="industrial-assembly"]')
  await expect(row.locator('td').nth(4)).toHaveText('1')          // Buy is now the 5th column
  await page.getByTestId('acquisition-mode-assembled').click()
  await expect(row.locator('td').nth(4)).toHaveText('3')
  await page.getByTestId('reserve-artwork').check()
  await expect(row.locator('td').nth(4)).toHaveText('4')
  await expect(row.locator('td').nth(2)).toHaveText('2')
  await expect(page.getByTestId('acquisition-list')).toHaveValue(/4x Industrial Assembly/)
```
(The two `expand`/`printing-inc` steps before it are unchanged; the drawer keeps those ids.)

- [ ] **Step 7: `e2e/artwork-goals.spec.ts`** — the copy-list assertions move to Plan purchases:

```ts
  await page.getByTestId('collection-mode-plan').click()
  await expect(page.getByTestId('copy-playset-list')).toBeVisible()
  await expect(page.getByTestId('copy-artwork-list')).toBeVisible()
  await page.getByTestId('collection-mode-browse').click()
```
The `printing-row-edgerunneropens1/004` assertions are inside the drawer, which is still open for Industrial Assembly; keep them after the mode round-trip (Browse stays mounted, so the drawer is still open).

- [ ] **Step 8: `e2e/collection-layout.spec.ts`** — the expanded rows are now the drawer: replace `page.locator('.collection-view__printings').first()` with `page.getByTestId('card-drawer')`, and close it with `page.getByTestId('drawer-close').click()` instead of the second `expand` click. At 390px the cells check still runs against `collection-cell`.

- [ ] **Step 9: `e2e/catalog.spec.ts`** — replace `page.locator('.collection-view__printings')` with `page.getByTestId('card-drawer')`.

- [ ] **Step 10: New `e2e/collection-delivery.spec.ts`**

```ts
// The box-and-deck delivery the overhaul was designed around (spec §Add
// cards): a whole product plus booster pulls staged from Browse, surviving a
// reload as a stale draft, applied as one History entry with cost and a
// rarity breakdown, then undone as one step.
import { test, expect } from './fixtures'
import { rm } from 'node:fs/promises'
const SCRATCH = 'test-results/e2e-collection.json'
test.beforeEach(async () => { await rm(SCRATCH, { force: true }); await rm(SCRATCH.replace(/\.json$/, '.backup.json'), { recursive: true, force: true }) })

test('records a booster box and a demo deck as one undoable acquisition', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('tab-collection').click()
  await expect(page.getByTestId('sync-status')).toContainText('Saved to disk')

  // Quick add in Browse stages into a session that starts by itself.
  await page.getByTestId('quick-add-set').selectOption('welcometonightcitybeta')
  for (let i = 0; i < 3; i++) { await page.getByTestId('quick-add-input').fill('mantis'); await page.getByTestId('quick-add-input').press('Enter') }
  await expect(page.getByTestId('staged-pill')).toContainText('3 staged')
  await expect(page.getByTestId('collection-count-mantis-blades')).toContainText('0/3')

  // The demo deck as one block, with source and cost.
  await page.getByTestId('staged-pill').click()
  await page.getByTestId('product-arasakademodeck').click()
  await expect(page.getByTestId('session-group-Arasaka Demo Deck')).toContainText('whole product')
  await page.getByTestId('session-source').fill('Beta booster box + Arasaka demo deck')
  await page.getByTestId('session-cost').fill('1450 SEK')
  await expect(page.getByTestId('session-rarity')).toBeVisible()

  // Survives a reload, and says so.
  await page.reload()
  await page.getByTestId('tab-collection').click()
  await expect(page.getByTestId('staged-pill')).toHaveClass(/staged-pill--stale/)
  await page.getByTestId('collection-mode-add').click()
  await expect(page.getByTestId('session-line-welcometonightcitybeta/β025')).toContainText('+3')
  await expect(page.getByTestId('session-source')).toHaveValue('Beta booster box + Arasaka demo deck')

  // One apply, one entry.
  await page.getByTestId('session-apply').click()
  await expect(page.getByTestId('staged-pill')).toHaveCount(0)
  await page.getByTestId('collection-mode-browse').click()
  await expect(page.getByTestId('collection-count-mantis-blades')).toContainText('3/3')
  await page.getByTestId('collection-mode-history').click()
  const entry = page.getByTestId('collection-history-entry').first()
  await expect(entry).toContainText('Acquisition')
  await expect(entry).toContainText('1450 SEK')
  await entry.getByTestId('history-details').click()
  await expect(entry.getByTestId('history-rarity')).toBeVisible()
  await entry.getByTestId('history-undo').click()
  await page.getByTestId('collection-mode-browse').click()
  await expect(page.getByTestId('collection-count-mantis-blades')).toContainText('0/3')
  await expect(page.getByTestId('sync-status')).toContainText('Saved to disk')
})
```

- [ ] **Step 11: Run the collection e2e specs**

Run: `CTCG_E2E_PORT=5177 npx playwright test e2e/collection.spec.ts e2e/collection-file.spec.ts e2e/collection-tabs.spec.ts e2e/collection-entry.spec.ts e2e/collection-history.spec.ts e2e/acquisition-plan.spec.ts e2e/artwork-goals.spec.ts e2e/collection-layout.spec.ts e2e/catalog.spec.ts e2e/collection-delivery.spec.ts`
Expected: all pass. A failure here is a real regression or a wrong selector in this task — fix the spec if the selector is wrong, fix the component if the behaviour is wrong; never loosen an assertion.

- [ ] **Step 12: Commit**

```bash
git add e2e
git commit -m "Re-point the collection e2e specs at the four-mode tab and add the delivery scenario"
```

---

### Task 12: Final verification

**Files:** none new.

- [ ] **Step 1: Full unit suite and typecheck**

Run: `npx vitest run && npx tsc -b`
Expected: all files pass; note the count for the report.

- [ ] **Step 2: Full e2e suite**

Run: `CTCG_E2E_PORT=5177 npx playwright test`
Expected: all pass (the Play/Deck Builder/Simulate specs are untouched by this plan and must still pass).

- [ ] **Step 3: Dead code sweep**

Run: `grep -rn "QuickAddBar\|BulkCollectionEntry\|CollectionSessions\|AcquisitionPlanner\|CollectionHeader\b" src tests e2e`
Expected: no matches (except `CollectionModeHeader`).

- [ ] **Step 4: Browser pass against the spec's success criterion**

`npm run dev -- --port 5178`, then in the browser: stage three cards from Browse, open Add cards, add the Arasaka demo deck, fill source and cost, apply, open History, undo. Nothing should require reading a paragraph. Take one screenshot of each mode for the final report. Stop the server.

- [ ] **Step 5: Update the spec status and commit**

In `docs/superpowers/specs/2026-09-09-collection-tab-overhaul-design.md` change `**Status:**` to `Implemented on branch feat/collection-overhaul (2026-09-09)`.

```bash
git add docs/superpowers/specs/2026-09-09-collection-tab-overhaul-design.md
git commit -m "docs: mark the Collection tab overhaul spec as implemented"
```

Then hand over to `superpowers:finishing-a-development-branch`.
