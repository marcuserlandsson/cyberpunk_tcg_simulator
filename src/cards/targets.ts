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

import { effectivePower, hasKeyword, opponentOf, streetCred } from '../engine/query'
import type {
  CardDb,
  GameState,
  GigDie,
  GigDieSpec,
  PlayerId,
  TargetFilter,
  TargetSpec,
} from '../engine/types'

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
  db: CardDb,
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
    // Never enumerated: a `chosen` reference consumes no slot, it reads the uid
    // the enclosing `sameTarget` bound (docs/rulings.md §53).
    case 'chosen':
      return []
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
    // Bare "a Gig" on a card means either player's die: the controller's area
    // first, then the rival's, as one index space (docs/rulings.md §39).
    case 'anyGigDie':
      return [...state.players[me].gigArea, ...state.players[rival].gigArea].map(
        (_die, index) => index
      )
    // Batch 2 additions (docs/rulings.md §55 ff.): zones no earlier card
    // needed to reach.
    case 'friendlyTrashCard':
      return state.players[me].trash.slice()
    case 'friendlyHandCard':
      return state.players[me].hand.slice()
    // "a Unit ... from your hand or trash" — the "Unit" restriction is baked
    // into the spec itself (a mixed hand+trash zone holds every card type);
    // a printed cost cap ("cost 4 or less") narrows further via the ordinary
    // `maxCost` filter.
    case 'friendlyHandOrTrashUnit':
      return [...state.players[me].hand, ...state.players[me].trash].filter(
        (uid) => db[state.cards[uid].defId]?.type === 'unit'
      )
    // Batch 3 fix round 1 (docs/rulings.md §73/§80): "a friendly Gear" / bare
    // "a Gear" — every Gear card attached to a field Unit or face-up Legend,
    // as a real, enumerable target rather than an internal rng pick.
    case 'friendlyGear':
      return [...fieldOf(state, me), ...faceUpLegendsOf(state, me)].flatMap(
        (uid) => state.cards[uid].attachedGear
      )
    case 'anyGear':
      return [
        ...[...fieldOf(state, me), ...faceUpLegendsOf(state, me)].flatMap(
          (uid) => state.cards[uid].attachedGear
        ),
        ...[...fieldOf(state, rival), ...faceUpLegendsOf(state, rival)].flatMap(
          (uid) => state.cards[uid].attachedGear
        ),
      ]
    // Batch 5 additions (docs/rulings.md §92 ff.):
    // Never enumerated: reads `TriggerContext.fightFoeUid` via `EffectCtx.context`,
    // exactly like `chosen` reads a `sameTarget` binding (maelstrom-zealots).
    case 'fightFoe':
      return []
    // "a friendly face-up Legend" as its own zone — the legends zone only,
    // unlike `friendlyUnitOrLegend` (which also includes the field).
    case 'friendlyFaceUpLegend':
      return faceUpLegendsOf(state, me)
  }
}

/** Does `spec` bind a Gig-die index rather than a card uid? */
export function isGigDieSpec(spec: TargetSpec): boolean {
  return spec === 'friendlyGigDie' || spec === 'rivalGigDie' || spec === 'anyGigDie'
}

/**
 * The Gig die one bound index refers to, resolved against the scope the node
 * asked for. `anyGigDie` counts the controller's area first, then the rival's
 * (docs/rulings.md §39). Returns null for an index that no longer exists.
 */
export function gigDieAt(
  state: GameState,
  spec: GigDieSpec,
  index: number,
  controller: PlayerId
): GigDie | null {
  const mine = state.players[controller].gigArea
  const theirs = state.players[opponentOf(controller)].gigArea
  switch (spec) {
    case 'friendlyGigDie':
      return mine[index] ?? null
    case 'rivalGigDie':
      return theirs[index] ?? null
    case 'anyGigDie':
      return (index < mine.length ? mine[index] : theirs[index - mine.length]) ?? null
  }
}

/**
 * Which player's Gig area a bound `changeGig` index actually belongs to — the
 * mirror image of `gigDieAt`. Used to fire "When a Rival adjusts ... friendly
 * Gigs" from the AFFECTED player's point of view (docs/rulings.md §55 ff.).
 */
export function gigDieOwner(
  state: GameState,
  spec: GigDieSpec,
  index: number,
  controller: PlayerId
): PlayerId {
  if (spec === 'friendlyGigDie') return controller
  if (spec === 'rivalGigDie') return opponentOf(controller)
  const mine = state.players[controller].gigArea.length
  return index < mine ? controller : opponentOf(controller)
}

/** The highest `effectivePower` among `player`'s field Units, or null if none. */
function bestFriendlyPower(db: CardDb, state: GameState, player: PlayerId): number | null {
  const powers = fieldOf(state, player).map((uid) => effectivePower(db, state, uid))
  return powers.length === 0 ? null : Math.max(...powers)
}

/**
 * The highest face value among `player`'s own d20 Gig dice, or -1 when they
 * have none — "the value of a friendly d20" (over-the-edge). -1 makes the
 * filter reject every candidate rather than special-casing "no d20"
 * (docs/rulings.md §55 ff.).
 */
function friendlyD20Value(state: GameState, player: PlayerId): number {
  const values = state.players[player].gigArea
    .filter((die) => die.size === 20)
    .map((die) => die.value)
  return values.length === 0 ? -1 : Math.max(...values)
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
  // "power 2 or less ... power 3 or less INSTEAD" — the alternate cap replaces
  // `maxPower` rather than adding to it, and is decided once per filter call
  // rather than per candidate (docs/rulings.md §55 ff.).
  const aheadOnStreetCred =
    filter.maxPowerIfAheadOnStreetCred !== undefined
      ? streetCred(state, controller) > streetCred(state, opponentOf(controller))
      : false
  const d20Cap = filter.maxPowerVsFriendlyD20 ? friendlyD20Value(state, controller) : null
  return candidates.filter((uid) => {
    if (filter.excludeSelf === true && uid === sourceUid) return false
    if (filter.keyword !== undefined && !hasKeyword(db, state, uid, filter.keyword)) return false
    if (filter.cardType !== undefined && db[state.cards[uid].defId]?.type !== filter.cardType) {
      return false
    }
    if (filter.maxCost !== undefined && db[state.cards[uid].defId].cost > filter.maxCost) {
      return false
    }
    const maxPower =
      filter.maxPowerIfAheadOnStreetCred !== undefined && aheadOnStreetCred
        ? filter.maxPowerIfAheadOnStreetCred
        : filter.maxPower
    if (maxPower !== undefined && effectivePower(db, state, uid) > maxPower) {
      return false
    }
    if (filter.maxPowerVsFriendlyD20 === true && effectivePower(db, state, uid) > (d20Cap ?? -1)) {
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
