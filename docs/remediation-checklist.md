# App remediation checklist

User request: address the app review and audit the newly published comprehensive rules. Work sequentially; verify and commit every completed step before starting the next. Preserve real collection data. Do not push commits automatically as part of this work.

## Steps

- [x] 01. Preserve collection data and attempted edits when browser storage fails.
- [ ] 02. Coordinate collection editing and recovery across browser tabs.
- [ ] 03. Fix overlapping Collection cards and verify responsive layouts.
- [ ] 04. Refresh deck choices across views and suppress unknown ownership figures.
- [ ] 05. Support collection persistence outside the dev server; expose Git outcomes and correct documentation.
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
