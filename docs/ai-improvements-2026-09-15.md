# AI improvements — 15 September 2026

## Outcome

The five concrete decision failures in the [investigation](ai-investigation-2026-09-15.md)
now have fixes and deterministic regression cases. The shared AI used by live play
and simulations is stronger in measured games. It remains a bounded heuristic:
these results do not establish human-level competitive piloting or real metagame
matchup percentages.

## Changes

| Investigation finding | Implemented behavior |
| --- | --- |
| Judy's already-revealed Program choice and choices after draws were scored before the choice took effect | Viewer-scoped replay records which information was already disclosed. Previews replay that prefix and evaluate the answer, stopping again at the next unknown outcome. |
| Ordinary attackers' readiness and control effects had little or no value | Board evaluation values available attacks, future attack threats, attack prevention and readying locks. Judy can recognize the benefit of giving a ready zero-power Unit its first power. |
| Temporary debuffs were rewarded without a useful follow-up | Lasting power and temporary combat potential are evaluated separately. Short action sequences can find debuff-then-fight lines; an unused debuff no longer counts as permanent removal. |
| Fixed high-die and high-Street-Cred policies conflicted with BBG | Deck effects determine min-d4, min-Gig, lower-Cred and value-pair preferences. These inform die selection, rerolls and evaluation. |
| Hand cards, mulligans and action sequencing lacked context | Known hand cards have role, affordability and redundancy values. Mulligans consider sale resources and early Units. The search examines short continuations and public opponent replies. |

Strategy detection uses card effects and known deck composition, not deck names.
The opponent's unseen hand and unknown deck/Legend positions are not used to
select moves. Known Legend peeks remain usable only by their entitled viewer.
Unknown draws and scripted reveals use estimates rather than actual future cards.

The default search considers at most 48 root candidates on large main-phase
boards, preserving multiple targets per action family. It refines three distinct
families with up to two additional main actions and a 16-edge continuation budget
per family. Reaction/effect resolution remains bounded at 32 steps, with the first
branching window optimized and later windows using inexpensive defaults. Public
rival replies minimize the acting AI's score. Opponent hand-based Quick reactions
and optional steal interceptions are not guessed from hidden cards. The actual
opponent re-evaluates its own decision when that window arrives.

Budgets count actions, not elapsed milliseconds, so seeded choices remain
deterministic across machines. Both interfaces use `createHeuristicAgent`; their
existing tie-breaking seed lifetimes differ. This change does not introduce
learning between games.

Engine version metadata is now `strategic-ai-2026-09-15-v2`, so saved measurements
can be distinguished from the earlier policy. No card balance or rule
interpretation was changed.

## BBG matchup measurements

Both sides use the corresponding old or new policy. Each matchup has 200 games,
seeds 7–206, alternating deck seats through the production `runGames` runner.
The BBG list is the same public WillGlitch Draw and Wipe list used in the
investigation, not a confirmed copy of the user's saved list.

| Retail starter opponent | Previous BBG wins | New BBG wins | Change |
| --- | ---: | ---: | ---: |
| Embracing Power | 17/200 (8.5%) | 49/200 (24.5%) | +16 percentage points |
| The Heist | 33/200 (16.5%) | 48/200 (24%) | +7.5 percentage points |

All 400 new games completed normally: 326 normal seven-Gig wins and 74 overtime
seven-Gig wins. There were no draws, deckouts, exceptions or action-cap failures.
Average lengths were 6.38 and 6.33 turns. The two batches took 91 and 204 seconds
on this machine while other verification was running; these are observed batch
times, not a latency guarantee.

These results still leave BBG losing most games. Improving both pilots also
improves the starter opponent. The smaller Heist increase should not be treated
as a precise strength estimate from only 200 games. The fixed scenarios and
separate identical-deck comparisons are needed alongside matchup win rates.

## Identical-deck comparison

The revised AI and the previous AI play the same deck against each other, swapping
seats each game. Seeds 12000–12099 were separate from the BBG development sample.
The previous evaluator and policy were copied from commit `6f33927`; real game
resolution uses the same current engine. Its original hidden-information stop
behavior is retained because only the new policy supplies a preview observer.

| Deck used by both players | New AI wins | Previous AI wins |
| --- | ---: | ---: |
| BBG Draw and Wipe | 65 | 35 |
| Embracing Power retail starter | 75 | 25 |
| The Heist retail starter | 71 | 29 |

There were no draws. Across the BBG games, the new pilot took all 80 Programs
offered by Judy, with zero declines. The original investigation's trace took
50/99 Programs; that trace used a different matchup and seed range, so the
counts demonstrate the corrected choice behavior rather than a paired rate
estimate. The focused revealed-Towerfall regression also takes the Program for
every one of 20 tie-breaking seeds.

## Validation

### Follow-up using the user's exact BBG export

After the original measurements, the user supplied the saved **BBG Judy** export.
It imports through the app's `importDeckText` and passes constructed validation:
40 main-deck cards, 3 Legends, 26 Programs and 14 Units. Compared with the public
reference it adds 3 Floor It and 1 Towerfall, removing 3 Chrome Reverie and
1 MaxTac AV. The Legend set is identical. The user's exported ordering was
preserved when constructing the benchmark deck.

