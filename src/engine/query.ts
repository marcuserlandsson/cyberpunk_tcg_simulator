// Read-only derived views over GameState. Pure functions, no mutation.
//
// This file owns the *static* half of the effect system: the layered views
// (power, keywords, restrictions) that a card's `static`-trigger EffectDefs and
// its attached Gear contribute to. The *active* half — resolving triggered and
// activated effects — lives in src/cards/effects.ts. Statics are read here
// rather than there so combat.ts/legal.ts can consult them without importing
// the card layer.

import type {
  CardDb,
  CardDef,
  CostReduction,
  EffectDef,
  EffectNode,
  GameState,
  Keyword,
  PlayerId,
} from './types'

/**
 * Granted-only keyword (never printed): "it may attack ready Units" — see
 * `gunpoint-diplomacy` and `valentino-guerrera` (docs/rulings.md §43).
 */
export const ATTACK_READY = 'attack-ready'

/** The rival of `player`. */
export function opponentOf(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0
}

/**
 * Street Cred = the sum of the top faces of every die in the player's gig
 * area (gameplay guide, p12). Dice still in the fixer are unrolled and do not
 * contribute.
 */
export function streetCred(state: GameState, player: PlayerId): number {
  return state.players[player].gigArea.reduce((sum, die) => sum + die.value, 0)
}

/**
 * Whose decision is pending. Normally the active player; during a `react`
 * window it is the defender (the rival of the attacking/active player); during
 * an *effect*-driven Gig steal it is the effect's controller, who may be either
 * player (docs/rulings.md §32) — an attack-driven steal leaves
 * `pendingSteal.thief` undefined and stays with the active player.
 */
