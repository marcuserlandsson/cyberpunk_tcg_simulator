# Collection Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track owned cards per printing (alt arts separately), surface playset gaps and missing arts, with fast pack-cracking entry, backup/export, and lightweight Deck Builder integration.

**Architecture:** A generated `data/printings.json` (one row per printing, fetched from the netdeck.gg API) joins against the existing `data/cards.json` by card id. The collection itself is a flat `printingKey -> count` map in localStorage, with pure derived queries for gaps/goals and a `useSyncExternalStore`-based hook for live UI updates. A new Collection tab hosts the grid + quick-add UI; the Deck Builder gets an owned badge and a missing-cards summary.

**Tech Stack:** React 19, TypeScript, zod 4, Vitest (+ Testing Library, jsdom), Playwright, tsx for scripts.

**Spec:** `docs/superpowers/specs/2026-09-04-collection-tracker-design.md`

## Global Constraints

- `data/cards.json` and engine types (`src/engine/types.ts`) are NOT modified by any task.
- Printing key format is `"<setCode>/<collectorNumber>"` verbatim (e.g. `"welcometonightcitybeta/β025"`); collector numbers keep their `β` prefix.
- `rarity` and `finish` stay open strings (never enums).
- localStorage key: `ctcg:collection:v1`; zero counts pruned on write; unknown printing keys preserved, never dropped.
- Playset target: 3 per card, 1 for legends (`def.type === 'legend'`).
- API etiquette (matches `scripts/fetch-images.mjs`): sequential requests, 500 ms delay, User-Agent `Mozilla/5.0 (cyberpunk-tcg-simulator fetch-printings.ts; personal playtesting tool)`; download the signed `image_url`, never `source_image_url` (403s).
- All new UI test ids use kebab-case `data-testid` attributes like the existing components.
- Follow existing code style: comment density and file-header comments as in `src/ui/storage.ts`, tests as in `tests/ui/storage.test.ts` (`// @vitest-environment jsdom`, `localStorage.clear()` in `beforeEach`).
- Run tests with `npx vitest run <file>` from the repo root.

---

### Task 1: Printing types, zod schema, parse + index helpers

**Files:**
- Create: `src/ui/printings.ts`
- Test: `tests/ui/printings.test.ts`

**Interfaces:**
- Consumes: nothing (pure module; no static JSON import yet — that is Task 3).
- Produces (later tasks rely on these exact names):
  - `interface Printing { key: string; cardId: string; setCode: string; setName: string; collectorNumber: string; rarity: string; finish: string | null; artist: string; sourcePrintingId: string }`
  - `parsePrintings(raw: unknown): Printing[]` — zod-validates, throws `Error` with a readable message on malformed input or duplicate keys.
  - `printingsByCard(printings: Printing[]): Map<string, Printing[]>`
  - `getPrinting(printings: Printing[], key: string): Printing | undefined`
  - `listSets(printings: Printing[]): { code: string; name: string }[]` — unique, in first-appearance order.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/ui/printings.test.ts
import { describe, expect, it } from 'vitest'
import {
  parsePrintings,
  printingsByCard,
  getPrinting,
  listSets,
  type Printing,
} from '../../src/ui/printings'

const row = (over: Partial<Printing> = {}): Printing => ({
  key: 'welcometonightcitybeta/β025',
  cardId: 'mantis-blades',
  setCode: 'welcometonightcitybeta',
  setName: 'Welcome to Night City — Beta',
  collectorNumber: 'β025',
  rarity: 'Common',
  finish: null,
  artist: 'Ricardo Padierne Silvera',
  sourcePrintingId: '84278f23-7323-47d2-b639-23edd76f87ae',
  ...over,
})

describe('parsePrintings', () => {
  it('accepts a valid array and returns it typed', () => {
    const out = parsePrintings([row()])
    expect(out).toHaveLength(1)
    expect(out[0].key).toBe('welcometonightcitybeta/β025')
  })

  it('rejects a row missing a required field', () => {
    const bad = { ...row() } as Record<string, unknown>
    delete bad.rarity
    expect(() => parsePrintings([bad])).toThrow(/rarity/)
  })

  it('rejects non-array input', () => {
    expect(() => parsePrintings({ nope: true })).toThrow()
  })

  it('rejects duplicate keys', () => {
    expect(() => parsePrintings([row(), row()])).toThrow(/duplicate/i)
  })

  it('accepts a string finish (open vocabulary, not an enum)', () => {
    const out = parsePrintings([row({ key: 'x/1', finish: 'Foil' })])
    expect(out[0].finish).toBe('Foil')
  })
})

