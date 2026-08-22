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
//     purity guard (tests/engine/purity.test.ts) covers this directory;
//   * `ctx.targets` holds the uids bound to the scripted node's declared
//     `targets` slots, in order (docs/rulings.md §48); a slot with no legal
//     candidate is simply absent, so a script must tolerate a short array.
//
// The registry is a plain mutable object so tests can register a throwaway
// entry (and delete it again) without a factory layer.
//
// IMPORT CYCLE: this module imports `fireTriggerOnDraft` from ../effects, which
// imports this registry. Both directions are run-time-only calls (nothing here
// runs at module evaluation), exactly like the engine <-> cards cycle
// documented at the top of ../effects.ts.

import { hasKeyword } from '../../engine/query'
import { nextInt } from '../../engine/rng'
import type { CardDb, GameState, PlayerId } from '../../engine/types'
import { fireTriggerOnDraft, type EffectCtx } from '../effects'

export type ScriptedCard = (db: CardDb, state: GameState, ctx: EffectCtx) => GameState

/** Picks one element through the seeded rng, advancing it on the draft. */
function pick<T>(state: GameState, items: T[]): T | undefined {
  if (items.length === 0) return undefined
  const [index, rng] = nextInt(state.rng, items.length)
  state.rng = rng
  return items[index]
}

/** Trashes the top `count` cards of a player's deck; returns what moved. */
function trashFromTop(state: GameState, player: PlayerId, count: number): number[] {
  const p = state.players[player]
  const moved: number[] = []
  for (let i = 0; i < count; i++) {
    const uid = p.deck.shift()
    if (uid === undefined) break
    p.trash.push(uid)
    state.events.push({ type: 'cardTrashed', uid })
    moved.push(uid)
  }
  return moved
}

export const scriptedCards: Record<string, ScriptedCard> = {
  /**
   * `all-is-lost` — "Trash 3. Add a Unit from among them to your hand."
   * Trashes the top 3 of the controller's own deck, then takes one of the Units
   * among *those three* back to hand (chosen through the rng, docs/rulings.md
   * §32 — a card's own search is not an enumerable action).
   */
  'all-is-lost': (db, state, ctx) => {
    const trashed = trashFromTop(state, ctx.player, 3)
    const units = trashed.filter((uid) => db[state.cards[uid].defId].type === 'unit')
    const chosen = pick(state, units)
    if (chosen === undefined) return state
    const p = state.players[ctx.player]
    p.trash = p.trash.filter((uid) => uid !== chosen)
    p.hand.push(chosen)
    return state
  },

  /**
   * `arasaka-emergency-radioport` — "When this Unit or Legend is spent, you may
   * look at a friendly face-down Legend. If that Legend is ARASAKA or has
   * {Go Solo}, you may Call it for free. (You may only Call a Legend once per
   * turn.)"
   *
   * The Legend looked at is picked through the rng (docs/rulings.md §32); both
   * "you may"s are taken whenever they are available (docs/rulings.md §50), and
   * the free Call still respects the once-per-turn gate and fires the Legend's
   * {Call} trigger, exactly like the paid action.
   */
  'arasaka-emergency-radioport': (db, state, ctx) => {
    const p = state.players[ctx.player]
    const legend = pick(
      state,
      p.legends.filter((uid) => !state.cards[uid].faceUp)
    )
    if (legend === undefined) return state
    const def = db[state.cards[legend].defId]
    const callable = def.faction === 'Arasaka' || def.keywords.includes('go-solo')
    if (!callable || p.calledLegendThisTurn) return state
    state.cards[legend].faceUp = true
    p.calledLegendThisTurn = true
    state.events.push({ type: 'legendCalled', player: ctx.player, uid: legend })
    fireTriggerOnDraft(db, state, 'onCall', legend, [])
    return state
  },

  /**
   * `johnny-silverhand-rocking-renegade` — "A friendly Unit can attack spent
   * rival Units the turn it's played. If it's a ROCKER Unit, also give it +2
   * power this turn."
   *
   * Scripted rather than encoded because both halves must land on the *same*
   * chosen Unit, and the second half is conditional on that Unit's tags. The
   * first half is {adrenaline}: "can attack ... the turn it's played" is exactly
   * the printed keyword's rule, and attacking *spent* rival Units is the normal
   * restriction (docs/rulings.md §43).
   */
  'johnny-silverhand-rocking-renegade': (db, state, ctx) => {
    const target = ctx.targets[0]
    if (target === undefined) return state
    const card = state.cards[target]
    if (!card.tempKeywords.includes('adrenaline')) card.tempKeywords.push('adrenaline')
    if (hasKeyword(db, state, target, 'rocker')) card.tempPower += 2
    return state
  },
}
