# AI planning and difficulty

The 16 September profile (`planning-2026-09-16-v4`) won **43/60** identical-deck
games against Medium on fresh seeds. Difficulty selection is available in both
Play and Simulate. BBG Judy still loses most games against Embracing Power in the
tested matchup; expert piloting and competitive matchup forecasting remain
unproven. Full outcomes and deck snapshots are in the
[benchmark artifact](ai-difficulty-benchmark-2026-09-16.json).

## Design

Play and Simulate use the same agent factory. Easy, Medium and Hard share the
legal rules engine; every selected move goes through `legalActions` and
`applyAction`. Random remains a diagnostic simulation baseline. The old
`heuristic` identifier maps to Medium so existing simulation exports still load.

- **Easy:** immediate evaluation, no sequence or response search, with a seeded
  30% chance of considering another plausible move in main/reaction phases.
- **Medium:** the improved tactical heuristic: deck-aware evaluation, reaction
  resolution, and short action sequences.
- **Hard:** tactical search plus sampled continuations through the current turn
  and the opponent's reply. Follow-up moves use tactical sequence search. It
  compares alternative futures against its tactical choice and penalizes
  uncertain improvements. Opening order and mulligans retain Medium's policy;
  experimental short-horizon opening search regressed the Judy matchup.

Hard's current default budget is six candidate moves, up to six shared hidden
state samples, at most 120 actions per line, and 12,000 preview/rollout transitions
per decision. Its shortlist reserves room for revealing a Legend and alternative
card sales, so immediate spell value does not exclude resource setup. The captured
Judy regression sells Les Élémens to fund a three-Unit Towerfall wipe, instead of
playing single-target removal and then selling Towerfall.

A passing root action counts toward the same turn horizon as a
played card. Incomplete comparisons are discarded. If fewer than two shared
samples finish, Hard keeps its tactical choice. Actual terminal wins outrank
nonterminal evaluations; seven Gigs are not treated as an already-won game in
future-state scoring.

Live Hard decisions have a ten-second deadline. The worker sends its tactical
choice immediately and updates it after complete comparisons; at the deadline,
the game uses the latest completed result and terminates the worker. Undo, load,
replacement and unmount also cancel it. Errors appear with a retry action.

Simulations use the fixed work budget to preserve seeded reproducibility across
machines. Wall-clock duration varies by hardware and load. They use the same
planner, with enough time to finish that budget; live play can stop earlier.
Saved live games retain the actual actions, so replay does not repeat a timed
search.

## Information available to the planner

The AI knows its own deck composition and hand, public cards and effects, and
cards explicitly revealed to it. Own unseen deck order, unseen Legend positions,
and future random outcomes are sampled independently. Rival hidden identities
are inferred from six reference lists: the four shipped retail/demo starters,
the user's supplied BBG Judy export, and the existing public Draw and Wipe
reference. A list is eligible only when its remaining counts match the hidden
zones and all exposed cards fit. When lists match, 80% of samples use a compatible
list; 20% retain a broad catalog hypothesis. With no match, all samples use the
catalog model.

Catalog samples use plausible Legend rosters consistent with exposed RAM costs
and unique Legend names, then compatible main cards with a constructed copy-limit
prior. Generated cards or unusual formats can require a broader fallback. Neither
model reads the rival's actual hidden identities or looks up the selected opposing
deck. Hypothetical hands, deck order and random outcomes remain uncertain even
when the reference list happens to match. This is a hand-built opponent model;
it does not learn between games.

Pending transactional choices keep the existing viewer-scoped preview mechanism,
which can replay a random prefix already observed by that player without peeking
past the next hidden information boundary.

## Persistence

New live records retain `aiDifficulty` and `aiVersion`. Changing the setup selector
does not change a running game. Legacy records without difficulty resume as
Medium. Simulation exports retain each seat's agent, seed, exact decks and engine
fingerprint. Different difficulties remain different benchmark conditions.

## Strength validation

A difficulty label and deeper search do not establish expert play. The intended
bar is a consistent advantage over Medium on multiple identical-deck matchups,
with paired seats and held-out seeds, plus an improvement on the user's exact
BBG Judy versus Embracing Power reproduction. Both agents should also complete
legal games without caps or exceptions. Human expert strength requires separate
expert games; no automated win rate establishes that claim.

### Measured results, 16 September 2026

The final profile was fixed before inspecting the fresh-seed strength outcomes.
Games pair the same seed with both seats and use identical decks on both sides
for difficulty comparisons. The 60-game sample has 20 games per deck.

| Identical deck | Hard wins against Medium | Medium wins against Easy |
| --- | ---: | ---: |
| Embracing Power retail starter | 15/20 | 17/20 |
| The Heist retail starter | 14/20 | 18/20 |
| User's BBG Judy | 14/20 | 16/20 |
| **Total** | **43/60 (71.7%)** | **51/60 (85%)** |

