// Target enumeration for the effect system.
//
// Two jobs:
//   * `targetsFor` turns a `TargetSpec` into the list of uids it currently
//     admits — the single authority both `legalActions` (enumeration) and the
//     interpreter (validation) use, so the two can never disagree;
//   * `gearEquipTargets` answers "what may this Gear card be equipped to",
//     defaulting to the pool-wide rule (a friendly Unit or a friendly face-up
//     Legend, docs/rulings.md §22) with a small per-card override registry for
//     the one card whose printed text is wider (docs/rulings.md §8).
//
// Everything here is a pure read over GameState. "Friendly" is always relative
// to the *source card's owner*, never to the active player: a Gear card equipped
// to a rival Unit still targets its own owner's side (docs/rulings.md §8).

import { effectivePower, hasKeyword, opponentOf } from '../engine/query'
import type { CardDb, GameState, PlayerId, TargetFilter, TargetSpec } from '../engine/types'

/** The player an effect acts for: the owner of the card the effect is on. */
export function controllerOf(state: GameState, sourceUid: number): PlayerId {
  const card = state.cards[sourceUid]
  if (!card) throw new Error(`Unknown card instance uid: ${sourceUid}`)
  return card.owner
}

function fieldOf(state: GameState, player: PlayerId): number[] {
  return state.players[player].field.slice()
}

function faceUpLegendsOf(state: GameState, player: PlayerId): number[] {
  return state.players[player].legends.filter((uid) => state.cards[uid].faceUp)
}

/**
 * Every uid `spec` admits right now, for an effect whose source is `sourceUid`.
 * A {go-solo} Legend played as a Unit sits on the field, so it is a "Unit" for
 * every spec below — which is exactly how the printed keyword reads ("play it
 * as a ready Unit").
 *
 * `controller` overrides whose side counts as "friendly". It defaults to the
 * source card's owner, but an ability or trigger on attached Gear belongs to the
 * *host's* controller, not the Gear's owner (docs/rulings.md §33) — callers pass
 * `effectController` for that.
 */
export function targetsFor(
  _db: CardDb,
  state: GameState,
  spec: TargetSpec,
  sourceUid: number,
  controller?: PlayerId
): number[] {
  const me = controller ?? controllerOf(state, sourceUid)
  const rival = opponentOf(me)

  switch (spec) {
    case 'self':
      return [sourceUid]
    case 'friendlyUnit':
      return fieldOf(state, me)
    case 'rivalUnit':
      return fieldOf(state, rival)
    case 'rivalSpentUnit':
      return fieldOf(state, rival).filter((uid) => !state.cards[uid].ready)
    case 'anyUnit':
      return [...fieldOf(state, me), ...fieldOf(state, rival)]
    case 'friendlyUnitOrLegend':
      return [...fieldOf(state, me), ...faceUpLegendsOf(state, me)]
    // Gig-die specs bind an *index* into the gig area, not a card uid
    // (docs/rulings.md §39).
    case 'friendlyGigDie':
      return state.players[me].gigArea.map((_die, index) => index)
    case 'rivalGigDie':
      return state.players[rival].gigArea.map((_die, index) => index)
  }
}

/** Does `spec` bind a Gig-die index rather than a card uid? */
export function isGigDieSpec(spec: TargetSpec): boolean {
  return spec === 'friendlyGigDie' || spec === 'rivalGigDie'
}

/** The highest `effectivePower` among `player`'s field Units, or null if none. */
function bestFriendlyPower(db: CardDb, state: GameState, player: PlayerId): number | null {
  const powers = fieldOf(state, player).map((uid) => effectivePower(db, state, uid))
  return powers.length === 0 ? null : Math.max(...powers)
}

/**
 * Narrows a card-target candidate list by a printed restriction
 * ("with power 4 or less", "CORPO", "another friendly Unit", "with less power
 * than a friendly Unit"). Gig-die candidates are never filtered — no card in
 * the pool restricts *which* die it may touch.
 */
export function filterTargets(
  db: CardDb,
  state: GameState,
  candidates: number[],
  filter: TargetFilter | undefined,
  sourceUid: number,
  controller: PlayerId
): number[] {
  if (filter === undefined) return candidates
  const friendlyBest = filter.weakerThanAFriendlyUnit
    ? bestFriendlyPower(db, state, controller)
    : null
  return candidates.filter((uid) => {
    if (filter.excludeSelf === true && uid === sourceUid) return false
    if (filter.keyword !== undefined && !hasKeyword(db, state, uid, filter.keyword)) return false
    if (filter.maxPower !== undefined && effectivePower(db, state, uid) > filter.maxPower) {
      return false
    }
    if (filter.minPower !== undefined && effectivePower(db, state, uid) < filter.minPower) {
      return false
    }
    if (filter.weakerThanAFriendlyUnit === true) {
      if (friendlyBest === null) return false
      if (effectivePower(db, state, uid) >= friendlyBest) return false
    }
    return true
  })
}

// ---------------------------------------------------------------------------
// Gear equip targets
// ---------------------------------------------------------------------------

/**
 * Per-card equip-target overrides, keyed by card id. The default rule covers
 * 16 of the 17 Gear cards verbatim; only `kiroshi-optics` prints a different
 * line — "(Equip to a Unit or friendly face-up Legend.)", where "friendly"
 * scopes to the Legend only, so *any* Unit including a rival's is legal
 * (docs/rulings.md §8). A registry keyed by id keeps that exception out of the
 * engine's generic rule and out of the card data's node vocabulary.
 */
export const gearTargetOverrides: Record<
  string,
  (db: CardDb, state: GameState, gearUid: number) => number[]
> = {
  'kiroshi-optics': (_db, state, gearUid) => {
    const me = controllerOf(state, gearUid)
    return [...fieldOf(state, me), ...fieldOf(state, opponentOf(me)), ...faceUpLegendsOf(state, me)]
  },
}

/**
 * What `gearUid` (a Gear card in hand) may be equipped to: a friendly field
 * Unit of any readiness or a friendly *face-up* Legend, unless the card id has
 * an override above. Legends stay ineligible while face-down: nothing can be
 * equipped to a hidden identity (docs/rulings.md §22).
 */
export function gearEquipTargets(db: CardDb, state: GameState, gearUid: number): number[] {
  const override = gearTargetOverrides[state.cards[gearUid].defId]
  if (override) return override(db, state, gearUid)
  const me = controllerOf(state, gearUid)
  return [...fieldOf(state, me), ...faceUpLegendsOf(state, me)]
}
