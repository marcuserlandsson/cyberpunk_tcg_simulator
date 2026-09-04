# Collection File Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `data/collection.json` the source of truth for the player's collection — read and written by the app through a Vite dev-server endpoint, auto-committed and pushed — so clearing browser data can never lose it, and a failed save never discards work in progress.

**Architecture:** The browser store stays synchronous (`useSyncExternalStore` contract unchanged). Every mutation writes a **pending buffer** to localStorage immediately; a debounced background **flusher** PUTs the whole collection to a Vite plugin endpoint, which validates it, writes it atomically, and schedules a debounced git commit + push. The buffer is cleared only on a confirmed write, so unsaved work survives reloads, crashes, and a dead server.

**Tech Stack:** React 19, TypeScript, Vite 8 (`configureServer`), zod 4, Vitest 4 (node + jsdom), Playwright, Node `fs/promises` + `child_process.execFile` for git.

**Spec:** `docs/superpowers/specs/2026-09-05-collection-file-storage-design.md`

## Global Constraints

- The collection file path comes from `process.env.CTCG_COLLECTION_FILE`, defaulting to `data/collection.json` (relative to repo root). This is what keeps tests off real data — honor it everywhere.
- File shape: `{ version: 1, revision: <int>, savedAt: <ISO string>, counts: Record<string, number> }`. `counts` is unchanged from today's format.
- Counts validation is unchanged: non-negative **safe** integers (`z.number().int().nonnegative()`; zod 4's `.int()` is `safeint`). Never persist a blob the reader would refuse.
- Writes are atomic: write `<file>.tmp` in the same directory, then `rename` over the target. Node's `fs.rename` overwrites an existing destination on Windows and POSIX alike.
- Before every overwrite, copy the previous contents to `data/collection.backup.json` (gitignored).
- A write that takes a **non-empty** collection to empty is refused unless the request carries `confirmEmpty: true`.
- Every non-2xx response body carries a `reason` discriminator (`'invalid' | 'conflict' | 'would-empty'`). The client branches on `reason`, never on the status code alone — two distinct refusals share `409`.
- Git automation commits **only the collection pathspec**, is skipped entirely when `CTCG_COLLECTION_FILE` is set, never auto-pulls/rebases/force-pushes, and can never fail a save.
- The browser store's public API is unchanged: `getCollection`, `setCount`, `adjustCount`, `subscribeCollection`, `useCollection`, `replaceCollection`, `getStorageError`, `_resetCollectionCacheForTests`, plus the derived queries and export/import. The existing **1309 tests must stay green**.
- **Plan clarification over spec §Migration:** the legacy `ctcg:collection:v1` key becomes **read-only immediately** (a migration source only) rather than after the first successful file write. The pending buffer, written on every mutation from the first one, is the browser-side durable copy — so nothing is lost by stopping legacy writes at once, and one write path is simpler than two. The key is never deleted.
- Node-side modules (`src/server/**`) must not import React or anything from `src/ui/**`.
- House style: file-header comment explaining purpose and non-obvious choices; doc comments explain *why*. Tests live in `tests/`, with `// @vitest-environment jsdom` as the first line only for DOM tests. This repo has **no** global RTL auto-cleanup, so DOM test files call `afterEach(cleanup)`.
- Run tests with `npx vitest run <file>`; typecheck with `npx tsc -b`.

---

### Task 1: Shared format module (no behavior change)

**Files:**
- Create: `src/collection/format.ts`
- Modify: `src/ui/collection.ts` (imports; delete the local `Collection`/`collectionSchema` definitions)
- Modify: `src/ui/printings.ts` (move `formatZodIssues` out, import it back)
- Test: `tests/collection/format.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface Collection { counts: Record<string, number> }`
  - `const collectionSchema` — `z.object({ counts: z.record(z.string(), z.number().int().nonnegative()) })`
  - `interface CollectionFile { version: 1; revision: number; savedAt: string; counts: Record<string, number> }`
  - `const collectionFileSchema`
  - `formatZodIssues(error: z.ZodError): string`
  - `EMPTY_FILE: CollectionFile` — `{ version: 1, revision: 0, savedAt: '1970-01-01T00:00:00.000Z', counts: {} }`

This task is a pure extraction: one shared module both the browser store and the Node plugin can import. It must not change any behavior — its success criterion is that the existing suite passes untouched.

- [ ] **Step 1: Write the failing test**

```ts
// tests/collection/format.test.ts
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  collectionSchema,
  collectionFileSchema,
  formatZodIssues,
  EMPTY_FILE,
  type CollectionFile,
} from '../../src/collection/format'

describe('collectionSchema', () => {
  it('accepts non-negative safe integer counts', () => {
    expect(collectionSchema.safeParse({ counts: { 'a/1': 0, 'b/2': 3 } }).success).toBe(true)
  })

  it('rejects a non-safe integer (the 1e20 case that poisoned the blob)', () => {
    expect(collectionSchema.safeParse({ counts: { 'a/1': 1e20 } }).success).toBe(false)
  })

  it('rejects negatives and fractions', () => {
    expect(collectionSchema.safeParse({ counts: { 'a/1': -1 } }).success).toBe(false)
    expect(collectionSchema.safeParse({ counts: { 'a/1': 1.5 } }).success).toBe(false)
  })
})

describe('collectionFileSchema', () => {
  const file: CollectionFile = {
    version: 1,
    revision: 7,
    savedAt: '2026-09-05T10:00:00.000Z',
    counts: { 'a/1': 2 },
  }

  it('accepts a well-formed file', () => {
    expect(collectionFileSchema.safeParse(file).success).toBe(true)
  })

  it('rejects a wrong version', () => {
    expect(collectionFileSchema.safeParse({ ...file, version: 2 }).success).toBe(false)
  })

  it('rejects a negative revision', () => {
    expect(collectionFileSchema.safeParse({ ...file, revision: -1 }).success).toBe(false)
  })

  it('EMPTY_FILE is itself valid and empty', () => {
    expect(collectionFileSchema.safeParse(EMPTY_FILE).success).toBe(true)
    expect(EMPTY_FILE.counts).toEqual({})
    expect(EMPTY_FILE.revision).toBe(0)
  })
})

describe('formatZodIssues', () => {
  it('renders readable lines, not a raw JSON dump', () => {
    const result = collectionSchema.safeParse({ counts: { 'a/1': -1 } })
    if (result.success) throw new Error('fixture assumption failed: expected a parse failure')
    const text = formatZodIssues(result.error)
    expect(text).toContain('counts')
    expect(text).not.toContain('"code"')
    expect(text).not.toContain('[\n')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/collection/format.test.ts`
Expected: FAIL — cannot resolve `../../src/collection/format`.

- [ ] **Step 3: Create the shared module**

```ts
// src/collection/format.ts
// The collection's on-the-wire and on-disk format, shared by the browser
// store (src/ui/collection.ts) and the Node-side dev-server plugin
// (src/server/**). It lives outside both because the plugin cannot import a
// React module and the store cannot import Node built-ins — and because two
// copies of this schema would drift, which is exactly how a validated write
// path stops protecting anything.

import { z } from 'zod'

export interface Collection {
  counts: Record<string, number>
}

/** Counts are non-negative SAFE integers: zod 4's `.int()` is `safeint`, and
 *  the reader refuses anything it cannot re-read, so 1e20 (an integer, but
 *  not a safe one) must fail here rather than poison the stored blob. */
export const collectionSchema = z.object({
  counts: z.record(z.string(), z.number().int().nonnegative()),
})

export interface CollectionFile {
  version: 1
  revision: number
  savedAt: string
  counts: Record<string, number>
}

export const collectionFileSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  savedAt: z.string(),
  counts: z.record(z.string(), z.number().int().nonnegative()),
})

/** The state of a collection that has never been written: revision 0 is what
 *  a client sends as `baseRevision` when it has never seen a file. */
export const EMPTY_FILE: CollectionFile = {
  version: 1,
  revision: 0,
  savedAt: '1970-01-01T00:00:00.000Z',
  counts: {},
}

/** Zod's own `error.message` is a JSON dump of issue objects; these messages
 *  reach the user, so render them as readable lines instead. */
export function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map((segment) => String(segment)).join('.')
      return path === '' ? issue.message : `${path}: ${issue.message}`
    })
    .join('\n')
}
```

- [ ] **Step 4: Repoint the existing modules**

In `src/ui/printings.ts`: delete the local `formatZodIssues` definition and add
`export { formatZodIssues } from '../collection/format'` (it is re-exported
because `collection.ts` and the components already import it from here).

In `src/ui/collection.ts`: delete the local `export interface Collection` and
`const collectionSchema`, and import them instead:

```ts
import { collectionSchema, type Collection } from '../collection/format'
export type { Collection }
```

Keep `formatZodIssues` imported from `./printings` as it is today — that import
still resolves through the re-export, so no other line changes.

- [ ] **Step 5: Run the format test and the full suite**

Run: `npx vitest run tests/collection/format.test.ts` → PASS (9 tests)
Run: `npx vitest run` → **1309 + 9 = 1318 passing**, nothing broken
Run: `npx tsc -b` → clean

- [ ] **Step 6: Commit**

```bash
git add src/collection/format.ts src/ui/collection.ts src/ui/printings.ts tests/collection/format.test.ts
git commit -m "refactor(collection): extract the shared on-disk format module"
```

---

### Task 2: Server file layer — atomic read/write with backup, revision, and guards

**Files:**
- Create: `src/server/collectionFile.ts`
- Test: `tests/server/collectionFile.test.ts`

**Interfaces:**
- Consumes: `collectionSchema`, `collectionFileSchema`, `formatZodIssues`, `EMPTY_FILE`, `CollectionFile`, `Collection` from `src/collection/format`.
- Produces:
  - `resolveCollectionPath(): string` — `process.env.CTCG_COLLECTION_FILE` or `<repo root>/data/collection.json`.
  - `backupPathFor(filePath: string): string` — sibling `<name>.backup.json`.
  - `readCollectionFile(filePath: string): Promise<CollectionFile>` — `EMPTY_FILE` when absent; **throws** `Error` when present but unparseable/invalid (a corrupt file must never be silently overwritten).
  - `type WriteResult = { ok: true; file: CollectionFile } | { ok: false; status: 400 | 409; reason: 'invalid' | 'conflict' | 'would-empty'; message: string; current?: CollectionFile }`
  - `writeCollectionFile(filePath: string, body: { baseRevision: number; counts: unknown; confirmEmpty?: boolean }): Promise<WriteResult>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/collectionFile.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readCollectionFile,
  writeCollectionFile,
  backupPathFor,
} from '../../src/server/collectionFile'

let dir = ''
let file = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ctcg-collection-'))
  file = join(dir, 'collection.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('readCollectionFile', () => {
  it('returns an empty file when none exists', async () => {
    const result = await readCollectionFile(file)
    expect(result.revision).toBe(0)
    expect(result.counts).toEqual({})
  })

  it('round-trips what writeCollectionFile wrote', async () => {
    await writeCollectionFile(file, { baseRevision: 0, counts: { 'a/1': 2 } })
    const result = await readCollectionFile(file)
    expect(result.counts).toEqual({ 'a/1': 2 })
    expect(result.revision).toBe(1)
  })

  it('throws on a corrupt file rather than reporting empty', async () => {
    await writeFile(file, '{ not json', 'utf8')
    await expect(readCollectionFile(file)).rejects.toThrow()
  })

  it('throws on a structurally invalid file', async () => {
    await writeFile(file, JSON.stringify({ version: 1, counts: {} }), 'utf8')
    await expect(readCollectionFile(file)).rejects.toThrow()
  })
})

describe('writeCollectionFile', () => {
  it('increments the revision on each write', async () => {
    const first = await writeCollectionFile(file, { baseRevision: 0, counts: { 'a/1': 1 } })
    if (!first.ok) throw new Error('fixture assumption failed: first write should succeed')
    expect(first.file.revision).toBe(1)
    const second = await writeCollectionFile(file, { baseRevision: 1, counts: { 'a/1': 2 } })
    if (!second.ok) throw new Error('fixture assumption failed: second write should succeed')
    expect(second.file.revision).toBe(2)
  })

  it('rejects invalid counts without touching the file', async () => {
    await writeCollectionFile(file, { baseRevision: 0, counts: { 'a/1': 5 } })
    const before = await readFile(file, 'utf8')
    const result = await writeCollectionFile(file, { baseRevision: 1, counts: { 'a/1': 1e20 } })
    expect(result).toMatchObject({ ok: false, status: 400, reason: 'invalid' })
    expect(await readFile(file, 'utf8')).toBe(before)
  })

  it('rejects a stale baseRevision and returns the current file', async () => {
    await writeCollectionFile(file, { baseRevision: 0, counts: { 'a/1': 1 } })
    const result = await writeCollectionFile(file, { baseRevision: 0, counts: { 'a/1': 9 } })
    expect(result).toMatchObject({ ok: false, status: 409, reason: 'conflict' })
    if (result.ok) throw new Error('fixture assumption failed: expected a conflict')
    expect(result.current?.counts).toEqual({ 'a/1': 1 })
  })

  it('refuses to empty a non-empty collection without confirmEmpty', async () => {
    await writeCollectionFile(file, { baseRevision: 0, counts: { 'a/1': 1 } })
    const result = await writeCollectionFile(file, { baseRevision: 1, counts: {} })
    expect(result).toMatchObject({ ok: false, status: 409, reason: 'would-empty' })
    expect((await readCollectionFile(file)).counts).toEqual({ 'a/1': 1 })
  })

  it('allows emptying with confirmEmpty', async () => {
    await writeCollectionFile(file, { baseRevision: 0, counts: { 'a/1': 1 } })
    const result = await writeCollectionFile(file, { baseRevision: 1, counts: {}, confirmEmpty: true })
    expect(result.ok).toBe(true)
    expect((await readCollectionFile(file)).counts).toEqual({})
  })

  it('writes a backup of the previous contents before overwriting', async () => {
    await writeCollectionFile(file, { baseRevision: 0, counts: { 'a/1': 1 } })
    await writeCollectionFile(file, { baseRevision: 1, counts: { 'a/1': 2 } })
    const backup = JSON.parse(await readFile(backupPathFor(file), 'utf8'))
    expect(backup.counts).toEqual({ 'a/1': 1 })
  })

  it('prunes zero counts', async () => {
    const result = await writeCollectionFile(file, { baseRevision: 0, counts: { 'a/1': 0, 'b/2': 3 } })
    if (!result.ok) throw new Error('fixture assumption failed: write should succeed')
    expect(result.file.counts).toEqual({ 'b/2': 3 })
  })

  it('leaves no .tmp file behind', async () => {
    await writeCollectionFile(file, { baseRevision: 0, counts: { 'a/1': 1 } })
    expect((await readdir(dir)).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/collectionFile.test.ts`
Expected: FAIL — cannot resolve `../../src/server/collectionFile`.

- [ ] **Step 3: Implement**

```ts
// src/server/collectionFile.ts
// Reading and writing data/collection.json — the collection's source of
// truth. Every guard here exists because this file is the only copy of data
// the player enters by hand, card by card:
//
//   * writes are atomic (temp file + rename), so a crash mid-write cannot
//     leave a truncated collection behind;
//   * the previous contents are copied to a sibling .backup.json first;
//   * a corrupt file is reported as an error rather than treated as empty,
//     because "empty" would then be written back over it;
//   * a write that would empty a non-empty collection needs explicit
//     confirmation;
//   * counts are validated with the same schema the browser reader uses, so
//     we never persist something that cannot be read back.
//
// Handlers take an explicit path so they can be tested against a temp
// directory without a running server.

import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  EMPTY_FILE,
  collectionFileSchema,
  collectionSchema,
  formatZodIssues,
  type CollectionFile,
} from '../collection/format'

/** `CTCG_COLLECTION_FILE` overrides the target — the lever that keeps tests
 *  and the e2e suite away from the real collection. */
export function resolveCollectionPath(): string {
  const override = process.env.CTCG_COLLECTION_FILE
  if (override !== undefined && override !== '') return resolve(override)
  return resolve(join(process.cwd(), 'data', 'collection.json'))
}

export function backupPathFor(filePath: string): string {
  return filePath.replace(/\.json$/i, '') + '.backup.json'
}

export async function readCollectionFile(filePath: string): Promise<CollectionFile> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY_FILE
    throw err
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${filePath} is not valid JSON. The previous contents are in ${backupPathFor(filePath)}.`)
  }
  const result = collectionFileSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`${filePath} is not a valid collection file:\n${formatZodIssues(result.error)}`)
  }
  return result.data
}

