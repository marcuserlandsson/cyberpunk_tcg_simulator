# App remediation checklist

User request: address the app review and audit the newly published comprehensive rules. Work sequentially; verify and commit every completed step before starting the next. Preserve real collection data. Do not push commits automatically as part of this work.

## Steps

- [x] 01. Preserve collection data and attempted edits when browser storage fails.
- [x] 02. Coordinate collection editing and recovery across browser tabs.
- [x] 03. Fix overlapping Collection cards and verify responsive layouts.
- [x] 04. Refresh deck choices across views and suppress unknown ownership figures.
- [x] 05. Support collection persistence outside the dev server; expose Git outcomes and correct documentation.
- [x] 06. Obtain/version comprehensive rules and errata; audit each rules section against implementation and record discrepancies.
- [x] 07. Discover/import current cards and printings, track data freshness and implementation coverage, and correct errata.
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

### 06 — comprehensive rules audit

Captured the official site's rules data (updated September 1), read all 11 numbered chapters, and mapped them against engine code/tests. Recorded 20 actionable discrepancies and three interpretation notes in `rules-audit-2026-09-08.md`, plus official errata and version metadata. Verified all 713 unique anchors, chapter completeness and snapshot SHA-256. This checkpoint completes the audit, not the gameplay corrections: those remain explicitly scheduled in steps 7–8.

### 07 — catalog refresh and errata

Discovery now paginates the full official catalog and fetches every card detail. Imported 10 missing cards and 22 printings (151 cards / 460 printings / 13 sets), preserving every prior collection key. New cards are explicitly pending and blocked from gameplay until step 8; they are usable for collection/deck planning. Added source snapshot, freshness/coverage UI, printed null-cost metadata, current Kiroshi equip restriction, and Nocturne artist correction. Completeness tests compare against discovery instead of a hardcoded historical total. Verified TypeScript, 360 targeted tests, 54 subsequent tests, source/printing identity checks, and a browser workflow using Detonate in both planning and collection. Existing text changes were limited to Kiroshi and editorial flavor labels.

### 08a — turn boundaries, overtime state and payment eligibility

Step 8 remains open. First checkpoint: overtime tracks consecutive empty-fixer starts and requires seven Gigs; start effects precede ready/draw; Lag and played-this-turn flags expire for both players at every turn end. Payment generation and validation exclude revealed Legends lacking Sell tags, and AI resource scoring uses the same eligibility. Legacy overtime result labels remain readable, with a new result reason for current rules. Updated obsolete tests and excluded pending cards from generated gameplay decks. Verified TypeScript, 404 engine/card/UI/simulation tests, plus 111 core/AI tests in the preceding run. Immediate win checks within multi-part effects and queued start effects will be completed with the resolution changes next.

### 08b — reactions and Gear destinations

Blocking now leaves reactions open; subsequent Quick effects and further Blockers resolve before the defender passes. Attacks end when their attacker leaves or their target becomes invalid. Gear follows its host to hand/deck/trash; a removed Legend leaves its Gear at the intermediate destination, and bottom-decked host/Gear groups use seeded randomization. Verified TypeScript, 505 engine/card regressions, and a full browser game with no page error. Pending-resolution ordering and randomization across several simultaneously moved hosts remain part of the next resolution checkpoint.

### 08c — pending effects, fight results and Program timing

Added an action-scoped pending-effect queue, controller-selected ordering through deterministic replay, turn-player priority, and uninterrupted compound effects. Joined 12 cards' consecutive instructions so later clauses see earlier results. Start/end/attack/fight windows drain pending triggers at their rules boundaries. Fight wins/losses precede defeat and survive shields; zero-power combatants cannot defeat one another. Programs resolve outside normal zones before entering trash, and payment precedes entry. Pending effects retain their source identity/controller after removal; full last-known numeric information and explicit target choices remain open.

The broader checks exposed AI lookahead reading future search/reveal results. Previews now stop at hidden-information boundaries and retain public attack continuations. Recalibrated the initial play-order policy against the changed rules/AI sample (114 first-player wins vs 86 second-player wins in 200 games; this is a policy sample, not a general matchup claim). Corrected obsolete overtime fixtures and a fragile tactical tie-break assertion. Verified 1,086 engine/card/data/AI/fuzz tests (including 300 random games, none hitting the action cap), TypeScript/production build, and a complete Chromium game. Remaining step-8 work includes explicit choices/private peeks, complete steal-batch resolution, source-number snapshots, replacement chains, and the other open audit findings; gameplay remains labeled provisional.

