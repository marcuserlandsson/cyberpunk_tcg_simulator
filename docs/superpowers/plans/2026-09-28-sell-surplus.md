# Sell Surplus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fifth Collection mode, **Sell**, that shows surplus copies against chosen decks and holds, keeps a persistent sell list, exports it for Cardmarket's bulk listing form (text + per-expansion CSV for the Bulk Import extension), and records sales in the collection.

**Architecture:** Pure arithmetic in `src/ui/surplus.ts` (reusing `acquisitionPlan`'s deck-requirement loop, extracted), a `useSyncExternalStore` sell-list store in `src/ui/sellDraft.ts` modelled on `sessionDraft.ts`, pure export formatting in `src/ui/cardmarketExport.ts` over a hand-maintained `data/cardmarket-expansions.json`, and two React components (`SellMode.tsx`, `SellList.tsx`) mounted by `CollectionView` like the other modes.

**Tech Stack:** React 19 + TypeScript (strict), zod, Vitest + Testing Library (jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-28-sell-surplus-design.md`

## Global Constraints

- Two-space indentation, single quotes, no statement-ending semicolons; match the dense style of neighbouring files.
- UI uses existing tools.css / collection.css vocabulary only (`card`, `card__in`, `tool-actions`, `check-chip`, `deckchip`, `seg`, `field`, `field__label`, `data-table`, `tool-table-wrap`, `tool-note`, `tool-figure`, `tool-error`, `tool-status`, `tool-panel`, `btn--primary`, `btn--ghost`, `btn--danger`, `session-x`, `session-name`, `collection-view__stepper`). One new class is allowed: `.prow__act` (Task 5). No bare `<details>`, no unstyled labels, nothing stacked above the playmat.
- localStorage keys: sell list `ctcg:sellList:v1`; sell preferences `ctcg:sell:prefs:v1`. Every read/write in try/catch.
- Cardmarket condition scale, in order: `MT · NM · EX · GD · LP · PL · PO`; default `NM`. Default language `English`.
- Journal metadata for a sale: `{ kind: 'Sale', date: <today YYYY-MM-DD>, source: 'Cardmarket' }`.
- CSV columns, exactly: `name,quantity,condition,language` (the Bulk Import extension fuzzy-maps its column pickers onto these header names). Price column omitted. RFC 4180 quoting, `\r\n` line endings, one file per Cardmarket expansion.
- Never run an ad-hoc `vite`/`npm run dev` for testing: it writes and auto-commits the real `data/collection.json`. E2E uses Playwright's dedicated server with the scratch `CTCG_COLLECTION_FILE`; port 5174 is often held by a stale server — use `CTCG_E2E_PORT=5177`.
- Commits: scoped (`feat(collection): …`, `test(e2e): …`, `docs: …`), each ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Before finishing: `npm test` and `npm run build` both pass.

## Review Focus

1. **Read-only tab** (another tab holds the collection lock): Mark sold must not remove sell-list lines, and must say it did not save — `writeCollection` silently returns in that state. Test in Task 2.
2. **Count dropped after listing** (a copy removed via the drawer): the line is capped to what is owned, export uses the capped number, and Mark sold decrements only the capped number, never below zero. Tests in Tasks 2 and 3.
3. **Pressing "Add all surplus" twice** must not list the surplus twice. Test in Task 4.
4. **A remembered deck that was renamed or deleted** must be dropped from the Sell preferences without an error. Test in Task 4.
5. **CSV cells containing commas or quotes**, and **sell lines whose printing key no longer exists** after a dataset regeneration, must produce a valid file and skip the unknown line. Tests in Task 3.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/ui/acquisitionPlan.ts` (modify) | Export `deckRequirements`; `acquisitionPlan` calls it. |
| `src/ui/surplus.ts` (create) | `surplusPlan`, `pendingSplit` — pure. |
| `src/ui/sellDraft.ts` (create) | Sell-list store, `effectiveLines`, `saleCounts`, `markSold`. |
| `data/cardmarket-expansions.json` (create) | setCode → Cardmarket expansion, naming style, per-printing name overrides. |
| `src/ui/cardmarketExport.ts` (create) | Map loading, grouping, text export, CSV export, filenames — pure. |
| `src/ui/DeckChoice.tsx` (create) | `DeckChips` and `DeckModeSeg`, extracted from Plan purchases. |
| `src/ui/PlanPurchasesMode.tsx` (modify) | Use `DeckChips`/`DeckModeSeg`; markup and test ids unchanged. |
| `src/ui/SellMode.tsx` (create) | Keep-for controls, preferences, surplus table. |
| `src/ui/SellList.tsx` (create) | Sell list, defaults, exports, Mark sold. |
| `src/ui/CollectionModeHeader.tsx`, `src/ui/CollectionView.tsx` (modify) | Fifth mode and badge. |
| `src/ui/CardDrawer.tsx`, `src/ui/styles/collection.css` (modify) | "Sell +1" per printing row. |
| `e2e/collection-sell.spec.ts` (create) | Browser workflow. |
| `docs/selling-surplus.md` (create) | User-facing notes. |

---

### Task 1: Surplus arithmetic

**Files:**
- Modify: `src/ui/acquisitionPlan.ts:12-24`
- Create: `src/ui/surplus.ts`
- Test: `tests/ui/surplus.test.ts` (create); `tests/ui/acquisition-plan.test.ts` (must pass unchanged)

**Interfaces:**
- Produces:
  - `export type DeckMode = 'shared' | 'assembled'` (in `acquisitionPlan.ts`)
  - `export function deckRequirements(db: CardDb, decks: DeckList[], mode: DeckMode): Map<string, { id: string; count: number }>` (in `acquisitionPlan.ts`)
  - `export interface SplitLine { key: string; count: number }`
  - `export interface SurplusRow { identity: string; id: string; owned: number; deckNeed: number; binderHold: number; playsetHold: number; keep: number; surplus: number; split: SplitLine[] }`
  - `export interface SurplusOptions { mode: DeckMode; keepBinderArt: boolean; keepPlayset: boolean }`
  - `export function surplusPlan(db: CardDb, decks: DeckList[], printings: Printing[], counts: Record<string, number>, opts: SurplusOptions): SurplusRow[]` — every identity with owned > 0, sorted by surplus desc then id.
  - `export function pendingSplit(split: SplitLine[], listed: Record<string, number>, want: number): SplitLine[]`

Fixture facts used below (verified against `data/printings.json`): `industrial-assembly` (program, playset 3) has six printings sharing one artwork, including `arasakademodeck/006`, `welcometonightcityretail/033`, `welcometonightcitybeta/β033`. `adam-smasher-ender-of-legends` (legend, playset 1) has playable `welcometonightcityretail/001` and collection-only `PRM01/008` (different artworks). `rebecca-having-a-moment` has only collection-only printings `PRM01/005`, `PRM01/007` and playset target 0. `v-streetkid` has `welcometonightcitybeta/β005a` and `welcometonightcityretail/005a` (same artwork) plus `welcometonightcitybeta/β005b` (another artwork).

- [ ] **Step 1: Write the failing tests**

Create `tests/ui/surplus.test.ts` (jsdom, because `surplus.ts` imports `collection.ts`, which touches localStorage — same as `acquisition-plan.test.ts`):

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { loadCardDb } from '../../src/engine/cardDb'
import type { DeckList } from '../../src/engine/deck'
import { loadPrintings } from '../../src/ui/printings'
import { deckRequirements } from '../../src/ui/acquisitionPlan'
import { pendingSplit, surplusPlan, type SurplusOptions } from '../../src/ui/surplus'

const db = loadCardDb(), printings = loadPrintings()
const deck = (cards: Record<string, number>, legends: [string, string, string] = ['', '', '']): DeckList => ({ name: 'T', legends, cards })
const none: SurplusOptions = { mode: 'shared', keepBinderArt: false, keepPlayset: false }
const ia = { 'arasakademodeck/006': 2, 'welcometonightcityretail/033': 1, 'welcometonightcitybeta/β033': 1 }
const row = (decks: DeckList[], counts: Record<string, number>, opts: Partial<SurplusOptions>, id: string) =>
  surplusPlan(db, decks, printings, counts, { ...none, ...opts }).find(r => r.id === id)!

describe('deckRequirements', () => {
  it('takes the max across decks when shared and the sum when kept', () => {
    const decks = [deck({ 'industrial-assembly': 3 }), deck({ 'industrial-assembly': 2 })]
    expect([...deckRequirements(db, decks, 'shared').values()].find(r => r.id === 'industrial-assembly')!.count).toBe(3)
    expect([...deckRequirements(db, decks, 'assembled').values()].find(r => r.id === 'industrial-assembly')!.count).toBe(5)
  })
})

describe('surplusPlan', () => {
  it('sells everything with no decks and no holds, most-duplicated printing first', () => {
    expect(row([], ia, {}, 'industrial-assembly')).toMatchObject({ owned: 4, keep: 0, surplus: 4, split: [
      { key: 'arasakademodeck/006', count: 2 }, { key: 'welcometonightcityretail/033', count: 1 }, { key: 'welcometonightcitybeta/β033', count: 1 },
    ] })
  })
  it('keeps what shared or kept-in-every-deck decks need', () => {
    const decks = [deck({ 'industrial-assembly': 3 }), deck({ 'industrial-assembly': 2 })]
    expect(row(decks, ia, {}, 'industrial-assembly')).toMatchObject({ deckNeed: 3, keep: 3, surplus: 1, split: [{ key: 'arasakademodeck/006', count: 1 }] })
    expect(row(decks, ia, { mode: 'assembled' }, 'industrial-assembly')).toMatchObject({ deckNeed: 5, keep: 4, surplus: 0, split: [] })
  })
  it('adds one binder copy per held artwork on top of deck need', () => {
    expect(row([deck({ 'industrial-assembly': 2 })], ia, { keepBinderArt: true }, 'industrial-assembly')).toMatchObject({ binderHold: 1, keep: 3, surplus: 1 })
  })
  it('lets deck copies count toward the playset hold', () => {
    expect(row([], ia, { keepPlayset: true }, 'industrial-assembly')).toMatchObject({ playsetHold: 3, keep: 3, surplus: 1 })
    expect(row([deck({ 'industrial-assembly': 2 })], ia, { keepPlayset: true }, 'industrial-assembly')).toMatchObject({ keep: 3, surplus: 1 })
  })
  it('sells a collection-only printing, but only after playable duplicates', () => {
    expect(row([], { 'PRM01/005': 2 }, { keepBinderArt: true }, 'rebecca-having-a-moment')).toMatchObject({ owned: 2, binderHold: 1, keep: 1, surplus: 1, split: [{ key: 'PRM01/005', count: 1 }] })
    const adam = { 'PRM01/008': 1, 'welcometonightcityretail/001': 2 }
    expect(row([], adam, { keepPlayset: true }, 'adam-smasher-ender-of-legends').split).toEqual([{ key: 'welcometonightcityretail/001', count: 2 }])
  })
  it('never sells the last playable copy a deck needs', () => {
    const adam = { 'PRM01/008': 1, 'welcometonightcityretail/001': 1 }
    const r = row([deck({}, ['adam-smasher-ender-of-legends', '', ''])], adam, {}, 'adam-smasher-ender-of-legends')
    expect(r).toMatchObject({ deckNeed: 1, keep: 1, surplus: 1, split: [{ key: 'PRM01/008', count: 1 }] })
  })
  it('keeps two printings of one card in one set distinct', () => {
    const counts = { 'welcometonightcitybeta/β005a': 1, 'welcometonightcitybeta/β005b': 1, 'welcometonightcityretail/005a': 1 }
    expect(row([], counts, { keepBinderArt: true }, 'v-streetkid')).toMatchObject({ binderHold: 2, surplus: 1, split: [{ key: 'welcometonightcityretail/005a', count: 1 }] })
  })
  it('breaks ties by selling retail before beta', () => {
    const counts = { 'welcometonightcitybeta/β033': 1, 'welcometonightcityretail/033': 1 }
    expect(row([deck({ 'industrial-assembly': 1 })], counts, {}, 'industrial-assembly').split).toEqual([{ key: 'welcometonightcityretail/033', count: 1 }])
  })
  it('ignores deck entries that are not in the card db', () => {
    expect(row([deck({ 'not-a-card': 2 })], ia, {}, 'industrial-assembly').surplus).toBe(4)
  })
})

describe('pendingSplit', () => {
  const split = [{ key: 'a', count: 2 }, { key: 'b', count: 1 }]
  it('subtracts copies already listed and stops at the wanted amount', () => {
    expect(pendingSplit(split, {}, 3)).toEqual(split)
    expect(pendingSplit(split, { a: 1 }, 2)).toEqual([{ key: 'a', count: 1 }, { key: 'b', count: 1 }])
    expect(pendingSplit(split, { a: 2, b: 1 }, 3)).toEqual([])
    expect(pendingSplit(split, {}, 1)).toEqual([{ key: 'a', count: 1 }])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/ui/surplus.test.ts`
Expected: FAIL — `deckRequirements` is not exported / cannot resolve `../../src/ui/surplus`.

- [ ] **Step 3: Extract `deckRequirements` in `src/ui/acquisitionPlan.ts`**

Replace lines 12–24 (the signature through the end of the `for (const deck of decks)` loop) so the file reads:

```ts
export type DeckMode = 'shared' | 'assembled'

/** Per card identity: the copies the chosen decks need — the max any one deck
 *  needs when cards are shared, the sum when every deck is kept assembled. */
export function deckRequirements(db: CardDb, decks: DeckList[], mode: DeckMode): Map<string, { id: string; count: number }> {
  const required = new Map<string,{id:string; count:number}>()
  const identity = (id:string) => db[id] ? cardIdentity(db[id]) : id
  for (const deck of decks) {
    const own = new Map<string,{id:string; count:number}>()
    for (const [id,n] of [...Object.entries(deck.cards), ...deck.legends.filter(Boolean).map(id=>[id,1] as [string,number])]) {
      if (!Number.isSafeInteger(n) || n < 1) continue
      const key = identity(id); own.set(key,{id,count:(own.get(key)?.count ?? 0)+n})
    }
    for (const [key,value] of own) required.set(key,{id:value.id,count:mode==='shared' ? Math.max(required.get(key)?.count ?? 0,value.count) : (required.get(key)?.count ?? 0)+value.count})
  }
  return required
}

export function acquisitionPlan(db: CardDb, decks: DeckList[], printings: Printing[], counts: Record<string,number>, mode: DeckMode, reserveArtwork: boolean): AcquisitionNeed[] {
  const required = deckRequirements(db, decks, mode)
  const identity = (id:string) => db[id] ? cardIdentity(db[id]) : id
```

Leave everything from `const owned = new Map…` onward untouched.

- [ ] **Step 4: Create `src/ui/surplus.ts`**

```ts
//
// Surplus for the Sell mode: per card identity, how many owned copies are
// not needed by the chosen decks, the binder (one copy per held artwork) or
// a playset, and which printings to part with. Deck need comes from the same
// `deckRequirements` Plan purchases uses, so buying and selling agree.
import { cardIdentity, type DeckList } from '../engine/deck'
import type { CardDb } from '../engine/types'
import type { Printing } from './printings'
import { playsetTarget } from './collection'
import { deckRequirements, type DeckMode } from './acquisitionPlan'

export interface SplitLine { key: string; count: number }
export interface SurplusRow { identity: string; id: string; owned: number; deckNeed: number; binderHold: number; playsetHold: number; keep: number; surplus: number; split: SplitLine[] }
export interface SurplusOptions { mode: DeckMode; keepBinderArt: boolean; keepPlayset: boolean }

const isBeta = (p: Printing) => /beta/i.test(p.setCode)

export function surplusPlan(db: CardDb, decks: DeckList[], printings: Printing[], counts: Record<string, number>, opts: SurplusOptions): SurplusRow[] {
  const required = deckRequirements(db, decks, opts.mode)
  const identity = (id: string) => db[id] ? cardIdentity(db[id]) : id
  const held = new Map<string, { p: Printing; n: number }[]>()
  for (const p of printings) {
    const n = counts[p.key] ?? 0
    if (!Number.isSafeInteger(n) || n < 1) continue
    const key = identity(p.cardId)
    held.set(key, [...(held.get(key) ?? []), { p, n }])
  }
  const rows: SurplusRow[] = []
  for (const [key, list] of held) {
    const def = list.map(h => db[h.p.cardId]).find(Boolean)
    const owned = list.reduce((s, h) => s + h.n, 0)
    const deckNeed = required.get(key)?.count ?? 0
    const remaining = new Map(list.map(h => [h.p.key, h.n]))
    let binderHold = 0
    if (opts.keepBinderArt) {
      const arts = new Map<string, Printing[]>()
      for (const h of list) if (h.p.artworkId) arts.set(h.p.artworkId, [...(arts.get(h.p.artworkId) ?? []), h.p])
      for (const group of arts.values()) {
        // A collection-only printing fills the binder copy without consuming a playable one (acquisitionPlan's rule).
        const chosen = [...group].sort((a, b) => Number(a.playable !== false) - Number(b.playable !== false) || a.key.localeCompare(b.key))[0]
        remaining.set(chosen.key, remaining.get(chosen.key)! - 1); binderHold++
      }
    }
    const playsetHold = opts.keepPlayset && def ? playsetTarget(def) : 0
    const keep = Math.min(owned, Math.max(deckNeed + binderHold, playsetHold))
    const surplus = owned - keep
    const playableLeft = () => list.reduce((s, h) => s + (h.p.playable === false ? 0 : remaining.get(h.p.key)!), 0)
    const deckFloor = Math.min(deckNeed, playableLeft())
    const order = (a: { p: Printing }, b: { p: Printing }) => Number(a.p.playable === false) - Number(b.p.playable === false) || remaining.get(b.p.key)! - remaining.get(a.p.key)! || Number(isBeta(a.p)) - Number(isBeta(b.p)) || a.p.key.localeCompare(b.p.key)
    const sold = new Map<string, number>()
    // One copy at a time, so "most copies left" is re-evaluated after each sale.
    // Always finds a copy: surplus ≤ owned − binderHold − deckFloor.
    for (let i = 0; i < surplus; i++) {
      const next = [...list].sort(order).find(h => remaining.get(h.p.key)! > 0 && (h.p.playable === false || playableLeft() - 1 >= deckFloor))!
      remaining.set(next.p.key, remaining.get(next.p.key)! - 1)
      sold.set(next.p.key, (sold.get(next.p.key) ?? 0) + 1)
    }
    rows.push({ identity: key, id: def?.id ?? list[0].p.cardId, owned, deckNeed, binderHold, playsetHold, keep, surplus, split: [...sold].map(([k, count]) => ({ key: k, count })) })
  }
  return rows.sort((a, b) => b.surplus - a.surplus || a.id.localeCompare(b.id))
}

/** The part of a suggested split not yet on the sell list, up to `want` copies. */
export function pendingSplit(split: SplitLine[], listed: Record<string, number>, want: number): SplitLine[] {
  const out: SplitLine[] = []
  let left = want
  for (const line of split) {
    const n = Math.min(left, Math.max(0, line.count - (listed[line.key] ?? 0)))
    if (n > 0) { out.push({ key: line.key, count: n }); left -= n }
  }
  return out
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/ui/surplus.test.ts tests/ui/acquisition-plan.test.ts tests/ui/plan-purchases-mode.test.tsx`
Expected: PASS (all three files).

- [ ] **Step 6: Commit**

```bash
git add src/ui/acquisitionPlan.ts src/ui/surplus.ts tests/ui/surplus.test.ts
git commit -m "feat(collection): surplus arithmetic for selling

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Sell-list store and Mark sold

**Files:**
- Create: `src/ui/sellDraft.ts`
- Test: `tests/ui/sell-draft.test.ts` (create)

**Interfaces:**
- Consumes: `getCollection(): Collection`, `replaceCollection(collection: Collection, metadata?: ChangeMetadata): void` from `src/ui/collection.ts`.
- Produces:
  - `export const CONDITIONS = ['MT','NM','EX','GD','LP','PL','PO'] as const`, `export type Condition`
  - `export const LANGUAGES = ['English','German','French','Spanish','Italian'] as const`, `export type Language`
  - `export interface SellLine { key: string; count: number; condition?: Condition }`
  - `export interface SellList { version: 1; condition: Condition; language: Language; lines: SellLine[] }`
  - `export const SELL_KEY = 'ctcg:sellList:v1'`
  - `getSellList(): SellList`, `useSellList(): SellList`, `subscribeSellList(fn): () => void`, `getSellListStorageError(): string`
  - `addToSellList(lines: SplitLine[]): void` (one write; merges by key), `setSellCount(key: string, n: number): void` (ignored when n < 1), `setLineCondition(key: string, condition: Condition | undefined): void`, `removeSellLine(key: string): void`, `setSellDefaults(patch: Partial<Pick<SellList, 'condition' | 'language'>>): void`, `clearSold(keys: string[]): void`
  - `export interface EffectiveLine { key: string; requested: number; count: number; condition: Condition }`
  - `effectiveLines(list: SellList, counts: Record<string, number>): EffectiveLine[]` — `count = min(requested, owned)`
  - `saleCounts(keys: string[], before: Record<string, number>): Record<string, number>`
  - `markSold(keys: string[], expectedBefore: Record<string, number>, today?: Date): void` — throws `'Collection changed; review again.'` or `'Could not save the collection; the sell list was kept.'`
  - `_resetSellListForTests(): void`

- [ ] **Step 1: Write the failing tests**

Create `tests/ui/sell-draft.test.ts`:

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { _resetCollectionCacheForTests, getCollection, setCount } from '../../src/ui/collection'
import { setCollectionAccess } from '../../src/ui/collectionAccess'
import { readCollectionJournal } from '../../src/ui/collectionJournal'
import {
  SELL_KEY, _resetSellListForTests, addToSellList, clearSold, effectiveLines, getSellList, getSellListStorageError,
  markSold, removeSellLine, setLineCondition, setSellCount, setSellDefaults,
} from '../../src/ui/sellDraft'

beforeEach(() => { localStorage.clear(); _resetCollectionCacheForTests(); _resetSellListForTests(); setCollectionAccess('writer') })

describe('sell list store', () => {
  it('starts empty with NM and English defaults', () => {
    expect(getSellList()).toEqual({ version: 1, condition: 'NM', language: 'English', lines: [] })
  })
  it('merges additions by printing key and persists across a reload', () => {
    addToSellList([{ key: 'a/1', count: 2 }, { key: 'b/2', count: 1 }])
    addToSellList([{ key: 'a/1', count: 1 }])
    setLineCondition('b/2', 'EX')
    setSellDefaults({ language: 'German' })
    _resetSellListForTests()
    expect(getSellList()).toEqual({ version: 1, condition: 'NM', language: 'German', lines: [{ key: 'a/1', count: 3 }, { key: 'b/2', count: 1, condition: 'EX' }] })
  })
  it('edits, removes and clears lines; ignores counts below one', () => {
    addToSellList([{ key: 'a/1', count: 2 }, { key: 'b/2', count: 1 }, { key: 'c/3', count: 1 }])
    setSellCount('a/1', 5); setSellCount('b/2', 0); removeSellLine('c/3')
    expect(getSellList().lines).toEqual([{ key: 'a/1', count: 5 }, { key: 'b/2', count: 1 }])
    clearSold(['a/1'])
    expect(getSellList().lines).toEqual([{ key: 'b/2', count: 1 }])
  })
  it('resets unreadable stored data and says so', () => {
    localStorage.setItem(SELL_KEY, '{"version":1,"lines":"nope"}')
    expect(getSellList().lines).toEqual([])
    expect(getSellListStorageError()).toMatch(/could not be read/)
  })
  it('caps every line at the copies currently owned', () => {
    addToSellList([{ key: 'a/1', count: 3 }, { key: 'b/2', count: 1 }])
    setLineCondition('b/2', 'LP')
    expect(effectiveLines(getSellList(), { 'a/1': 2 })).toEqual([
      { key: 'a/1', requested: 3, count: 2, condition: 'NM' },
      { key: 'b/2', requested: 1, count: 0, condition: 'LP' },
    ])
  })
})

describe('markSold', () => {
  const key = 'arasakademodeck/006', other = 'welcometonightcityretail/033'
  beforeEach(() => { setCount(key, 3); setCount(other, 1) })

  it('decrements the capped count, records a Sale and removes only the sold lines', () => {
    addToSellList([{ key, count: 5 }, { key: other, count: 1 }])
    markSold([key], getCollection().counts, new Date('2026-09-28T12:00:00Z'))
    expect(getCollection().counts[key] ?? 0).toBe(0)
    expect(getCollection().counts[other]).toBe(1)
    expect(getSellList().lines).toEqual([{ key: other, count: 1 }])
    expect(readCollectionJournal().entries.some(e => e.kind === 'Sale' && e.source === 'Cardmarket' && e.date === '2026-09-28')).toBe(true)
  })
  it('refuses when the collection changed since the confirm opened', () => {
    addToSellList([{ key, count: 1 }])
    const seen = { ...getCollection().counts }
    setCount(key, 2)
    expect(() => markSold([key], seen)).toThrow('Collection changed; review again.')
    expect(getSellList().lines).toHaveLength(1)
  })
  it('keeps the sell list when the tab cannot write the collection', () => {
    addToSellList([{ key, count: 1 }])
    const seen = { ...getCollection().counts }
    setCollectionAccess('waiting')
    expect(() => markSold([key], seen)).toThrow('Could not save the collection; the sell list was kept.')
    expect(getSellList().lines).toHaveLength(1)
    expect(getCollection().counts[key]).toBe(3)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/ui/sell-draft.test.ts`
Expected: FAIL — cannot resolve `../../src/ui/sellDraft`.

- [ ] **Step 3: Create `src/ui/sellDraft.ts`**

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/ui/sell-draft.test.ts`
Expected: PASS. If `setCollectionAccess('waiting')` leaves `getCollection()` unchanged but the test still fails, read `src/ui/collection.ts:156-200` — the check must be against the post-write cache, not the argument.

- [ ] **Step 5: Commit**

```bash
git add src/ui/sellDraft.ts tests/ui/sell-draft.test.ts
git commit -m "feat(collection): sell list store and mark-sold write

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Cardmarket export formatting

**Files:**
- Create: `data/cardmarket-expansions.json`
- Create: `src/ui/cardmarketExport.ts`
- Test: `tests/ui/cardmarket-export.test.ts` (create)

**Interfaces:**
- Consumes: `EffectiveLine`, `Condition`, `Language` from `src/ui/sellDraft.ts`; `Printing`; `CardDb`; `cardIdentity` from `src/engine/deck.ts`.
- Produces:
  - `export type CardmarketMap = { version: 1; subtitle: 'always' | 'when-shared'; separator: string; expansions: Record<string, { expansion: string; variant?: string }>; names: Record<string, string> }`
  - `export function loadCardmarketMap(raw?: unknown): CardmarketMap` (defaults to the JSON file; throws on invalid data)
  - `export interface ExportRow { name: string; collectorNumbers: string[]; quantity: number; condition: Condition; variant?: string }`
  - `export interface ExportGroup { expansion: string; mapped: boolean; rows: ExportRow[]; copies: number }`
  - `export function buildExportGroups(lines: EffectiveLine[], printings: Printing[], db: CardDb, map: CardmarketMap): ExportGroup[]`
  - `export function bulkListingText(groups: ExportGroup[], language: Language): string`
  - `export function groupCsv(group: ExportGroup, language: Language): string`
  - `export function csvFilename(group: ExportGroup, today?: Date): string`

`subtitle: 'when-shared'` exports "Name" and adds the subtitle only when another card identity has the same name; `'always'` adds it whenever the card has one. `separator` joins name and subtitle. `names` overrides the exported name for one printing key (for Cardmarket's own version suffixes). Task 7 fills the real values.

- [ ] **Step 1: Create the initial data file**

`data/cardmarket-expansions.json`:

```json
{
  "version": 1,
  "subtitle": "when-shared",
  "separator": " - ",
  "expansions": {},
  "names": {}
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/ui/cardmarket-export.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { loadCardDb } from '../../src/engine/cardDb'
import { loadPrintings } from '../../src/ui/printings'
import { buildExportGroups, bulkListingText, csvFilename, groupCsv, loadCardmarketMap, type CardmarketMap } from '../../src/ui/cardmarketExport'
import type { EffectiveLine } from '../../src/ui/sellDraft'

const db = loadCardDb(), printings = loadPrintings()
const map: CardmarketMap = {
  version: 1, subtitle: 'always', separator: ' - ',
  expansions: {
    welcometonightcitybeta: { expansion: 'Welcome to Night City', variant: 'Beta' },
    welcometonightcityretail: { expansion: 'Welcome to Night City' },
  },
  names: { 'welcometonightcitybeta/β005b': 'V - Streetkid (V.2)' },
}
const line = (key: string, count: number, condition: EffectiveLine['condition'] = 'NM'): EffectiveLine => ({ key, requested: count, count, condition })

describe('buildExportGroups', () => {
  it('groups by Cardmarket expansion, mapped first, rows by collector number, and merges identical rows', () => {
    const groups = buildExportGroups([
      line('welcometonightcityretail/033', 1),
      line('welcometonightcityretail/001', 2),
      line('welcometonightcitybeta/β005b', 1),
      line('arasakademodeck/006', 2),
      line('PRM01/008', 0),
      line('no-such-set/999', 3),
    ], printings, db, map)
    expect(groups.map(g => [g.expansion, g.mapped, g.copies])).toEqual([['Welcome to Night City', true, 4], ['Arasaka Demo Deck', false, 2]])
    expect(groups[0].rows).toEqual([
      { name: 'Adam Smasher - Ender of Legends', collectorNumbers: ['001'], quantity: 2, condition: 'NM' },
      { name: 'V - Streetkid (V.2)', collectorNumbers: ['β005b'], quantity: 1, condition: 'NM', variant: 'Beta' },
      { name: 'Industrial Assembly', collectorNumbers: ['033'], quantity: 1, condition: 'NM' },
    ])
  })
  it('keeps different conditions of one card as separate rows', () => {
    const [group] = buildExportGroups([line('welcometonightcityretail/033', 1, 'NM'), line('welcometonightcitybeta/β033', 1, 'EX')], printings, db, { ...map, expansions: { ...map.expansions, welcometonightcitybeta: { expansion: 'Welcome to Night City' } } })
    expect(group.rows.map(r => [r.condition, r.quantity, r.collectorNumbers])).toEqual([['NM', 1, ['033']], ['EX', 1, ['β033']]])
  })
})

describe('formats', () => {
  const groups = buildExportGroups([line('welcometonightcityretail/001', 2), line('arasakademodeck/006', 1)], printings, db, map)
  it('writes the bulk-listing text with an unmapped-set marker', () => {
    expect(bulkListingText(groups, 'English')).toBe([
      '## Welcome to Night City (2 copies)',
      '2× Adam Smasher - Ender of Legends · #001 · NM · English',
      '',
      '## Arasaka Demo Deck ⚠ check expansion (1 copy)',
      '1× Industrial Assembly · #006 · NM · English',
    ].join('\n'))
  })
  it('writes one CSV per expansion with the extension\'s column names', () => {
    expect(groupCsv(groups[0], 'English')).toBe('name,quantity,condition,language\r\nAdam Smasher - Ender of Legends,2,Near Mint,English\r\n')
  })
  it('quotes cells containing commas or quotes', () => {
    const csv = groupCsv({ expansion: 'X', mapped: true, copies: 1, rows: [{ name: 'Say "Hi", Choom', collectorNumbers: ['1'], quantity: 1, condition: 'LP' }] }, 'German')
    expect(csv).toBe('name,quantity,condition,language\r\n"Say ""Hi"", Choom",1,Light Played,German\r\n')
  })
  it('names files by date and expansion, flagging unmapped sets', () => {
    const today = new Date('2026-09-28T12:00:00Z')
    expect(csvFilename(groups[0], today)).toBe('cardmarket-sell-2026-09-28-welcome-to-night-city.csv')
    expect(csvFilename(groups[1], today)).toBe('cardmarket-sell-2026-09-28-CHECK-arasaka-demo-deck.csv')
  })
})

describe('the shipped map', () => {
  it('parses and only names set codes that exist', () => {
    const shipped = loadCardmarketMap()
    const codes = new Set(printings.map(p => p.setCode))
    expect(Object.keys(shipped.expansions).filter(c => !codes.has(c))).toEqual([])
    const keys = new Set(printings.map(p => p.key))
    expect(Object.keys(shipped.names).filter(k => !keys.has(k))).toEqual([])
  })
  it('rejects a malformed map', () => {
    expect(() => loadCardmarketMap({ version: 1, expansions: [] })).toThrow()
  })
})
```

Note the sort in the first test: `001` (Adam), `β005b` (V), `033` (Industrial Assembly) — collector numbers compare by their digits (`001 < 005 < 033`), ignoring the `β` prefix.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/ui/cardmarket-export.test.ts`
Expected: FAIL — cannot resolve `../../src/ui/cardmarketExport`.

- [ ] **Step 4: Create `src/ui/cardmarketExport.ts`**

```ts
//
// Sell list → what Cardmarket's bulk listing form wants. A private seller
// lists one expansion at a time, so everything is grouped by Cardmarket
// expansion (data/cardmarket-expansions.json maps our set codes onto them).
// The CSV targets the Cardmarket Bulk Import extension, whose column pickers
// fuzzy-match the header names name / quantity / condition / language
// (checked against PedroPerpetua/cardmarket-bulk-import 8ed18c0, 2026-09-05).
// Price is left for Cardmarket, where the trend price is on screen.
import { z } from 'zod'
import rawMap from '../../data/cardmarket-expansions.json'
import { cardIdentity } from '../engine/deck'
import type { CardDb } from '../engine/types'
import type { Printing } from './printings'
import type { Condition, EffectiveLine, Language } from './sellDraft'

const mapSchema = z.object({
  version: z.literal(1),
  subtitle: z.enum(['always', 'when-shared']),
  separator: z.string(),
  expansions: z.record(z.string(), z.object({ expansion: z.string().min(1), variant: z.string().min(1).optional() })),
  names: z.record(z.string(), z.string().min(1)),
})
export type CardmarketMap = z.infer<typeof mapSchema>
export function loadCardmarketMap(raw: unknown = rawMap): CardmarketMap { return mapSchema.parse(raw) }

export interface ExportRow { name: string; collectorNumbers: string[]; quantity: number; condition: Condition; variant?: string }
export interface ExportGroup { expansion: string; mapped: boolean; rows: ExportRow[]; copies: number }

const CONDITION_NAMES: Record<Condition, string> = { MT: 'Mint', NM: 'Near Mint', EX: 'Excellent', GD: 'Good', LP: 'Light Played', PL: 'Played', PO: 'Poor' }

function sharedNames(db: CardDb): Set<string> {
  const identities = new Map<string, Set<string>>()
  for (const def of Object.values(db)) identities.set(def.name, (identities.get(def.name) ?? new Set()).add(cardIdentity(def)))
  return new Set([...identities].filter(([, ids]) => ids.size > 1).map(([name]) => name))
}

function collectorOrder(a: string, b: string): number {
  const parse = (s: string) => { const m = s.match(/(\d+)(\D*)$/); return m ? [Number(m[1]), m[2]] as const : [Infinity, s] as const }
  const [an, as] = parse(a), [bn, bs] = parse(b)
  return an - bn || as.localeCompare(bs)
}

export function buildExportGroups(lines: EffectiveLine[], printings: Printing[], db: CardDb, map: CardmarketMap): ExportGroup[] {
  const byKey = new Map(printings.map(p => [p.key, p]))
  const shared = sharedNames(db)
  const setOrder = Object.keys(map.expansions)
  const groups = new Map<string, ExportGroup & { rank: number }>()
  for (const line of lines) {
    const p = byKey.get(line.key)
    if (!p || line.count < 1) continue // unknown after a dataset regeneration, or nothing left to sell
    const m = map.expansions[p.setCode]
    const groupKey = m ? `m:${m.expansion}` : `u:${p.setCode}`
    const group = groups.get(groupKey) ?? { expansion: m?.expansion ?? p.setName, mapped: !!m, rows: [], copies: 0, rank: m ? setOrder.indexOf(p.setCode) : Infinity }
    if (m) group.rank = Math.min(group.rank, setOrder.indexOf(p.setCode))
    const def = db[p.cardId]
    const withSubtitle = def?.subtitle && (map.subtitle === 'always' || shared.has(def.name))
    const name = map.names[p.key] ?? (def ? (withSubtitle ? `${def.name}${map.separator}${def.subtitle}` : def.name) : p.cardId)
    const existing = group.rows.find(r => r.name === name && r.condition === line.condition && r.variant === m?.variant)
    if (existing) { existing.quantity += line.count; if (!existing.collectorNumbers.includes(p.collectorNumber)) existing.collectorNumbers.push(p.collectorNumber) }
    else group.rows.push({ name, collectorNumbers: [p.collectorNumber], quantity: line.count, condition: line.condition, ...(m?.variant ? { variant: m.variant } : {}) })
    group.copies += line.count
    groups.set(groupKey, group)
  }
  return [...groups.values()]
    .sort((a, b) => a.rank - b.rank || a.expansion.localeCompare(b.expansion))
    .map(g => ({ expansion: g.expansion, mapped: g.mapped, copies: g.copies, rows: g.rows.sort((a, b) => collectorOrder(a.collectorNumbers[0], b.collectorNumbers[0]) || a.name.localeCompare(b.name)) }))
}

const copies = (n: number) => `${n} ${n === 1 ? 'copy' : 'copies'}`

export function bulkListingText(groups: ExportGroup[], language: Language): string {
  return groups.map(g => [
    `## ${g.expansion}${g.mapped ? '' : ' ⚠ check expansion'} (${copies(g.copies)})`,
    ...g.rows.map(r => `${r.quantity}× ${r.name} · #${r.collectorNumbers.join('/#')}${r.variant ? ` · ${r.variant}` : ''} · ${r.condition} · ${language}`),
  ].join('\n')).join('\n\n')
}

function csvCell(value: string): string { return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value }

export function groupCsv(group: ExportGroup, language: Language): string {
  const rows = [['name', 'quantity', 'condition', 'language'], ...group.rows.map(r => [r.name, String(r.quantity), CONDITION_NAMES[r.condition], language])]
  return rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

export function csvFilename(group: ExportGroup, today = new Date()): string {
  const slug = group.expansion.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `cardmarket-sell-${today.toISOString().slice(0, 10)}-${group.mapped ? '' : 'CHECK-'}${slug}.csv`
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/ui/cardmarket-export.test.ts`
Expected: PASS. If the Adam Smasher name differs, check `db['adam-smasher-ender-of-legends'].subtitle` — the fixture map uses `subtitle: 'always'`.

- [ ] **Step 6: Commit**

```bash
git add data/cardmarket-expansions.json src/ui/cardmarketExport.ts tests/ui/cardmarket-export.test.ts
git commit -m "feat(collection): Cardmarket bulk-listing text and CSV export

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Sell mode screen

**Files:**
- Create: `src/ui/DeckChoice.tsx`
- Modify: `src/ui/PlanPurchasesMode.tsx:38-51`
- Create: `src/ui/SellMode.tsx`, `src/ui/SellList.tsx`
- Test: `tests/ui/sell-mode.test.tsx` (create); `tests/ui/plan-purchases-mode.test.tsx` (must pass unchanged)

**Interfaces:**
- Consumes: `surplusPlan`, `pendingSplit`, `SurplusRow` (Task 1); everything from `sellDraft.ts` (Task 2); `loadCardmarketMap`, `buildExportGroups`, `bulkListingText`, `groupCsv`, `csvFilename` (Task 3); `useDecks`, `buildDisplayNames` from `./storage`; `useCollection` from `./collection`; `downloadFile` from `./CollectionModeHeader`; `validateDeck`, `deckSize`, `cardIdentity`, `DeckList` from `../engine/deck`.
- Produces:
  - `DeckChips({ db, decks, selected, onSelected, idPrefix }: { db: CardDb; decks: DeckList[]; selected: string[]; onSelected: (names: string[]) => void; idPrefix: string })`
  - `DeckModeSeg({ mode, onMode, idPrefix }: { mode: DeckMode; onMode: (m: DeckMode) => void; idPrefix: string })`
  - `SellMode({ db, printings, known }: { db: CardDb; printings: Printing[]; known: boolean }): ReactElement` — root `data-testid="sell-mode"`
  - `SellList({ db, printings, known, surplusByIdentity }: { db: CardDb; printings: Printing[]; known: boolean; surplusByIdentity: Map<string, number> }): ReactElement`
  - Test ids: `sell-deck-<name>`, `sell-mode-shared`, `sell-mode-assembled`, `sell-keep-binder`, `sell-keep-playset`, `sell-total`, `sell-row` (with `data-card-id`), `sell-add-<cardId>`, `sell-add-all`, `sell-line-<key>`, `sell-line-check-<key>`, `sell-line-inc-<key>`, `sell-line-dec-<key>`, `sell-line-condition-<key>`, `sell-line-remove-<key>`, `sell-line-note-<key>`, `sell-default-condition`, `sell-default-language`, `sell-copy-text`, `sell-csv-<index>`, `sell-mark`, `sell-confirm`, `sell-confirm-ok`, `sell-confirm-cancel`, `sell-status`, `sell-error`.

- [ ] **Step 1: Write the failing tests**

Create `tests/ui/sell-mode.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { loadCardDb } from '../../src/engine/cardDb'
import { loadPrintings } from '../../src/ui/printings'
import { _resetCollectionCacheForTests, getCollection, setCount } from '../../src/ui/collection'
import { setCollectionAccess } from '../../src/ui/collectionAccess'
import { readCollectionJournal } from '../../src/ui/collectionJournal'
import { saveDeck } from '../../src/ui/storage'
import { _resetSellListForTests, getSellList } from '../../src/ui/sellDraft'
import { SellMode } from '../../src/ui/SellMode'

const db = loadCardDb(), printings = loadPrintings()
const legends: [string, string, string] = ['goro-takemura-hands-unclean', 'yorinobu-arasaka-embracing-destruction', 'saburo-arasaka-stubborn-patriarch']
const KEY = 'arasakademodeck/006'
beforeEach(() => {
  localStorage.clear(); _resetCollectionCacheForTests(); _resetSellListForTests(); setCollectionAccess('writer')
  saveDeck({ name: 'Keep A', demo: true, legends, cards: { 'industrial-assembly': 1 } })
  setCount(KEY, 3)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
const mount = () => render(<SellMode db={db} printings={printings} known />)
const surplusOf = (id: string) => screen.getAllByTestId('sell-row').find(r => r.getAttribute('data-card-id') === id)?.querySelectorAll('td')[4].textContent

describe('SellMode', () => {
  it('shrinks surplus as decks are chosen and remembers the choice', () => {
    mount()
    expect(surplusOf('industrial-assembly')).toBe('3')
    fireEvent.click(screen.getByLabelText('Keep A', { exact: true }))
    expect(surplusOf('industrial-assembly')).toBe('2')
    fireEvent.click(screen.getByTestId('sell-keep-playset'))
    expect(surplusOf('industrial-assembly')).toBeUndefined()
    cleanup(); mount()
    expect((screen.getByLabelText('Keep A', { exact: true }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByTestId('sell-keep-playset') as HTMLInputElement).checked).toBe(true)
  })
  it('drops a remembered deck that no longer exists', () => {
    localStorage.setItem('ctcg:sell:prefs:v1', JSON.stringify({ decks: ['Gone', 'Keep A'], mode: 'shared', keepBinderArt: false, keepPlayset: false }))
    mount()
    expect(surplusOf('industrial-assembly')).toBe('2')
    fireEvent.click(screen.getByTestId('sell-mode-assembled'))
    expect(JSON.parse(localStorage.getItem('ctcg:sell:prefs:v1')!).decks).toEqual(['Keep A'])
  })
  it('adds all surplus once, however often the button is pressed', () => {
    mount()
    fireEvent.click(screen.getByLabelText('Keep A', { exact: true }))
    fireEvent.click(screen.getByTestId('sell-add-all'))
    fireEvent.click(screen.getByTestId('sell-add-all'))
    expect(getSellList().lines).toEqual([{ key: KEY, count: 2 }])
    expect(screen.getByTestId(`sell-line-${KEY}`)).toBeTruthy()
  })
  it('flags lines that sell below what is kept', () => {
    mount()
    fireEvent.click(screen.getByLabelText('Keep A', { exact: true }))
    fireEvent.click(screen.getByTestId('sell-add-all'))
    fireEvent.click(screen.getByTestId(`sell-line-inc-${KEY}`))
    expect(screen.getByTestId(`sell-line-note-${KEY}`).textContent).toMatch(/below keep/)
  })
  it('shows a reduced line when fewer copies are owned than listed', () => {
    mount()
    fireEvent.click(screen.getByTestId('sell-add-all'))
    setCount(KEY, 1)
    return waitFor(() => expect(screen.getByTestId(`sell-line-note-${KEY}`).textContent).toMatch(/reduced: you now own 1/))
  })
  it('copies the bulk-listing text and downloads a CSV per expansion', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const createObjectURL = vi.fn(() => 'blob:x'); Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
    mount()
    fireEvent.click(screen.getByTestId('sell-add-all'))
    fireEvent.click(screen.getByTestId('sell-copy-text'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('3× Industrial Assembly · #006 · NM · English')))
    fireEvent.click(screen.getByTestId('sell-csv-0'))
    expect(createObjectURL).toHaveBeenCalledTimes(1)
  })
  it('marks checked lines sold after a confirm and journals a Sale', () => {
    mount()
    fireEvent.click(screen.getByLabelText('Keep A', { exact: true }))
    fireEvent.click(screen.getByTestId('sell-add-all'))
    fireEvent.click(screen.getByTestId(`sell-line-check-${KEY}`))
    fireEvent.click(screen.getByTestId('sell-mark'))
    expect(within(screen.getByTestId('sell-confirm')).getByText(/3 → 1/)).toBeTruthy()
    fireEvent.click(screen.getByTestId('sell-confirm-ok'))
    expect(getCollection().counts[KEY]).toBe(1)
    expect(getSellList().lines).toEqual([])
    expect(readCollectionJournal().entries.some(e => e.kind === 'Sale')).toBe(true)
    expect(screen.getByTestId('sell-status').textContent).toMatch(/2 copies sold/)
  })
  it('refuses the confirm when the collection changed meanwhile', () => {
    mount()
    fireEvent.click(screen.getByTestId('sell-add-all'))
    fireEvent.click(screen.getByTestId(`sell-line-check-${KEY}`))
    fireEvent.click(screen.getByTestId('sell-mark'))
    setCount('welcometonightcityretail/033', 1)
    fireEvent.click(screen.getByTestId('sell-confirm-ok'))
    expect(screen.getByTestId('sell-error').textContent).toMatch(/Collection changed/)
    expect(getSellList().lines).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/ui/sell-mode.test.tsx`
Expected: FAIL — cannot resolve `../../src/ui/SellMode`.

- [ ] **Step 3: Create `src/ui/DeckChoice.tsx` and use it in Plan purchases**

`src/ui/DeckChoice.tsx`:

```tsx
//
// The "which decks, shared or kept" controls Plan purchases and Sell share.
// `idPrefix` keeps each mode's test ids (`acquisition-…`, `sell-…`) distinct.
import type { ReactElement } from 'react'
import type { CardDb } from '../engine/types'
import { deckSize, validateDeck, type DeckList } from '../engine/deck'
import type { DeckMode } from './acquisitionPlan'

export function DeckChips({ db, decks, selected, onSelected, idPrefix }: { db: CardDb; decks: DeckList[]; selected: string[]; onSelected: (names: string[]) => void; idPrefix: string }): ReactElement {
  return (
    <div className="tool-actions">
      {decks.length === 0 && <span className="tool-note">No saved decks yet.</span>}
      {decks.map(d => { const errors = validateDeck(db, d).length; return (
        <label key={d.name} className={`check-chip deckchip${selected.includes(d.name) ? ' deckchip--on' : ''}`}>
          <input type="checkbox" aria-label={d.name} data-testid={`${idPrefix}-deck-${d.name}`} checked={selected.includes(d.name)} onChange={e => onSelected(e.target.checked ? [...selected, d.name] : selected.filter(n => n !== d.name))} />
          {d.name}<span className={`deckchip__st${errors ? ' deckchip__st--bad' : ''}`}>{errors ? `${errors} error${errors === 1 ? '' : 's'}` : `${deckSize(d)} cards`}</span>
        </label>) })}
    </div>
  )
}

export function DeckModeSeg({ mode, onMode, idPrefix }: { mode: DeckMode; onMode: (m: DeckMode) => void; idPrefix: string }): ReactElement {
  return (
    <div className="field"><span className="field__label">Cards are</span><div className="seg">
      <button type="button" data-testid={`${idPrefix}-mode-shared`} aria-pressed={mode === 'shared'} onClick={() => onMode('shared')}>Shared between decks</button>
      <button type="button" data-testid={`${idPrefix}-mode-assembled`} aria-pressed={mode === 'assembled'} onClick={() => onMode('assembled')}>Kept in every deck</button>
    </div></div>
  )
}
```

In `src/ui/PlanPurchasesMode.tsx`, replace the chips `<div className="tool-actions">…</div>` (lines 38–45) with:

```tsx
          <DeckChips db={db} decks={decks} selected={selected} onSelected={setSelected} idPrefix="acquisition" />
```

and replace the `<div className="field">…</div>` seg (lines 47–50, inside the second `tool-actions`) with:

```tsx
            <DeckModeSeg mode={mode} onMode={setMode} idPrefix="acquisition" />
```

Add `import { DeckChips, DeckModeSeg } from './DeckChoice'`, and drop `deckSize` from the `../engine/deck` import (keep `validateDeck`, still used for the warnings). Change `useState<'shared' | 'assembled'>` to `useState<DeckMode>` with `import type { DeckMode } from './acquisitionPlan'`.

Run: `npx vitest run tests/ui/plan-purchases-mode.test.tsx`
Expected: PASS, unchanged.

- [ ] **Step 4: Create `src/ui/SellMode.tsx`**

```tsx
//
// Sell: choose what to keep (decks, a binder copy of each artwork, a
// playset), see every card with copies beyond that, and move copies onto the
// sell list. The arithmetic is surplus.ts; the list, exports and Mark sold
// are SellList.tsx.
import { useMemo, useState, type ReactElement } from 'react'
import { z } from 'zod'
import type { CardDb } from '../engine/types'
import { cardIdentity, validateDeck } from '../engine/deck'
import type { Printing } from './printings'
import type { DeckMode } from './acquisitionPlan'
import { pendingSplit, surplusPlan, type SurplusRow } from './surplus'
import { addToSellList, useSellList } from './sellDraft'
import { useCollection } from './collection'
import { buildDisplayNames, useDecks } from './storage'
import { DeckChips, DeckModeSeg } from './DeckChoice'
import { SellList } from './SellList'

const PREFS_KEY = 'ctcg:sell:prefs:v1'
interface SellPrefs { decks: string[]; mode: DeckMode; keepBinderArt: boolean; keepPlayset: boolean }
const prefsSchema = z.object({ decks: z.array(z.string()), mode: z.enum(['shared', 'assembled']), keepBinderArt: z.boolean(), keepPlayset: z.boolean() })
function readPrefs(): SellPrefs {
  try { const parsed = prefsSchema.safeParse(JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null')); if (parsed.success) return parsed.data } catch { /* per-browser convenience only */ }
  return { decks: [], mode: 'shared', keepBinderArt: false, keepPlayset: false }
}

export function SellMode({ db, printings, known }: { db: CardDb; printings: Printing[]; known: boolean }): ReactElement {
  const decks = useDecks()
  const collection = useCollection()
  const list = useSellList()
  const names = useMemo(() => buildDisplayNames(db), [db])
  const byKey = useMemo(() => new Map(printings.map(p => [p.key, p])), [printings])
  const [prefs, setPrefsState] = useState(readPrefs)
  const setPrefs = (patch: Partial<SellPrefs>) => {
    // Deck names that no longer exist are dropped the first time anything is saved.
    const next = { ...prefs, ...patch, decks: (patch.decks ?? prefs.decks).filter(n => decks.some(d => d.name === n)) }
    setPrefsState(next)
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)) } catch { /* per-browser convenience only */ }
  }
  const chosen = useMemo(() => decks.filter(d => prefs.decks.includes(d.name)), [decks, prefs.decks])
  const all = useMemo(() => surplusPlan(db, chosen, printings, collection.counts, prefs), [db, chosen, printings, collection, prefs])
  const rows = all.filter(r => r.surplus > 0)
  const surplusByIdentity = useMemo(() => new Map(all.map(r => [r.identity, r.surplus])), [all])
  const identityOf = (key: string) => { const p = byKey.get(key); return p ? (db[p.cardId] ? cardIdentity(db[p.cardId]) : p.cardId) : key }
  const listed: Record<string, number> = {}
  for (const l of list.lines) listed[l.key] = Math.min(l.count, collection.counts[l.key] ?? 0)
  const listedFor = (identity: string) => list.lines.filter(l => identityOf(l.key) === identity).reduce((n, l) => n + (listed[l.key] ?? 0), 0)
  const [want, setWant] = useState<Record<string, number>>({})
  const open = (r: SurplusRow) => Math.max(0, r.surplus - listedFor(r.identity))
  const where = (key: string) => { const p = byKey.get(key); return p ? `${p.setName} ${p.collectorNumber}` : key }

  return (
    <div className="plan" data-testid="sell-mode">
      <section className="card">
        <h3>Keep for <span className="card__meta">everything beyond this is surplus</span></h3>
        <div className="card__in">
          <DeckChips db={db} decks={decks} selected={prefs.decks} onSelected={d => setPrefs({ decks: d })} idPrefix="sell" />
          <div className="tool-actions">
            <DeckModeSeg mode={prefs.mode} onMode={m => setPrefs({ mode: m })} idPrefix="sell" />
            <label className="check-chip"><input type="checkbox" data-testid="sell-keep-binder" checked={prefs.keepBinderArt} onChange={e => setPrefs({ keepBinderArt: e.target.checked })} />One of each artwork in the binder</label>
            <label className="check-chip"><input type="checkbox" data-testid="sell-keep-playset" checked={prefs.keepPlayset} onChange={e => setPrefs({ keepPlayset: e.target.checked })} />A full playset</label>
          </div>
          <p className="tool-note">Keep is the larger of deck need plus binder copies, and a playset. Deck copies count toward the playset.</p>
          {chosen.filter(d => validateDeck(db, d).length > 0).map(d => <p key={d.name} className="tool-error">{d.name} has deck validation errors; its cards are still kept.</p>)}
          {!known ? <p className="tool-note">Ownership unavailable — load the collection before planning sales.</p> : (
            <>
              <div className="tool-actions">
                <p className="tool-figure" data-testid="sell-total">{rows.reduce((n, r) => n + r.surplus, 0)} surplus copies · {rows.length} cards</p>
                <button type="button" className="btn--primary" data-testid="sell-add-all" disabled={rows.every(r => open(r) === 0)} onClick={() => addToSellList(rows.flatMap(r => pendingSplit(r.split, listed, open(r))))}>Add all surplus</button>
              </div>
              <div className="tool-table-wrap"><table className="data-table">
                <thead><tr><th>Card</th><th className="num">Own</th><th className="num">Keep</th><th className="num">Listed</th><th className="num">Surplus</th><th>Suggested split</th><th>Add</th></tr></thead>
                <tbody>{rows.map(r => { const n = Math.min(want[r.identity] ?? open(r), open(r)); return (
                  <tr key={r.identity} data-testid="sell-row" data-card-id={r.id}>
                    <td className="session-name">{names.get(r.id) ?? r.id}</td><td className="num">{r.owned}</td><td className="num">{r.keep}</td><td className="num">{listedFor(r.identity)}</td><td className="num">{r.surplus}</td>
                    <td className="tool-note">{r.split.map(s => `${s.count}× ${where(s.key)}`).join(', ')}</td>
                    <td><span className="collection-view__stepper">
                      <button type="button" disabled={n <= 1} onClick={() => setWant(w => ({ ...w, [r.identity]: n - 1 }))}>−</button>
                      <span>{n}</span>
                      <button type="button" disabled={n >= open(r)} onClick={() => setWant(w => ({ ...w, [r.identity]: n + 1 }))}>+</button>
                      <button type="button" data-testid={`sell-add-${r.id}`} disabled={n === 0} onClick={() => { addToSellList(pendingSplit(r.split, listed, n)); setWant(w => { const next = { ...w }; delete next[r.identity]; return next }) }}>Add</button>
                    </span></td>
                  </tr>) })}</tbody>
              </table></div>
            </>
          )}
        </div>
      </section>
      <div className="plan__side">
        <SellList db={db} printings={printings} known={known} surplusByIdentity={surplusByIdentity} />
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Create `src/ui/SellList.tsx`**

```tsx
//
// The sell list card: defaults, one line per printing, the two Cardmarket
// exports, and Mark sold (an inline confirm, then one Sale write).
import { useMemo, useState, type ReactElement } from 'react'
import type { CardDb } from '../engine/types'
import { cardIdentity } from '../engine/deck'
import type { Printing } from './printings'
import { useCollection } from './collection'
import { buildDisplayNames } from './storage'
import { downloadFile } from './CollectionModeHeader'
import { buildExportGroups, bulkListingText, csvFilename, groupCsv, loadCardmarketMap } from './cardmarketExport'
import {
  CONDITIONS, LANGUAGES, effectiveLines, getSellListStorageError, markSold, removeSellLine, saleCounts,
  setLineCondition, setSellCount, setSellDefaults, useSellList, type Condition, type Language,
} from './sellDraft'

export function SellList({ db, printings, known, surplusByIdentity }: { db: CardDb; printings: Printing[]; known: boolean; surplusByIdentity: Map<string, number> }): ReactElement {
  const list = useSellList()
  const collection = useCollection()
  const names = useMemo(() => buildDisplayNames(db), [db])
  const byKey = useMemo(() => new Map(printings.map(p => [p.key, p])), [printings])
  const map = useMemo(() => { try { return { map: loadCardmarketMap(), error: '' } } catch (err) { return { map: undefined, error: String(err) } } }, [])
  const lines = effectiveLines(list, collection.counts)
  const groups = map.map ? buildExportGroups(lines, printings, db, map.map) : []
  const [checked, setChecked] = useState<string[]>([])
  const [confirm, setConfirm] = useState<Record<string, number> | null>(null)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const identityOf = (key: string) => { const p = byKey.get(key); return p ? (db[p.cardId] ? cardIdentity(db[p.cardId]) : p.cardId) : key }
  const listedByIdentity = new Map<string, number>()
  for (const l of lines) listedByIdentity.set(identityOf(l.key), (listedByIdentity.get(identityOf(l.key)) ?? 0) + l.count)
  const selected = lines.filter(l => checked.includes(l.key))
  const selectedCopies = selected.reduce((n, l) => n + l.count, 0)
  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => setStatus({ kind: 'ok', text: `Copied the bulk-listing text ${new Date().toLocaleTimeString()}` })).catch(err => setStatus({ kind: 'error', text: `Could not copy to clipboard: ${err instanceof Error ? err.message : String(err)}` }))
  const sell = () => {
    try { markSold(selected.map(l => l.key), confirm!); setStatus({ kind: 'ok', text: `Marked ${selectedCopies} ${selectedCopies === 1 ? 'copy' : 'copies'} sold.` }); setChecked([]) }
    catch (err) { setStatus({ kind: 'error', text: err instanceof Error ? err.message : String(err) }) }
    setConfirm(null)
  }
  const unmapped = groups.filter(g => !g.mapped).map(g => g.expansion)
  const storageError = getSellListStorageError()

  return (
    <section className="card" data-testid="sell-list">
      <h3>Sell list <span className="card__meta">{lines.length} printings · {lines.reduce((n, l) => n + l.count, 0)} copies</span></h3>
      <div className="card__in">
        {storageError && <p className="tool-error">{storageError}</p>}
        <div className="tool-actions">
          <label className="field"><span className="field__label">Condition</span><select data-testid="sell-default-condition" value={list.condition} onChange={e => setSellDefaults({ condition: e.target.value as Condition })}>{CONDITIONS.map(c => <option key={c}>{c}</option>)}</select></label>
          <label className="field"><span className="field__label">Language</span><select data-testid="sell-default-language" value={list.language} onChange={e => setSellDefaults({ language: e.target.value as Language })}>{LANGUAGES.map(l => <option key={l}>{l}</option>)}</select></label>
        </div>
        {lines.length === 0 ? <p className="tool-note">Add surplus copies, or use Sell +1 in a card's drawer.</p> : (
          <div className="tool-table-wrap"><table className="data-table">
            <tbody>{lines.map(l => {
              const p = byKey.get(l.key)
              const below = p !== undefined && (listedByIdentity.get(identityOf(l.key)) ?? 0) > (surplusByIdentity.get(identityOf(l.key)) ?? 0)
              const note = [!p && 'unknown printing', l.count < l.requested && `reduced: you now own ${l.count}`, below && 'below keep'].filter(Boolean).join(' · ')
              return (
                <tr key={l.key} data-testid={`sell-line-${l.key}`}>
                  <td><input type="checkbox" aria-label={`Select ${p ? names.get(p.cardId) ?? p.cardId : l.key}`} data-testid={`sell-line-check-${l.key}`} checked={checked.includes(l.key)} onChange={e => setChecked(c => e.target.checked ? [...c, l.key] : c.filter(k => k !== l.key))} /></td>
                  <td className="session-name">{p ? names.get(p.cardId) ?? p.cardId : l.key}{note && <span className="tool-note" data-testid={`sell-line-note-${l.key}`}> · {note}</span>}</td>
                  <td className="tool-note">{p ? `${p.setName} ${p.collectorNumber}` : ''}</td>
                  <td><span className="collection-view__stepper">
                    <button type="button" data-testid={`sell-line-dec-${l.key}`} disabled={l.requested <= 1} onClick={() => setSellCount(l.key, l.requested - 1)}>−</button>
                    <span>{l.count}</span>
                    <button type="button" data-testid={`sell-line-inc-${l.key}`} disabled={l.requested >= (collection.counts[l.key] ?? 0)} onClick={() => setSellCount(l.key, l.requested + 1)}>+</button>
                  </span></td>
                  <td><select data-testid={`sell-line-condition-${l.key}`} aria-label="Condition" value={list.lines.find(x => x.key === l.key)?.condition ?? ''} onChange={e => setLineCondition(l.key, (e.target.value || undefined) as Condition | undefined)}><option value="">{list.condition} (default)</option>{CONDITIONS.map(c => <option key={c}>{c}</option>)}</select></td>
                  <td><button type="button" className="session-x" data-testid={`sell-line-remove-${l.key}`} aria-label="Remove" onClick={() => removeSellLine(l.key)}>✕</button></td>
                </tr>) })}</tbody>
          </table></div>
        )}
        {map.error && <p className="tool-error">Cardmarket expansion map is invalid: {map.error}</p>}
        {unmapped.length > 0 && <p className="tool-error">No Cardmarket expansion recorded for {unmapped.join(', ')} — check these before listing.</p>}
        <div className="tool-actions">
          <button type="button" className="btn--primary" data-testid="sell-copy-text" disabled={groups.length === 0} onClick={() => copy(bulkListingText(groups, list.language))}>Copy for bulk listing</button>
          {groups.map((g, i) => <button type="button" key={g.expansion} data-testid={`sell-csv-${i}`} onClick={() => downloadFile(csvFilename(g), groupCsv(g, list.language), 'text/csv')}>CSV · {g.expansion}</button>)}
        </div>
        <p className="tool-note">One CSV per Cardmarket expansion, for the Cardmarket Bulk Import extension on that expansion's bulk listing page. Prices are set on Cardmarket.</p>
        <div className="tool-actions">
          <button type="button" data-testid="sell-mark" disabled={!known || selectedCopies === 0} onClick={() => { setStatus(null); setConfirm({ ...collection.counts }) }}>Mark {selectedCopies} sold…</button>
        </div>
        {confirm && (
          <div className="tool-panel" data-testid="sell-confirm">
            <table className="data-table"><tbody>{selected.map(l => { const after = saleCounts([l.key], confirm)[l.key]; return <tr key={l.key}><td className="session-name">{byKey.get(l.key) ? names.get(byKey.get(l.key)!.cardId) : l.key}</td><td className="tool-note">{byKey.get(l.key)?.setName} {byKey.get(l.key)?.collectorNumber}</td><td className="num">{confirm[l.key] ?? 0} → {after}</td></tr> })}</tbody></table>
            <div className="tool-actions">
              <button type="button" className="btn--danger" data-testid="sell-confirm-ok" onClick={sell}>Remove {selectedCopies} {selectedCopies === 1 ? 'copy' : 'copies'} from the collection</button>
              <button type="button" className="btn--ghost" data-testid="sell-confirm-cancel" onClick={() => setConfirm(null)}>Cancel</button>
            </div>
          </div>
        )}
        {status && <p className={status.kind === 'error' ? 'tool-error' : 'tool-status'} role="status" data-testid={status.kind === 'error' ? 'sell-error' : 'sell-status'}>{status.text}</p>}
      </div>
    </section>
  )
}
```

The status text for the Mark sold test is `Marked 2 copies sold.` — the test matches `/2 copies sold/`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/ui/sell-mode.test.tsx tests/ui/plan-purchases-mode.test.tsx`
Expected: PASS. Two things to check if a test fails:
- **The "reduced" test:** `setCount` outside React must re-render through `useCollection`. `waitFor` covers that.
- **The Mark sold refusal test:** it changes a different printing after the confirm opens, and `sameCounts` compares every key.

- [ ] **Step 7: Commit**

```bash
git add src/ui/DeckChoice.tsx src/ui/PlanPurchasesMode.tsx src/ui/SellMode.tsx src/ui/SellList.tsx tests/ui/sell-mode.test.tsx
git commit -m "feat(collection): Sell mode with surplus table, sell list and exports

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Wire Sell into the Collection tab and the card drawer

**Files:**
- Modify: `src/ui/CollectionModeHeader.tsx:15-18,43-48`
- Modify: `src/ui/CollectionView.tsx:17-20,62-66`
- Modify: `src/ui/CardDrawer.tsx:16,73-77`
- Modify: `src/ui/styles/collection.css` (after line 240)
- Test: `tests/ui/collection-mode-header.test.tsx`, `tests/ui/card-drawer.test.tsx` (extend)

**Interfaces:**
- Consumes: `SellMode` (Task 4), `useSellList`, `addToSellList`, `getSellList`, `_resetSellListForTests` (Task 2).
- Produces: `CollectionMode = 'browse' | 'add' | 'plan' | 'sell' | 'history'`; test ids `collection-mode-sell`, `printing-sell-<key>`.

- [ ] **Step 1: Write the failing tests**

Change the `mount` signature in `tests/ui/collection-mode-header.test.tsx` line 16 to accept `'sell'`:

```tsx
function mount(mode: 'browse' | 'add' | 'plan' | 'sell' | 'history' = 'browse', onMode = vi.fn()) {
```

and append inside its `describe`. Add `_resetSellListForTests` and `addToSellList` from `../../src/ui/sellDraft` to the imports, and call `_resetSellListForTests()` in that file's `beforeEach`:

```tsx
  it('offers a Sell mode after Plan purchases with a badge for listed printings', () => {
    addToSellList([{ key: 'arasakademodeck/006', count: 2 }, { key: 'welcometonightcityretail/033', count: 1 }])
    const onMode = vi.fn()
    mount('browse', onMode)
    const labels = screen.getAllByRole('button').map(b => b.getAttribute('data-testid')).filter(id => id?.startsWith('collection-mode-'))
    expect(labels).toEqual(['collection-mode-browse', 'collection-mode-add', 'collection-mode-plan', 'collection-mode-sell', 'collection-mode-history'])
    expect(screen.getByTestId('collection-mode-sell').textContent).toBe('Sell2')
    fireEvent.click(screen.getByTestId('collection-mode-sell'))
    expect(onMode).toHaveBeenCalledWith('sell')
  })
```

In `tests/ui/card-drawer.test.tsx`, add `import { _resetSellListForTests, getSellList } from '../../src/ui/sellDraft'`, extend its `beforeEach` to `beforeEach(() => { localStorage.clear(); _resetCollectionCacheForTests(); _resetSellListForTests() })`, and append inside `describe('CardDrawer', …)` (the file's `mount()` renders `industrial-assembly` with `collection={getCollection()}` and `known`):

```tsx
  it('adds one copy of a printing to the sell list, only when one is owned', () => {
    setCount('arasakademodeck/006', 2)
    mount()
    expect((screen.getByTestId('printing-sell-welcometonightcityretail/033') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByTestId('printing-sell-arasakademodeck/006'))
    fireEvent.click(screen.getByTestId('printing-sell-arasakademodeck/006'))
    expect(getSellList().lines).toEqual([{ key: 'arasakademodeck/006', count: 2 }])
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/ui/collection-mode-header.test.tsx tests/ui/card-drawer.test.tsx`
Expected: FAIL — no `collection-mode-sell`, no `printing-sell-…`.

- [ ] **Step 3: Implement the header, view and drawer changes**

`src/ui/CollectionModeHeader.tsx`:

```tsx
export type CollectionMode = 'browse' | 'add' | 'plan' | 'sell' | 'history'
const MODES: { id: CollectionMode; label: string }[] = [
  { id: 'browse', label: 'Browse' }, { id: 'add', label: 'Add cards' }, { id: 'plan', label: 'Plan purchases' }, { id: 'sell', label: 'Sell' }, { id: 'history', label: 'History & backup' },
]
```

Add `import { useSellList } from './sellDraft'`, and in the component body `const sellLines = useSellList().lines.length`. In the mode button, after the history badge, add:

```tsx
{m.id === 'sell' && sellLines > 0 && <span className="colhead__count">{sellLines}</span>}
```

Also update the file header comment ("which of the four modes" → "which of the five modes").

`src/ui/CollectionView.tsx`: add `import { SellMode } from './SellMode'`; set `const MODES: CollectionMode[] = ['browse', 'add', 'plan', 'sell', 'history']`; add after the plan mode line:

```tsx
        <div hidden={mode !== 'sell'}>{visited.has('sell') && <SellMode db={db} printings={loadResult.printings} known={known} />}</div>
```

and change "the four mode screens" in the header comment to "the five mode screens".

`src/ui/CardDrawer.tsx`: add `import { addToSellList } from './sellDraft'`. Wrap the stepper so the row keeps its three grid columns:

```tsx
                  <span className="prow__act">
                    <span className="collection-view__stepper">
                      <button type="button" data-testid={`printing-dec-${p.key}`} disabled={!known || count === 0} onClick={() => adjustCount(p.key, -1)}>−</button>
                      <PrintingCount printingKey={p.key} count={count} known={known} />
                      <button type="button" data-testid={`printing-inc-${p.key}`} disabled={!known} onClick={() => adjustCount(p.key, 1)}>+</button>
                    </span>
                    <button type="button" className="btn--ghost" data-testid={`printing-sell-${p.key}`} disabled={!known || count === 0} title="Add one copy to the sell list" onClick={() => addToSellList([{ key: p.key, count: 1 }])}>Sell +1</button>
                  </span>
```

`src/ui/styles/collection.css`, after the `.prow__meta > span` rule:

```css
.prow__act { display: flex; align-items: center; gap: 6px; }
```

- [ ] **Step 4: Run the collection UI tests**

Run: `npx vitest run tests/ui`
Expected: PASS. `collectionview.test.tsx` and the other mode tests must not need changes. If one counts mode buttons, update the expected count to 5 and say so in the commit message.

- [ ] **Step 5: Commit**

```bash
git add src/ui/CollectionModeHeader.tsx src/ui/CollectionView.tsx src/ui/CardDrawer.tsx src/ui/styles/collection.css tests/ui/collection-mode-header.test.tsx tests/ui/card-drawer.test.tsx
git commit -m "feat(collection): Sell mode tab and drawer Sell +1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: End-to-end workflow and docs

**Files:**
- Create: `e2e/collection-sell.spec.ts`
- Create: `docs/selling-surplus.md`

**Interfaces:**
- Consumes: the test ids from Tasks 4–5; `e2e/fixtures.ts` (its `test` isolates the collection file automatically).

- [ ] **Step 1: Write the E2E spec**

`e2e/collection-sell.spec.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { test, expect } from './fixtures'
const starter = { demo: true, legends: ['goro-takemura-hands-unclean', 'yorinobu-arasaka-embracing-destruction', 'saburo-arasaka-stubborn-patriarch'] }
const KEY = 'arasakademodeck/006'

test('lists surplus against a kept deck, exports a CSV and records the sale', async ({ page }) => {
  await page.addInitScript(({ starter }) => localStorage.setItem('ctcg:decks:v1', JSON.stringify({
    'Keep A': { ...starter, name: 'Keep A', cards: { 'industrial-assembly': 1 } },
  })), { starter })
  await page.goto('/')
  await page.getByTestId('tab-collection').click()
  await expect(page.getByTestId('sync-status')).toContainText('Saved to disk')
  await page.getByTestId('expand-industrial-assembly').click()
  for (let i = 0; i < 3; i++) await page.getByTestId(`printing-inc-${KEY}`).click()
  await page.getByTestId('collection-mode-sell').click()
  const sell = page.getByTestId('sell-mode')
  await sell.getByLabel('Keep A', { exact: true }).check()
  const row = sell.locator('[data-testid="sell-row"][data-card-id="industrial-assembly"]')
  await expect(row.locator('td').nth(4)).toHaveText('2')
  await page.getByTestId('sell-add-all').click()
  await expect(page.getByTestId('collection-mode-sell')).toContainText('1')
  const download = page.waitForEvent('download')
  await page.getByTestId('sell-csv-0').click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^cardmarket-sell-\d{4}-\d{2}-\d{2}-.+\.csv$/)
  const csv = await readFile((await file.path())!, 'utf8')
  expect(csv).toContain('name,quantity,condition,language')
  expect(csv).toContain('Industrial Assembly,2,Near Mint,English')
  await page.getByTestId(`sell-line-check-${KEY}`).check()
  await page.getByTestId('sell-mark').click()
  await expect(page.getByTestId('sell-confirm')).toContainText('3 → 1')
  await page.getByTestId('sell-confirm-ok').click()
  await expect(page.getByTestId('sell-status')).toContainText('2 copies sold')
  await expect(row).toHaveCount(0)
  await page.getByTestId('collection-mode-history').click()
  await expect(page.getByTestId('collection-history-entry').first()).toContainText('Sale')
})
```

- [ ] **Step 2: Run it**

Run (Git Bash): `CTCG_E2E_PORT=5177 npx playwright test e2e/collection-sell.spec.ts`
Expected: PASS. If `expand-industrial-assembly` is not visible, the Browse grid may need the same setup `e2e/acquisition-plan.spec.ts` uses. That spec passes with exactly these steps, so compare the two before changing anything. If the History entry shows a different label, read `src/ui/HistoryBackupMode.tsx:65-75` for how `kind` is rendered and match that. Don't change the journal kind.

- [ ] **Step 3: Write `docs/selling-surplus.md`**

```markdown
# Selling surplus

Collection → **Sell** lists every card you own more copies of than you keep,
and builds a list to put up on Cardmarket.

## What is kept

For each card (all printings of the same name and subtitle together):

keep = the larger of (copies the ticked decks need + one binder copy per
artwork you hold) and (a playset, if ticked) — never more than you own.

- **Shared between decks** keeps the most any one deck needs; **Kept in every
  deck** adds them up — the same choice as Plan purchases.
- Deck copies count toward the playset, so ticking both does not double up.
- Surplus = owned − keep.

## Which printings are suggested

One binder copy per artwork is never suggested, preferring a collection-only
printing (promos) for that copy. Copies are then suggested from the printing
you hold the most of, retail before beta on a tie, and collection-only
printings last. A deck's last playable copies are never suggested.
You can change any line on the sell list.

## Exporting

- **Copy for bulk listing**: text grouped by Cardmarket expansion, in
  collector-number order, to follow on each expansion's bulk listing page.
- **CSV · <expansion>**: one file per expansion for the
  [Cardmarket Bulk Import](https://github.com/PedroPerpetua/cardmarket-bulk-import/)
  extension (columns `name,quantity,condition,language`). Open that
  expansion's bulk listing page, import the file, check the rows, set prices.

Nothing changes in the collection until you tick the sold lines and confirm
**Mark sold**, which removes those copies in one save and records a *Sale*
in History (undo it there if needed).

## The expansion map

`data/cardmarket-expansions.json` maps our set codes to Cardmarket expansion
names:

- `expansions`: `setCode → { expansion, variant? }`. A set without an entry
  exports under its own name with a "⚠ check expansion" marker, and its CSV
  filename contains `CHECK`.
- `subtitle` (`always` | `when-shared`) and `separator` control how names are
  written.
- `names`: `printingKey → exact Cardmarket name` for the exceptions, such as
  Cardmarket's own version suffixes.

After Cardmarket adds a set, add its entry and run
`npx vitest run tests/ui/cardmarket-export.test.ts`.
```

- [ ] **Step 4: Full verification**

Run: `npm test` then `npm run build`
Expected: both succeed with no new failures. `tests/ai/heuristic.test.ts` is known to time out at 5s under load; if that's the only failure, rerun it alone and note it.

- [ ] **Step 5: Commit**

```bash
git add e2e/collection-sell.spec.ts docs/selling-surplus.md
git commit -m "test(e2e): sell surplus workflow; docs: selling surplus

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Fill the Cardmarket expansion map (controller task, needs the user)

This task needs Cardmarket's real names, and Cardmarket blocks automated fetches (HTTP 403). The **controller session** does it, not a subagent. Ask Marcus first: either use his logged-in Chrome, read-only, or he pastes the names in. Never submit a form or list anything on Cardmarket.

**Files:**
- Modify: `data/cardmarket-expansions.json`
- Test: `tests/ui/cardmarket-export.test.ts` (extend)

- [ ] **Step 1: Ask for the go-ahead**

Ask: "To fill the expansion map I need Cardmarket's Cyberpunk expansion names and one bulk-listing page. Can I read them in your logged-in Chrome (read-only, nothing gets listed), or would you rather paste them?"

- [ ] **Step 2: Collect the facts**

From `https://www.cardmarket.com/en/Cyberpunk` (expansion list) and the bulk listing page of the main set (**Welcome to Night City**, or whatever Cardmarket calls it), record:
1. The Cardmarket expansion name for each of our 13 set codes. Print ours with `node -e "const p=require('./data/printings.json');console.log([...new Set(p.map(x=>x.setCode+' | '+x.setName))].join('\n'))"`. Note sets Cardmarket does not carry.
2. Whether Beta and Retail are separate expansions or one expansion with a version/variant marker.
3. How the form writes a card with a subtitle (e.g. `Adam Smasher - Ender of Legends` vs `Adam Smasher`), which sets `subtitle` and `separator`.
4. How it tells apart two printings in one set (e.g. `v-streetkid` β005a/β005b), which gives the `names` overrides.
5. The form's row order (collector number or alphabetical). If alphabetical, change `buildExportGroups`' row sort to `a.name.localeCompare(b.name)` and update the first test's expected order in the same commit.

- [ ] **Step 3: Write the map and pin it**

Fill `data/cardmarket-expansions.json` with the collected values, listing `expansions` in Cardmarket's own set order. Only list sets Cardmarket carries. Add to the `the shipped map` describe block in `tests/ui/cardmarket-export.test.ts`:

```ts
  it('maps every set Cardmarket carries', () => {
    const shipped = loadCardmarketMap()
    // Sets Cardmarket does not list (recorded in Task 7); everything else must be mapped.
    const notOnCardmarket: string[] = [/* e.g. 'edgerunneropens1', filled from Step 2 */]
    const codes = [...new Set(printings.map(p => p.setCode))].filter(c => !notOnCardmarket.includes(c))
    expect(codes.filter(c => !shipped.expansions[c])).toEqual([])
  })
```

Replace the comment in `notOnCardmarket` with the actual list, which may be empty.

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/ui/cardmarket-export.test.ts && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add data/cardmarket-expansions.json tests/ui/cardmarket-export.test.ts
git commit -m "data(collection): Cardmarket expansion map for Cyberpunk sets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