export type WriteResult =
  | { ok: true; file: CollectionFile }
  | {
      ok: false
      status: 400 | 409
      reason: 'invalid' | 'conflict' | 'would-empty'
      message: string
      current?: CollectionFile
    }

export async function writeCollectionFile(
  filePath: string,
  body: { baseRevision: number; counts: unknown; confirmEmpty?: boolean }
): Promise<WriteResult> {
  const validated = collectionSchema.safeParse({ counts: body.counts })
  if (!validated.success) {
    return {
      ok: false,
      status: 400,
      reason: 'invalid',
      message: `Refusing to save invalid counts:\n${formatZodIssues(validated.error)}`,
    }
  }

  // Prune zero counts: absence means 0, matching the browser store.
  const counts: Record<string, number> = {}
  for (const [key, count] of Object.entries(validated.data.counts)) {
    if (count > 0) counts[key] = count
  }

  const current = await readCollectionFile(filePath)

  if (body.baseRevision !== current.revision) {
    return {
      ok: false,
      status: 409,
      reason: 'conflict',
      message: `The collection on disk changed (revision ${current.revision}, you sent ${body.baseRevision}).`,
      current,
    }
  }

  const wouldEmpty = Object.keys(counts).length === 0 && Object.keys(current.counts).length > 0
  if (wouldEmpty && body.confirmEmpty !== true) {
    return {
      ok: false,
      status: 409,
      reason: 'would-empty',
      message: 'Refusing to empty a non-empty collection without confirmation.',
      current,
    }
  }

  const next: CollectionFile = {
    version: 1,
    revision: current.revision + 1,
    savedAt: new Date().toISOString(),
    counts,
  }

  await mkdir(dirname(filePath), { recursive: true })
  if (current.revision > 0) {
    // Best-effort: a missing previous file is not a reason to refuse a write.
    try {
      await copyFile(filePath, backupPathFor(filePath))
    } catch {
      /* ignore */
    }
  }

  const tmp = `${filePath}.tmp`
  await writeFile(tmp, JSON.stringify(next, null, 1) + '\n', 'utf8')
  await rename(tmp, filePath)

  return { ok: true, file: next }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/server/collectionFile.test.ts` → PASS (13 tests)
Run: `npx tsc -b` → clean

- [ ] **Step 5: Commit**

```bash
git add src/server/collectionFile.ts tests/server/collectionFile.test.ts
git commit -m "feat(collection): atomic file layer with backup, revisions, and wipe guard"
```

---

### Task 3: Server git layer — debounced commit and push that can never break a save

**Files:**
- Create: `src/server/collectionGit.ts`
- Test: `tests/server/collectionGit.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type GitResult = { status: 'ok' | 'skipped' | 'failed'; detail: string }`
  - `commitCollection(filePath: string, summary: string): Promise<GitResult>` — commits that pathspec only, then pushes when an upstream exists. Never throws.
  - `scheduleCommit(filePath: string, summary: string, onResult: (r: GitResult) => void): void` — debounces 5s; a later call resets the timer.
  - `_flushCommitTimerForTests(): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/collectionGit.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { commitCollection } from '../../src/server/collectionGit'

const run = promisify(execFile)
let dir = ''
let file = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ctcg-git-'))
  file = join(dir, 'collection.json')
  await run('git', ['init', '-b', 'main'], { cwd: dir })
  await run('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  await run('git', ['config', 'user.name', 'Test'], { cwd: dir })
  await writeFile(join(dir, 'README.md'), 'seed\n', 'utf8')
  await run('git', ['add', 'README.md'], { cwd: dir })
  await run('git', ['commit', '-m', 'seed'], { cwd: dir })
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function log(): Promise<string> {
  const { stdout } = await run('git', ['log', '--oneline'], { cwd: dir })
  return stdout
}

describe('commitCollection', () => {
  it('commits the collection file', async () => {
    await writeFile(file, '{}', 'utf8')
    const result = await commitCollection(file, '3 cards')
    expect(result.status).toBe('ok')
    expect(await log()).toContain('3 cards')
  })

  it('commits ONLY the collection pathspec, leaving other work dirty', async () => {
    await writeFile(file, '{}', 'utf8')
    await writeFile(join(dir, 'unrelated.txt'), 'in progress\n', 'utf8')
    await commitCollection(file, '1 card')
    const { stdout } = await run('git', ['status', '--porcelain'], { cwd: dir })
    expect(stdout).toContain('unrelated.txt')
  })

  it('skips when the file has not changed', async () => {
    await writeFile(file, '{}', 'utf8')
    await commitCollection(file, 'first')
    const result = await commitCollection(file, 'second')
    expect(result.status).toBe('skipped')
    expect(await log()).not.toContain('second')
  })

  it('skips push when no upstream is configured, still reporting ok', async () => {
    await writeFile(file, '{}', 'utf8')
    const result = await commitCollection(file, 'no upstream')
    expect(result.status).toBe('ok')
    expect(result.detail).toMatch(/push skipped/i)
  })

  it('reports skipped, not failed, outside a git work tree', async () => {
    const bare = await mkdtemp(join(tmpdir(), 'ctcg-nogit-'))
    try {
      const loose = join(bare, 'collection.json')
      await writeFile(loose, '{}', 'utf8')
      const result = await commitCollection(loose, 'nowhere')
      expect(result.status).toBe('skipped')
    } finally {
      await rm(bare, { recursive: true, force: true })
    }
  })

  it('never throws, even on a nonsense path', async () => {
    const result = await commitCollection(join(dir, 'no', 'such', 'file.json'), 'missing')
    expect(['skipped', 'failed']).toContain(result.status)
  })

  it('is skipped entirely when CTCG_COLLECTION_FILE is set (tests never commit)', async () => {
    const previous = process.env.CTCG_COLLECTION_FILE
    process.env.CTCG_COLLECTION_FILE = file
    try {
      await writeFile(file, '{}', 'utf8')
      const result = await commitCollection(file, 'should not commit')
      expect(result.status).toBe('skipped')
      expect(await log()).not.toContain('should not commit')
    } finally {
      if (previous === undefined) delete process.env.CTCG_COLLECTION_FILE
      else process.env.CTCG_COLLECTION_FILE = previous
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/collectionGit.test.ts`
Expected: FAIL — cannot resolve `../../src/server/collectionGit`.

- [ ] **Step 3: Implement**

```ts
// src/server/collectionGit.ts
// Auto-commit and push the collection file, batched so a pack of quick-adds
// becomes one commit rather than one per card.
//
// Two rules shape everything here. First, this must never break a save: by
// the time git runs, the collection is already durable on disk, so every
// failure is reported and swallowed, never thrown. Second, it touches
// nothing but the collection: commits pass an explicit pathspec so unrelated
// in-progress work is never swept in, and a rejected push is left for the
// user — resolving remote divergence is not a decision a background process
// should make in someone's repo.

import { execFile } from 'node:child_process'
import { dirname } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const DEBOUNCE_MS = 5000

export type GitResult = { status: 'ok' | 'skipped' | 'failed'; detail: string }

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd })
  return stdout.trim()
}

export async function commitCollection(filePath: string, summary: string): Promise<GitResult> {
  // Tests point CTCG_COLLECTION_FILE at a scratch file; they must never
  // produce commits in the real repository.
  if (process.env.CTCG_COLLECTION_FILE !== undefined && process.env.CTCG_COLLECTION_FILE !== '') {
    return { status: 'skipped', detail: 'CTCG_COLLECTION_FILE is set; git automation disabled' }
  }

  const cwd = dirname(filePath)
  try {
    const inside = await git(cwd, ['rev-parse', '--is-inside-work-tree'])
    if (inside !== 'true') return { status: 'skipped', detail: 'not a git work tree' }
  } catch {
    return { status: 'skipped', detail: 'not a git work tree' }
  }

  try {
    const status = await git(cwd, ['status', '--porcelain', '--', filePath])
    if (status === '') return { status: 'skipped', detail: 'collection file unchanged' }

    await git(cwd, ['add', '--', filePath])
    await git(cwd, ['commit', '-m', `chore(collection): ${summary}`, '--', filePath])

    try {
      await git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
    } catch {
      return { status: 'ok', detail: 'committed; push skipped (no upstream configured)' }
    }

    try {
      await git(cwd, ['push'])
      return { status: 'ok', detail: 'committed and pushed' }
    } catch (err) {
      // A rejected push means the remote moved. The commit is safe locally;
      // resolving divergence is the user's call, not ours.
      return { status: 'failed', detail: `committed, but push failed: ${String(err)}` }
    }
  } catch (err) {
    return { status: 'failed', detail: String(err) }
  }
}

let timer: ReturnType<typeof setTimeout> | undefined
let inFlight: Promise<void> | undefined

/** Debounced: a burst of saves produces one commit once writes go quiet. */
export function scheduleCommit(
  filePath: string,
  summary: string,
  onResult: (result: GitResult) => void
): void {
  if (timer !== undefined) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = undefined
    inFlight = commitCollection(filePath, summary).then(onResult)
  }, DEBOUNCE_MS)
}

/** Test-only: run any pending debounced commit immediately and await it. */
export async function _flushCommitTimerForTests(): Promise<void> {
  if (timer !== undefined) {
    clearTimeout(timer)
    timer = undefined
  }
  await inFlight
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/server/collectionGit.test.ts` → PASS (7 tests)
Run: `npx tsc -b` → clean

Note: these tests shell out to real `git` in temp repos. That is deliberate — mocking `execFile` would only prove the mock's shape, not that the pathspec commit actually leaves other files dirty.

- [ ] **Step 5: Commit**

```bash
git add src/server/collectionGit.ts tests/server/collectionGit.test.ts
git commit -m "feat(collection): debounced git commit/push that never breaks a save"
```

---

### Task 4: Vite plugin — the HTTP endpoint

**Files:**
- Create: `src/server/collectionPlugin.ts`
- Modify: `vite.config.ts`
- Modify: `.gitignore` (add `data/collection.backup.json`)
- Test: `tests/server/collectionPlugin.test.ts`

**Interfaces:**
- Consumes: `readCollectionFile`, `writeCollectionFile`, `resolveCollectionPath` (Task 2); `scheduleCommit`, `GitResult` (Task 3).
- Produces:
  - `handleCollectionRequest(filePath, method, body): Promise<{ status: number; body: unknown }>` — transport-free core, unit tested directly.
  - `collectionPlugin(): Plugin` — the Vite plugin wiring `/__collection` to it via `configureServer`.
  - Response bodies: `GET` → `CollectionFile`; `PUT` ok → `{ revision, savedAt, git }`; error → `{ reason, message, current? }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/collectionPlugin.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleCollectionRequest } from '../../src/server/collectionPlugin'

let dir = ''
let file = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ctcg-plugin-'))
  file = join(dir, 'collection.json')
  process.env.CTCG_COLLECTION_FILE = file // also disables git automation
})

