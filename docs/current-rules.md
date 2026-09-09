# Current rules decisions — 8 September 2026

Authority: the official comprehensive rules updated September 1, captured in
`rules/comprehensive-rules-2026-09-08.json`, plus the official errata. The audit
and remediation checklist link each corrected area to its implementation and
verification. Historical numbered rulings explain earlier code and must not be
used to override this source.

The simulator now implements turn-boundary overtime and Lag, null Street Cred
and costs, ordinary and Go Solo Legend play, persistent reactions after blocking,
fight results before defeat, simultaneous Gig transfers, exact/up-to adjustments,
Gear movement and inherited effects, controller-specific choices, and queued
pending effects with last-known source information. Costs and effect choices are
replayed deterministically. Programs resolve outside normal areas; search and
reveal choices display their current board while retaining the original replay
base. Private peeks have viewer-scoped knowledge and public seen markers.

All 151 discovered card definitions have implementations. This means coverage,
not a proof of every possible interaction. Regression tests exercise printed
cards and rule boundaries; randomized games check structural invariants.

## Interpretations pending official clarification

- Selling: preserve the distinction between effect-driven sales and the once-per-turn
  main action, because rules 5.8.4 and 11.9.2.2 conflict.
- Quick abilities: permit face-up Legend-area abilities using the general Legend-area
  permission, despite the narrower field wording in 11.26.1.2.
- Legend exits: record ordinary play versus Go Solo. Cards leaving for an invalid
  area record that intermediate destination before removal; Gear stays at the destination.

No publisher ruling has been requested or received. These interpretations remain
visible rather than being presented as official resolutions.

## Product boundaries

Physical handling, shuffling/cutting etiquette, sleeves and tournament penalties
are outside the simulator. Constructed/Demo/Sealed validation, opened pools and
a manual best-of-three tracker are implemented. The match clock tracks the event
procedure independently of a live engine game. AI policy still chooses among legal
options heuristically; higher simulation counts reduce sampling noise but cannot
remove policy bias. Existing saved action records may become incompatible after
rules changes; new records/runs retain version metadata, and older game replays
require an explicit attempt under current rules.
