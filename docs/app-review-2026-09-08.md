# Cyberpunk TCG app review — 8 September 2026

## Assessment

The app has a useful foundation for learning the game, drafting decks, and recording owned cards. I would address collection safety and simulation fidelity before treating its buy-lists or win rates as dependable acquisition advice.

Your clarified goals are **a playset of each distinct playable card** and **one copy of each unique artwork**, tracked separately. Owning a physical copy should contribute to both goals where applicable. A reprint of the same artwork should not create another artwork requirement.

This was a review, not an implementation pass. Application code and your real collection were not changed.

## Scope and verification

Reviewed all four application views, their storage and integration paths, card/printing data, engine and effect architecture, AI policy, simulation aggregation, and existing tests. Explored Deck Builder, Play setup, Simulate, and Collection in an isolated browser instance; the existing browser suite exercised a complete game, undo, resume, simulation, and collection recovery.

- Production type-check/build passed. Vite reported a roughly 644 kB minified main JavaScript bundle (about 164 kB gzip).
- Original Vitest run: 1,410 passed, one benchmark timed out at 5 seconds. That benchmark achieved 199 wins in 200 games, satisfying its strength assertion.
- Rerunning the AI test file with a 30-second per-test timeout passed all 104 tests.
- All eight Playwright test cases reported passing on an alternate port. The runner did not exit after the cases completed and was interrupted during cleanup. The normal configured port, 5174, was already occupied.
- Two temporary diagnostic tests reproduced the collection failure cases below. They asserted the observed faulty behavior and were removed after the review.
- The isolated browser used a scratch collection file with Git automation disabled.
- Current official sources were checked for database coverage, errata, and upcoming event formats. This is not an independent certification of every card interaction against the comprehensive rules.

## What works well

**One engine drives play, AI, and simulations.** Legality checks are shared, state transitions are deterministic, and seeded games are reproducible. That is a strong basis for debugging rules and comparing versions.

**The testing foundation is substantial.** Unit, card, UI, integration, and invariant tests cover much more than basic rendering. Synthetic decks extend the invariant checks beyond the bundled demos. However, tests can preserve an outdated rule or deliberate simplification; passing tests do not establish official-rules accuracy.

**The ownership model preserves physical detail.** Per-printing counts, JSON backup, strict import validation, retained unknown keys, revision checks, and atomic disk writes are good design choices. Quick-add explicitly asks you to distinguish ambiguous printings.

**Theorycrafting is unrestricted.** You can build and save a deck before owning it. RAM budgets, live legality feedback, and deck-specific missing-card lists align well with your preparation goal.

**The visual identity is coherent.** Card colors, typography, board state cues, and the simulation comparison are consistent. The HTML card rendering remains usable without downloading official artwork.

## Highest-priority findings

### 1. A failed browser-storage write can lead to collection loss — high

After a successful disk load/save, the confirmed collection exists in memory and the pending browser buffer is cleared. If the next browser write fails, writeCollection invalidates that in-memory cache anyway. The following read falls back to the legacy key or an empty collection.

The diagnostic reproduction loaded three copies at revision 7, forced one browser write failure, and observed the collection become empty. After a subsequent successful edit, the pending buffer contained only the newly added card, still based on revision 7. The server's revision check can accept that replacement; its empty-collection guard does not apply because the replacement contains one card.

**Fix:** preserve the confirmed snapshot on a failed write, retain the attempted changes separately, and make failure visible without replacing the baseline. Add a regression that proves earlier cards survive the next successful disk save.

Evidence: [collection write/cache handling](C:/Users/macke/Documents/GitHub/cyberpunk_tcg_simulator/src/ui/collection.ts:145) and [server replacement guards](C:/Users/macke/Documents/GitHub/cyberpunk_tcg_simulator/src/server/collectionFile.ts:96).

### 2. Browser tabs can overwrite each other's pending collection edits — high

Each tab caches its own collection, but all tabs share the same localStorage pending-buffer key. There is no cross-tab coordination for the read-modify-write operation.