afterEach(async () => {
  delete process.env.CTCG_COLLECTION_FILE
  await rm(dir, { recursive: true, force: true })
})

describe('handleCollectionRequest', () => {
  it('GET returns an empty file before anything is saved', async () => {
    const result = await handleCollectionRequest(file, 'GET', undefined)
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ version: 1, revision: 0, counts: {} })
  })

  it('PUT saves and GET reads it back', async () => {
    const put = await handleCollectionRequest(file, 'PUT', { baseRevision: 0, counts: { 'a/1': 2 } })
    expect(put.status).toBe(200)
    expect(put.body).toMatchObject({ revision: 1 })
    const get = await handleCollectionRequest(file, 'GET', undefined)
    expect(get.body).toMatchObject({ counts: { 'a/1': 2 }, revision: 1 })
  })

  it('PUT with invalid counts returns 400 with reason "invalid"', async () => {
    const result = await handleCollectionRequest(file, 'PUT', { baseRevision: 0, counts: { 'a/1': -3 } })
    expect(result.status).toBe(400)
    expect(result.body).toMatchObject({ reason: 'invalid' })
  })

  it('PUT with a stale revision returns 409 "conflict" carrying the current file', async () => {
    await handleCollectionRequest(file, 'PUT', { baseRevision: 0, counts: { 'a/1': 1 } })
    const result = await handleCollectionRequest(file, 'PUT', { baseRevision: 0, counts: { 'a/1': 5 } })
    expect(result.status).toBe(409)
    expect(result.body).toMatchObject({ reason: 'conflict' })
    expect((result.body as { current: { counts: Record<string, number> } }).current.counts).toEqual({ 'a/1': 1 })
  })

  it('PUT that would empty a non-empty collection returns 409 "would-empty"', async () => {
    await handleCollectionRequest(file, 'PUT', { baseRevision: 0, counts: { 'a/1': 1 } })
    const result = await handleCollectionRequest(file, 'PUT', { baseRevision: 1, counts: {} })
    expect(result.status).toBe(409)
    expect(result.body).toMatchObject({ reason: 'would-empty' })
  })

  it('PUT with a malformed body returns 400 rather than throwing', async () => {
    const result = await handleCollectionRequest(file, 'PUT', { nonsense: true })
    expect(result.status).toBe(400)
    expect(result.body).toMatchObject({ reason: 'invalid' })
  })

  it('an unsupported method returns 405', async () => {
    const result = await handleCollectionRequest(file, 'DELETE', undefined)
    expect(result.status).toBe(405)
  })

  it('a corrupt file surfaces as 500 rather than being overwritten', async () => {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(file, 'not json', 'utf8')
    const result = await handleCollectionRequest(file, 'GET', undefined)
    expect(result.status).toBe(500)
    expect(await (await import('node:fs/promises')).readFile(file, 'utf8')).toBe('not json')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/collectionPlugin.test.ts`
Expected: FAIL — cannot resolve `../../src/server/collectionPlugin`.

- [ ] **Step 3: Implement**

```ts
// src/server/collectionPlugin.ts
// The dev-server endpoint backing data/collection.json.
//
// The transport-free core (`handleCollectionRequest`) is separated from the
// Vite plumbing so the whole contract — status codes, reason discriminators,
// conflict payloads — is unit tested by calling a function, with no server
// to start and no ports to bind.

import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  readCollectionFile,
  resolveCollectionPath,
  writeCollectionFile,
} from './collectionFile'
import { scheduleCommit, type GitResult } from './collectionGit'

export const COLLECTION_ROUTE = '/__collection'

let lastGitResult: GitResult = { status: 'skipped', detail: 'no save yet' }

export async function handleCollectionRequest(
  filePath: string,
  method: string,
  body: unknown
): Promise<{ status: number; body: unknown }> {
  try {
    if (method === 'GET') {
      return { status: 200, body: await readCollectionFile(filePath) }
    }

    if (method === 'PUT') {
      const input = body as { baseRevision?: unknown; counts?: unknown; confirmEmpty?: unknown }
      if (
        input === null ||
        typeof input !== 'object' ||
        typeof input.baseRevision !== 'number' ||
        typeof input.counts !== 'object' ||
        input.counts === null
      ) {
        return {
          status: 400,
          body: { reason: 'invalid', message: 'Expected { baseRevision: number, counts: object }.' },
        }
      }

      const result = await writeCollectionFile(filePath, {
        baseRevision: input.baseRevision,
        counts: input.counts,
        confirmEmpty: input.confirmEmpty === true,
      })

      if (!result.ok) {
        return {
          status: result.status,
          body: { reason: result.reason, message: result.message, current: result.current },
        }
      }

      const cards = Object.values(result.file.counts).reduce((sum, n) => sum + n, 0)
      const printings = Object.keys(result.file.counts).length
      scheduleCommit(filePath, `${cards} cards, ${printings} printings`, (r) => {
        lastGitResult = r
      })

      return {
        status: 200,
        body: { revision: result.file.revision, savedAt: result.file.savedAt, git: lastGitResult },
      }
    }

    return { status: 405, body: { reason: 'invalid', message: `${method} is not supported.` } }
  } catch (err) {
    // A corrupt or unreadable file lands here. Reporting it is the whole
    // point: the alternative is treating it as empty and overwriting it.
    return { status: 500, body: { reason: 'invalid', message: String(err) } }
  }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  if (chunks.length === 0) return undefined
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return undefined
  }
}