Hard/Medium uses seeds 66000–66029; Medium/Easy uses 65000–65029. These are
measured policy advantages across the three tested decks, not a guarantee for
every deck or player. The Hard/Medium sample was expanded from 24 to 60 games
before inspecting its outcomes.

The user's exact constructed export was also tested against the retail
Embracing Power starter, with paired seats:

| Judy agent / starter agent | Judy wins |
| --- | ---: |
| Medium / Medium | 4/24 (16.7%) |
| Hard / Medium | 6/24 (25%) |
| Hard / Hard | 3/12 (25%) |

The first two rows use seeds 52000–52011; the third uses 52000–52005. Medium also
won 3/12 in that same 12-game subset. The two-win increase against Medium is too
small to establish reliable matchup improvement. **The original concern about
competitive BBG piloting is not resolved by these results.** Hard beats Medium
with the same Judy deck, but both still struggle to pilot Judy against this
starter. Longer-term control planning, the limited move/sample budget, and the
approximate opponent model remain limitations. This measurement does not prove
the real, human-piloted matchup is unfavorable.

All 180 games in these five final comparisons completed without draws,
exceptions or action-cap failures. The Hard/Medium check measured 3,683 Hard
decisions: mean 0.87 seconds, 95th percentile 3.79 seconds, maximum 5.98 seconds.
These include simple and forced moves and were measured alongside other work;
they are observed timings, not isolated hardware limits. Live play separately
enforces its ten-second worker deadline.

### Experiments and selection

- The catalog-only prototype won 14/24 mirrored games; adding compatible
  reference lists won 16/24 on the same development seeds. Neither alone fixed
  Judy: both won only 2/24 against the starter on seeds 52000–52011.
- Searching opening order and mulligans with a short horizon regressed Judy.
  The expanded shortlist with one sale and opening search won 1/12; retaining
  the tactical opening policy won 7/24 (3/12 on the comparable first half).
- Reserving a second sale fixed the captured sell-to-fund-Towerfall position.
  That final profile won 6/24 against the starter. The one-game difference
  from the one-sale experiment is not evidence of a general regression or
  improvement; the concrete sequencing regression and fresh strength sample
  support the selected profile.

These are development comparisons, not additional independent evidence for the
final 71.7% result. Earlier batches labelled `setup` used exactly the options
promoted to the v4 default; later strength shards ran that default directly.

### Verification

- **1,691 unit/integration cases verified across 89 files.** The full run with
  concurrent benchmarks passed 1,688 cases; two information-invariance tests
  exceeded their five-second timeout and a speed assertion measured 2.33 seconds
  against its two-second bound. After the simulations finished, all three passed
  in an isolated rerun. No assertions or timeouts were weakened.
- **27/27 browser tests passed against the production build**, including full
  games, undo, Hard save/resume, both workers, history and collection workflows.
  Browser tests used the dedicated scratch collection with Git automation off.
- **Production build passed.** Vite retains its existing bundle-size advisory.
- Regression coverage includes sale-then-wipe sequencing, hidden-information
  invariance, independent future RNG, legal deterministic decisions, incomplete
  search fallback, the ten-second deadline, cancellation, retry, and legacy saves.

Logs remain under `test-results/difficulty-final-*.log`; the complete game
outcomes are retained in the versioned benchmark artifact linked above. This
work is local and has not been committed or pushed.

### Reproduction

Reproduce measurements with Node 24:

```text
npx tsx scripts/benchmark-ai.ts strength 60 66000 test-results/ai-strength.json
npx tsx scripts/benchmark-ai.ts ladder 60 65000 test-results/ai-ladder.json
npx tsx scripts/benchmark-ai.ts judy-medium 24 52000 test-results/ai-judy-medium.json
npx tsx scripts/benchmark-ai.ts judy 24 52000 test-results/ai-judy-hard.json
npx tsx scripts/benchmark-ai.ts judy-hard 12 52000 test-results/ai-judy-both-hard.json
```

Each pair uses the same game seed and swaps seats. Output includes exact deck
snapshots, per-game results, policy and engine versions, and decision-time
percentiles. Benchmark simulations do not read or save the collection.

Optional fifth and sixth arguments are a game offset (even, for paired shards)
and a research profile. `current` uses the production default. `setup` names the
equivalent profile used before promotion; other profiles retain experimental
ablations. The harness uses agent seeds `gameSeed + seat * 5000`, so reproduce its
results with this script rather than the production runner's different seed
derivation. Live play likewise derives a fresh seed per decision; all interfaces
share the policy, but their seed lifetimes differ.