export function actingPlayer(state: GameState): PlayerId {
  if (state.phase === 'chooseGig' && state.pendingSteal?.thief !== undefined) {
    return state.pendingSteal.thief
  }
  return state.phase === 'react' ? opponentOf(state.activePlayer) : state.activePlayer
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

/** The highest value among `player`'s Gig dice (0 with an empty Gig area). */
export function maxGigValue(state: GameState, player: PlayerId): number {
  return state.players[player].gigArea.reduce((best, die) => Math.max(best, die.value), 0)
}

/**
 * Extra facts a watcher trigger's condition needs, which no read of the state
 * can supply: the size of the Gig die that was just stolen
 * (docs/rulings.md §42).
 */
export interface ConditionContext {
  stolenDieSize?: number
}

/**
 * Is an EffectDef's `condition` satisfied for `player` right now? Checked both
 * when an activated ability is offered and again when any effect resolves, so a
 * condition that lapses between the two never fires.
 *
 * A `stolenDieSize` condition can only ever be met with a matching `context`,
 * so an effect gated on it never fires outside the steal that triggered it.
 */
export function conditionMet(
  state: GameState,
  player: PlayerId,
  def: EffectDef,
  context: ConditionContext = {}
): boolean {
  const condition = def.condition
  if (condition === undefined) return true
  if (
    condition.streetCredAtLeast !== undefined &&
    streetCred(state, player) < condition.streetCredAtLeast
  ) {
    return false
  }
  if (
    condition.friendlyGigValueAtLeast !== undefined &&
    maxGigValue(state, player) < condition.friendlyGigValueAtLeast
  ) {
    return false
  }
  if (condition.rivalGigLeadAtLeast !== undefined) {
    const mine = state.players[player].gigArea.length
    const theirs = state.players[opponentOf(player)].gigArea.length
    if (theirs - mine < condition.rivalGigLeadAtLeast) return false
  }
  if (condition.stolenDieSize !== undefined && context.stolenDieSize !== condition.stolenDieSize) {
    return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Cost reduction
// ---------------------------------------------------------------------------

/**
 * Applies a printed cost reduction ("-1 €$ for each friendly Gig with 8+
 * value, to a minimum of 1 €$") to a base cost (docs/rulings.md §44).
 */
export function reducedCost(
  state: GameState,
  player: PlayerId,
  base: number,
  reduction: CostReduction | undefined
): number {
  if (reduction === undefined) return base
  const matching = state.players[player].gigArea.filter(
    (die) => die.value >= reduction.value
  ).length
  return Math.max(reduction.minimum, base - matching * reduction.amount)
}

/**
 * What playing `defId` costs `player` right now: its printed cost, less every
 * `costReduction` static node printed on the card itself. Read off the *card
 * definition* rather than `activeStaticNodes`, because a card in hand is not
 * "in play" and so contributes no live statics (docs/rulings.md §44).
 */
export function effectiveCardCost(def: CardDef, state: GameState, player: PlayerId): number {
  let cost = def.cost
  for (const effect of def.effects) {
    if (effect.trigger !== 'static') continue
    if (!conditionMet(state, player, effect)) continue
    for (const node of flattenNodes(effect.effect)) {
      if (node.kind === 'costReduction') cost = reducedCost(state, player, cost, node.reduction)
    }
  }
  return cost
}

// ---------------------------------------------------------------------------
// Static effects (self + attached gear)
// ---------------------------------------------------------------------------

/** Flattens `sequence` nodes so a static def can bundle several statics. */
function flattenNodes(node: EffectNode): EffectNode[] {
  return node.kind === 'sequence' ? node.effects.flatMap(flattenNodes) : [node]
}

/**
 * Every node of every *active* `static` EffectDef of one card definition, from
 * the point of view of `player` (whose street cred gates the conditions).
 */
function staticNodes(state: GameState, def: CardDef, player: PlayerId): EffectNode[] {
  const nodes: EffectNode[] = []
  for (const effect of def.effects) {
    if (effect.trigger !== 'static') continue
    if (!conditionMet(state, player, effect)) continue
    nodes.push(...flattenNodes(effect.effect))
  }
  return nodes
}

/**
 * Is `uid` somewhere its own static abilities apply? Units on the field and
 * face-up Legends in the legends zone are "in play"; a card in hand, deck,
 * trash or eddies, and a face-down Legend (whose identity is not revealed
 * yet), contribute nothing.
 */
function inPlay(state: GameState, uid: number): boolean {
  const card = state.cards[uid]
  if (!card) return false
  const p = state.players[card.owner]
  if (p.field.includes(uid)) return true
  return p.legends.includes(uid) && card.faceUp
}

/**
 * Every static node affecting `uid`: its own (while in play) plus every
 * attached Gear's. Gear conditions are judged from *its own* owner's point of
 * view, which matters for the one card that can equip to a rival Unit
 * (docs/rulings.md §8).
 */
function activeStaticNodes(db: CardDb, state: GameState, uid: number): EffectNode[] {
  const card = state.cards[uid]
  if (!card) return []
  const nodes: EffectNode[] = []
  const def = db[card.defId]
  if (def && inPlay(state, uid)) nodes.push(...staticNodes(state, def, card.owner))
  for (const gearUid of card.attachedGear) {
    const gear = state.cards[gearUid]
    const gearDef = gear ? db[gear.defId] : undefined
    if (!gear || !gearDef) continue
    nodes.push(...staticNodes(state, gearDef, gear.owner))
  }
  return nodes
}

/**
 * The power a card fights with right now: printed power (null counts as 0, see
 * docs/rulings.md §11), plus its until-end-of-turn and permanent deltas, plus
 * every active `staticPower` node affecting it, plus the *printed* power of
 * each attached Gear card — a Gear card's power box is the bonus it hands its
 * host (docs/rulings.md §29).
 */
export function effectivePower(db: CardDb, state: GameState, uid: number): number {
  const card = state.cards[uid]
  if (!card) throw new Error(`Unknown card instance uid: ${uid}`)
  const def = db[card.defId]
  if (!def) throw new Error(`Unknown card definition: ${card.defId}`)

  let power = (def.power ?? 0) + card.tempPower + card.permPower
  for (const gearUid of card.attachedGear) {
    const gear = state.cards[gearUid]
    const gearDef = gear ? db[gear.defId] : undefined
    if (gearDef) power += gearDef.power ?? 0
  }
  for (const node of activeStaticNodes(db, state, uid)) {
    if (node.kind === 'staticPower') power += node.amount
  }
  return power
}

/**
 * Keywords a Gear card never hands to its host. {go-solo} is a property of a
 * Legend card itself ("pay *this Legend's* cost to play it as a ready Unit"),
 * and `riot-shield`'s keyword list contains `go-solo` only because its rules
 * text mentions the keyword — granting it would make any shielded Legend
 * playable as a Unit (docs/rulings.md §30).
 */
const NEVER_GRANTED_BY_GEAR: readonly Keyword[] = ['go-solo']

/**
 * The keywords a card has right now: its own printed keywords plus those of
 * every attached Gear card, minus the ones Gear can never grant
 * (docs/rulings.md §30). Gear that prints {blocker} (riot-shield,
 * mandibular-upgrade) hands the keyword to the Unit or Legend wearing it — the
 * Gear itself can never act. Duplicates are collapsed. This is the single
 * authority on keywords: every caller (combat legality, go-solo plays) goes
 * through it rather than reading `def.keywords`.
 */
export function effectiveKeywords(db: CardDb, state: GameState, uid: number): Keyword[] {
  const card = state.cards[uid]
  if (!card) return []
  const def = db[card.defId]
  const keywords = new Set<Keyword>(def ? def.keywords : [])
  // Until-end-of-turn grants (docs/rulings.md §43) are as real as printed ones.
  for (const keyword of card.tempKeywords) keywords.add(keyword)
  for (const gearUid of card.attachedGear) {
    const gear = state.cards[gearUid]
    const gearDef = gear ? db[gear.defId] : undefined
    if (!gearDef) continue
    for (const keyword of gearDef.keywords) {
      if (NEVER_GRANTED_BY_GEAR.includes(keyword)) continue
      keywords.add(keyword)
    }
  }
  return [...keywords]
}

/** Does `uid` have `keyword`, printed on it or granted by its Gear? */
export function hasKeyword(db: CardDb, state: GameState, uid: number, keyword: Keyword): boolean {
  return effectiveKeywords(db, state, uid).includes(keyword)
}

/**
 * Is `uid` under a static "this Unit can't attack" restriction (corpo-security,
 * misty-olszewski-...)? Gear can impose it too, via the same static node.
 */
export function cantAttack(db: CardDb, state: GameState, uid: number): boolean {
  return activeStaticNodes(db, state, uid).some((node) => node.kind === 'cantAttack')
}

/**
 * The attached Gear that would soak a defeat for `uid` — "If this Unit would be
 * defeated, defeat its DEADMAN TRANSMITTER instead" (docs/rulings.md §46), or
 * null when nothing is protecting it. The *first* such Gear (in attach order)
 * takes the hit.
 */
export function defeatShieldOf(db: CardDb, state: GameState, uid: number): number | null {
  const card = state.cards[uid]
  if (!card) return null
  for (const gearUid of card.attachedGear) {
    const gear = state.cards[gearUid]
    const gearDef = gear ? db[gear.defId] : undefined
    if (!gear || !gearDef) continue
    const shields = staticNodes(state, gearDef, gear.owner).some(
      (node) => node.kind === 'defeatShield'
    )
    if (shields) return gearUid
  }
  return null
}

/**
 * "This Unit wins all fights against CORPO Units": does `uid` beat `foe` in a
 * fight whatever the two powers say?
 */
export function winsFightRegardless(
  db: CardDb,
  state: GameState,
  uid: number,
  foe: number
): boolean {
  return activeStaticNodes(db, state, uid).some(
    (node) => node.kind === 'winsFightVsKeyword' && hasKeyword(db, state, foe, node.keyword)
  )
}