export function collectionPlugin(): Plugin {
  return {
    name: 'ctcg-collection',
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = (req.url ?? '').split('?')[0]
        if (url !== COLLECTION_ROUTE) return next()
        const filePath = resolveCollectionPath()
        const body = req.method === 'PUT' ? await readBody(req) : undefined
        const result = await handleCollectionRequest(filePath, req.method ?? 'GET', body)
        res.statusCode = result.status
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(result.body))
      })
    },
  }
}
```

- [ ] **Step 4: Register the plugin and ignore the backup**

In `vite.config.ts`, import and add it to `plugins`:

```ts
import { collectionPlugin } from './src/server/collectionPlugin'
// ...
plugins: [react(), collectionPlugin()],
```

Append to `.gitignore`:

```
data/collection.backup.json
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/server/collectionPlugin.test.ts` → PASS (8 tests)
Run: `npx vitest run` → everything green
Run: `npx tsc -b` → clean

- [ ] **Step 6: Verify the endpoint by hand once**

Run `npm run dev` in one shell, then in another:

```bash
curl -s http://localhost:5173/__collection
curl -s -X PUT http://localhost:5173/__collection -H 'Content-Type: application/json' -d '{"baseRevision":0,"counts":{"welcometonightcitybeta/β025":1}}'
```

Expected: the first returns `revision: 0` and empty counts; the second returns `revision: 1`. **Then undo it** — `git checkout -- data/collection.json` if it was created, or delete the file — so the manual probe does not leave a stray collection behind. Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add src/server/collectionPlugin.ts vite.config.ts .gitignore tests/server/collectionPlugin.test.ts
git commit -m "feat(collection): dev-server endpoint for the collection file"
```

