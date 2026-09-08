# App remediation checklist

User request: address the app review and audit the newly published comprehensive rules. Work sequentially; verify and commit every completed step before starting the next. Preserve real collection data. Do not push commits automatically as part of this work.

## Steps

- [x] 01. Preserve collection data and attempted edits when browser storage fails.
- [x] 02. Coordinate collection editing and recovery across browser tabs.
- [x] 03. Fix overlapping Collection cards and verify responsive layouts.
- [x] 04. Refresh deck choices across views and suppress unknown ownership figures.
- [x] 05. Support collection persistence outside the dev server; expose Git outcomes and correct documentation.
- [ ] 06. Obtain/version comprehensive rules and errata; audit each rules section against implementation and record discrepancies.
- [ ] 07. Discover/import current cards and printings, track data freshness and implementation coverage, and correct errata.
- [ ] 08. Implement rules-audit corrections, explicit effect/player choices, private knowledge, and payment choices, with card/engine regressions.
- [ ] 09. Model unique artwork independently of printings; separate playset/artwork targets, filters, progress, and buy-lists.
- [ ] 10. Persist complete simulation runs and deck snapshots; retain runs during navigation and support history/reopening/exports.
- [ ] 11. Clarify simulation identities/metrics, add uncertainty and controlled matchup comparisons.
- [ ] 12. Add explicit deck formats, deck versions/notes, and direct Play this deck.
- [ ] 13. Add deck diagnostics, legal-RAM filtering, opening-hand sampling, and manual practice scenarios.
- [ ] 14. Add multi-deck acquisition planning with shared/assembled inventories and optional binder reservations.
- [ ] 15. Add compact collection search, collector numbers, artwork previews, bulk entry, and scoped filters.
- [ ] 16. Add recoverable acquisition/trade sessions, import previews/history, optional date/source/cost, and starter entry.
- [ ] 17. Add sealed pool validation/building and best-of-three/manual match tracking.
- [ ] 18. Stabilize verification timeouts/cleanup, run final regression/build/browser checks, and reconcile documentation.

## Completion log

Each entry records the implementation, verification evidence, and any remaining limitations. Commit history provides the corresponding checkpoints.

### 01 — browser storage failure

Preserved the last confirmed collection and attempted edits in memory when localStorage fails. The disk sync can flush that buffer directly; invalid counts preserve the prior snapshot. Read/removal failures no longer crash recovery. Verified 101 tests across collection, sync, error UI, and header, including temporary quota failure followed by another edit and successful disk sync while browser writes remain blocked.

### 02 — cross-tab coordination

An origin-scoped Web Lock allows one collection editor; waiting tabs display updates without touching the shared buffer and automatically take over after the owner closes. Browsers without Web Locks fail closed with an explanation. Verified 87 unit/component tests, TypeScript, and a real two-tab Playwright regression covering read-only protection, live counts, takeover, and saving. The E2E port can now be overridden to avoid occupied local ports. Running Playwright outside the restricted process sandbox also resolved its teardown hang.

### 03 — collection layout

Collection cards now fit their grid cells; expanded printing text wraps and quick-add controls stack on narrow screens. Chromium verified card bounds at 1270px and 390px in both HTML/art modes, plus expanded printing panels with no internal overflow.

### 04 — deck choices and ownership availability

Deck libraries now update across mounted views and browser tabs, with valid fallback selections after deletion. Loading or failed collection reads show unknown ownership and suppress misleading buy-lists. Verified TypeScript, 126 targeted unit/component tests (83 rerun after selection refinements), and two browser workflows covering immediate Play selection and failed collection loading.

### 05 — production persistence and backup results

The production preview now mounts the same collection service as development. A separate status endpoint reports pending/final Git backup outcomes without another save; background commits serialize and stale callbacks cannot replace newer status. Manual retry can reload an unreadable collection without writing. Documentation distinguishes local disk, browser storage, and Git backup. Verified 79 server/sync/header tests, production build, and three browser/API checks against production preview using only a scratch collection.