### 08d — resolution-time targets and modes

Missing target/mode/amount choices now pause gameplay and ask the effect's controller, including rival-chosen modes. Later instructions choose against the updated board (for example, retrieving one of two cards just trashed). Unchosen branches do not ask questions or consume RNG. Replay questions retain viewer-scoped information about identities already disclosed, so hidden-information verification does not shuffle cards the chooser just learned. Updated old random-selection tests to make explicit choices. Verified 960 engine/card/fuzz tests, TypeScript, AI hidden-information checks, and a complete Chromium game. The broader AI/fuzz run passed 420 tests before its one information-permutation failure was corrected and retested. Script-internal searches/optional choices and simultaneous steal batches remain next within step 8.
### 08e — simultaneous stealing

Steals now select the complete batch before prevention, transfer accepted dice together, and let triggers see the completed transfer. Effect-driven steals finish before later instructions; an overtime-winning transfer ends the game before a following draw. Attack selection excludes already selected original indexes and shows the pending batch. Verified 1,067 engine/card/AI/fuzz tests (including 300 random games), TypeScript, and a complete Chromium game. Step 8 remains open for the remaining numbered audit findings.

### 08f — Gig adjustment semantics

Exact changes and set effects now fail outside the die's faces or when unchanged, without firing adjustment watchers. Printed up-to changes expose partial and zero amounts; exact bidirectional adjustments retain their two directions. V and Jackie scripts now offer amounts and Jackie only draws when the selected Gig actually becomes minimum. Stolen-die trigger context identifies each member of a batch. Return/reroll instructions ask for a die. Verified 658 engine/card tests and TypeScript, including six focused comprehensive-rules cases. Remaining source-lifetime/identity edge cases belong to the pending-resolution audit still open in step 8.

### 08g — null Street Cred and signed power

Empty Gig areas now have null Street Cred (shown as a dash), satisfy neither parity nor a numeric difference, and compare below numeric values. Power references clamp negative totals to zero while arithmetic and combat keep signed values until contextual modifiers are added. Verified 664 engine/card/StreetStrip tests, TypeScript, and 415 AI/fuzz tests including 300 randomized games and hidden-information invariance checks.

### 08h — Legend play modes and payable costs

Face-up Legends with numeric costs now offer ordinary play (preserve post-payment orientation, add Lag), separately from Go Solo (enter ready without Lag). A spent Legend can Go Solo and an eligible Sell-tag Legend can pay toward its own play. The Play view explains both modes and their payment amounts; Go Solo taxes only apply to that mode. Null costs remain unpayable/unmodifiable, and payment reductions floor at one. Verified 675 existing engine/card/PlayView tests plus six new Legend/cost regressions, TypeScript, and a complete Chromium game. The entry records how the Legend was played for subsequent movement rules.

### 08i — script-internal choices

Scripted searches, secondary targets, rival-selected casualties/destinations, optional discard/defeat, and multi-card up-to selections now use explicit replayable player decisions instead of RNG. Hanako's unselected searched cards are bottom-decked randomly. Fool on the Hill discloses its revealed cards to both players before the rival chooses; Tetratronic asks whether to trash the privately inspected card. Verified 670 engine/card tests, TypeScript, and the AI hidden-information checks. Legend-position selection/private peeks and additional optional/card-entry scripts remain open in step 8.

### 08j — private Legend peeks and chosen Calls

Call a Legend now selects a face-down position without exposing its identity. Kiroshi, Radioport and T-Bug implement private peeks with an explicit finish-looking step, viewer-scoped replay knowledge and persistent public previously-seen markers. Hovering marked face-down Legends still shows only the card back. Optional free Calls can be declined; T-Bug still looks even after the Call allowance is used. The human UI explicitly excludes rival-only prompts. Verified 676 engine/card/knowledge/zoom tests, TypeScript, and three AI hidden-information checks. Transient public reveals and source-lifetime snapshots remain within the open resolution audit.