---

### Task 5: Pending buffer in the browser store

**Files:**
- Modify: `src/ui/collection.ts`
- Test: `tests/ui/collection.test.ts` (extend)

**Interfaces:**
- Consumes: `collectionSchema`, `Collection` (Task 1).
- Produces (all additive; every existing export keeps its signature):
  - `PENDING_KEY = 'ctcg:collection:pending:v1'`
  - `interface PendingBuffer { counts: Record<string, number>; baseRevision: number }`
  - `readPendingBuffer(): PendingBuffer | undefined`
  - `clearPendingBuffer(): void`
  - `setBaseRevision(revision: number): void` / `getBaseRevision(): number`
  - `setCollectionFromFile(counts: Record<string, number>, revision: number): void` — adopt server state without marking it pending (used on load and after a confirmed write).
  - `readLegacyCollection(): Collection | undefined` — the migration source.

Behavior change inside `writeCollection`: it now writes the **pending buffer** instead of the legacy key. The legacy key becomes read-only (see Global Constraints). Validation, zero-count pruning, `storageError`, cache invalidation, and listener notification all stay exactly as they are.

- [ ] **Step 1: Write the failing test**

```ts
// appended to tests/ui/collection.test.ts
import {
  PENDING_KEY,
  readPendingBuffer,
  clearPendingBuffer,
  setBaseRevision,
  getBaseRevision,
  setCollectionFromFile,
  readLegacyCollection,
} from '../../src/ui/collection'

describe('pending buffer', () => {
  it('records every mutation with the current base revision', () => {
    setBaseRevision(7)
    setCount('a/1', 2)
    expect(readPendingBuffer()).toEqual({ counts: { 'a/1': 2 }, baseRevision: 7 })
  })

  it('survives a reload (it is real localStorage, not memory)', () => {
    setCount('a/1', 3)
    _resetCollectionCacheForTests()
    expect(readPendingBuffer()?.counts).toEqual({ 'a/1': 3 })
  })

  it('clearPendingBuffer removes it without touching the collection', () => {
    setCount('a/1', 1)
    clearPendingBuffer()
    expect(readPendingBuffer()).toBeUndefined()
    expect(getCollection().counts).toEqual({ 'a/1': 1 })
  })

  it('setCollectionFromFile adopts server state WITHOUT creating a buffer', () => {
    setCollectionFromFile({ 'b/2': 4 }, 9)
    expect(getCollection().counts).toEqual({ 'b/2': 4 })
    expect(getBaseRevision()).toBe(9)
    expect(readPendingBuffer()).toBeUndefined()
  })

  it('setCollectionFromFile still notifies subscribers', () => {
    let calls = 0
    const unsubscribe = subscribeCollection(() => calls++)
    setCollectionFromFile({ 'b/2': 1 }, 2)
    expect(calls).toBe(1)
    unsubscribe()
  })

  it('does not write the legacy key any more, but still reads it', () => {
    localStorage.setItem('ctcg:collection:v1', JSON.stringify({ counts: { 'legacy/1': 5 } }))
    expect(readLegacyCollection()?.counts).toEqual({ 'legacy/1': 5 })
    setCount('a/1', 1)
    expect(JSON.parse(localStorage.getItem('ctcg:collection:v1')!).counts).toEqual({ 'legacy/1': 5 })
    expect(readPendingBuffer()?.counts).toEqual({ 'a/1': 1 })
  })

  it('a malformed buffer is ignored rather than throwing', () => {
    localStorage.setItem(PENDING_KEY, '{ not json')
    expect(readPendingBuffer()).toBeUndefined()
  })

  it('refuses to buffer counts the reader would reject, and says so', () => {
    setCount('a/1', 1)
    setCount('b/2', 1e20)
    expect(getStorageError()).toContain('Could not save')
    expect(readPendingBuffer()?.counts).toEqual({ 'a/1': 1 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui/collection.test.ts`
Expected: FAIL — the new exports do not exist.

- [ ] **Step 3: Implement**

In `src/ui/collection.ts`, add below `COLLECTION_KEY`:

```ts
/** The browser-side durable copy of unsaved work. Written synchronously on
 *  every mutation and cleared ONLY by a confirmed write to disk, so a whole
 *  booster box entered while the dev server was down survives a reload, a
 *  crash, and closing the tab. */
export const PENDING_KEY = 'ctcg:collection:pending:v1'

export interface PendingBuffer {
  counts: Record<string, number>
  baseRevision: number
}

const pendingSchema = z.object({
  counts: z.record(z.string(), z.number().int().nonnegative()),
  baseRevision: z.number().int().nonnegative(),
})

let baseRevision = 0

export function getBaseRevision(): number {
  return baseRevision
}

export function setBaseRevision(revision: number): void {
  baseRevision = revision
}

export function readPendingBuffer(): PendingBuffer | undefined {
  const raw = localStorage.getItem(PENDING_KEY)
  if (raw === null) return undefined
  try {
    const parsed = pendingSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

export function clearPendingBuffer(): void {
  localStorage.removeItem(PENDING_KEY)
}

/** The pre-file storage key, kept read-only as a migration source. */
export function readLegacyCollection(): Collection | undefined {
  const raw = localStorage.getItem(COLLECTION_KEY)
  if (raw === null) return undefined
  try {
    const parsed = collectionSchema.safeParse(JSON.parse(raw))
    return parsed.success ? freeze(parsed.data) : undefined
  } catch {
    return undefined
  }
}
```

