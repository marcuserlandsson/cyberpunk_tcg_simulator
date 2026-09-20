# BBG Judy simulation investigation — 15 September 2026

> Historical baseline before the fixes. See [AI improvements and verification](ai-improvements-2026-09-15.md) for the revised behavior and results.

## Conclusion

The current AI is not a reliable competitive deck evaluator. It uses a shallow,
fixed scoring policy that misses control effects, resource combinations, and
important information already revealed during card resolution. These weaknesses
systematically disadvantage BBG's strategy. The reported loss rate is consistent
with a fresh reproduction using a public BBG list.

This investigation establishes specific decision failures, not the true human
matchup percentage or the fraction of losses caused by each failure. No production
AI, rules, card data, or user storage was changed.

## Reproduction

The user's saved BBG list and original run settings were not available in the
repository or an accessible browser session. The comparison used WillGlitch's
[BBG Draw and Wipe](https://choom.gg/guides/bbg-draw-and-wipe-f4d128), published
11 September: Jackie / Hanako / Judy, 40 main-deck cards, 25 Programs and 15 Units.
The imported list passed `validateDeck`.

The production `runGames` runner used both agents set to `heuristic`, seed 7,
200 games per matchup (game seeds 7–206), and alternating deck seats.

| Opponent | BBG wins | BBG win rate | BBG loss rate |
| --- | ---: | ---: | ---: |
| Embracing Power — retail starter | 17 / 200 | 8.5% | 91.5% |
| The Heist — retail starter | 33 / 200 | 16.5% | 83.5% |

All 400 games ended through seven-Gig wins, either normally or in overtime.
There were no draws, deckouts, simulation exceptions, or action-cap failures.
The deck/seat mapping in the runner correctly attributes wins after swapping
seats. These observations do not point to a result-counting error.

Runtime: Node 24.14.0. Checkout HEAD: `6f33927`; pre-existing storage edits were
present and untouched. Engine version: `comprehensive-2026-09-08-v1`.

## What the AI actually does

`src/ai/heuristic.ts` scores each legal action after applying that one action.
It follows decision windows for up to 32 steps with default answers, but does not
search 32 strategic moves ahead. It normally assumes the defending player passes,
takes the highest-valued available stolen die, and declines optional interceptions.
It does not search the opponent's best response or combinations of main actions.

`src/ai/evaluate.ts` assigns fixed values to Gig counts, Street Cred, field power,
hand size, resources, face-up Legends, ready Blockers, and deck size. It does not
value the identity of cards in hand, recurring card-draw engines, min-d4 access,
Gig value-pairs, or ordinary attackers' readiness directly. Equal scores are
broken with seeded randomness. There is no learning across simulated games.

`src/ui/useGame.ts` and `src/sim/runner.ts` both call `createHeuristicAgent`.
Live games recreate its seeded tie-breaking stream per decision, whereas the
simulation retains an agent for each seat. Their strategy is the same; identical
turn-by-turn tie choices are not guaranteed across the two interfaces.

## Confirmed decision failures

### 1. Control effects can have no value in its scoring

In deterministic positions with a ready rival 10-power Animals Wrecker, sufficient
payment, no min Gig, and odd friendly Street Cred, the AI chose to end its turn:

| Candidate | Score change |
| --- | ---: |
| End turn | -17 |
| Chrome Reverie to prevent the attack | -30 |
| Memory Relapse to spend and prevent readying | -36 |

Chrome Reverie and Memory Relapse were tested in separate otherwise equivalent
positions. The evaluator charges the card and payment costs but gives no direct
credit for preventing an ordinary Unit from attacking. It specifically rewards
ready **Blockers**, so these effects can still receive value against Blockers.

This explains why straightforward bodies and Blockers fit the policy much better
than BBG's control tools.

### 2. It can spend removal for a temporary change with no payoff

With Pyramid Song as the only hand card, no friendly Units, no active abilities,
and no min d4, it paid 3 Eddies to give that 10-power rival Unit -5 power.
That action scored +70; ending the turn scored -17. There was no attacker or
follow-up removal to exploit the reduction, which expires at the end of the turn.

The score rewards the immediate power reduction without planning what happens
afterward. Conversely, enabling a later profitable play can look unattractive.

### 3. Judy's revealed Program choice is effectively random

Both Judy scripts are in `PRIVATE_INFORMATION_SCRIPTS` in
`src/cards/scripted/index.ts`. `src/cards/effects.ts` stops AI previews before
entering those scripts. The actual engine can execute them correctly.

However, answering a pending choice replays the original action. Scoring that
answer re-enters the same preview stop, even when the real game has already
revealed the card and asked whether to retrieve it. In a position with a revealed
Towerfall, taking the Program and leaving it in trash both scored -6. The scorer
never reached the difference between the answers.

In 100 fully traced production-policy games against Embracing Power:

- Judy's ability was activated 160 times.
- A Program retrieval choice occurred 99 times.
- The AI took it 50 times and left it in trash 49 times.

This is an AI preview/replay integration defect, beyond an ordinary lack of deep
search. Judy is not simply unimplemented or never activated: the policy uses her,
but fails to evaluate her benefit and her subsequent choice correctly.

The same boundary can hide later effects following a draw. A Jackie decrease
choice reached after Delamain's draw gave identical scores for decreasing a d4
showing 3 by 0, 1, or 2, despite their different real outcomes.

### 4. Its Gig policy conflicts with BBG's conditions

The agent always chooses the largest available die other than the initially
restricted d20. It chose d12 first in all 100 traced baseline games. When a
reroll choice exists, it rerolls below-average faces. Its evaluator always
rewards higher Street Cred.

BBG benefits from a min d4 for [Pyramid Song](https://cyberpunktcg.com/cards/pyramid-song),
lower Street Cred for [Towerfall](https://cyberpunktcg.com/cards/towerfall), and
Gig value-pairs for Hanako's draws. The fixed policy has no model of maintaining
these conditions. In traced baseline play, BBG ended only 20 of its 573 turns
with a min d4.

### 5. Buff targeting, hand preservation, and sequencing lack strategic context

In a position containing a spent 0-power Delamain and a ready, non-Lag 0-power
Delamain, Judy's +1 targets scored identically. Seed 7 selected the spent Unit.
The evaluator sees the same added power; it misses the newly enabled attacker.

Selling Towerfall, Trust No One, or Chrome Reverie also produced identical sale
scores in a focused position. Hand cards are scored by count, so preserving a
specific answer or combo piece does not guide otherwise equivalent sales.

The mulligan policy likewise counts cards costing at most 2; it does not check
whether the hand has the Units, resources, and Programs needed for its game plan.

## Isolated policy experiments

Diagnostic-only wrappers changed BBG's decisions while preserving the production
engine and opponent policy. Each row used 100 games, seeds 7–106, alternating
seats, against Embracing Power. The traced baseline reproduced the first 100
games of the production run.

| BBG policy | Wins / 100 |
| --- | ---: |
| Shipped policy | 8 |
| Choose d4 first; retain a 1 when offered a reroll | 10 |
| Always take Judy's revealed Program | 9 |
| Both overrides | 11 |

The low-Gig overrides increased min-d4 end-turn positions from 20/573 to 115/571.
The retrieval override removed the observed Program declines. Neither, separately
or together, was enough to make the deck perform well. The small win-rate changes
are inconclusive at this sample size and must not be treated as reliable estimates
of each fix's strength. Decisions alter later game trajectories and random choices.

## Rules, coverage, and test limits

The relevant suite passed: **6 test files, 255 tests**. It covered the heuristic,
Blue and Green cards, optional effects, scripted choices, and simulation runner:

```text
npm test -- tests/ai/heuristic.test.ts tests/cards/blue.test.ts tests/cards/green.test.ts tests/engine/comprehensive-optional.test.ts tests/engine/comprehensive-script-choices.test.ts tests/sim
```

The local Judy, Pyramid Song, and Towerfall text agrees with the current official
card pages checked in this investigation. The current
[official errata](https://cyberpunktcg.com/errata) does not identify a gameplay
change to these BBG interactions that explains this result. This was a targeted
check, not a fresh audit of every rule and interaction.

The AI tests emphasize legality, deterministic execution, hidden-information
invariance, speed, simple tactics, and strength against a random opponent.
Passing them does not establish competent competitive piloting. Some historic
comments describe old heuristic matchup results as a deck's “genuine gap”; those
comments should not be interpreted as measured human matchup strength.

## Recommended implementation order

1. Correct preview/resolution handling so decisions use already-disclosed
   information and score the full known consequences of each answer. Model
   unknown outcomes by expectation instead of dropping their benefits.
2. Value attack prevention, readiness, temporary effect expiry, and useful
   attack thresholds. Add regression positions for the failures above.
3. Add short action-sequence search and plausible opponent responses, so the AI
   can plan removal combinations, buffs before attacks, and defensive setups.
4. Make Gig selection, mulligans, sales, payments, and resource preservation
   respond to deck composition and current conditions.
5. Benchmark across multiple archetypes with human-reviewed decision positions,
   and report simulation rates explicitly as outcomes under that policy.

Increasing simulation count alone reduces sampling noise; it does not repair
systematic decision errors. The present results describe how the shipped AI
pilots these lists, not how skilled players would perform with them.

## Reproducibility artifacts

Local diagnostic files are under the gitignored `test-results/` directory:

- `bbg-public-deck.json`: comparison list and source.
- `bbg-investigation.ts` and `bbg-investigation-results.json`: production-run results.
- `bbg-policy-probes.ts` and `bbg-policy-probes-results.json`: isolated overrides and counters.
- `ai-investigation.ts` and `ai-investigation-positions.json`: deterministic decision scores.

Run each diagnostic with `npx tsx test-results/<script>.ts` from the repository root.
