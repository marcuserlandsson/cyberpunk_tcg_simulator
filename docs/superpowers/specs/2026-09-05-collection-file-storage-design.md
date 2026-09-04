# Collection File Storage — Design

**Date:** 2026-09-05
**Status:** Approved design, pre-implementation
**Supersedes:** the persistence half of `2026-09-04-collection-tracker-design.md` §2
(that spec's derived queries, export/import, and UI are unchanged)

**Depends on:** the merged collection tracker (`src/ui/collection.ts`,
`src/ui/printings.ts`, the Collection tab, `data/printings.json`), Vite 8's
`configureServer` plugin hook, and the repo's existing git remote.

## Goal

Move the source of truth for the player's collection out of `localStorage` and
into `data/collection.json`, a file in the repo, so that clearing browser data,
switching browsers, or using a private window cannot lose it. The file is
committed and pushed automatically, making git history a restore log and the
remote an offsite backup.

The binding requirement, in the user's words: after entering a whole booster
box, a failed save must never discard that work — "it should keep them in the
browser so I can try to save again once it is possible again."

## Decisions taken during brainstorming

| Question | Decision |
|---|---|
| How is the app run? | Always `npm run dev`. A Vite dev-server endpoint is therefore a valid persistence backend. |
| Is the file committed? | Yes, and **auto-committed** by the app. |
| Commit granularity | Batched: one commit per quiet period, then **pushed** automatically. |
| Behavior on save failure | **Never discard the edit.** Keep it in the browser and retry until it lands. |

## Architecture

```
Collection tab / Deck Builder
    │  (synchronous reads, unchanged)
    ▼
src/ui/collection.ts ── in-memory snapshot + pending buffer (localStorage)
    │                        │
    │  schedules             │ survives reload/crash
    ▼                        ▼
src/ui/collectionSync.ts ── debounced flusher ──HTTP──► Vite plugin
                                                          │
                                              validate → atomic write
                                                          │
                                              data/collection.json
                                                          │
                                              debounced git commit + push
```

### The store stays synchronous

`src/ui/collection.ts` currently exposes a synchronous snapshot through
`useSyncExternalStore` (`getCollection`, `setCount`, `adjustCount`,
`replaceCollection`, `useCollection`). **That contract does not change.** Making
it async would ripple into every consumer (`CollectionView`, `QuickAddBar`,
`CollectionHeader`, `CardBrowser`, `DeckBuilderView`) for no user-visible gain.

Instead, a mutation continues to update memory and browser storage
synchronously, and a new module schedules a background flush to disk. Disk
writes are therefore naturally batched: a pack of quick-adds becomes one file
write, one commit, one push.

### File format — `data/collection.json`

```jsonc
{
  "version": 1,        // format version
  "revision": 42,      // monotonic; incremented by the server on every write
  "savedAt": "2026-09-05T10:31:00.000Z",
  "counts": { "welcometonightcitybeta/β025": 2 }
}
```

`counts` is exactly today's map, so every derived query keeps working untouched.
`revision` exists for optimistic concurrency (below). The file is committed;
`data/collection.backup.json` is gitignored.

### Shared format module — `src/collection/format.ts` (new)

The zod schema and `Collection` type currently live inside
`src/ui/collection.ts`, which imports React. The Node-side plugin cannot import
that. Rather than maintain two schemas that will drift, the format moves to a
new dependency-free module imported by both:

- `interface Collection { counts: Record<string, number> }`
- `collectionSchema` (counts: record of non-negative safe integers)
- `fileSchema` (version, revision, savedAt, counts)
- `formatZodIssues(error)` — currently in `src/ui/printings.ts`; it moves here
  and `printings.ts` imports it back, so both sides produce identical readable
  messages from one implementation.

`src/ui/collection.ts` re-exports what it exports today, so no consumer changes.

### Pending buffer — the anti-data-loss mechanism

localStorage key `ctcg:collection:pending:v1`:

```jsonc
{ "counts": { … }, "baseRevision": 42 }
```

It holds the **full intended collection**, not a diff — the data is a few KB,
and diff-merging is where this class of system loses data.

Rules, in priority order:

1. Every mutation writes the buffer **synchronously**, before any network work.
2. The buffer is cleared **only** on a confirmed successful write (server
   returned a new revision).
3. On startup, if a buffer exists it *wins* over the file — it is the user's
   unsaved work — and a flush is attempted immediately.
4. A failed flush leaves the buffer completely untouched.

This is what satisfies the booster-box requirement: 300 cards entered while the
server was down survive a reload, a crash, and closing the tab.

### Flusher — `src/ui/collectionSync.ts` (new)

- Debounce 1s after the last mutation; also flush on `visibilitychange` →
  hidden and on `beforeunload` (via `fetch(..., { keepalive: true })`).
- On success: clear the buffer, record the new revision, clear any error state.
- On failure: retain the buffer, set a sync status, and retry with backoff
  (1s, 2s, 5s, 15s, then every 30s). A later mutation cancels the pending retry
  and schedules a fresh flush.
- Exposes a status the UI subscribes to:
  `{ state: 'idle' | 'saving' | 'unsaved' | 'conflict', pendingCount: number,
     lastSavedAt?: string, message?: string, git?: 'ok' | 'failed' }`.

`pendingCount` is the number of card copies not yet on disk: the sum of absolute
differences between the buffer's `counts` and the counts of the last state
confirmed written (the file as last fetched or last successfully PUT). So the
banner says "300 changes not yet saved" rather than a vague warning.

### Endpoint — `src/server/collectionPlugin.ts` (new)

A Vite plugin (`configureServer` only — the app is always run via `npm run dev`,
so a preview-server hook would be unused code) imported by `vite.config.ts`,
which stays thin. The request handlers are exported as plain async functions
taking an explicit file path, so they are unit tested directly against a temp
directory rather than through a live server.

- **`GET /__collection`** → the parsed file, or `{version:1, revision:0, counts:{}}`
  when it does not exist.
- **`PUT /__collection`** — body `{ baseRevision, counts, confirmEmpty? }`:
  - `400 { reason: 'invalid', message }` if `counts` fails `collectionSchema`,
    with `formatZodIssues` text and **no file mutation**.
  - `409 { reason: 'conflict', current }` if `baseRevision !== file.revision`,
    returning the current file so the client can present both versions.
  - `409 { reason: 'would-empty' }` if the write would take a non-empty
    collection to empty and `confirmEmpty` is not `true`.
  - otherwise: back up, write atomically, return `{ revision, savedAt }`.

Every non-2xx body carries a `reason` discriminator; the client branches on that
field, never on the status code alone, since two distinct refusals share `409`.

Write safety:

- **Atomic:** write `<file>.tmp` in the same directory, then `rename` over the
  target, so a crash cannot leave a truncated file.
- **Backup:** the previous contents are copied to `data/collection.backup.json`
  before each overwrite (gitignored; git holds the deeper history).
- **Path:** from `CTCG_COLLECTION_FILE`, defaulting to `data/collection.json`.
  This is the lever that keeps tests away from real data.

### Git automation — `src/server/collectionGit.ts` (new)

Debounced 5s after writes go quiet, in the server process:

```
git commit -m "chore(collection): <N> cards, <M> printings" -- <collection file>
git push
```

- Commits **only that pathspec**, so unrelated in-progress work is never swept in.
- Skipped entirely when the file is unchanged, when the path is not inside a git
  work tree, or when `CTCG_COLLECTION_FILE` is overridden (tests never commit).
- Push is skipped when no upstream is configured.
- **Never blocks or fails a save.** The file is already durable on disk by the
  time git runs; failures are logged and reported to the UI as a soft
  `git: 'failed'` status.
- Never auto-pulls, auto-rebases, or force-pushes. A rejected push is surfaced
  for the user to resolve — resolving remote divergence is not a decision a
  background process should make on someone's repo.

### UI changes — `src/ui/CollectionHeader.tsx`

One new status line, driven by the flusher's status:

- `idle` — "Saved to disk · <relative time>".
- `saving` — "Saving…".
- `unsaved` — "**N changes not yet saved to disk** — retrying…", plus a
  **Retry now** button and a **Download JSON** escape hatch (reusing the
  existing `download()` helper), test id `sync-status` / `sync-retry`.
- `conflict` — the file changed underneath us: show both versions' card totals
  and offer **Keep mine** (re-PUT with the file's current revision) or
  **Take disk** (discard the buffer). Never resolved automatically.
- A failed git push adds a secondary, non-alarming note; it does not change the
  save state, because the save succeeded.

The existing `collection-storage-error` banner (a failed *browser* write) stays
as is — it is a different failure and still worth showing.

## Data flow

**Load:** `GET` the file → if a pending buffer exists, adopt it as current state
and flush immediately → otherwise adopt the file. If the `GET` itself fails (no
dev server), fall back to the buffer, then to the legacy `ctcg:collection:v1`
key, and set status `unsaved` so the user knows nothing is reaching disk.

**Edit:** update memory + buffer synchronously → notify subscribers → schedule a
flush.

**Flush:** `PUT { baseRevision, counts }` → on `200`, clear the buffer and store
the new revision → on `400`/network failure, keep the buffer and back off → on
`409`, enter `conflict` and stop retrying until the user chooses.

## Migration

On first run, if the file is absent or has `revision: 0` and empty counts while
the legacy `ctcg:collection:v1` key holds counts, the store seeds the file from
localStorage and flushes it. One-time, logged in the UI as "Imported N cards
from browser storage". After the first successful file write the legacy key is
never read or written again, but it is deliberately **not deleted** — it costs
nothing and is one more copy of data the user cannot easily reproduce.

## Error handling summary

| Failure | Behavior |
|---|---|
| Dev server down / network error | Buffer retained, status `unsaved`, backoff retry, work preserved across reloads |
| Invalid counts (`400`) | Buffer retained, message shown; indicates a bug, so it is surfaced verbatim |
| Revision conflict (`409`) | Status `conflict`, user chooses; nothing overwritten automatically |
| Would empty a non-empty collection | Refused unless explicitly confirmed |
| Crash mid-write | Impossible to truncate: temp-file + rename |
| Corrupt file on disk | `GET` returns a parse error; app refuses to start the tab with `collection-error` rather than overwriting; `data/collection.backup.json` is the manual recovery |
| Git commit/push fails | Logged, soft status; save is unaffected |

## Testing

**Server handlers** (temp dir, no live server): empty `GET`; valid `PUT`
round-trip; stale revision → `409` carrying current contents; invalid body →
`400` with the file byte-identical afterwards; backup written before overwrite;
wipe guard refuses, and accepts with `confirmEmpty`; atomic write leaves no
`.tmp` behind.

**Git layer** (temp git repo): commits only the collection path with other files
dirty; skips when unchanged; skips push with no upstream; a failing git command
does not throw into the caller.

**Flusher/buffer** (jsdom, fetch stubbed): failed flush retains the buffer;
reload restores it; successful flush clears it; backoff schedules as specified;
`pendingCount` counts copies correctly; store works with the endpoint entirely
absent (this also keeps the existing suite green).

**Regression:** the current 1309 tests must pass unchanged — the store's public
API is unchanged.

**E2E** (`CTCG_COLLECTION_FILE` pointed at a scratch file via
`playwright.config.ts`): add a card, **clear browser storage**, reload, and the
card is still present — only satisfiable if the whole chain works. Plus: with
the endpoint made to fail, an added card survives a reload and the unsaved
banner is shown.

## Out of scope

- Any deployment other than the local dev server (no static build backend, no
  remote/multi-device access, no phone entry).
- Multi-user or concurrent-tab merge semantics beyond the revision check.
- Auto-resolving a rejected push (pull/rebase/force).
- Encrypting or otherwise protecting the collection file.
- Changing the derived queries, export/import formats, or any Collection tab
  behavior beyond the new status line.