Replace `readCollection`'s body so the buffer is the browser-side source, with the legacy key as a one-time fallback:

```ts
function readCollection(): Collection {
  const pending = readPendingBuffer()
  if (pending !== undefined) return freeze({ counts: pending.counts })
  return readLegacyCollection() ?? emptyCollection()
}
```

In `writeCollection`, replace the `localStorage.setItem(COLLECTION_KEY, ...)` line with the buffer write (everything else in that function is unchanged):

```ts
      localStorage.setItem(PENDING_KEY, JSON.stringify({ counts, baseRevision }))
```

Add, next to `replaceCollection`:

```ts
/** Adopt state that is already on disk: updates the snapshot and notifies
 *  subscribers, but creates NO pending buffer, because there is nothing
 *  unsaved. Used on load and after a confirmed write. */
export function setCollectionFromFile(counts: Record<string, number>, revision: number): void {
  baseRevision = revision
  clearPendingBuffer()
  cache = freeze({ counts: { ...counts } })
  storageError = ''
  for (const listener of listeners) listener()
}
```

Extend `_resetCollectionCacheForTests` to also reset `baseRevision = 0`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/ui/collection.test.ts` → PASS, including all pre-existing cases
Run: `npx vitest run` → green
Run: `npx tsc -b` → clean

Exactly **two** pre-existing assertions in `tests/ui/collection.test.ts` name the storage key as the *write target* and must be repointed at the buffer. Change only these:

1. `'setCount clamps negatives to 0 and prunes zero counts'` — the line reading
   `expect(JSON.parse(localStorage.getItem('ctcg:collection:v1')!)).toEqual({ counts: {} })`
   becomes
   `expect(JSON.parse(localStorage.getItem(PENDING_KEY)!)).toEqual({ counts: {}, baseRevision: 0 })`.
2. `'refuses to persist a blob its own reader would reject, and says so'` — the line reading
   `expect(JSON.parse(localStorage.getItem('ctcg:collection:v1')!)).toEqual({ counts: { 'beta/1': 2 } })`
   becomes
   `expect(JSON.parse(localStorage.getItem(PENDING_KEY)!)).toEqual({ counts: { 'beta/1': 2 }, baseRevision: 0 })`.

The other three references to `ctcg:collection:v1` (in `'preserves unknown keys already in storage across writes'`, `'falls back to empty on a malformed blob'`, and `'the refused blob would in fact have been unreadable'`) **seed** that key rather than assert on it. Leave all three exactly as they are — they still pass, and they now double as coverage of the legacy read-fallback path. Do not weaken any assertion to get green; if one of those three fails, stop and report it rather than editing it.

- [ ] **Step 5: Commit**

```bash
git add src/ui/collection.ts tests/ui/collection.test.ts
git commit -m "feat(collection): pending buffer as the browser-side durable copy"
```

---

### Task 6: The flusher — debounce, retry, status, conflict

**Files:**
- Create: `src/ui/collectionSync.ts`
- Test: `tests/ui/collectionSync.test.ts`

**Interfaces:**
- Consumes: `getCollection`, `setCollectionFromFile`, `readPendingBuffer`, `clearPendingBuffer`, `getBaseRevision`, `setBaseRevision`, `subscribeCollection` (Task 5); the endpoint contract (Task 4).
- Produces:
  - `interface SyncStatus { state: 'idle' | 'saving' | 'unsaved' | 'conflict'; pendingCount: number; lastSavedAt?: string; message?: string; git?: 'ok' | 'skipped' | 'failed' }`
  - `getSyncStatus(): SyncStatus` (reference-stable between changes) / `subscribeSync(listener)` / `useSyncStatus(): SyncStatus`
  - `initCollectionSync(): Promise<void>` — load from the endpoint, adopt buffer if present, migrate the legacy key, start listening for mutations.
  - `flushNow(): Promise<void>` — used by the Retry button and by tests.
  - `resolveConflict(choice: 'mine' | 'disk'): Promise<void>`
  - `_resetSyncForTests(): void`

- [ ] **Step 1: Write the failing test**

```ts
// tests/ui/collectionSync.test.ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetCollectionCacheForTests,
  getCollection,
  readPendingBuffer,
  setCount,
} from '../../src/ui/collection'
import {
  _resetSyncForTests,
  flushNow,
  getSyncStatus,
  initCollectionSync,
  resolveConflict,
} from '../../src/ui/collectionSync'

const okFile = { version: 1, revision: 3, savedAt: '2026-09-05T00:00:00.000Z', counts: { 'a/1': 1 } }

function stubFetch(handler: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const { status, body } = handler(String(url), init)
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
  }))
}

