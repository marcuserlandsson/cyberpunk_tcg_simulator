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
  CardType,
  CostReduction,
  DynamicAmount,
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
 * The card `uid` acts on behalf of: its Gear host, if `uid` is attached
 * Gear (mirroring `effects.ts`'s `abilityHost`, reimplemented locally so
 * this pure-read module does not need to import the card layer), otherwise
 * `uid` itself. Used by `selfIsStealer` so a "When THIS Unit steals" clause
 * printed on Gear (gorilla-arms) reads its host's identity, not the Gear
 * card's own uid (docs/rulings.md §68 ff.).
 */
function actingCardFor(state: GameState, uid: number): number {
  for (const player of [0, 1] as const) {
    for (const host of [...state.players[player].field, ...state.players[player].legends]) {
      if (state.cards[host].attachedGear.includes(uid)) return host
    }
  }
  return uid
}

/**
 * Extra facts a triggered effect's condition needs, which no read of the
 * state can supply: the size of the Gig die that was just stolen
 * (docs/rulings.md §42), plus four batch-2 additions (docs/rulings.md §55 ff.)
 * that are each scoped to exactly one trigger seam and unsatisfiable anywhere
 * else, the same way `stolenDieSize` only ever matches inside a steal.
 */
export interface ConditionContext {
  stolenDieSize?: number
  /** `onAttack` only: the attacking Unit's own `effectivePower`. */
  sourcePower?: number
  /** `onFriendlyStealDie` only: the card uid that actually did the stealing. */
  stealerUid?: number
  /** `onFriendlyAttack` only: the attacking Unit's own faction/keyword tags. */
  attackerTags?: string[]
  /** `onUnitDefeated` only: the defeated Unit's own faction/keyword tags. */
  defeatedTags?: string[]
  // Batch 4 additions (docs/rulings.md §81 ff.):
  /** `onFriendlyStealDie` only: the rolled value of the die that was just stolen (not its size). */
  stolenDieValue?: number
  /** `onFriendlyStealDie` only: was the stealing card's own type a Legend? */
  stealerIsLegend?: boolean
  /** `onUnitDefeated` only: the PlayerId that owned the defeated Unit. */
  defeatedOwner?: PlayerId
  /** `onUnitDefeated` only: did the defeated Unit carry ≥1 attached Gear before it left the field? */
  defeatedWasEquipped?: boolean
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
  context: ConditionContext = {},
  sourceUid?: number
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
  // Batch 2 additions (docs/rulings.md §55 ff.):
  if (
    condition.streetCredAheadOfRival === true &&
    streetCred(state, player) <= streetCred(state, opponentOf(player))
  ) {
    return false
  }
  if (condition.streetCredBelow !== undefined && streetCred(state, player) >= condition.streetCredBelow) {
    return false
  }
  if (condition.duringOwnTurn === true && state.activePlayer !== player) {
    return false
  }
  if (
    condition.sourcePowerAtLeast !== undefined &&
    (context.sourcePower ?? -Infinity) < condition.sourcePowerAtLeast
  ) {
    return false
  }
  // "When THIS Unit steals a Gig" compares against the ACTING card — its Gear
  // host, when the printed effect sits on attached Gear (gorilla-arms), or
  // itself otherwise (v-roamer-of-the-badlands). A watcher firing for a Gear
  // card passes the Gear's own uid as `sourceUid` (docs/rulings.md §42/§68 ff.).
  if (
    condition.selfIsStealer === true &&
    context.stealerUid !== (sourceUid !== undefined ? actingCardFor(state, sourceUid) : undefined)
  ) {
    return false
  }
  if (
    condition.attackerKeyword !== undefined &&
    !(context.attackerTags ?? []).includes(condition.attackerKeyword)
  ) {
    return false
  }
  if (
    condition.defeatedKeyword !== undefined &&
    !(context.defeatedTags ?? []).includes(condition.defeatedKeyword)
  ) {
    return false
  }
  if (condition.friendlyGigsAtLeastValueCount !== undefined) {
    const { value, count } = condition.friendlyGigsAtLeastValueCount
    const matching = state.players[player].gigArea.filter((die) => die.value >= value).length
    if (matching < count) return false
  }
  // Task 8 batch 3 additions (docs/rulings.md §68 ff.):
  if (condition.friendlyGigDistinctValuesAtLeast !== undefined) {
    const distinct = new Set(state.players[player].gigArea.map((die) => die.value)).size
    if (distinct < condition.friendlyGigDistinctValuesAtLeast) return false
  }
  if (condition.friendlyGigEvenAndOdd === true) {
    const area = state.players[player].gigArea
    const hasEven = area.some((die) => die.value % 2 === 0)
    const hasOdd = area.some((die) => die.value % 2 === 1)
    if (!hasEven || !hasOdd) return false
  }
  if (
    condition.friendlyGigValueEquals !== undefined &&
    !state.players[player].gigArea.some((die) => die.value === condition.friendlyGigValueEquals)
  ) {
    return false
  }
  if (condition.streetCredDiffAtLeast !== undefined) {
    const diff = Math.abs(streetCred(state, player) - streetCred(state, opponentOf(player)))
    if (diff < condition.streetCredDiffAtLeast) return false
  }
  if (condition.sourceEquipped === true) {
    const source = sourceUid !== undefined ? state.cards[sourceUid] : undefined
    if (source === undefined || source.attachedGear.length === 0) return false
  }
  // Batch 4 additions (docs/rulings.md §81 ff.):
  if (condition.stealerIsLegend === true && context.stealerIsLegend !== true) {
    return false
  }
  if (condition.stolenDieValueParity !== undefined) {
    if (context.stolenDieValue === undefined) return false
    const wantEven = condition.stolenDieValueParity === 'even'
    if (context.stolenDieValue % 2 === 0 !== wantEven) return false
  }
  if (condition.defeatedIsFriendly === true && context.defeatedOwner !== player) {
    return false
  }
  if (condition.defeatedWasEquipped === true && context.defeatedWasEquipped !== true) {
    return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Cost reduction
// ---------------------------------------------------------------------------

/**
 * Applies a printed cost reduction to a base cost (docs/rulings.md §44/§81
 * ff.): "-1 €$ for each friendly Gig with 8+ value, to a minimum of 1 €$", or
 * (batch 4) "-1 €$ for each Unit in your trash" — a flat count with no value
 * threshold, hence the second `per` variant rather than an overload of
 * `value`. The trash count needs `db` to tell a Unit from any other card type.
 */
export function reducedCost(
  db: CardDb,
  state: GameState,
  player: PlayerId,
  base: number,
  reduction: CostReduction | undefined
): number {
  if (reduction === undefined) return base
  const matching =
    reduction.per === 'friendlyGigValueAtLeast'
      ? state.players[player].gigArea.filter((die) => die.value >= reduction.value).length
      : state.players[player].trash.filter((uid) => db[state.cards[uid].defId]?.type === 'unit')
          .length
  return Math.max(reduction.minimum, base - matching * reduction.amount)
}

/**
 * Every `firstMatchingPlayDiscount` static node currently active on `player`'s
 * own side, with the provenance (`hostUid`, its own effect `index`) needed to
 * check/mark its once-per-turn allowance (docs/rulings.md §81 ff. —
 * viktor-vektor-drop-your-illusions). Deliberately not folded into
 * `activeStaticNodes`: that helper discards provenance, which this needs.
 */
export function firstMatchingPlayDiscountSources(
  db: CardDb,
  state: GameState,
  player: PlayerId
): { hostUid: number; index: number; node: Extract<EffectNode, { kind: 'firstMatchingPlayDiscount' }> }[] {
  const p = state.players[player]
  const hosts = [...p.field, ...p.legends.filter((uid) => state.cards[uid].faceUp)]
  const results: {
    hostUid: number
    index: number
    node: Extract<EffectNode, { kind: 'firstMatchingPlayDiscount' }>
  }[] = []
  for (const hostUid of hosts) {
    const hostDef = db[state.cards[hostUid].defId]
    if (!hostDef) continue
    for (const [index, effect] of hostDef.effects.entries()) {
      if (effect.trigger !== 'static') continue
      if (!conditionMet(state, player, effect)) continue
      for (const node of flattenNodes(effect.effect)) {
        if (node.kind === 'firstMatchingPlayDiscount') results.push({ hostUid, index, node })
      }
    }
  }
  return results
}

/**
 * What playing `uid` costs `player` right now: its printed cost, less every
 * `costReduction` static node printed on the card itself (read off the *card
 * definition* rather than `activeStaticNodes`, because a card in hand is not
 * "in play" and so contributes no live statics of its own, docs/rulings.md
 * §44), less every OTHER friendly in-play card's still-unused
 * `firstMatchingPlayDiscount` whose category this card matches
 * (docs/rulings.md §81 ff.) — "Play your first CYBERWARE Gear each turn for
 * -3 €$." The allowance itself is marked used by `effects.playCardOnDraft`
 * the moment a matching card is actually played, not here (this is a pure
 * read, consulted both when enumerating and when validating a payment).
 */
export function effectiveCardCost(
  db: CardDb,
  state: GameState,
  player: PlayerId,
  uid: number
): number {
  const def = db[state.cards[uid].defId]
  let cost = def.cost
  for (const effect of def.effects) {
    if (effect.trigger !== 'static') continue
    if (!conditionMet(state, player, effect)) continue
    for (const node of flattenNodes(effect.effect)) {
      if (node.kind === 'costReduction') cost = reducedCost(db, state, player, cost, node.reduction)
    }
  }
  for (const { hostUid, index, node } of firstMatchingPlayDiscountSources(db, state, player)) {
    if (def.type !== node.cardType || !def.keywords.includes(node.keyword)) continue
    if (state.oncePerTurnUsed.includes(`${hostUid}:${index}`)) continue
    cost = Math.max(node.minimum, cost - node.amount)
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
 * Keyword names one of `def`'s own `static` EffectDefs explicitly gates via
 * `grantKeywordWhile` — masks that keyword out of the blanket printed-keyword
 * grant below, so the gate becomes the sole authority on whether it is
 * currently active ("If a Rival controls at least 2 more Gigs than you, this
 * Unit has {Adrenaline}." — adrenaline-converter, docs/rulings.md §68 ff.).
 * Every other card's printed keywords are unaffected: this only ever removes
 * a keyword a card ALSO gates with its own static def.
 */
function gatedKeywordNames(def: CardDef): Set<string> {
  const names = new Set<string>()
  for (const effect of def.effects) {
    if (effect.trigger !== 'static') continue
    for (const node of flattenNodes(effect.effect)) {
      if (node.kind === 'grantKeywordWhile') names.add(node.keyword)
    }
  }
  return names
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
    if (node.kind === 'staticPower') power += resolvePowerAmount(state, node.amount, uid, card.owner)
  }
  return power
}

/**
 * A `buffPower`/`staticPower` amount, resolved against the board: a plain
 * number is itself; `'friendlyMaxGig'` reads `player`'s best Gig die;
 * `{ perEquippedGear: N }` reads `subjectUid`'s own `attachedGear.length`
 * (docs/rulings.md §55 ff. — royce-psycho-on-the-edge's "+2 power for each of
 * its equipped Gear").
 */
export function resolvePowerAmount(
  state: GameState,
  amount: number | DynamicAmount,
  subjectUid: number,
  player: PlayerId
): number {
  if (typeof amount === 'number') return amount
  if (amount === 'friendlyMaxGig') return maxGigValue(state, player)
  if ('perEquippedGear' in amount) {
    return state.cards[subjectUid].attachedGear.length * amount.perEquippedGear
  }
  // "+2 power for each friendly Gig with an even value" / "Draw 1 for each
  // friendly Gig with an odd value" (docs/rulings.md §68 ff.).
  const { parity, amount: perDie } = amount.perFriendlyGigParity
  const matching = state.players[player].gigArea.filter((die) =>
    parity === 'even' ? die.value % 2 === 0 : die.value % 2 === 1
  ).length
  return matching * perDie
}

/**
 * A card's own faction/keyword tags, kebab-cased, as the schema's "Faction
 * tags" section describes: at most one organization tag lives in `faction`,
 * the rest (role tags, and any *second* organization tag) live in `keywords`
 * already. A condition that means "an ARASAKA Unit" has to check both, since
 * a single-faction ARASAKA card carries it in `faction`, not `keywords`
 * (docs/rulings.md §55 ff.). Deliberately reads the card's OWN definition, not
 * `effectiveKeywords` — a Unit's faction is not something its Gear changes.
 */
export function cardTags(def: CardDef): string[] {
  const tags = [...def.keywords]
  if (def.faction !== undefined) tags.push(def.faction.toLowerCase().replace(/\s+/g, '-'))
  return tags
}

/**
 * The extra power `uid` fights with against this specific `foe` — "+2 power
 * while fighting a Legend" (meredith-stout-stone-cold-corpo). Deliberately
 * separate from `effectivePower`: the bonus only exists while a fight against
 * a matching foe is actually happening, so `fight()` is the only reader
 * (docs/rulings.md §55 ff.).
 */
export function fightPowerBonus(db: CardDb, state: GameState, uid: number, foe: number): number {
  const foeCard = state.cards[foe]
  const foeDef = foeCard ? db[foeCard.defId] : undefined
  if (!foeDef) return 0
  let bonus = 0
  for (const node of activeStaticNodes(db, state, uid)) {
    if (node.kind === 'powerVsCardType' && node.cardType === foeDef.type) bonus += node.amount
  }
  return bonus
}

/**
 * "This Unit can attack ready Units with {Blocker}" (valentino-guerrera) —
 * the keyword a static `attackReadyWithKeyword` node widens `attackTargets`
 * to, or null when no such (condition-gated) node is active. Narrower than
 * the granted-only `attack-ready` keyword, which allows ANY ready Unit
 * (docs/rulings.md §43 vs §55 ff.).
 */
export function attackableReadyKeyword(db: CardDb, state: GameState, uid: number): string | null {
  for (const node of activeStaticNodes(db, state, uid)) {
    if (node.kind === 'attackReadyWithKeyword') return node.keyword
  }
  return null
}

/**
 * "This Unit can only attack rival Units. (It can't attack Gig areas.)"
 * (ruthless-lowlife) — a per-card mirror of §24's engine-wide "no dice, no
 * attack" omission (docs/rulings.md §55 ff.).
 */
export function cantAttackGigArea(db: CardDb, state: GameState, uid: number): boolean {
  return activeStaticNodes(db, state, uid).some((node) => node.kind === 'cantAttackGigArea')
}

/**
 * "Rival Units can't attack the turn they're played" (maxtac-suppression-team,
 * docs/rulings.md §81 ff.) — does `uid`'s owner's OPPONENT have any in-play
 * card carrying a `rivalCantAttackWhenPlayed` static? Consulted by
 * `combat.ts`'s `canAttack` to deny the {adrenaline} exception to Lag for
 * every Unit on that opposing side, while `uid`'s own static defs are
 * unaffected (the restriction is about the RIVAL of whoever prints it).
 */
export function rivalDeniesFreshAttacks(db: CardDb, state: GameState, uid: number): boolean {
  const card = state.cards[uid]
  if (!card) return false
  const rival = state.players[opponentOf(card.owner)]
  const hosts = [...rival.field, ...rival.legends.filter((u) => state.cards[u].faceUp)]
  return hosts.some((host) =>
    activeStaticNodes(db, state, host).some((node) => node.kind === 'rivalCantAttackWhenPlayed')
  )
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
  const keywords = new Set<Keyword>()
  if (def) {
    const gated = gatedKeywordNames(def)
    for (const keyword of def.keywords) {
      if (!gated.has(keyword)) keywords.add(keyword)
    }
  }
  // Until-end-of-turn grants (docs/rulings.md §43) are as real as printed ones.
  for (const keyword of card.tempKeywords) keywords.add(keyword)
  for (const gearUid of card.attachedGear) {
    const gear = state.cards[gearUid]
    const gearDef = gear ? db[gear.defId] : undefined
    if (!gearDef) continue
    const gearGated = gatedKeywordNames(gearDef)
    for (const keyword of gearDef.keywords) {
      if (NEVER_GRANTED_BY_GEAR.includes(keyword)) continue
      if (gearGated.has(keyword)) continue
      keywords.add(keyword)
    }
  }
  // A `grantKeywordWhile` static — on the card itself (while in play) or on
  // its Gear — contributes its keyword only while its own condition holds,
  // unlike the always-on printed keywords masked out above (docs/rulings.md
  // §68 ff.).
  for (const node of activeStaticNodes(db, state, uid)) {
    if (node.kind === 'grantKeywordWhile' && !NEVER_GRANTED_BY_GEAR.includes(node.keyword)) {
      keywords.add(node.keyword)
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
