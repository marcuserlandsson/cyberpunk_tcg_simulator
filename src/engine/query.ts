// Read-only derived views over GameState. Pure functions, no mutation.
//
// This file owns the *static* half of the effect system: the layered views
// (power, keywords, restrictions) that a card's `static`-trigger EffectDefs and
// its attached Gear contribute to. The *active* half — resolving triggered and
// activated effects — lives in src/cards/effects.ts. Statics are read here
// rather than there so combat.ts/legal.ts can consult them without importing
// the card layer.

import type { CardDb, CardDef, EffectDef, EffectNode, GameState, Keyword, PlayerId } from './types'

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
 * window it is the defender (the rival of the attacking/active player).
 */
export function actingPlayer(state: GameState): PlayerId {
  return state.phase === 'react' ? opponentOf(state.activePlayer) : state.activePlayer
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

/**
 * Is an EffectDef's `condition` satisfied for `player` right now? Checked both
 * when an activated ability is offered and again when any effect resolves, so a
 * condition that lapses between the two never fires.
 */
export function conditionMet(state: GameState, player: PlayerId, def: EffectDef): boolean {
  const needed = def.condition?.streetCredAtLeast
  if (needed === undefined) return true
  return streetCred(state, player) >= needed
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
 * The keywords a card has right now: its own printed keywords plus those of
 * every attached Gear card (docs/rulings.md §30). Gear that prints {blocker}
 * (riot-shield, mandibular-upgrade) hands the keyword to the Unit or Legend
 * wearing it — the Gear itself can never act. Duplicates are collapsed.
 */
export function effectiveKeywords(db: CardDb, state: GameState, uid: number): Keyword[] {
  const card = state.cards[uid]
  if (!card) return []
  const def = db[card.defId]
  const keywords = new Set<Keyword>(def ? def.keywords : [])
  for (const gearUid of card.attachedGear) {
    const gear = state.cards[gearUid]
    const gearDef = gear ? db[gear.defId] : undefined
    if (!gearDef) continue
    for (const keyword of gearDef.keywords) keywords.add(keyword)
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