beforeEach(() => {
  localStorage.clear()
  _resetCollectionCacheForTests()
  _resetSyncForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('initCollectionSync', () => {
  it('adopts the file from the endpoint', async () => {
    stubFetch(() => ({ status: 200, body: okFile }))
    await initCollectionSync()
    expect(getCollection().counts).toEqual({ 'a/1': 1 })
    expect(getSyncStatus().state).toBe('idle')
  })

  it('a pending buffer wins over the file and is flushed immediately', async () => {
    localStorage.setItem(
      'ctcg:collection:pending:v1',
      JSON.stringify({ counts: { 'b/2': 9 }, baseRevision: 3 })
    )
    _resetCollectionCacheForTests()
    const calls: string[] = []
    stubFetch((url, init) => {
      calls.push(String(init?.method ?? 'GET'))
      if ((init?.method ?? 'GET') === 'GET') return { status: 200, body: okFile }
      return { status: 200, body: { revision: 4, savedAt: 'now', git: { status: 'ok' } } }
    })
    await initCollectionSync()
    await flushNow()
    expect(getCollection().counts).toEqual({ 'b/2': 9 })
    expect(calls).toContain('PUT')
    expect(readPendingBuffer()).toBeUndefined()
  })

  it('migrates the legacy key when the file is empty', async () => {
    localStorage.setItem('ctcg:collection:v1', JSON.stringify({ counts: { 'legacy/1': 2 } }))
    _resetCollectionCacheForTests()
    stubFetch((_url, init) =>
      (init?.method ?? 'GET') === 'GET'
        ? { status: 200, body: { version: 1, revision: 0, savedAt: 'x', counts: {} } }
        : { status: 200, body: { revision: 1, savedAt: 'now', git: { status: 'ok' } } }
    )
    await initCollectionSync()
    await flushNow()
    expect(getCollection().counts).toEqual({ 'legacy/1': 2 })
  })

  it('falls back to the buffer and reports unsaved when the endpoint is unreachable', async () => {
    localStorage.setItem(
      'ctcg:collection:pending:v1',
      JSON.stringify({ counts: { 'b/2': 5 }, baseRevision: 0 })
    )
    _resetCollectionCacheForTests()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    await initCollectionSync()
    expect(getCollection().counts).toEqual({ 'b/2': 5 })
    expect(getSyncStatus().state).toBe('unsaved')
  })
})

describe('flushing', () => {
  it('a successful flush clears the buffer and reports idle', async () => {
    stubFetch((_url, init) =>
      (init?.method ?? 'GET') === 'GET'
        ? { status: 200, body: okFile }
        : { status: 200, body: { revision: 4, savedAt: '2026-09-05T01:00:00.000Z', git: { status: 'ok' } } }
    )
    await initCollectionSync()
    setCount('c/3', 2)
    await flushNow()
    expect(readPendingBuffer()).toBeUndefined()
    expect(getSyncStatus().state).toBe('idle')
    expect(getSyncStatus().lastSavedAt).toBe('2026-09-05T01:00:00.000Z')
  })

  it('a failed flush RETAINS the buffer and counts the unsaved copies', async () => {
    let allow = true
    stubFetch((_url, init) => {
      if ((init?.method ?? 'GET') === 'GET') return { status: 200, body: okFile }
      if (allow) return { status: 200, body: { revision: 4, savedAt: 'now', git: { status: 'ok' } } }
      throw new Error('ECONNREFUSED')
    })
    await initCollectionSync()
    allow = false
    setCount('c/3', 300)
    await flushNow()
    expect(readPendingBuffer()?.counts).toEqual({ 'a/1': 1, 'c/3': 300 })
    expect(getSyncStatus().state).toBe('unsaved')
    expect(getSyncStatus().pendingCount).toBe(300)
  })

  it('a 409 conflict stops retrying and surfaces the disk version', async () => {
    stubFetch((_url, init) =>
      (init?.method ?? 'GET') === 'GET'
        ? { status: 200, body: okFile }
        : { status: 409, body: { reason: 'conflict', message: 'moved', current: { ...okFile, revision: 8, counts: { 'z/9': 4 } } } }
    )
    await initCollectionSync()
    setCount('c/3', 1)
    await flushNow()
    expect(getSyncStatus().state).toBe('conflict')
    expect(readPendingBuffer()).toBeDefined()
  })

  it('resolveConflict("disk") discards the buffer and takes the file', async () => {
    stubFetch((_url, init) =>
      (init?.method ?? 'GET') === 'GET'
        ? { status: 200, body: { ...okFile, revision: 8, counts: { 'z/9': 4 } } }
        : { status: 409, body: { reason: 'conflict', message: 'moved', current: { ...okFile, revision: 8, counts: { 'z/9': 4 } } } }
    )
    await initCollectionSync()
    setCount('c/3', 1)
    await flushNow()
    await resolveConflict('disk')
    expect(getCollection().counts).toEqual({ 'z/9': 4 })
    expect(readPendingBuffer()).toBeUndefined()
    expect(getSyncStatus().state).toBe('idle')
  })

  it('surfaces a failed git push without changing the save state', async () => {
    stubFetch((_url, init) =>
      (init?.method ?? 'GET') === 'GET'
        ? { status: 200, body: okFile }
        : { status: 200, body: { revision: 4, savedAt: 'now', git: { status: 'failed', detail: 'rejected' } } }
    )
    await initCollectionSync()
    setCount('c/3', 1)
    await flushNow()
    expect(getSyncStatus().state).toBe('idle')
    expect(getSyncStatus().git).toBe('failed')
  })

  it('getSyncStatus is reference-stable between changes', async () => {
    stubFetch(() => ({ status: 200, body: okFile }))
    await initCollectionSync()
    expect(getSyncStatus()).toBe(getSyncStatus())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui/collectionSync.test.ts`
Expected: FAIL — cannot resolve `../../src/ui/collectionSync`.

- [ ] **Step 3: Implement**

```ts
// src/ui/collectionSync.ts
// Pushes the collection to disk through the dev-server endpoint, in the
// background, so the store itself can stay synchronous.
//
// The one rule everything else serves: a failed save must never discard the
// player's work. The pending buffer (src/ui/collection.ts) is cleared only
// after the server confirms a write, so 300 cards entered while the server
// was down survive a reload and are retried until they land.

import { useSyncExternalStore } from 'react'
import {
  PENDING_KEY,
  clearPendingBuffer,
  getBaseRevision,
  readLegacyCollection,
  readPendingBuffer,
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
let lastConfirmed: Record<string, number> = {}
let diskVersion: { counts: Record<string, number>; revision: number } | undefined
let timer: ReturnType<typeof setTimeout> | undefined
let attempt = 0
let started = false

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
    lastConfirmed = { ...buffer.counts }
    setBaseRevision(body.revision)
    clearPendingBuffer()
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
  // not help, but the buffer is still the player's work — keep it and say so.
  setStatus({ state: 'unsaved', pendingCount: countPending(), message: body.message })
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
  setStatus({ state: 'unsaved', message: undefined })
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
        setBaseRevision(file.revision)
        localStorage.setItem(
          PENDING_KEY,
          JSON.stringify({ counts: legacy.counts, baseRevision: file.revision })
        )
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
    subscribeCollection(() => {
      if (readPendingBuffer() !== undefined) {
        setStatus({ state: status.state === 'conflict' ? 'conflict' : 'unsaved', pendingCount: countPending() })
        scheduleFlush()
      }
    })
    if (typeof window !== 'undefined') {
      window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') void flushNow()
      })
      window.addEventListener('beforeunload', () => void flushNow())
    }
  }
}

export function _resetSyncForTests(): void {
  if (timer !== undefined) clearTimeout(timer)
  timer = undefined
  attempt = 0
  started = false
  diskVersion = undefined
  lastConfirmed = {}
  status = { state: 'idle', pendingCount: 0 }
  syncListeners.clear()
}
```

The import list above is exactly what the implementation uses — `getCollection` is deliberately absent, because the flusher reads the buffer (the unsaved truth), never the rendered snapshot.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/ui/collectionSync.test.ts` → PASS (11 tests)
Run: `npx vitest run` → green
Run: `npx tsc -b` → clean

- [ ] **Step 5: Commit**

```bash
git add src/ui/collectionSync.ts tests/ui/collectionSync.test.ts
git commit -m "feat(collection): background flusher with retry, conflict, and status"
```

---

### Task 7: Sync status in the Collection header

**Files:**
- Modify: `src/ui/CollectionHeader.tsx`
- Modify: `src/ui/styles/collection.css`
- Test: `tests/ui/collectionheader.test.tsx` (extend)

**Interfaces:**
- Consumes: `useSyncStatus`, `flushNow`, `resolveConflict` (Task 6); the existing `download()` helper and `exportCollectionJson` already in this file.
- Produces test ids: `sync-status`, `sync-retry`, `sync-download`, `sync-conflict`, `sync-keep-mine`, `sync-take-disk`.

- [ ] **Step 1: Write the failing test**

```ts
// appended to tests/ui/collectionheader.test.tsx
import * as sync from '../../src/ui/collectionSync'

describe('sync status', () => {
  it('shows a saved state when idle', () => {
    vi.spyOn(sync, 'useSyncStatus').mockReturnValue({ state: 'idle', pendingCount: 0, lastSavedAt: '2026-09-05T00:00:00.000Z' })
    render(<CollectionHeader db={db} printings={printings} />)
    expect(screen.getByTestId('sync-status').textContent).toMatch(/saved/i)
  })

  it('shows the unsaved count and a retry button', () => {
    vi.spyOn(sync, 'useSyncStatus').mockReturnValue({ state: 'unsaved', pendingCount: 300 })
    render(<CollectionHeader db={db} printings={printings} />)
    expect(screen.getByTestId('sync-status').textContent).toContain('300')
    expect(screen.getByTestId('sync-retry')).toBeTruthy()
    expect(screen.getByTestId('sync-download')).toBeTruthy()
  })

  it('retry calls flushNow', () => {
    vi.spyOn(sync, 'useSyncStatus').mockReturnValue({ state: 'unsaved', pendingCount: 2 })
    const flush = vi.spyOn(sync, 'flushNow').mockResolvedValue(undefined)
    render(<CollectionHeader db={db} printings={printings} />)
    fireEvent.click(screen.getByTestId('sync-retry'))
    expect(flush).toHaveBeenCalledOnce()
  })

  it('offers both choices on a conflict and never resolves it automatically', () => {
    const resolve = vi.spyOn(sync, 'resolveConflict').mockResolvedValue(undefined)
    vi.spyOn(sync, 'useSyncStatus').mockReturnValue({ state: 'conflict', pendingCount: 4, message: 'moved' })
    render(<CollectionHeader db={db} printings={printings} />)
    expect(screen.getByTestId('sync-conflict')).toBeTruthy()
    expect(resolve).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('sync-keep-mine'))
    expect(resolve).toHaveBeenCalledWith('mine')
    fireEvent.click(screen.getByTestId('sync-take-disk'))
    expect(resolve).toHaveBeenCalledWith('disk')
  })

  it('notes a failed git push without claiming the save failed', () => {
    vi.spyOn(sync, 'useSyncStatus').mockReturnValue({ state: 'idle', pendingCount: 0, git: 'failed' })
    render(<CollectionHeader db={db} printings={printings} />)
    expect(screen.getByTestId('sync-status').textContent).toMatch(/saved/i)
    expect(screen.getByTestId('sync-status').textContent).toMatch(/push/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui/collectionheader.test.tsx`
Expected: FAIL — no `sync-status` element.

- [ ] **Step 3: Implement**

Add to `CollectionHeader.tsx` (imports first):

```tsx
import { useSyncStatus, flushNow, resolveConflict } from './collectionSync'
```

Inside the component, above the existing stats span:

```tsx
  const syncStatus = useSyncStatus()
```

And render, as the first child of the header:

```tsx
      <span className={`collection-header__sync collection-header__sync--${syncStatus.state}`}
        data-testid="sync-status">
        {syncStatus.state === 'idle' && (
          <>Saved to disk{syncStatus.lastSavedAt !== undefined ? ` · ${new Date(syncStatus.lastSavedAt).toLocaleTimeString()}` : ''}
          {syncStatus.git === 'failed' ? ' · git push failed (your data is safe on disk)' : ''}</>
        )}
        {syncStatus.state === 'saving' && <>Saving…</>}
        {syncStatus.state === 'unsaved' && (
          <><strong>{syncStatus.pendingCount} changes not yet saved to disk</strong> — retrying…</>
        )}
        {syncStatus.state === 'conflict' && <>The collection on disk changed</>}
      </span>
      {(syncStatus.state === 'unsaved' || syncStatus.state === 'conflict') && (
        <>
          <button type="button" data-testid="sync-retry" onClick={() => void flushNow()}>
            Retry now
          </button>
          <button type="button" data-testid="sync-download"
            onClick={() => download('collection.json', exportCollectionJson(collection))}>
            Download JSON
          </button>
        </>
      )}
      {syncStatus.state === 'conflict' && (
        <span className="collection-header__conflict" data-testid="sync-conflict">
          {syncStatus.message} — which version should win?
          <button type="button" data-testid="sync-keep-mine" onClick={() => void resolveConflict('mine')}>
            Keep mine
          </button>
          <button type="button" data-testid="sync-take-disk" onClick={() => void resolveConflict('disk')}>
            Take disk
          </button>
        </span>
      )}
```

In `src/ui/styles/collection.css`, add alongside the existing `.collection-header` rules:

```css
.collection-header__sync {
  font-family: var(--font-mono);
  font-size: 0.85em;
}
.collection-header__sync--unsaved,
.collection-header__sync--conflict {
  color: var(--rival);
}
.collection-header__conflict {
  display: flex;
  gap: 0.5em;
  align-items: center;
  flex-wrap: wrap;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/ui/collectionheader.test.tsx` → PASS
Run: `npx vitest run` → green
Run: `npx tsc -b` → clean

- [ ] **Step 5: Commit**

```bash
git add src/ui/CollectionHeader.tsx src/ui/styles/collection.css tests/ui/collectionheader.test.tsx
git commit -m "feat(collection): sync status, retry, and conflict resolution in the header"
```

---

### Task 8: Wire it up and prove it end to end

**Files:**
- Modify: `src/App.tsx` (call `initCollectionSync()` once on mount)
- Modify: `playwright.config.ts` (set `CTCG_COLLECTION_FILE` for the dev server)
- Modify: `README.md` (document the file, the env var, and the auto-commit)
- Create: `e2e/collection-file.spec.ts`
- Test: the e2e spec above

**Interfaces:**
- Consumes: `initCollectionSync` (Task 6); the endpoint (Task 4).
- Produces: nothing later tasks depend on — this is the last task.

- [ ] **Step 1: Wire the app**

In `src/App.tsx`, inside the component:

```tsx
  useEffect(() => {
    void initCollectionSync()
  }, [])
```

with `import { useEffect } from 'react'` extended and `import { initCollectionSync } from './ui/collectionSync'`.

- [ ] **Step 2: Point Playwright at a scratch file**

In `playwright.config.ts`, inside `webServer`, add:

```ts
    env: {
      ...process.env,
      CTCG_COLLECTION_FILE: 'test-results/e2e-collection.json',
    },
```

`test-results/` is already gitignored, and setting the variable also disables git automation, so the e2e run can never commit.

- [ ] **Step 3: Write the e2e spec**

```ts
// e2e/collection-file.spec.ts
// The proof that the whole chain works: a card added in the browser reaches
// data/collection.json (here, a scratch file) and comes back after browser
// storage is wiped — which is only possible if it was read from disk.
import { test, expect } from '@playwright/test'
import { rm } from 'node:fs/promises'

const SCRATCH = 'test-results/e2e-collection.json'

test.beforeEach(async () => {
  await rm(SCRATCH, { force: true })
  await rm(SCRATCH.replace(/\.json$/, '.backup.json'), { force: true })
})

test('a quick-added card survives clearing browser storage', async ({ page }) => {
  await page.goto('/?aiDelay=0')
  await page.getByTestId('tab-collection').click()

  await page.getByTestId('quick-add-set').selectOption('welcometonightcitybeta')
  await page.getByTestId('quick-add-input').fill('mantis')
  await page.getByTestId('quick-add-input').press('Enter')
  await expect(page.getByTestId('collection-count-mantis-blades')).toContainText('1/3')

  // Wait for the debounced flush to reach disk.
  await expect(page.getByTestId('sync-status')).toContainText(/saved/i, { timeout: 10_000 })

  // Wipe every browser-side copy: only the file can supply the count now.
  await page.evaluate(() => window.localStorage.clear())
  await page.reload()
  await page.getByTestId('tab-collection').click()
  await expect(page.getByTestId('collection-count-mantis-blades')).toContainText('1/3')
})

// The failure path, which is the whole reason the buffer exists: with saving
// broken, entered cards must survive a reload rather than being discarded.
test('cards entered while saving is broken survive a reload', async ({ page }) => {
  await page.goto('/?aiDelay=0')
  // Let the initial GET through, then break every write.
  await page.route('**/__collection', async (route) => {
    if (route.request().method() === 'PUT') return route.abort()
    return route.continue()
  })

  await page.getByTestId('tab-collection').click()
  await page.getByTestId('quick-add-set').selectOption('welcometonightcitybeta')
  await page.getByTestId('quick-add-input').fill('mantis')
  await page.getByTestId('quick-add-input').press('Enter')

  await expect(page.getByTestId('sync-status')).toContainText('not yet saved', { timeout: 10_000 })
  await expect(page.getByTestId('sync-retry')).toBeVisible()

  // The card is still there after a reload, and still reported as unsaved —
  // nothing was silently dropped and nothing was silently claimed as saved.
  await page.reload()
  await page.getByTestId('tab-collection').click()
  await expect(page.getByTestId('collection-count-mantis-blades')).toContainText('1/3')
  await expect(page.getByTestId('sync-status')).toContainText('not yet saved')
})
```

- [ ] **Step 4: Run the e2e and the whole suite**

Run: `npx playwright test e2e/collection-file.spec.ts` → PASS
Run: `npx playwright test` → all specs pass (allow up to 10 minutes)
Run: `npx vitest run` → green
Run: `npx tsc -b` → clean

Confirm afterwards that `git status` shows **no** change to `data/collection.json` — the e2e must never touch the real file.

- [ ] **Step 5: Document it**

In `README.md`, in the Collection tracking section, add a short subsection covering: `data/collection.json` is the source of truth and is committed; the app saves through the dev server, so run `npm run dev`; saves are batched and auto-committed and pushed about five seconds after you stop editing; unsaved changes are kept in the browser and retried, with a banner showing the count; `CTCG_COLLECTION_FILE` overrides the path and disables git automation (used by tests); `data/collection.backup.json` holds the previous contents and is gitignored.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx playwright.config.ts e2e/collection-file.spec.ts README.md
git commit -m "feat(collection): wire file sync into the app, with an end-to-end proof"
```
