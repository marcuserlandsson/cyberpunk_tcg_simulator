// Escape hatch for the handful of cards whose text no reasonable data
// vocabulary will ever express (multi-step searches, "choose one" modes,
// look-at-a-face-down-Legend, and so on). A card reaches it via the
// `{ kind: 'scripted', name }` EffectNode; Task 8 registers one entry per such
// card, keyed by the card id (or `<cardId>:<what>` when a card needs several).
//
// Contract for a ScriptedCard:
//   * it receives the interpreter's live draft state and may mutate it in place
//     *or* return a fresh state — the interpreter folds whatever comes back
//     into the draft, so both styles are safe;
//   * it must stay deterministic: every random choice goes through `state.rng`
//     (see src/engine/rng.ts), returning the advanced rng on the state;
//   * it must not read the clock, the filesystem or any global — the engine
//     purity guard (tests/engine/purity.test.ts) covers this directory.
//
// The registry is a plain mutable object so tests can register a throwaway
// entry (and delete it again) without a factory layer.

import type { CardDb, GameState } from '../../engine/types'
import type { EffectCtx } from '../effects'

export type ScriptedCard = (db: CardDb, state: GameState, ctx: EffectCtx) => GameState

export const scriptedCards: Record<string, ScriptedCard> = {}