Reproduction: two isolated store instances start with one copy of card A. The first increases A to two. Before that saves, the second adds card B from its older cached collection. The shared pending buffer becomes A=1, B=1, losing the first increment. Server-side revision checks cannot detect a change already lost before the request reaches the server.

**Fix:** use a single writer or a transactional shared store, with per-edit operations and cross-tab synchronization. A storage event alone is useful for refreshing views but does not make concurrent writes atomic.

Evidence: [shared buffer and store](C:/Users/macke/Documents/GitHub/cyberpunk_tcg_simulator/src/ui/collection.ts:17).

### 3. Card coverage is already behind the official database — high

The local dataset contains 141 card definitions and 438 printings across 13 sets. The official database currently lists 151 cards. **Detonate**, a playable Quick program, is one confirmed missing entry. This means both deck options and collection completion are incomplete.

The printing-refresh script only visits card IDs already present in cards.json, so running it does not discover new cards. Existing completeness tests explicitly expect 141 and therefore cannot alert you to upstream growth.

**Fix:** add a card-discovery/import report, explicit data version and checked date, missing-card warnings, and a separate implementation status for each newly discovered card. Keep unsupported cards visible for collection tracking even before their gameplay effects are implemented.

Evidence: [printing refresh loop](C:/Users/macke/Documents/GitHub/cyberpunk_tcg_simulator/scripts/fetch-printings.ts:134); [official card database](https://cyberpunktcg.com/cards); [Detonate](https://cyberpunktcg.com/cards/detonate).

### 4. Some strategic decisions are replaced with random or automatic choices — high for deck testing

The engine implements many effects, but it does not give the player or AI every decision described by card text.

Examples:
- Triggered effects without supplied targets select candidates randomly.
- Live with the Aftermath randomly chooses the rival's casualty instead of asking that rival.
- Some searches choose a qualifying card randomly.
- Kiroshi Optics's private peek is implemented as a no-op; the UI still hides face-down Legend identities.
- Payment choices are reduced to ready Eddies first, then Legends in order. Choosing which Legend to spend can matter for its abilities and equipped Gear.

These policies can materially change the value of a card or combination. Increasing the simulation count does not remove that bias.

**Fix:** represent pending decisions explicitly, including the deciding player, available choices, and continuation of the interrupted effect. Track private information separately. Until then, label affected cards and simulation output as approximate.

Evidence: [random target fallback](C:/Users/macke/Documents/GitHub/cyberpunk_tcg_simulator/src/cards/effects.ts:446), [Kiroshi and Aftermath scripts](C:/Users/macke/Documents/GitHub/cyberpunk_tcg_simulator/src/cards/scripted/index.ts:410), [payment policy](C:/Users/macke/Documents/GitHub/cyberpunk_tcg_simulator/src/engine/economy.ts:58).

### 5. Published errata contradicts a currently tested rule — high

Kiroshi Optics is explicitly allowed to equip to rival Units by the app. Official errata corrects its reminder text to match normal Gear restrictions. The current test suite actually asserts that the obsolete rival-targeting behavior is allowed.

**Fix:** remove the obsolete targeting exception, update the card text, and change the regression to the corrected behavior. Reconcile the documented rulings with the comprehensive rules published on August 28.

Evidence: [Kiroshi targeting exception](C:/Users/macke/Documents/GitHub/cyberpunk_tcg_simulator/src/cards/targets.ts:298), [outdated test](C:/Users/macke/Documents/GitHub/cyberpunk_tcg_simulator/tests/cards/yellow.test.ts:615); [official errata](https://cyberpunktcg.com/errata); [comprehensive-rules announcement](https://cyberpunktcg.com/blog/comp-rules-published).

### 6. “Arts” completion measures printings, not your unique-art goal — high product mismatch

Arts percentage divides owned printing keys by all printing keys. It does not group identical artwork used across Beta, Retail, starter decks, or finishes. There is no artwork identifier in the printing model.

The playset calculation also includes Rebecca: Having a Moment, which the app itself marks as an unplayable art-only promo. That belongs in the artwork goal, not in the playable-card goal.

**Fix:** keep physical ownership per printing, add a stable artworkId linking printings that share an illustration, and calculate the two goals independently. Do not infer identical artwork from artist names alone. A foil or reprint with unchanged artwork should satisfy the same artwork goal unless you later choose a separate finish goal.

Evidence: [completion arithmetic](C:/Users/macke/Documents/GitHub/cyberpunk_tcg_simulator/src/ui/collection.ts:285), [printing model](C:/Users/macke/Documents/GitHub/cyberpunk_tcg_simulator/src/ui/printings.ts:10), [playset targets](C:/Users/macke/Documents/GitHub/cyberpunk_tcg_simulator/src/ui/collection.ts:253).

## Other confirmed issues

### Saved decks do not refresh in Play

I loaded a bundled deck, saved it as Review Test Deck, and switched to Play. The new deck was absent. Simulate did see it. Play reads the deck list only once and remains mounted throughout navigation, so additions, edits, and deletions leave its deck choices stale until reload. Edits can therefore also lead to testing an older saved version.

Use a reactive shared deck store. Evidence: [Play deck list](C:/Users/macke/Documents/GitHub/cyberpunk_tcg_simulator/src/ui/PlayView.tsx:371).

### Collection cards visibly overlap

At the tested desktop viewport, cards covered neighboring card text and controls. Collection uses grid columns with a 190px minimum, while its zoom cards retain a fixed 250px width. Deck Builder already has a width override that Collection lacks.

Make Collection cards fit their grid cells and check expanded printing rows, both rendering modes, and narrower viewports. Evidence: [collection grid](C:/Users/macke/Documents/GitHub/cyberpunk_tcg_simulator/src/ui/styles/collection.css:173), [fixed card width](C:/Users/macke/Documents/GitHub/cyberpunk_tcg_simulator/src/ui/styles/cards.css:34).

### Leaving Simulate loses useful access to results

After a completed 10-game run, switching to Collection and back removed the detailed results and export controls. Only an anonymous “Deck A / Deck B” percentage banner remained.

The persisted result does not include deck snapshots, names, agent settings, or engine/data versions. JSON exports share that omission. CSV exports contain game outcomes but no per-card statistics. An active run is also cancelled automatically when you switch tabs.

Persist a complete run record and allow reopening/exporting it. Give completed runs immutable deck snapshots and keep an active worker alive across navigation, with an explicit Cancel action.

Evidence: [simulation state/persistence](C:/Users/macke/Documents/GitHub/cyberpunk_tcg_simulator/src/ui/SimulateView.tsx:198), [result schema and CSV](C:/Users/macke/Documents/GitHub/cyberpunk_tcg_simulator/src/sim/runner.ts:71), [tab mounting](C:/Users/macke/Documents/GitHub/cyberpunk_tcg_simulator/src/App.tsx:91).

### Card statistics need clearer identities and interpretation

The results showed two rows both named “Goro Takemura,” although they represent different cards. Display names omit subtitles. “Games seen” actually means games in which the card was played, not games where it was drawn or available.

Win percentage when played is correlation: an expensive finisher may look excellent because it gets played when a deck is already winning. The current single-policy AI also evaluates only a limited continuation of decisions.

Use disambiguated card names, rename the metric, show sample sizes and uncertainty, and compare controlled deck changes against several opponents. Treat the current figures as exploratory signals.

Evidence: [table display names and labels](C:/Users/macke/Documents/GitHub/cyberpunk_tcg_simulator/src/ui/SimulateView.tsx:123), [card tallies](C:/Users/macke/Documents/GitHub/cyberpunk_tcg_simulator/src/sim/runner.ts:196), [AI design](C:/Users/macke/Documents/GitHub/cyberpunk_tcg_simulator/src/ai/heuristic.ts:1).

### Ownership can be presented as zero when it is unknown

CollectionHeader suppresses its totals on a collection-read error, but DeckBuilderView does not inspect sync status. It calculates missing cards from the empty fallback and can offer a buy-list despite not knowing what you own. Collection tiles also continue showing fallback counts.

Use one explicit loaded/loading/unavailable state across every ownership display. Evidence: [deck ownership calculation](C:/Users/macke/Documents/GitHub/cyberpunk_tcg_simulator/src/ui/DeckBuilderView.tsx:43).

### Demo mode persists when building from a starter

Loading, editing, and saving a starter preserves demo=true. There is no visible way to convert it to constructed mode. The badge helps, but an undersized custom deck can remain playable with relaxed size validation. Add a visible format selector and a Convert to constructed action.

### Collection persistence depends on the development server

The endpoint is installed with configureServer only. A production build served by vite preview or ordinary static hosting has no collection endpoint. This is a deployment limitation, not an unexplained dev-mode failure.

Choose the intended use: a dependable local application with a small persistent service, or a hosted application with authenticated storage. Update README's older browser-only/offline claims and its outdated 426-printing/12-set counts. Also surface background Git outcomes independently of a subsequent save; currently a push result may only reach the UI on the next PUT.

Evidence: [dev-only endpoint](C:/Users/macke/Documents/GitHub/cyberpunk_tcg_simulator/src/server/collectionPlugin.ts:134), [background Git status](C:/Users/macke/Documents/GitHub/cyberpunk_tcg_simulator/src/server/collectionGit.ts:110).

## Improvements that best serve your goals

### Separate targets and useful acquisition lists

Keep three concepts distinct:

| Concept | Identity | Completion rule |
| --- | --- | --- |
| Playable card | cardId | Target copies across eligible owned printings; default 3, Legend 1 |
| Artwork | artworkId | At least one owned copy among printings using that artwork |
| Physical printing | printing key | Exact inventory count, retaining set, rarity, finish, and collector number |

Add independent Playset and Artwork progress, each with owned/target counts, a missing-only view, and its own buy-list.

Build an acquisition list across selected decks. Offer “share cards between decks” using the maximum required count per card, and “keep all decks assembled” using the sum. Account for cards reserved for a binder only if you choose to reserve them. Highlight an acquisition that fills both a playset gap and an artwork gap so you do not buy unnecessarily twice.

### Improve deck analysis before adding more automation

Add a cost curve, sell-tag count and ratio, type distribution, early-play density, and a filter for cards within the selected Legends' RAM. Offer opening-hand sampling, manual test scenarios, deck versions, notes, and a direct Play this deck action.

For empirical comparison, retain matchup history with exact deck versions and benchmark against several decks. Log manual game results alongside AI results.

### Make collecting faster and recoverable

Add a compact searchable list view, collector-number search, bulk counts, visible artwork thumbnails, and a clear undoable acquisition session. Record acquired/traded dates and optional source/cost; allow bulk entry of known starter contents. Preview replace/merge imports before applying them and retain a recoverable history.

Set and rarity filters currently select cards having a matching printing but still show all printings and global totals. Label that behavior or make the expanded rows and scoped totals match the selected filters. Do not label rounded percentages 100% until the relevant goal is actually complete.

### Add a distinct sealed format if preparing for launch events

The official upcoming Beta events use a sealed format: at least 30 main-deck cards, up to three chosen colors, ignored RAM limits, and unrestricted copy counts. The existing demo flag only waives deck size and does not model that format.

A pool-limited sealed builder and best-of-three match tracking would be useful if you plan to attend. [Official Beta Event Guide](https://cyberpunktcg.com/beta-event-guide).

## Suggested order

1. Fix the two collection-loss paths and the overlapping card layout.
2. Make Play refresh saved decks and suppress ownership claims until data is available.
3. Refresh missing cards and errata; expose unsupported/simplified interactions.
4. Add artwork identity and separate your two goal calculations and buy-lists.
5. Preserve complete simulation history and deck versions.
6. Expand player-choice fidelity, deck diagnostics, and multi-deck acquisition planning.

The existing architecture is worth building on. The immediate work is primarily about making its answers trustworthy and aligning its collection model with what you actually want to collect.