Both policies were tested against the retail Embracing Power starter for 200
games each, seeds 7–206, alternating seats. Both seats used the corresponding
previous or improved policy in each run.

| Policy | BBG wins | BBG losses | Judy Programs taken / offered |
| --- | ---: | ---: | ---: |
| Previous | 14/200 (7%) | 186/200 (93%) | 101/191 |
| Improved | 42/200 (21%) | 158/200 (79%) | 185/185 |

The old policy reproduces the user's reported 93% loss rate on this sample. All
400 games ended normally through seven-Gig or overtime seven-Gig wins; there
were no exceptions, action-cap failures, draws or deckouts. The traced benchmark
loop was cross-checked against the production runner for its first four improved
games, with identical per-game results.

The earlier 24.5% result against Embracing Power belongs to the public reference
list; **21% is the measurement for the user's exact list**. This confirms the
improvements help the actual deck, while its remaining 79% loss rate still makes
competitive matchup forecasting inappropriate. These samples do not isolate
the effects of the four card substitutions: list ordering also changes seeded
shuffles, and subsequent decisions change game trajectories.

Exact export, parsed deck, full outcomes and trace harness are retained in
`test-results/bbg-user-export.txt`, `bbg-user-deck.json`, `bbg-user-results.json`
and `bbg-user-benchmark.ts`. The versioned benchmark summary includes this
follow-up separately from the original public-list results.

### Implementation verification

All **1,672 current unit/integration tests across 87 files** were verified across
split runs: 1,568 outside the large heuristic suite, plus its 104 cases. The first
heuristic run had three timeout failures and the demo-only calibration failure
discussed below. The timed cases and revised calibration passed their final
targeted reruns. Correctness/benchmark timeouts now allow full searched games;
the separate two-second per-game speed requirement was retained and passed.

Additional evidence:

- 11 new strategic regression cases and 3 viewer-scoped replay cases pass.
- Hidden-information invariance passes on 100 starter and 115 synthetic states.
  Across those checks, 490 candidate outcomes materially changed after hidden
  cards were permuted, without changing a score or chosen action.
- The AI won 200/200 balanced-seat games against the random agent.
- Reaction search beat the version without it 32–8 over 40 games.
- Blocker-aware evaluation produced 22 observed Mercs block windows versus 7
  without the blocker term, satisfying the existing deployment regression.
- The speed sample completed five games in 3.59 seconds, worst 1.187 seconds.
- All 26 browser checks pass: the existing 25-test suite and the added real
  heuristic-worker simulation check. Live play, complete games, reactions,
  undo, save/resume and simulation persistence were exercised.
- `npm run build` and `git diff --check` pass. The build still reports its bundle
  size advisory.

Test logs are retained under `test-results/ai-full-other-tests.log`,
`ai-full-heuristic-tests.log`, `ai-timing-recheck.log`,
`ai-final-calibration.log`, `ai-e2e.log`, `ai-worker-e2e.log` and
`ai-final-build.log`. The initial failed calibration remains documented below;
it was not a game-rule error or an illegal-action failure.

### Weight calibration and its limits

The previous 40-game demo-only calibration favored the original brief's weights
27–13 with the new search. This is a real counterexample to any claim that the
new defaults outperform every alternative in every matchup. A second seed range
(22000–22039), with 40 games per deck pairing and balanced seats/play order, gave:

| Candidate versus the brief weights | Demo pairing | BBG mirror | Retail pairing | Total |
| --- | ---: | ---: | ---: | ---: |
| Retained defaults | 18–22 | 24–16 | 21–19 | 63–57 |
| Moderate resource/blocker values | 11–29 | 18–22 | 21–19 | 50–70 |
| Aggressive resource/blocker values | 24–16 | 21–19 | 24–16 | 69–51 |

The aggressive alternative also measured 19–21 on the original demo calibration.
There is no consistent winner across these small samples. The retained defaults
did best on the BBG mirror; their larger comparisons against the previous shipped
policy also won across all three decks. No further weight change was made solely
to win the old demo test. The regression now covers all three pairings and retains
per-pair results; its aggregate directional assertion is not proof of statistical
significance or universal superiority. More deck coverage and larger independent
samples would be needed for confident general weight optimization.

## Reproduction artifacts

The versioned [benchmark summary](ai-benchmark-2026-09-15.json) includes the deck
snapshot and before/after measurements. The public BBG list is also retained in
`tests/ai/fixtures/bbg-draw-and-wipe.json`. A production matchup can be reproduced
without the diagnostic harness:

```text
npm run sim -- --deckA tests/ai/fixtures/bbg-draw-and-wipe.json --deckB data/decks/embracing-power-starter.json --games 200 --seed 7
```

Local, gitignored artifacts retain the exact inputs, full per-game production
results, baseline policy copies and diagnostic harness:

- `test-results/bbg-public-deck.json`
- `test-results/bbg-investigation-results.json` — unchanged original baseline
- `test-results/ai-final-benchmark.ts` and `test-results/legacy-ai/`
- `test-results/ai-final-matchups.json`
- `test-results/ai-final-legacy.json`

Run `npx tsx test-results/ai-final-benchmark.ts matchups` or replace `matchups` with
`legacy`. Node 24.14.0 was used. No collection save, commit or push was performed
by this work; browser tests use the dedicated scratch collection configuration.