describe('indexes', () => {
  const rows = [
    row(),
    row({ key: 'welcometonightcityretail/025', setCode: 'welcometonightcityretail', setName: 'Welcome to Night City — Retail', collectorNumber: '025' }),
    row({ key: 'welcometonightcitybeta/β001', cardId: 'v-streetkid', collectorNumber: 'β001' }),
  ]

  it('printingsByCard groups rows by cardId', () => {
    const byCard = printingsByCard(rows)
    expect(byCard.get('mantis-blades')).toHaveLength(2)
    expect(byCard.get('v-streetkid')).toHaveLength(1)
  })

  it('getPrinting finds by key', () => {
    expect(getPrinting(rows, 'welcometonightcityretail/025')?.setCode).toBe('welcometonightcityretail')
    expect(getPrinting(rows, 'missing/999')).toBeUndefined()
  })

  it('listSets returns unique sets in first-appearance order', () => {
    expect(listSets(rows)).toEqual([
      { code: 'welcometonightcitybeta', name: 'Welcome to Night City — Beta' },
      { code: 'welcometonightcityretail', name: 'Welcome to Night City — Retail' },
    ])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/ui/printings.test.ts`
Expected: FAIL — cannot resolve `../../src/ui/printings`.

- [ ] **Step 3: Write the implementation**

```ts
// src/ui/printings.ts
// The printings dataset: one row per physical printing of a card (base art,
// alt art, per-set reprints). Generated by `scripts/fetch-printings.ts` into
// `data/printings.json` and joined against `data/cards.json` by `cardId`.
// Collection metadata lives here, never in cards.json or the engine types.

import { z } from 'zod'

export interface Printing {
  /** `"<setCode>/<collectorNumber>"` — the app's stable printing id. */
  key: string
  /** FK into cards.json ids (the API slug). */
  cardId: string
  setCode: string
  setName: string
  /** Verbatim, including the β prefix on beta numbers. */
  collectorNumber: string
  /** Open string on purpose — the API's vocabulary is not under our control. */
  rarity: string
  finish: string | null
  artist: string
  /** The API's printing uuid, for provenance and re-sync. */
  sourcePrintingId: string
}

const printingSchema = z.object({
  key: z.string().min(1),
  cardId: z.string().min(1),
  setCode: z.string().min(1),
  setName: z.string().min(1),
  collectorNumber: z.string().min(1),
  rarity: z.string().min(1),
  finish: z.string().nullable(),
  artist: z.string(),
  sourcePrintingId: z.string().min(1),
})

const printingsSchema = z.array(printingSchema)

/** Validates raw JSON into `Printing[]`; throws with a readable message on
 *  malformed rows or duplicate keys. Used by both the loader (Task 3) and the
 *  fetch script's self-check. */
export function parsePrintings(raw: unknown): Printing[] {
  const result = printingsSchema.safeParse(raw)
  if (!result.success) {
    throw new Error(`printings.json is malformed: ${result.error.message}`)
  }
  const seen = new Set<string>()
  for (const printing of result.data) {
    if (seen.has(printing.key)) {
      throw new Error(`printings.json has a duplicate key: "${printing.key}".`)
    }
    seen.add(printing.key)
  }
  return result.data
}

export function printingsByCard(printings: Printing[]): Map<string, Printing[]> {
  const byCard = new Map<string, Printing[]>()
  for (const printing of printings) {
    const list = byCard.get(printing.cardId) ?? []
    list.push(printing)
    byCard.set(printing.cardId, list)
  }
  return byCard
}

export function getPrinting(printings: Printing[], key: string): Printing | undefined {
  return printings.find((printing) => printing.key === key)
}

/** Unique sets in first-appearance order (printings.json is written sorted
 *  by set, so this is also a stable display order). */
export function listSets(printings: Printing[]): { code: string; name: string }[] {
  const seen = new Set<string>()
  const sets: { code: string; name: string }[] = []
  for (const printing of printings) {
    if (seen.has(printing.setCode)) continue
    seen.add(printing.setCode)
    sets.push({ code: printing.setCode, name: printing.setName })
  }
  return sets
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/ui/printings.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/printings.ts tests/ui/printings.test.ts
git commit -m "feat(collection): printing types, zod schema, parse + index helpers"
```

---

### Task 2: Fetch script, generated `data/printings.json`, schema doc, CI join test

**Files:**
- Create: `scripts/fetch-printings.ts`
- Create: `data/printings.json` (generated by running the script)
- Create: `data/printings.schema.md`
- Create: `tests/data/printings.test.ts`
- Modify: `package.json` (add npm script `fetch:printings`)

**Interfaces:**
- Consumes: `parsePrintings` from `src/ui/printings.ts` (Task 1).
- Produces: committed `data/printings.json` conforming to `Printing[]`, sorted by `(setCode, collectorNumber)`. Optional `--images` flag downloads printing art to `data/images/printings/<key with '/' replaced by '__'>.webp` (gitignored — `data/images/` already covers it).

**Note on TDD:** the script is a one-off data-population tool in the mold of `scripts/fetch-images.mjs` (which has no unit tests); its correctness gate is (a) its own refuse-to-write validation and (b) the CI join test written first in this task, which permanently guards the committed data.

- [ ] **Step 1: Write the failing data-validation test**

```ts
// tests/data/printings.test.ts
// CI guard on the *committed* dataset: printings.json must parse, join
// cleanly against cards.json in both directions, and keep unique keys.
// These mirror the fetch script's own refuse-to-write checks so a bad
// regeneration cannot land.
import { describe, expect, it } from 'vitest'
import rawPrintings from '../../data/printings.json'
import { parsePrintings, printingsByCard } from '../../src/ui/printings'
import { loadCardDb } from '../../src/engine/cardDb'

const db = loadCardDb()
const printings = parsePrintings(rawPrintings)

describe('data/printings.json', () => {
  it('parses and has at least one printing per card in cards.json', () => {
    const byCard = printingsByCard(printings)
    const missing = Object.keys(db).filter((id) => !byCard.has(id))
    expect(missing).toEqual([])
  })

  it('references only card ids that exist in cards.json', () => {
    const unknown = printings.filter((p) => !(p.cardId in db)).map((p) => p.key)
    expect(unknown).toEqual([])
  })

  it('derives every key as setCode/collectorNumber', () => {
    for (const p of printings) {
      expect(p.key).toBe(`${p.setCode}/${p.collectorNumber}`)
    }
  })

  it('is sorted by (setCode, collectorNumber) for stable diffs', () => {
    const sorted = [...printings].sort(
      (a, b) => a.setCode.localeCompare(b.setCode) || a.collectorNumber.localeCompare(b.collectorNumber)
    )
    expect(printings.map((p) => p.key)).toEqual(sorted.map((p) => p.key))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/data/printings.test.ts`
Expected: FAIL — cannot resolve `../../data/printings.json`.

- [ ] **Step 3: Write the fetch script**

```ts
// scripts/fetch-printings.ts
// Generates data/printings.json from the netdeck.gg API (the same primary
// source cards.json was transcribed from — see data/transcription-report.md).
// One row per printing of each of the 141 cards in cards.json, keyed
// "<setCode>/<collectorNumber>". Refuses to write on any validation failure
// (missing cards, unknown cards, duplicate keys) and prints a report instead.
//
// Usage:
//   npm run fetch:printings            # regenerate data/printings.json
//   npm run fetch:printings -- --images  # ...and download printing art to
//                                        # data/images/printings/ (gitignored)
//
// Unlike fetch-images.mjs (best-effort, always exits 0), this script's output
// is committed and load-bearing — a failed fetch for any card aborts with a
// non-zero exit rather than writing a dataset with holes.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePrintings, type Printing } from '../src/ui/printings'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const CARDS_JSON_PATH = resolve(REPO_ROOT, 'data/cards.json')
const PRINTINGS_JSON_PATH = resolve(REPO_ROOT, 'data/printings.json')
const PRINTING_IMAGES_DIR = resolve(REPO_ROOT, 'data/images/printings')

const API_BASE = 'https://api.netdeck.gg/api/cards/cyberpunk'
const USER_AGENT =
  'Mozilla/5.0 (cyberpunk-tcg-simulator fetch-printings.ts; personal playtesting tool)'
const DELAY_MS = 500

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))

/** Shape of the API's per-card `printings[]` entries (fields we consume). */
interface ApiPrinting {
  id: string
  collector_number: string
  set: { code: string; name: string }
  rarity: string
  finish: string | null
  artist: string
  image_url: string
}

async function fetchCardPrintings(slug: string): Promise<ApiPrinting[]> {
  const res = await fetch(`${API_BASE}/${encodeURIComponent(slug)}`, {
    headers: { 'User-Agent': USER_AGENT },
  })
  if (!res.ok) throw new Error(`GET ${slug} -> HTTP ${res.status}`)
  const data = (await res.json()) as { printings?: ApiPrinting[] }
  if (!Array.isArray(data.printings) || data.printings.length === 0) {
    throw new Error(`card "${slug}" has no printings[] in the API response`)
  }
  return data.printings
}

async function downloadImage(url: string, filePath: string): Promise<void> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`image download -> HTTP ${res.status}`)
  await writeFile(filePath, Buffer.from(await res.arrayBuffer()))
}

async function main(): Promise<void> {
  const withImages = process.argv.includes('--images')
  const cards = JSON.parse(await readFile(CARDS_JSON_PATH, 'utf8')) as { id: string }[]
  if (withImages) await mkdir(PRINTING_IMAGES_DIR, { recursive: true })

  const rows: Printing[] = []
  const errors: string[] = []

  for (const [index, card] of cards.entries()) {
    process.stdout.write(`[${index + 1}/${cards.length}] ${card.id}\n`)
    let apiPrintings: ApiPrinting[]
    try {
      apiPrintings = await fetchCardPrintings(card.id)
    } catch (err) {
      errors.push(String(err))
      await sleep(DELAY_MS)
      continue
    }
    for (const p of apiPrintings) {
      const key = `${p.set.code}/${p.collector_number}`
      rows.push({
        key,
        cardId: card.id,
        setCode: p.set.code,
        setName: p.set.name,
        collectorNumber: p.collector_number,
        rarity: p.rarity,
        finish: p.finish,
        artist: p.artist ?? '',
        sourcePrintingId: p.id,
      })
      if (withImages) {
        const filePath = resolve(PRINTING_IMAGES_DIR, `${key.replace('/', '__')}.webp`)
        try {
          await downloadImage(p.image_url, filePath)
        } catch (err) {
          // Images are best-effort (the app falls back to base art / the
          // drawn frame); data rows are not.
          console.error(`[images] ${key}: ${String(err)}`)
        }
      }
    }
    await sleep(DELAY_MS)
  }

  rows.sort(
    (a, b) => a.setCode.localeCompare(b.setCode) || a.collectorNumber.localeCompare(b.collectorNumber)
  )

  // Refuse-to-write validation: schema + duplicate keys via parsePrintings,
  // then the both-direction join against cards.json.
  try {
    parsePrintings(JSON.parse(JSON.stringify(rows)))
  } catch (err) {
    errors.push(String(err))
  }
  const cardIds = new Set(cards.map((c) => c.id))
  const covered = new Set(rows.map((r) => r.cardId))
  for (const id of cardIds) {
    if (!covered.has(id)) errors.push(`card "${id}" has no printings`)
  }
  for (const row of rows) {
    if (!cardIds.has(row.cardId)) errors.push(`printing "${row.key}" references unknown card "${row.cardId}"`)
  }

  if (errors.length > 0) {
    console.error(`\nREFUSING TO WRITE — ${errors.length} problem(s):`)
    for (const e of errors) console.error(`  - ${e}`)
    process.exit(1)
  }

  await writeFile(PRINTINGS_JSON_PATH, JSON.stringify(rows, null, 1) + '\n', 'utf8')
  console.log(`\nWrote ${rows.length} printings for ${covered.size} cards to data/printings.json`)
}

main().catch((err) => {
  console.error(String(err))
  process.exit(1)
})
```

- [ ] **Step 4: Add the npm script**

In `package.json` `"scripts"`, after `"sim"`:

```json
"fetch:printings": "tsx scripts/fetch-printings.ts"
```

- [ ] **Step 5: Run the script for real and eyeball the report**

Run: `npm run fetch:printings` (takes ~1.5 min: 141 sequential requests at 500 ms).
Expected: `Wrote N printings for 141 cards to data/printings.json` with N ≥ 141. If it refuses to write, the report names each problem — investigate before proceeding (do not weaken the validation).

- [ ] **Step 6: Run the data test to verify it passes**

Run: `npx vitest run tests/data/printings.test.ts`
Expected: PASS (4 tests) against the freshly committed data.

- [ ] **Step 7: Write the schema doc**

Create `data/printings.schema.md` with: the `Printing` field table (name, type, meaning — mirror the interface docs from Task 1), the key format rule (`setCode/collectorNumber`, collector numbers verbatim including `β`), provenance (generated by `scripts/fetch-printings.ts` from `api.netdeck.gg`, date of the run, row/set counts from the script's output), the sorted-for-stable-diffs note, and the regeneration instruction (`npm run fetch:printings`; re-running when new alt arts appear adds rows without changing existing keys, so saved collections need no migration). State explicitly that `rarity`/`finish` are open strings and that this file is generated — hand edits will be overwritten.

- [ ] **Step 8: Commit**

```bash
git add scripts/fetch-printings.ts data/printings.json data/printings.schema.md tests/data/printings.test.ts package.json
git commit -m "feat(collection): fetch-printings script + generated printings dataset + CI join test"
```

---

### Task 3: Loader wiring + printing image index

**Files:**
- Modify: `src/ui/printings.ts` (add static import + `loadPrintings`)
- Modify: `src/ui/images.ts` (add printing image index)
- Test: `tests/ui/images.test.ts` (extend), `tests/ui/printings.test.ts` (extend)

**Interfaces:**
- Consumes: `data/printings.json` (Task 2), `parsePrintings` (Task 1), `buildImageIndex` (existing in `images.ts`).
- Produces:
  - `loadPrintings(): Printing[]` — parses the bundled JSON once (module-level memo), throws the `parsePrintings` error on malformed data.
  - `getPrintingImageUrl(printingKey: string): string | undefined` — looks up `data/images/printings/<key with '/' → '__'>.webp`; callers fall back to `getOfficialImageUrl(cardId)` then the drawn `CardFrame`, mirroring today's chain.

- [ ] **Step 1: Write the failing tests**

Append to `tests/ui/printings.test.ts`:

```ts
import { loadPrintings } from '../../src/ui/printings'

describe('loadPrintings', () => {
  it('loads the bundled dataset and joins against real card ids', () => {
    const printings = loadPrintings()
    expect(printings.length).toBeGreaterThanOrEqual(141)
    expect(printings.some((p) => p.cardId === 'mantis-blades')).toBe(true)
  })

  it('returns the same array on repeated calls (memoized)', () => {
    expect(loadPrintings()).toBe(loadPrintings())
  })
})
```

Append to `tests/ui/images.test.ts` (it already tests `buildImageIndex` with synthetic module records — follow its existing style):

```ts
import { buildPrintingImageIndex } from '../../src/ui/images'

describe('buildPrintingImageIndex', () => {
  it('maps glob paths back to printing keys (undoing the __ substitution)', () => {
    const index = buildPrintingImageIndex({
      '/data/images/printings/welcometonightcitybeta__β025.webp': '/assets/beta-mantis.webp',
    })
    expect(index.get('welcometonightcitybeta/β025')).toBe('/assets/beta-mantis.webp')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/ui/printings.test.ts tests/ui/images.test.ts`
Expected: FAIL — `loadPrintings` / `buildPrintingImageIndex` not exported.

- [ ] **Step 3: Implement**

In `src/ui/printings.ts`, add at the top `import rawPrintings from '../../data/printings.json'` and:

```ts
let loaded: Printing[] | undefined

/** The bundled dataset, parsed and validated once. Throws (with the
 *  parsePrintings message) if data/printings.json is malformed — the
 *  Collection tab catches this and renders an error state (Task 7); nothing
 *  else imports this module, so the rest of the app is untouched. */
export function loadPrintings(): Printing[] {
  if (loaded === undefined) loaded = parsePrintings(rawPrintings)
  return loaded
}
```

In `src/ui/images.ts`, mirroring the existing card-image pattern:

```ts
const printingImageModules = import.meta.glob('/data/images/printings/*', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

/** Like buildImageIndex, but filenames encode printing keys with '/'
 *  replaced by '__' (a '/' cannot appear in a filename). Exported pure for
 *  the same test-with-synthetic-records reason as buildImageIndex. */
export function buildPrintingImageIndex(modules: Record<string, string>): Map<string, string> {
  const index = new Map<string, string>()
  for (const [path, url] of Object.entries(modules)) {
    const filename = path.split('/').pop() ?? ''
    const stem = filename.replace(/\.(png|jpg|jpeg|webp)$/i, '')
    index.set(stem.replace('__', '/'), url)
  }
  return index
}

const printingImageIndex = buildPrintingImageIndex(printingImageModules)

/** The art URL for a specific printing, or undefined if none is bundled —
 *  callers then fall back to getOfficialImageUrl(cardId), then the drawn
 *  CardFrame, exactly like base art falls back today. */
export function getPrintingImageUrl(printingKey: string): string | undefined {
  return printingImageIndex.get(printingKey)
}
```

- [ ] **Step 4: Run all tests to verify they pass**

Run: `npx vitest run tests/ui/printings.test.ts tests/ui/images.test.ts tests/data/printings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/printings.ts src/ui/images.ts tests/ui/printings.test.ts tests/ui/images.test.ts
git commit -m "feat(collection): bundled printings loader + printing image index"
```

---

### Task 4: Collection storage core (counts, subscribe, hook)

**Files:**
- Create: `src/ui/collection.ts`
- Test: `tests/ui/collection.test.ts`

**Interfaces:**
- Consumes: `readJson`/`writeJson` pattern from `storage.ts` (reimplemented locally — they are private there; do NOT export them from storage.ts, copy the 12-line pattern with a comment noting the mirror).
- Produces (exact names later tasks use):
  - `interface Collection { counts: Record<string, number> }`
  - `getCollection(): Collection`
  - `setCount(key: string, count: number): void` — clamps to ≥ 0; a 0 count is pruned from storage.
  - `adjustCount(key: string, delta: number): void`
  - `subscribeCollection(listener: () => void): () => void` — returns unsubscribe.
  - `useCollection(): Collection` — React hook via `useSyncExternalStore`; snapshot reference is stable between writes.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/ui/collection.test.ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  getCollection,
  getStorageError,
  setCount,
  adjustCount,
  subscribeCollection,
  useCollection,
  _resetCollectionCacheForTests,
} from '../../src/ui/collection'

beforeEach(() => {
  localStorage.clear()
  _resetCollectionCacheForTests()
})

describe('counts', () => {
  it('starts empty', () => {
    expect(getCollection().counts).toEqual({})
  })

  it('setCount stores and getCollection reads back', () => {
    setCount('welcometonightcitybeta/β025', 2)
    expect(getCollection().counts['welcometonightcitybeta/β025']).toBe(2)
  })

  it('setCount clamps negatives to 0 and prunes zero counts', () => {
    setCount('a/1', 2)
    setCount('a/1', -5)
    expect(getCollection().counts).toEqual({})
    expect(JSON.parse(localStorage.getItem('ctcg:collection:v1')!)).toEqual({ counts: {} })
  })

  it('adjustCount adds and subtracts with a floor of 0', () => {
    adjustCount('a/1', 1)
    adjustCount('a/1', 1)
    adjustCount('a/1', -5)
    expect(getCollection().counts['a/1']).toBeUndefined()
  })

  it('preserves unknown keys already in storage across writes', () => {
    localStorage.setItem('ctcg:collection:v1', JSON.stringify({ counts: { 'ghost/999': 4 } }))
    _resetCollectionCacheForTests()
    setCount('a/1', 1)
    expect(getCollection().counts['ghost/999']).toBe(4)
  })

  it('falls back to empty on a malformed blob', () => {
    localStorage.setItem('ctcg:collection:v1', '{not json')
    _resetCollectionCacheForTests()
    expect(getCollection().counts).toEqual({})
  })

  it('surfaces a storage error instead of throwing when the write fails', () => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    try {
      expect(() => setCount('a/1', 1)).not.toThrow()
      expect(getStorageError()).toContain('Could not save')
    } finally {
      Storage.prototype.setItem = original
    }
    setCount('a/1', 1) // a later successful write clears the error
    expect(getStorageError()).toBe('')
  })
})

describe('subscription', () => {
  it('notifies on write and stops after unsubscribe', () => {
    let calls = 0
    const unsubscribe = subscribeCollection(() => calls++)
    setCount('a/1', 1)
    expect(calls).toBe(1)
    unsubscribe()
    setCount('a/1', 2)
    expect(calls).toBe(1)
  })

  it('useCollection re-renders with fresh counts and keeps a stable snapshot otherwise', () => {
    const { result, rerender } = renderHook(() => useCollection())
    const first = result.current
    rerender()
    expect(result.current).toBe(first) // stable reference, no write between
    act(() => setCount('a/1', 3))
    expect(result.current.counts['a/1']).toBe(3)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/ui/collection.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```ts
// src/ui/collection.ts
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

/** Test-only: drops the snapshot cache so localStorage seeding/clearing in a
 *  test is observed. Underscore-prefixed by convention; not for app code. */
export function _resetCollectionCacheForTests(): void {
  cache = undefined
}
```

Also export `writeCollection` internally for Task 6 (import replace/merge) by adding:

```ts
/** Replaces the whole collection in one write (used by import — Task 6). */
export function replaceCollection(collection: Collection): void {
  writeCollection(collection)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/ui/collection.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/collection.ts tests/ui/collection.test.ts
git commit -m "feat(collection): localStorage collection store with subscription hook"
```

---

### Task 5: Derived queries (gaps, goals, stats, buy-list)

**Files:**
- Modify: `src/ui/collection.ts` (append pure query functions)
- Modify: `src/ui/storage.ts` (export a display-name helper)
- Test: `tests/ui/collection.test.ts` (extend), `tests/ui/storage.test.ts` (extend)

**Interfaces:**
- Consumes: `Printing`, `printingsByCard` (Task 1); `Collection` (Task 4); `CardDb`, `CardDef` from `src/engine/types`; `buildNameIndex`/`cardDisplayName` internals of `storage.ts`.
- Produces:
  - In `storage.ts`: `buildDisplayNames(db: CardDb): Map<string, string>` — card id → `"Name"` or `"Name — Subtitle"` (wraps the existing private helpers; the private functions stay private).
  - In `collection.ts` (all pure — take `(db, printings, collection)` args, no localStorage reads):
    - `cardTotal(printings: Printing[], collection: Collection, cardId: string): number`
    - `playsetTarget(def: CardDef): number` — 1 for legends, else 3.
    - `interface PlaysetGap { cardId: string; owned: number; target: number; missing: number }`
    - `playsetGaps(db: CardDb, printings: Printing[], collection: Collection): PlaysetGap[]` — only cards below target.
    - `missingPrintings(printings: Printing[], collection: Collection): Printing[]` — count 0.
    - `interface CompletionStats { playsetPct: number; artsPct: number; totalOwned: number }`
    - `completionStats(db: CardDb, printings: Printing[], collection: Collection): CompletionStats` — percentages 0–100, rounded to whole numbers; `playsetPct` = owned-toward-target summed over cards / total targets; `artsPct` = printings owned ≥1 / total printings.
    - `buildBuyList(db: CardDb, printings: Printing[], collection: Collection, options: { playset: boolean; arts: boolean }): string`

- [ ] **Step 1: Write the failing tests**

Append to `tests/ui/storage.test.ts`:

```ts
import { buildDisplayNames } from '../../src/ui/storage'

describe('buildDisplayNames', () => {
  it('uses the bare name when unique and Name — Subtitle when shared', () => {
    const names = buildDisplayNames(db)
    expect(names.get('mantis-blades')).toBe('Mantis Blades')
    // Multiple cards named "V" exist; each must carry its subtitle.
    expect(names.get('v-streetkid')).toMatch(/^V — /)
  })
})
```

Append to `tests/ui/collection.test.ts` (uses a tiny synthetic db + printings so the math is auditable):

```ts
import type { CardDb } from '../../src/engine/types'
import type { Printing } from '../../src/ui/printings'
import {
  cardTotal,
  playsetTarget,
  playsetGaps,
  missingPrintings,
  completionStats,
  buildBuyList,
} from '../../src/ui/collection'

// Minimal defs: only the fields the queries touch matter, but build full
// CardDefs so the CardDb type is satisfied without casts scattered per test.
const def = (id: string, type: 'legend' | 'unit') =>
  ({
    id, name: id, color: 'Red', type, cost: 1, power: 1,
    ram: null, ramLimit: null, sellTag: false, keywords: [], text: '', effects: [],
  }) as unknown as CardDb[string]

const miniDb: CardDb = { alpha: def('alpha', 'unit'), boss: def('boss', 'legend') }

const p = (key: string, cardId: string): Printing => ({
  key, cardId,
  setCode: key.split('/')[0], setName: key.split('/')[0],
  collectorNumber: key.split('/')[1],
  rarity: 'Common', finish: null, artist: '', sourcePrintingId: key,
})

const miniPrintings = [p('beta/1', 'alpha'), p('retail/1', 'alpha'), p('beta/2', 'boss')]

describe('derived queries', () => {
  it('cardTotal sums across printings', () => {
    const collection = { counts: { 'beta/1': 2, 'retail/1': 1 } }
    expect(cardTotal(miniPrintings, collection, 'alpha')).toBe(3)
    expect(cardTotal(miniPrintings, collection, 'boss')).toBe(0)
  })

  it('playsetTarget is 1 for legends, 3 otherwise', () => {
    expect(playsetTarget(miniDb.alpha)).toBe(3)
    expect(playsetTarget(miniDb.boss)).toBe(1)
  })

  it('playsetGaps lists only cards below target, capped at target', () => {
    const collection = { counts: { 'beta/1': 2 } }
    expect(playsetGaps(miniDb, miniPrintings, collection)).toEqual([
      { cardId: 'alpha', owned: 2, target: 3, missing: 1 },
      { cardId: 'boss', owned: 0, target: 1, missing: 1 },
    ])
  })

  it('missingPrintings returns printings with count 0', () => {
    const collection = { counts: { 'beta/1': 1 } }
    expect(missingPrintings(miniPrintings, collection).map((x) => x.key)).toEqual([
      'retail/1', 'beta/2',
    ])
  })

  it('completionStats: owned-toward-target over total targets; arts over printings', () => {
    // alpha 2/3 + boss 0/1 => 2/4 = 50%; arts: 1 of 3 printings owned => 33%.
    const collection = { counts: { 'beta/1': 2 } }
    expect(completionStats(miniDb, miniPrintings, collection)).toEqual({
      playsetPct: 50, artsPct: 33, totalOwned: 2,
    })
  })

  it('overshoot does not inflate playsetPct past the target', () => {
    const collection = { counts: { 'beta/1': 9, 'beta/2': 1 } }
    expect(completionStats(miniDb, miniPrintings, collection).playsetPct).toBe(100)
  })

  it('buildBuyList renders playset gaps and missing arts per options', () => {
    const collection = { counts: { 'beta/1': 2 } }
    const both = buildBuyList(miniDb, miniPrintings, collection, { playset: true, arts: true })
    expect(both).toContain('1x alpha')                 // playset shortfall
    expect(both).toContain('alpha [retail/1]')        // missing art
    expect(both).toContain('boss [beta/2]')
    const playsetOnly = buildBuyList(miniDb, miniPrintings, collection, { playset: true, arts: false })
    expect(playsetOnly).not.toContain('[retail/1]')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/ui/collection.test.ts tests/ui/storage.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement**

In `src/ui/storage.ts`, below `cardDisplayName`:

```ts
/** Card id -> display name ("Name", or "Name — Subtitle" when the bare name
 *  is shared) for every card in the db. The collection buy-list and text
 *  export (src/ui/collection.ts) render names through this so they use the
 *  same disambiguation as deck text export. */
export function buildDisplayNames(db: CardDb): Map<string, string> {
  const nameIndex = buildNameIndex(db)
  const names = new Map<string, string>()
  for (const id of Object.keys(db)) {
    names.set(id, cardDisplayName(db, nameIndex, id))
  }
  return names
}
```

Append to `src/ui/collection.ts` (add imports: `type { CardDb, CardDef } from '../engine/types'`, `type { Printing } from './printings'`, `printingsByCard from './printings'`, `buildDisplayNames from './storage'`):

```ts
// ---------------------------------------------------------------------------
// Derived queries — pure functions over (db, printings, collection); no
// localStorage access, so they test without jsdom state and memoize cleanly
// in components.
// ---------------------------------------------------------------------------

export function cardTotal(printings: Printing[], collection: Collection, cardId: string): number {
  let total = 0
  for (const printing of printings) {
    if (printing.cardId === cardId) total += collection.counts[printing.key] ?? 0
  }
  return total
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
  const byCard = printingsByCard(printings)
  const gaps: PlaysetGap[] = []
  for (const def of Object.values(db)) {
    let owned = 0
    for (const printing of byCard.get(def.id) ?? []) {
      owned += collection.counts[printing.key] ?? 0
    }
    const target = playsetTarget(def)
    if (owned < target) gaps.push({ cardId: def.id, owned, target, missing: target - owned })
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
  const byCard = printingsByCard(printings)
  let targetSum = 0
  let ownedTowardTarget = 0
  for (const def of Object.values(db)) {
    const target = playsetTarget(def)
    let owned = 0
    for (const printing of byCard.get(def.id) ?? []) {
      owned += collection.counts[printing.key] ?? 0
    }
    targetSum += target
    ownedTowardTarget += Math.min(owned, target)
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/ui/collection.test.ts tests/ui/storage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/collection.ts src/ui/storage.ts tests/ui/collection.test.ts tests/ui/storage.test.ts
git commit -m "feat(collection): derived queries — playset gaps, missing arts, stats, buy-list"
```

---

### Task 6: Export / import (JSON + text, replace/merge)

**Files:**
- Modify: `src/ui/collection.ts`
- Test: `tests/ui/collection.test.ts` (extend)

**Interfaces:**
- Consumes: `Collection`, `getCollection`, `replaceCollection` (Task 4); `buildDisplayNames` (Task 5); `Printing`, `getPrinting` (Task 1).
- Produces:
  - `exportCollectionJson(collection: Collection): string` — `{"version":1,"counts":{...}}`, pretty-printed.
  - `importCollectionJson(text: string, mode: 'replace' | 'merge'): void` — throws on malformed input (loud, unlike the forgiving read); `merge` sums counts into the current collection.
  - `exportCollectionText(db: CardDb, printings: Printing[], collection: Collection): string` — one line per owned printing: `2x Mantis Blades [welcometonightcitybeta/β025]`; unknown keys export as `2x ??? [ghost/999]` so they round-trip.
  - `importCollectionText(text: string, mode: 'replace' | 'merge'): void` — parses the bracketed key (authoritative; the name is decorative), collects ALL errors (malformed lines) and throws them together, `importDeckText`-style; writes nothing unless the whole import parses. Unknown keys are accepted (preserve-don't-drop rule).

- [ ] **Step 1: Write the failing tests**

Append to `tests/ui/collection.test.ts`:

```ts
import {
  exportCollectionJson,
  importCollectionJson,
  exportCollectionText,
  importCollectionText,
} from '../../src/ui/collection'

describe('JSON export/import', () => {
  it('round-trips through export -> import replace', () => {
    setCount('beta/1', 2)
    const json = exportCollectionJson(getCollection())
    setCount('beta/1', 0)
    setCount('retail/1', 5)
    importCollectionJson(json, 'replace')
    expect(getCollection().counts).toEqual({ 'beta/1': 2 })
  })

  it('merge sums counts', () => {
    setCount('beta/1', 1)
    importCollectionJson(JSON.stringify({ version: 1, counts: { 'beta/1': 2, 'beta/2': 1 } }), 'merge')
    expect(getCollection().counts).toEqual({ 'beta/1': 3, 'beta/2': 1 })
  })

  it('throws loudly on malformed JSON and writes nothing', () => {
    setCount('beta/1', 1)
    expect(() => importCollectionJson('{"version":1,"counts":{"a":-2}}', 'replace')).toThrow()
    expect(() => importCollectionJson('not json', 'replace')).toThrow()
    expect(getCollection().counts).toEqual({ 'beta/1': 1 })
  })
})

describe('text export/import', () => {
  it('exports one line per owned printing with the bracketed key', () => {
    const collection = { counts: { 'beta/1': 2 } }
    const text = exportCollectionText(miniDb, miniPrintings, collection)
    expect(text).toBe('2x alpha [beta/1]')
  })

  it('round-trips unknown keys with a ??? name', () => {
    const collection = { counts: { 'ghost/999': 4 } }
    const text = exportCollectionText(miniDb, miniPrintings, collection)
    expect(text).toBe('4x ??? [ghost/999]')
    importCollectionText(text, 'replace')
    expect(getCollection().counts).toEqual({ 'ghost/999': 4 })
  })

  it('collects all malformed lines into one error and writes nothing', () => {
    setCount('beta/1', 1)
    expect(() => importCollectionText('2x alpha [beta/1]\ngarbage line\nalso bad', 'replace'))
      .toThrow(/garbage line[\s\S]*also bad/)
    expect(getCollection().counts).toEqual({ 'beta/1': 1 })
  })

  it('merge adds text counts onto existing ones, ignoring blank lines', () => {
    setCount('beta/1', 1)
    importCollectionText('\n2x alpha [beta/1]\n', 'merge')
    expect(getCollection().counts['beta/1']).toBe(3)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/ui/collection.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement**

Append to `src/ui/collection.ts`:

```ts
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
    throw new Error(`Could not import collection: ${result.error.message}`)
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
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '') continue
    const match = line.match(/^(\d+)\s*x\s+.*\[(.+)\]$/i)
    if (!match) {
      errors.push(`malformed line "${line}" (expected "Nx Name [printingKey]")`)
      continue
    }
    const [, count, key] = match
    counts[key] = (counts[key] ?? 0) + Number(count)
  }
  if (errors.length > 0) {
    throw new Error(`Could not import collection:\n${errors.join('\n')}`)
  }
  applyImport(counts, mode)
}
```

(`getPrinting` joins the existing `./printings` import; `z` is already imported in this file from Task 4.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/ui/collection.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/collection.ts tests/ui/collection.test.ts
git commit -m "feat(collection): JSON + text export/import with replace/merge modes"
```

---

### Task 7: Collection tab — grid, per-printing steppers, filters

**Files:**
- Create: `src/ui/CollectionView.tsx`
- Modify: `src/App.tsx` (4th tab)
- Modify: `src/ui/styles/` or `src/ui/theme.css` (whichever holds component styles — follow where `.card-browser__*` classes live; add `.collection-*` classes there)
- Test: `tests/ui/collectionview.test.tsx`

**Interfaces:**
- Consumes: `loadPrintings`, `printingsByCard`, `listSets`, `Printing` (Tasks 1/3); `useCollection`, `adjustCount`, `cardTotal`, `playsetTarget` (Tasks 4/5); `CardFrame` (existing, props `def/size/useOfficialImages/onClick`); `getPrintingImageUrl` (Task 3).
- Produces: `CollectionView({ db, useOfficialImages }: { db: CardDb; useOfficialImages: boolean }): ReactElement`. Test ids later tasks and e2e rely on: `collection-view`, `collection-grid`, `collection-cell` (with `data-card-id`), `collection-count-<cardId>`, `printing-row-<printingKey>`, `printing-inc-<printingKey>`, `printing-dec-<printingKey>`, `goal-filter-<all|missing-playset|missing-arts|complete>`, `set-filter`, `rarity-filter-<rarity>`.

Layout: header strip (Task 9 fills it), quick-add slot (Task 8), filter chips, then a grid of per-card tiles. Clicking a tile toggles an expanded panel under it listing that card's printings with counts and +/− steppers. Filters: color/type chips (same chip pattern as `CardBrowser`), rarity chips (derived from the dataset's distinct rarities), a set `<select>`, and the goal filter.

If `loadPrintings()` throws, render `<div data-testid="collection-error">` with the error message instead of the view (spec §5) — wrap the call in a `useMemo` + try/catch at the top of `CollectionView`.

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/ui/collectionview.test.tsx
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { loadCardDb } from '../../src/engine/cardDb'
import { loadPrintings } from '../../src/ui/printings'
import { _resetCollectionCacheForTests, getCollection } from '../../src/ui/collection'
import { CollectionView } from '../../src/ui/CollectionView'

const db = loadCardDb()
const printings = loadPrintings()
// A real card with ≥2 printings (beta + retail exist for the whole core set).
const multi = printings.find((p) => printings.filter((q) => q.cardId === p.cardId).length >= 2)!

beforeEach(() => {
  localStorage.clear()
  _resetCollectionCacheForTests()
})

describe('CollectionView', () => {
  it('renders a tile per card with an owned/target badge', () => {
    render(<CollectionView db={db} useOfficialImages={false} />)
    const cells = screen.getAllByTestId('collection-cell')
    expect(cells.length).toBe(Object.keys(db).length)
    expect(screen.getByTestId(`collection-count-${multi.cardId}`).textContent).toContain('0/')
  })

  it('expands a tile to printing rows and increments via the stepper', async () => {
    const user = userEvent.setup()
    render(<CollectionView db={db} useOfficialImages={false} />)
    const cell = screen
      .getAllByTestId('collection-cell')
      .find((el) => el.getAttribute('data-card-id') === multi.cardId)!
    await user.click(within(cell).getByTestId(`expand-${multi.cardId}`))
    await user.click(screen.getByTestId(`printing-inc-${multi.key}`))
    expect(getCollection().counts[multi.key]).toBe(1)
    expect(screen.getByTestId(`collection-count-${multi.cardId}`).textContent).toContain('1/')
  })

  it('decrement stops at 0', async () => {
    const user = userEvent.setup()
    render(<CollectionView db={db} useOfficialImages={false} />)
    const cell = screen
      .getAllByTestId('collection-cell')
      .find((el) => el.getAttribute('data-card-id') === multi.cardId)!
    await user.click(within(cell).getByTestId(`expand-${multi.cardId}`))
    await user.click(screen.getByTestId(`printing-dec-${multi.key}`))
    expect(getCollection().counts[multi.key]).toBeUndefined()
  })

  it('goal filter "complete" shows nothing on an empty collection', async () => {
    const user = userEvent.setup()
    render(<CollectionView db={db} useOfficialImages={false} />)
    await user.click(screen.getByTestId('goal-filter-complete'))
    expect(screen.queryAllByTestId('collection-cell')).toHaveLength(0)
  })

  it('set filter narrows the grid to cards printed in that set', async () => {
    const user = userEvent.setup()
    render(<CollectionView db={db} useOfficialImages={false} />)
    await user.selectOptions(screen.getByTestId('set-filter'), multi.setCode)
    const shown = screen.getAllByTestId('collection-cell').length
    expect(shown).toBeGreaterThan(0)
    expect(shown).toBeLessThanOrEqual(Object.keys(db).length)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/ui/collectionview.test.tsx`
Expected: FAIL — `CollectionView` does not exist.

- [ ] **Step 3: Implement `CollectionView`**

```tsx
// src/ui/CollectionView.tsx
// The Collection tab: every card in the pool as a tile (CardFrame + owned/
// target badge), expandable into per-printing rows with +/− steppers.
// Filters mirror CardBrowser's chip pattern, plus rarity/set/goal filters
// that only make sense here. The header strip (stats/buy-list/export) and
// the quick-add bar are separate components slotted in above the grid
// (Tasks 8 and 9); this file owns the grid and filter state.

import { useMemo, useState, type CSSProperties, type ReactElement } from 'react'
import type { CardDb, CardDef, CardType } from '../engine/types'
import { CardFrame, ramColorVar } from './CardFrame'
import {
  loadPrintings,
  printingsByCard,
  listSets,
  type Printing,
} from './printings'
import { useCollection, adjustCount, getStorageError, playsetTarget, type Collection } from './collection'

const COLORS = ['Red', 'Yellow', 'Green', 'Blue'] as const
const TYPES: CardType[] = ['legend', 'unit', 'program', 'gear']
type GoalFilter = 'all' | 'missing-playset' | 'missing-arts' | 'complete'
const GOALS: { id: GoalFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'missing-playset', label: 'Missing for playset' },
  { id: 'missing-arts', label: 'Missing arts' },
  { id: 'complete', label: 'Complete' },
]

interface CardRollup {
  def: CardDef
  printings: Printing[]
  owned: number
  target: number
  playsetDone: boolean
  artsDone: boolean
}

function rollup(def: CardDef, prints: Printing[], collection: Collection): CardRollup {
  const owned = prints.reduce((sum, p) => sum + (collection.counts[p.key] ?? 0), 0)
  const target = playsetTarget(def)
  return {
    def,
    printings: prints,
    owned,
    target,
    playsetDone: owned >= target,
    artsDone: prints.every((p) => (collection.counts[p.key] ?? 0) > 0),
  }
}

export function CollectionView({
  db,
  useOfficialImages,
}: {
  db: CardDb
  useOfficialImages: boolean
}): ReactElement {
  const collection = useCollection()

  const loadResult = useMemo(() => {
    try {
      const printings = loadPrintings()
      return { printings, byCard: printingsByCard(printings), error: undefined }
    } catch (err) {
      return { printings: [] as Printing[], byCard: new Map<string, Printing[]>(), error: String(err) }
    }
  }, [])

  const [colors, setColors] = useState<Set<string>>(new Set())
  const [types, setTypes] = useState<Set<CardType>>(new Set())
  const [rarities, setRarities] = useState<Set<string>>(new Set())
  const [setCode, setSetCode] = useState('')
  const [goal, setGoal] = useState<GoalFilter>('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  const allRarities = useMemo(
    () => [...new Set(loadResult.printings.map((p) => p.rarity))],
    [loadResult]
  )
  const sets = useMemo(() => listSets(loadResult.printings), [loadResult])

  const rollups = useMemo(() => {
    return Object.values(db)
      .map((def) => rollup(def, loadResult.byCard.get(def.id) ?? [], collection))
      .filter((r) => colors.size === 0 || colors.has(r.def.color))
      .filter((r) => types.size === 0 || types.has(r.def.type))
      .filter((r) => rarities.size === 0 || r.printings.some((p) => rarities.has(p.rarity)))
      .filter((r) => setCode === '' || r.printings.some((p) => p.setCode === setCode))
      .filter((r) => {
        if (goal === 'missing-playset') return !r.playsetDone
        if (goal === 'missing-arts') return !r.artsDone
        if (goal === 'complete') return r.playsetDone && r.artsDone
        return true
      })
      .sort((a, b) => a.def.name.localeCompare(b.def.name))
  }, [db, loadResult, collection, colors, types, rarities, setCode, goal])

  if (loadResult.error !== undefined) {
    return <div data-testid="collection-error">Collection unavailable: {loadResult.error}</div>
  }

  function toggle<T>(set: Set<T>, value: T, setter: (next: Set<T>) => void): void {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    setter(next)
  }

  return (
    <div className="collection-view" data-testid="collection-view">
      {/* useCollection above re-renders this component on every collection
          write, so a failed write's error appears (and clears) live. */}
      {getStorageError() !== '' && (
        <div className="collection-view__storage-error" data-testid="collection-storage-error">
          {getStorageError()}
        </div>
      )}
      <div className="collection-view__filters">
        <div className="card-browser__chips">
          {COLORS.map((color) => (
            <button type="button" key={color} data-testid={`collection-color-${color}`}
              aria-pressed={colors.has(color)} className="filter-chip filter-chip--ram"
              style={{ '--ram-chip-color': ramColorVar(color) } as CSSProperties}
              onClick={() => toggle(colors, color, setColors)}>
              <span className="filter-chip__swatch" aria-hidden="true" />
              {color}
            </button>
          ))}
          {TYPES.map((type) => (
            <button type="button" key={type} data-testid={`collection-type-${type}`}
              aria-pressed={types.has(type)} className="filter-chip"
              onClick={() => toggle(types, type, setTypes)}>
              {type}
            </button>
          ))}
          {allRarities.map((rarity) => (
            <button type="button" key={rarity} data-testid={`rarity-filter-${rarity}`}
              aria-pressed={rarities.has(rarity)} className="filter-chip"
              onClick={() => toggle(rarities, rarity, setRarities)}>
              {rarity}
            </button>
          ))}
          {GOALS.map((g) => (
            <button type="button" key={g.id} data-testid={`goal-filter-${g.id}`}
              aria-pressed={goal === g.id} className="filter-chip"
              onClick={() => setGoal(g.id)}>
              {g.label}
            </button>
          ))}
          <select data-testid="set-filter" value={setCode}
            onChange={(e) => setSetCode(e.target.value)}>
            <option value="">All sets</option>
            {sets.map((s) => (
              <option key={s.code} value={s.code}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="collection-view__grid" data-testid="collection-grid">
        {rollups.map((r) => (
          <div key={r.def.id} className="collection-view__cell" data-testid="collection-cell"
            data-card-id={r.def.id}>
            <CardFrame def={r.def} size="zoom" useOfficialImages={useOfficialImages}
              onClick={() => setExpanded(expanded === r.def.id ? null : r.def.id)} />
            <span className="collection-view__count" data-testid={`collection-count-${r.def.id}`}>
              {r.owned}/{r.target}
              {r.playsetDone && <span title="Playset complete"> ✓</span>}
              {r.artsDone && <span title="All arts owned"> ★</span>}
            </span>
            <button type="button" className="collection-view__expand"
              data-testid={`expand-${r.def.id}`}
              onClick={() => setExpanded(expanded === r.def.id ? null : r.def.id)}>
              printings
            </button>
            {expanded === r.def.id && (
              <div className="collection-view__printings">
                {r.printings.map((p) => {
                  const count = collection.counts[p.key] ?? 0
                  return (
                    <div key={p.key} className="collection-view__printing-row"
                      data-testid={`printing-row-${p.key}`}>
                      <span>{p.setName} · {p.collectorNumber} · {p.rarity}{p.finish ? ` · ${p.finish}` : ''}</span>
                      <span className="collection-view__stepper">
                        <button type="button" data-testid={`printing-dec-${p.key}`}
                          disabled={count === 0}
                          onClick={() => adjustCount(p.key, -1)}>
                          −
                        </button>
                        <span>{count}</span>
                        <button type="button" data-testid={`printing-inc-${p.key}`}
                          onClick={() => adjustCount(p.key, 1)}>
                          +
                        </button>
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
```

The `--ram-chip-color` style follows `CardBrowser`'s existing cast style: `style={{ '--ram-chip-color': ramColorVar(color) } as CSSProperties}` with `CSSProperties` added to the react type imports.

- [ ] **Step 4: Wire the tab into `App.tsx`**

- Extend `type View = 'play' | 'deckBuilder' | 'simulate' | 'collection'`.
- Add `{ id: 'collection', label: 'Collection' }` to `TABS`.
- Add to `<main>`, after the deckBuilder div, kept mounted like Play/Deck Builder (filter + expand state survives tab switches):

```tsx
{/* Kept mounted, only hidden: same pattern as Play/Deck Builder so filter
    state and an in-progress quick-add session survive a glance at another
    tab. */}
<div hidden={view !== 'collection'}>
  <CollectionView db={db} useOfficialImages={useOfficialImages} />
</div>
```

- [ ] **Step 5: Add minimal styles**

Find where `.card-browser__grid` is defined (`grep -n "card-browser__grid" src/ui/theme.css src/ui/styles/*`) and add alongside, matching the file's conventions: `.collection-view__grid` (same grid-template as the card browser's), `.collection-view__cell` (relative positioning for the count badge, like `.card-browser__cell`), `.collection-view__count` (corner badge, like `.card-browser__count`), `.collection-view__printings` (full-width panel under the cell), `.collection-view__printing-row` (flex row, space-between), `.collection-view__stepper` (inline flex, small gap).

- [ ] **Step 6: Run tests + full suite**

Run: `npx vitest run tests/ui/collectionview.test.tsx && npx vitest run`
Expected: new tests PASS; no existing test broken (App-level tests may need the new tab in snapshots — fix if so).

- [ ] **Step 7: Commit**

```bash
git add src/ui/CollectionView.tsx src/App.tsx tests/ui/collectionview.test.tsx src/ui/theme.css
git commit -m "feat(collection): Collection tab — card grid, printing steppers, filters"
```

---

### Task 8: Quick-add bar with session set + undo

**Files:**
- Create: `src/ui/QuickAddBar.tsx`
- Modify: `src/ui/CollectionView.tsx` (slot it in above the filters)
- Test: `tests/ui/quickaddbar.test.tsx`

**Interfaces:**
- Consumes: `adjustCount` (Task 4); `listSets`, `printingsByCard`, `Printing` (Task 1); `buildDisplayNames` (Task 5).
- Produces: `QuickAddBar({ db, printings }: { db: CardDb; printings: Printing[] }): ReactElement`. Behavior:
  - Text input (`data-testid="quick-add-input"`); typing shows up to 8 name matches (`quick-add-match-<cardId>`, top match `aria-selected`), case-insensitive substring on display name.
  - A set `<select>` (`quick-add-set`) — the *session set*, defaulting to the first set and remembered in localStorage `ctcg:quickAddSet:v1` (plain string, read/write inline; not part of the collection blob).
  - Enter (or clicking a match) adds +1 of the matched card's printing in the session set and clears the input. ArrowDown/ArrowUp move the selection.
  - If the card has no printing in the session set, the match row shows its printings inline (`quick-add-printing-<key>` buttons) instead of being Enter-addable.
  - After every add, an undo toast (`quick-add-undo`) shows "Added 1x <name> [<set>]" with an Undo button that decrements that same printing (single-level).

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/ui/quickaddbar.test.tsx
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { loadCardDb } from '../../src/engine/cardDb'
import { loadPrintings, printingsByCard } from '../../src/ui/printings'
import { _resetCollectionCacheForTests, getCollection } from '../../src/ui/collection'
import { QuickAddBar } from '../../src/ui/QuickAddBar'

const db = loadCardDb()
const printings = loadPrintings()
// A card + one of its printings to target via the session set.
const target = printings.find((p) => p.cardId === 'mantis-blades')!

beforeEach(() => {
  localStorage.clear()
  _resetCollectionCacheForTests()
})

async function typeAndPickSet(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByTestId('quick-add-set'), target.setCode)
  await user.type(screen.getByTestId('quick-add-input'), 'mantis')
}

describe('QuickAddBar', () => {
  it('shows matches while typing and Enter adds 1 in the session set', async () => {
    const user = userEvent.setup()
    render(<QuickAddBar db={db} printings={printings} />)
    await typeAndPickSet(user)
    expect(screen.getByTestId('quick-add-match-mantis-blades')).toBeTruthy()
    await user.keyboard('{Enter}')
    expect(getCollection().counts[target.key]).toBe(1)
    expect((screen.getByTestId('quick-add-input') as HTMLInputElement).value).toBe('')
  })

  it('undo decrements the just-added printing', async () => {
    const user = userEvent.setup()
    render(<QuickAddBar db={db} printings={printings} />)
    await typeAndPickSet(user)
    await user.keyboard('{Enter}')
    await user.click(screen.getByTestId('quick-add-undo'))
    expect(getCollection().counts[target.key]).toBeUndefined()
  })

  it('remembers the session set across mounts', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<QuickAddBar db={db} printings={printings} />)
    await user.selectOptions(screen.getByTestId('quick-add-set'), target.setCode)
    unmount()
    render(<QuickAddBar db={db} printings={printings} />)
    expect((screen.getByTestId('quick-add-set') as HTMLSelectElement).value).toBe(target.setCode)
  })

  it('a card absent from the session set offers its printings inline', async () => {
    // Find a card that is NOT in `target.setCode` but has printings elsewhere.
    const byCard = printingsByCard(printings)
    const outsider = [...byCard.entries()].find(
      ([, list]) => !list.some((p) => p.setCode === target.setCode)
    )
    if (!outsider) return // every card is in the session set — nothing to assert
    const [cardId, list] = outsider
    const user = userEvent.setup()
    render(<QuickAddBar db={db} printings={printings} />)
    await user.selectOptions(screen.getByTestId('quick-add-set'), target.setCode)
    await user.type(screen.getByTestId('quick-add-input'), db[cardId].name.slice(0, 6))
    await user.click(screen.getByTestId(`quick-add-printing-${list[0].key}`))
    expect(getCollection().counts[list[0].key]).toBe(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/ui/quickaddbar.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `QuickAddBar`**

```tsx
// src/ui/QuickAddBar.tsx
// Pack-cracking entry: type a few letters, Enter adds 1 of the top match's
// printing in the "session set" (the set of boosters currently being
// opened — pick it once, every add lands there). Cards with no printing in
// the session set show their printings inline instead. Single-level undo.

import { useMemo, useState, type KeyboardEvent, type ReactElement } from 'react'
import type { CardDb } from '../engine/types'
import { printingsByCard, listSets, type Printing } from './printings'
import { adjustCount } from './collection'
import { buildDisplayNames } from './storage'

const SESSION_SET_KEY = 'ctcg:quickAddSet:v1'
const MAX_MATCHES = 8

interface LastAdd {
  key: string
  label: string
}

export function QuickAddBar({ db, printings }: { db: CardDb; printings: Printing[] }): ReactElement {
  const sets = useMemo(() => listSets(printings), [printings])
  const byCard = useMemo(() => printingsByCard(printings), [printings])
  const names = useMemo(() => buildDisplayNames(db), [db])

  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [lastAdd, setLastAdd] = useState<LastAdd | null>(null)
  const [sessionSet, setSessionSetState] = useState(() => {
    const saved = localStorage.getItem(SESSION_SET_KEY)
    return saved !== null && sets.some((s) => s.code === saved) ? saved : sets[0]?.code ?? ''
  })

  function setSessionSet(code: string): void {
    setSessionSetState(code)
    localStorage.setItem(SESSION_SET_KEY, code)
  }

  const matches = useMemo(() => {
    if (query.trim() === '') return []
    const needle = query.trim().toLowerCase()
    return [...names.entries()]
      .filter(([, name]) => name.toLowerCase().includes(needle))
      .slice(0, MAX_MATCHES)
      .map(([cardId, name]) => {
        const inSet = (byCard.get(cardId) ?? []).find((p) => p.setCode === sessionSet)
        return { cardId, name, inSet, all: byCard.get(cardId) ?? [] }
      })
  }, [query, names, byCard, sessionSet])

  function add(printing: Printing, name: string): void {
    adjustCount(printing.key, 1)
    setLastAdd({ key: printing.key, label: `Added 1x ${name} [${printing.setName}]` })
    setQuery('')
    setSelected(0)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelected((s) => Math.min(s + 1, matches.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelected((s) => Math.max(s - 1, 0))
    } else if (event.key === 'Enter') {
      const match = matches[selected]
      if (match?.inSet) add(match.inSet, match.name)
    }
  }

  return (
    <div className="quick-add" data-testid="quick-add">
      <input
        type="text"
        data-testid="quick-add-input"
        placeholder="Quick add — type a card name, Enter adds 1…"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setSelected(0)
        }}
        onKeyDown={onKeyDown}
      />
      <select
        data-testid="quick-add-set"
        value={sessionSet}
        title="Session set — which printing quick-add increments"
        onChange={(event) => setSessionSet(event.target.value)}
      >
        {sets.map((s) => (
          <option key={s.code} value={s.code}>{s.name}</option>
        ))}
      </select>
      {matches.length > 0 && (
        <ul className="quick-add__matches" role="listbox">
          {matches.map((match, index) => (
            <li
              key={match.cardId}
              role="option"
              aria-selected={index === selected}
              data-testid={`quick-add-match-${match.cardId}`}
            >
              {match.inSet ? (
                <button type="button" onClick={() => add(match.inSet!, match.name)}>
                  {match.name}
                </button>
              ) : (
                <span>
                  {match.name} — not in this set:
                  {match.all.map((p) => (
                    <button
                      type="button"
                      key={p.key}
                      data-testid={`quick-add-printing-${p.key}`}
                      onClick={() => add(p, match.name)}
                    >
                      {p.setName} {p.collectorNumber}
                    </button>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {lastAdd !== null && (
        <div className="quick-add__toast" data-testid="quick-add-toast">
          {lastAdd.label}
          <button
            type="button"
            data-testid="quick-add-undo"
            onClick={() => {
              adjustCount(lastAdd.key, -1)
              setLastAdd(null)
            }}
          >
            Undo
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Slot into `CollectionView`**

In `CollectionView.tsx`, above the filters div (only when `loadResult.error === undefined`):

```tsx
<QuickAddBar db={db} printings={loadResult.printings} />
```

Add styles alongside Task 7's: `.quick-add` (flex row), `.quick-add__matches` (positioned dropdown, list-style none), `.quick-add__toast` (small inline strip).

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/ui/quickaddbar.test.tsx tests/ui/collectionview.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/QuickAddBar.tsx src/ui/CollectionView.tsx tests/ui/quickaddbar.test.tsx src/ui/theme.css
git commit -m "feat(collection): quick-add bar with session set and undo"
```

---

### Task 9: Header — stats, buy-list copy, export/import UI

**Files:**
- Create: `src/ui/CollectionHeader.tsx`
- Modify: `src/ui/CollectionView.tsx` (slot it in at the top)
- Test: `tests/ui/collectionheader.test.tsx`

**Interfaces:**
- Consumes: `completionStats`, `buildBuyList`, `exportCollectionJson`, `exportCollectionText`, `importCollectionJson`, `importCollectionText`, `useCollection` (Tasks 4–6); `Printing` (Task 1).
- Produces: `CollectionHeader({ db, printings }: { db: CardDb; printings: Printing[] }): ReactElement`. Test ids: `collection-stats`, `copy-buylist`, `export-json`, `export-text`, `import-input` (a `<textarea>`), `import-mode-replace` / `import-mode-merge` (radio), `import-submit`, `import-error`.

Behavior: stats line "Playset N% · Arts N% · M cards owned". Copy buy-list writes `buildBuyList(..., { playset: true, arts: true })` via `navigator.clipboard.writeText`. Export buttons download a file via a temporary `<a download>` with a `Blob` URL (`collection.json` / `collection.txt`). Import: paste into the textarea, pick replace/merge, submit; the format is sniffed (first non-whitespace char `{` → JSON, else text); a thrown import error renders in `import-error` and nothing is written (the import functions already guarantee that).

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/ui/collectionheader.test.tsx
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { loadCardDb } from '../../src/engine/cardDb'
import { loadPrintings } from '../../src/ui/printings'
import { _resetCollectionCacheForTests, getCollection, setCount } from '../../src/ui/collection'
import { CollectionHeader } from '../../src/ui/CollectionHeader'

const db = loadCardDb()
const printings = loadPrintings()

beforeEach(() => {
  localStorage.clear()
  _resetCollectionCacheForTests()
})

describe('CollectionHeader', () => {
  it('renders live stats', () => {
    render(<CollectionHeader db={db} printings={printings} />)
    expect(screen.getByTestId('collection-stats').textContent).toContain('0 cards owned')
  })

  it('copies the buy-list to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const user = userEvent.setup({ writeToClipboard: false })
    render(<CollectionHeader db={db} printings={printings} />)
    await user.click(screen.getByTestId('copy-buylist'))
    expect(writeText).toHaveBeenCalledOnce()
    expect(writeText.mock.calls[0][0]).toContain('## Missing for playset')
  })

  it('imports pasted JSON with merge mode', async () => {
    setCount(printings[0].key, 1)
    const user = userEvent.setup()
    render(<CollectionHeader db={db} printings={printings} />)
    await user.click(screen.getByTestId('import-mode-merge'))
    await user.type(
      screen.getByTestId('import-input'),
      JSON.stringify({ version: 1, counts: { [printings[0].key]: 2 } }).replace(/[{[]/g, '$&$&')
    ) // userEvent treats { and [ as key markers; doubling escapes them
    await user.click(screen.getByTestId('import-submit'))
    expect(getCollection().counts[printings[0].key]).toBe(3)
  })

  it('shows the error and keeps data on a bad import', async () => {
    setCount(printings[0].key, 1)
    const user = userEvent.setup()
    render(<CollectionHeader db={db} printings={printings} />)
    await user.type(screen.getByTestId('import-input'), 'garbage')
    await user.click(screen.getByTestId('import-submit'))
    expect(screen.getByTestId('import-error').textContent).toContain('Could not import')
    expect(getCollection().counts[printings[0].key]).toBe(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/ui/collectionheader.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```tsx
// src/ui/CollectionHeader.tsx
// Stats strip + buy-list copy + backup (export/import) for the Collection
// tab. Exports download as files; import accepts pasted JSON or text (format
// sniffed by first character) with an explicit replace/merge choice.

import { useMemo, useState, type ReactElement } from 'react'
import type { CardDb } from '../engine/types'
import type { Printing } from './printings'
import {
  useCollection,
  completionStats,
  buildBuyList,
  exportCollectionJson,
  exportCollectionText,
  importCollectionJson,
  importCollectionText,
} from './collection'

function download(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function CollectionHeader({ db, printings }: { db: CardDb; printings: Printing[] }): ReactElement {
  const collection = useCollection()
  const stats = useMemo(
    () => completionStats(db, printings, collection),
    [db, printings, collection]
  )
  const [importText, setImportText] = useState('')
  const [mode, setMode] = useState<'replace' | 'merge'>('replace')
  const [error, setError] = useState('')

  function runImport(): void {
    setError('')
    try {
      if (importText.trimStart().startsWith('{')) importCollectionJson(importText, mode)
      else importCollectionText(importText, mode)
      setImportText('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="collection-header">
      <span data-testid="collection-stats">
        Playset {stats.playsetPct}% · Arts {stats.artsPct}% · {stats.totalOwned} cards owned
      </span>
      <button type="button" data-testid="copy-buylist"
        onClick={() => navigator.clipboard.writeText(
          buildBuyList(db, printings, collection, { playset: true, arts: true })
        )}>
        Copy buy-list
      </button>
      <button type="button" data-testid="export-json"
        onClick={() => download('collection.json', exportCollectionJson(collection))}>
        Export JSON
      </button>
      <button type="button" data-testid="export-text"
        onClick={() => download('collection.txt', exportCollectionText(db, printings, collection))}>
        Export text
      </button>
      <details className="collection-header__import">
        <summary>Import</summary>
        <textarea data-testid="import-input" value={importText}
          placeholder="Paste a collection JSON or text export…"
          onChange={(event) => setImportText(event.target.value)} />
        <label>
          <input type="radio" name="import-mode" data-testid="import-mode-replace"
            checked={mode === 'replace'} onChange={() => setMode('replace')} />
          Replace
        </label>
        <label>
          <input type="radio" name="import-mode" data-testid="import-mode-merge"
            checked={mode === 'merge'} onChange={() => setMode('merge')} />
          Merge (add counts)
        </label>
        <button type="button" data-testid="import-submit" onClick={runImport}>Import</button>
        {error !== '' && <div data-testid="import-error" className="collection-header__error">{error}</div>}
      </details>
    </div>
  )
}
```

Slot into `CollectionView` above the QuickAddBar: `<CollectionHeader db={db} printings={loadResult.printings} />`. Add `.collection-header` styles (flex row, wrap, small gap) next to the Task 7 styles.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/ui/collectionheader.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/CollectionHeader.tsx src/ui/CollectionView.tsx tests/ui/collectionheader.test.tsx src/ui/theme.css
git commit -m "feat(collection): header stats, buy-list copy, export/import UI"
```

---

### Task 10: Deck Builder integration — owned badge + missing summary

**Files:**
- Modify: `src/ui/CardBrowser.tsx` (optional owned prop + badge)
- Modify: `src/ui/DeckBuilderView.tsx` (compute owned map, missing summary strip)
- Test: `tests/ui/deckbuilder.test.tsx` (extend)

**Interfaces:**
- Consumes: `useCollection`, `cardTotal`, `playsetTarget`, `buildDisplayNames` (Tasks 4/5); `loadPrintings` (Task 3); existing `CardBrowserProps`.
- Produces: `CardBrowserProps` gains `owned?: Record<string, number>` (card id → copies owned; absent = feature off, badge hidden — PlayView-side callers pass nothing and render unchanged). Badge test id: `owned-<cardId>`, text `owned N/T`. DeckBuilderView renders `data-testid="deck-missing-summary"` ("You own all cards for this deck" or "Missing N cards for this deck") and `data-testid="copy-deck-buylist"`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/ui/deckbuilder.test.tsx` (match its existing render helper/setup — read the file first and reuse its conventions; the assertions to add):

```tsx
import { setCount, _resetCollectionCacheForTests } from '../../src/ui/collection'
import { loadPrintings } from '../../src/ui/printings'

// inside the existing describe, with localStorage.clear() +
// _resetCollectionCacheForTests() added to the shared beforeEach:

it('shows an owned badge on browser cards once you own copies', async () => {
  const printing = loadPrintings().find((p) => p.cardId === 'mantis-blades')!
  setCount(printing.key, 2)
  renderDeckBuilder() // the file's existing render helper
  expect(screen.getByTestId('owned-mantis-blades').textContent).toBe('owned 2/3')
})

it('summarizes missing cards for the current deck', async () => {
  renderDeckBuilder()
  // Empty collection + a starter deck loaded -> everything is missing.
  const summary = screen.getByTestId('deck-missing-summary')
  expect(summary.textContent).toMatch(/Missing \d+ cards for this deck/)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/ui/deckbuilder.test.tsx`
Expected: the two new tests FAIL (missing test ids); existing tests still pass.

- [ ] **Step 3: Implement the badge in `CardBrowser.tsx`**

- Add to `CardBrowserProps`: `/** Card id -> copies owned (any printing). Absent = collection feature not wired in; badge hidden. */ owned?: Record<string, number>`.
- In the cell render, after the existing count badge:

```tsx
{owned !== undefined && (
  <span className="card-browser__owned" data-testid={`owned-${def.id}`}>
    owned {owned[def.id] ?? 0}/{def.type === 'legend' ? 1 : 3}
  </span>
)}
```

- [ ] **Step 4: Implement the summary in `DeckBuilderView.tsx`**

```tsx
const collection = useCollection()
const printings = useMemo(() => {
  try { return loadPrintings() } catch { return [] }
}, [])
const ownedByCard = useMemo(() => {
  const owned: Record<string, number> = {}
  for (const printing of printings) {
    const count = collection.counts[printing.key] ?? 0
    if (count > 0) owned[printing.cardId] = (owned[printing.cardId] ?? 0) + count
  }
  return owned
}, [printings, collection])

const missing = useMemo(() => {
  const shortfalls: { id: string; missing: number }[] = []
  for (const [id, count] of Object.entries(deck.cards)) {
    const short = Math.max(0, count - (ownedByCard[id] ?? 0))
    if (short > 0) shortfalls.push({ id, missing: short })
  }
  for (const id of deck.legends) {
    if (id !== '' && (ownedByCard[id] ?? 0) === 0) shortfalls.push({ id, missing: 1 })
  }
  return shortfalls
}, [deck, ownedByCard])
```

(Adapt `deck.cards` / `deck.legends` access to the file's actual deck state variable names — read the file first.) Pass `owned={ownedByCard}` to `<CardBrowser>`. Render near the DeckPanel:

```tsx
<div className="deck-missing" data-testid="deck-missing-summary">
  {missing.length === 0
    ? 'You own all cards for this deck'
    : `Missing ${missing.reduce((sum, m) => sum + m.missing, 0)} cards for this deck`}
  {missing.length > 0 && (
    <button type="button" data-testid="copy-deck-buylist"
      onClick={() => {
        const names = buildDisplayNames(db)
        navigator.clipboard.writeText(
          missing.map((m) => `${m.missing}x ${names.get(m.id) ?? m.id}`).join('\n')
        )
      }}>
      Copy buy-list
    </button>
  )}
</div>
```

Style `.card-browser__owned` (second corner badge, offset from `.card-browser__count`) and `.deck-missing` (small strip) alongside existing rules.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: all PASS (Play tab passes no `owned` prop, so PlayView-side CardBrowser usage — if any — renders unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/ui/CardBrowser.tsx src/ui/DeckBuilderView.tsx tests/ui/deckbuilder.test.tsx src/ui/theme.css
git commit -m "feat(collection): deck builder owned badges + missing-cards summary"
```

---

### Task 11: Playwright e2e smoke

**Files:**
- Create: `e2e/collection.spec.ts`

**Interfaces:**
- Consumes: test ids from Tasks 7–10: `tab-collection` (from the App TABS pattern — `data-testid={'tab-' + id}`), `quick-add-input`, `quick-add-set`, `collection-count-<cardId>`, `owned-<cardId>`, `tab-deckBuilder`.

- [ ] **Step 1: Write the e2e spec**

```ts
// e2e/collection.spec.ts
// Smoke: quick-add persists across reload and feeds the Deck Builder badge.
import { test, expect } from '@playwright/test'

test('quick-add persists across reload and shows in the deck builder', async ({ page }) => {
  await page.goto('/?aiDelay=0')
  await page.getByTestId('tab-collection').click()

  await page.getByTestId('quick-add-input').fill('mantis')
  await page.getByTestId('quick-add-input').press('Enter')
  await expect(page.getByTestId('collection-count-mantis-blades')).toContainText('1/3')

  await page.reload()
  await page.getByTestId('tab-collection').click()
  await expect(page.getByTestId('collection-count-mantis-blades')).toContainText('1/3')

  await page.getByTestId('tab-deckBuilder').click()
  await expect(page.getByTestId('owned-mantis-blades')).toContainText('owned 1/3')
})
```

(Check `e2e/play.spec.ts` first for the project's `baseURL`/goto conventions and mirror them exactly.)

Note: quick-add's default session set is the first set in the dataset; `mantis-blades` is in the core set which appears in every list — if the Enter-add lands "not in this set" instead, select a set that contains it first via `page.getByTestId('quick-add-set').selectOption(...)` with a set code from `data/printings.json`.

- [ ] **Step 2: Run it**

Run: `npx playwright test e2e/collection.spec.ts`
Expected: PASS.

- [ ] **Step 3: Run everything**

Run: `npx vitest run && npx playwright test`
Expected: full suite green.

- [ ] **Step 4: Commit**

```bash
git add e2e/collection.spec.ts
git commit -m "test(collection): e2e smoke — quick-add persists and feeds deck builder badge"
```
