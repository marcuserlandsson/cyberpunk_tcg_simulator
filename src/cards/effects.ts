// The effect interpreter: the data-driven half of the rules engine.
//
// A card's behaviour is a list of `EffectDef`s (types.ts), each a trigger + an
// optional cost/condition + an `EffectNode` tree. This file walks those trees
// and applies them to a draft GameState, and enumerates the *decisions* they
// need (targets, activated abilities, quick reactions) so `legalActions` can
// offer them.
//
// Split of responsibilities:
//   * src/engine/query.ts owns the *static* half (power/keyword/restriction
//     layers), because combat.ts and legal.ts need those without importing the
//     card layer;
//   * this file owns the *active* half — resolving triggers, activated
//     abilities and quick plays;
//   * src/cards/targets.ts owns target enumeration for both.
//
// IMPORT CYCLE (deliberate, documented): the engine calls into this file at the
// trigger seams (combat.ts's `declareAttack`/`defeatUnit`, reduce.ts's play and
// call handlers) and this file calls back into the engine's mechanics
// (`defeatUnit`, `leaveField`, `drawCards`, the rng). Both directions are
// plain function calls made at *run* time — neither module touches the other
// during module evaluation — so the ESM cycle resolves cleanly. Keep it that
// way: no top-level code here may call an engine function.
//
// PURITY: the public entry points (`fireTrigger`, `resolveEffect`) take a
// GameState and return a new one, drafting internally. The `...OnDraft` twins
// mutate a draft the caller already owns and are what the engine's reducers
// use, exactly like game.ts's `drawCards`.

import { defeatUnit, leaveField } from '../engine/combat'
import { canonicalPayment, pay } from '../engine/economy'
import { draftState, drawCards, endGame } from '../engine/game'
import { conditionMet, opponentOf } from '../engine/query'
import { nextInt, rollDie } from '../engine/rng'
import { scriptedCards } from './scripted/index'
import { gearEquipTargets, targetsFor } from './targets'
import type {
  Action,
  CardDb,
  CardDef,
  EffectDef,
  EffectNode,
  GameState,
  PlayerId,
  TargetSpec,
  Trigger,
} from '../engine/types'

export interface EffectCtx {
  player: PlayerId
  sourceUid: number
  targets: number[]
}

/** Keyword: "usable during the rival's attack" (guide p11 / glossary QUICK). */
const QUICK = 'quick'

/**
 * Ceiling on the number of target tuples one EffectDef contributes to
 * `legalActions`. Every real card needs at most two target slots, so this only
 * ever bites on pathological data; it keeps a runaway cartesian product from
 * exploding the legal-action list.
 */
const MAX_TARGET_TUPLES = 256

// ---------------------------------------------------------------------------
// Target slots
// ---------------------------------------------------------------------------

/**
 * The target specs an EffectNode tree needs, in resolution order. `self` needs
 * no decision (it is always the source card) and so takes no slot.
 */
function targetSpecs(node: EffectNode): TargetSpec[] {
  switch (node.kind) {
    case 'buffPower':
    case 'defeat':
    case 'bounce':
    case 'readyCard':
    case 'spendCard':
    case 'bottomDeck':
      return node.target === 'self' ? [] : [node.target]
    case 'sequence':
      return node.effects.flatMap(targetSpecs)
    default:
      return []
  }
}

/**
 * Which of an EffectDef's target slots can actually be filled right now. A slot
 * with no candidate is *skipped*: the node that wanted it fizzles, and the
 * slots after it still line up, so a "defeat a rival Unit, then draw 1" card
 * still draws when the rival field is empty. Enumeration and resolution both
 * call this, so their positional bookkeeping cannot drift.
 */
function fillableSlots(
  db: CardDb,
  state: GameState,
  sourceUid: number,
  def: EffectDef
): { spec: TargetSpec; candidates: number[] }[] {
  return targetSpecs(def.effect).map((spec) => ({
    spec,
    candidates: targetsFor(db, state, spec, sourceUid),
  }))
}

/**
 * Every legal target tuple for one EffectDef — one entry per fillable slot, in
 * resolution order. Always at least `[[]]`: a def whose slots cannot be filled
 * is still *offered* (playing a card whose effect fizzles is legal), it just
 * resolves to nothing. Callers that must not offer a costed, pointless choice
 * (activated abilities) check `hasUnfillableSlot` as well.
 */
export function effectTargetChoices(
  db: CardDb,
  state: GameState,
  uid: number,
  def: EffectDef
): number[][] {
  let tuples: number[][] = [[]]
  for (const slot of fillableSlots(db, state, uid, def)) {
    if (slot.candidates.length === 0) continue
    const next: number[][] = []
    for (const tuple of tuples) {
      for (const candidate of slot.candidates) {
        if (next.length >= MAX_TARGET_TUPLES) break
        next.push([...tuple, candidate])
      }
    }
    tuples = next
  }
  return tuples
}

/** Does this def want a target it cannot have? (Used to hide dead abilities.) */
export function hasUnfillableSlot(
  db: CardDb,
  state: GameState,
  uid: number,
  def: EffectDef
): boolean {
  return fillableSlots(db, state, uid, def).some((slot) => slot.candidates.length === 0)
}

/** The target tuples for every EffectDef of `uid` that fires on `trigger`. */
export function triggerTargetChoices(
  db: CardDb,
  state: GameState,
  uid: number,
  trigger: Trigger
): number[][] {
  const def = defOf(db, state, uid)
  if (!def) return [[]]
  let tuples: number[][] = [[]]
  for (const effect of def.effects) {
    if (effect.trigger !== trigger) continue
    const own = effectTargetChoices(db, state, uid, effect)
    const next: number[][] = []
    for (const tuple of tuples) {
      for (const extra of own) {
        if (next.length >= MAX_TARGET_TUPLES) break
        next.push([...tuple, ...extra])
      }
    }
    tuples = next
  }
  return tuples
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

function defOf(db: CardDb, state: GameState, uid: number): CardDef | undefined {
  const card = state.cards[uid]
  return card ? db[card.defId] : undefined
}

/** A cursor over the pre-assigned target for each slot of one EffectDef. */
interface Slots {
  assigned: (number | null)[]
  next: number
}

/**
 * Binds the def's fillable slots to concrete uids *once*, before any node runs,
 * so a node that empties the field cannot shift the targets of the nodes after
 * it. Slots the caller supplied are validated against the current candidates;
 * slots left unsupplied (triggers carry no player choice — see
 * docs/rulings.md §32) are drawn uniformly from the candidates through
 * `state.rng`, which keeps replays deterministic.
 */
function bindSlots(
  db: CardDb,
  draft: GameState,
  def: EffectDef,
  sourceUid: number,
  supplied: number[]
): Slots {
  const assigned: (number | null)[] = []
  let supply = 0
  for (const slot of fillableSlots(db, draft, sourceUid, def)) {
    if (slot.candidates.length === 0) {
      assigned.push(null)
      continue
    }
    const offered = supplied[supply]
    supply += 1
    if (offered !== undefined) {
      assigned.push(slot.candidates.includes(offered) ? offered : null)
      continue
    }
    const [index, rng] = nextInt(draft.rng, slot.candidates.length)
    draft.rng = rng
    assigned.push(slot.candidates[index])
  }
  return { assigned, next: 0 }
}

/** How many supplied targets one def consumes (used to split a shared array). */
function slotDemand(db: CardDb, state: GameState, sourceUid: number, def: EffectDef): number {
  return fillableSlots(db, state, sourceUid, def).filter((slot) => slot.candidates.length > 0).length
}

function note(draft: GameState, sourceUid: number, description: string): void {
  draft.events.push({ type: 'effectResolved', sourceUid, description })
}

/** The next bound target for a node, or null when the slot could not be filled. */
function takeTarget(node: { target: TargetSpec }, ctx: EffectCtx, slots: Slots): number | null {
  if (node.target === 'self') return ctx.sourceUid
  const target = slots.assigned[slots.next]
  slots.next += 1
  return target ?? null
}

function randomIndex(draft: GameState, length: number): number {
  const [index, rng] = nextInt(draft.rng, length)
  draft.rng = rng
  return index
}

function playerFor(ctx: EffectCtx, whose: 'friendly' | 'rival'): PlayerId {
  return whose === 'friendly' ? ctx.player : opponentOf(ctx.player)
}

/**
 * Applies one node to a draft. Every branch is total: a node whose target
 * vanished, whose zone ran dry or whose slot could not be filled resolves to
 * nothing rather than throwing. The one exception is an unknown `scripted`
 * name, which is a card-data bug and must be loud.
 */
function applyNode(
  db: CardDb,
  draft: GameState,
  node: EffectNode,
  ctx: EffectCtx,
  slots: Slots
): void {
  switch (node.kind) {
    case 'draw': {
      if (!drawCards(draft, ctx.player, node.count)) {
        // Same rule as the start-of-turn draw (docs/rulings.md §17): being
        // asked to draw from an empty deck loses the game.
        endGame(draft, opponentOf(ctx.player), 'deckout')
        return
      }
      note(draft, ctx.sourceUid, `draw ${node.count}`)
      return
    }

    case 'discardRandomRival': {
      const rival = opponentOf(ctx.player)
      const p = draft.players[rival]
      for (let i = 0; i < node.count; i++) {
        if (p.hand.length === 0) break
        const [uid] = p.hand.splice(randomIndex(draft, p.hand.length), 1)
        p.trash.push(uid)
        draft.events.push({ type: 'cardTrashed', uid })
      }
      note(draft, ctx.sourceUid, `rival discards ${node.count}`)
      return
    }

    case 'buffPower': {
      const target = takeTarget(node, ctx, slots)
      if (target === null || !draft.cards[target]) return
      if (node.duration === 'turn') draft.cards[target].tempPower += node.amount
      else draft.cards[target].permPower += node.amount
      const sign = node.amount >= 0 ? '+' : ''
      note(draft, ctx.sourceUid, `${sign}${node.amount} power (${node.duration}) on ${target}`)
      return
    }

    case 'defeat': {
      const target = takeTarget(node, ctx, slots)
      if (target === null) return
      if (!draft.players[draft.cards[target].owner].field.includes(target)) return
      note(draft, ctx.sourceUid, `defeat ${target}`)
      defeatUnit(draft, db, target)
      return
    }

    case 'bounce': {
      const target = takeTarget(node, ctx, slots)
      if (target === null) return
      if (!draft.players[draft.cards[target].owner].field.includes(target)) return
      note(draft, ctx.sourceUid, `bounce ${target}`)
      leaveField(draft, db, target, 'hand')
      return
    }

    case 'bottomDeck': {
      const target = takeTarget(node, ctx, slots)
      if (target === null) return
      if (!draft.players[draft.cards[target].owner].field.includes(target)) return
      note(draft, ctx.sourceUid, `bottom-deck ${target}`)
      leaveField(draft, db, target, 'deckBottom')
      return
    }

    case 'readyCard':
    case 'spendCard': {
      const target = takeTarget(node, ctx, slots)
      if (target === null || !draft.cards[target]) return
      draft.cards[target].ready = node.kind === 'readyCard'
      note(draft, ctx.sourceUid, `${node.kind === 'readyCard' ? 'ready' : 'spend'} ${target}`)
      return
    }

    case 'stealGig': {
      const victim = opponentOf(ctx.player)
      for (let i = 0; i < node.count; i++) {
        const from = draft.players[victim].gigArea
        if (from.length === 0) break
        const [die] = from.splice(randomIndex(draft, from.length), 1)
        draft.players[ctx.player].gigArea.push(die)
        draft.events.push({ type: 'gigStolen', from: victim, die: { ...die } })
      }
      note(draft, ctx.sourceUid, `steal ${node.count} gig(s)`)
      return
    }

    case 'returnGig': {
      const p = draft.players[ctx.player]
      for (let i = 0; i < node.count; i++) {
        if (p.gigArea.length === 0) break
        const [die] = p.gigArea.splice(randomIndex(draft, p.gigArea.length), 1)
        p.fixer.push({ size: die.size, value: 0 })
      }
      note(draft, ctx.sourceUid, `return ${node.count} gig(s) to the fixer`)
      return
    }

    case 'rerollGig': {
      const player = playerFor(ctx, node.whose)
      const area = draft.players[player].gigArea
      if (area.length === 0) return
      const die = area[randomIndex(draft, area.length)]
      const [value, rng] = rollDie(draft.rng, die.size)
      draft.rng = rng
      die.value = value
      draft.events.push({ type: 'dieRolled', player, size: die.size, value })
      note(draft, ctx.sourceUid, `reroll a ${node.whose} gig`)
      return
    }

    case 'trashFromDeck': {
      const player = playerFor(ctx, node.whose)
      const p = draft.players[player]
      for (let i = 0; i < node.count; i++) {
        const uid = p.deck.shift()
        if (uid === undefined) break
        p.trash.push(uid)
        draft.events.push({ type: 'cardTrashed', uid })
      }
      note(draft, ctx.sourceUid, `trash ${node.count} from the ${node.whose} deck`)
      return
    }

    case 'gainEddieFromTopDeck': {
      const p = draft.players[ctx.player]
      for (let i = 0; i < node.count; i++) {
        const uid = p.deck.shift()
        if (uid === undefined) break
        // Same status as a sold card (docs/rulings.md §21): face-down and
        // ready, so it can pay a cost this same turn.
        draft.cards[uid].faceUp = false
        draft.cards[uid].ready = true
        p.eddies.push(uid)
      }
      note(draft, ctx.sourceUid, `bank ${node.count} eddie(s) from the deck`)
      return
    }

    case 'sequence': {
      for (const child of node.effects) {
        // A node can end the game (a `draw` off an empty deck): stop resolving.
        if (draft.winner !== null) return
        applyNode(db, draft, child, ctx, slots)
      }
      return
    }

    case 'scripted': {
      const script = scriptedCards[node.name]
      if (!script) {
        throw new Error(`Unknown scripted card effect "${node.name}" (src/cards/scripted).`)
      }
      const result = script(db, draft, ctx)
      // Scripts may mutate the draft or return a fresh state; fold either in.
      if (result !== draft) Object.assign(draft, result)
      note(draft, ctx.sourceUid, `scripted:${node.name}`)
      return
    }

    case 'staticPower':
    case 'cantAttack':
      // Static layers, read by query.ts — nothing to do at resolution time.
      return
  }
}

/** Applies one EffectDef (condition + target binding + nodes) to a draft. */
export function applyEffectDefOnDraft(
  db: CardDb,
  draft: GameState,
  def: EffectDef,
  sourceUid: number,
  targets: number[]
): void {
  const card = draft.cards[sourceUid]
  if (!card) return
  if (draft.winner !== null) return
  if (!conditionMet(draft, card.owner, def)) return
  const ctx: EffectCtx = { player: card.owner, sourceUid, targets }
  const slots = bindSlots(db, draft, def, sourceUid, targets)
  applyNode(db, draft, def.effect, ctx, slots)
}

/**
 * Fires every EffectDef of `sourceUid` matching `trigger`, in printed order, on
 * a draft the caller owns. `targets` is one flat array shared by all of them,
 * consumed left to right (each def taking as many entries as it has fillable
 * slots) — the same order `triggerTargetChoices` enumerates.
 */
export function fireTriggerOnDraft(
  db: CardDb,
  draft: GameState,
  trigger: Trigger,
  sourceUid: number,
  targets: number[]
): void {
  const def = defOf(db, draft, sourceUid)
  if (!def) return
  let offset = 0
  for (const effect of def.effects) {
    if (effect.trigger !== trigger) continue
    const demand = slotDemand(db, draft, sourceUid, effect)
    applyEffectDefOnDraft(db, draft, effect, sourceUid, targets.slice(offset, offset + demand))
    offset += demand
  }
}

/** Pure form of `fireTriggerOnDraft`: returns a new state, never mutates. */
export function fireTrigger(
  db: CardDb,
  state: GameState,
  trigger: Trigger,
  sourceUid: number,
  targets: number[]
): GameState {
  const draft = draftState(state)
  fireTriggerOnDraft(db, draft, trigger, sourceUid, targets)
  return draft
}

/** Resolves a single node against an explicit context; returns a new state. */
export function resolveEffect(
  db: CardDb,
  state: GameState,
  node: EffectNode,
  ctx: EffectCtx
): GameState {
  const draft = draftState(state)
  const def: EffectDef = { trigger: 'activated', effect: node }
  const slots = bindSlots(db, draft, def, ctx.sourceUid, ctx.targets)
  applyNode(db, draft, node, ctx, slots)
  return draft
}

// ---------------------------------------------------------------------------
// Activated abilities and quick reactions (legalActions slices)
// ---------------------------------------------------------------------------

/**
 * Where the cards that can carry an activated ability live: the player's field,
 * their face-up Legends, and the Gear attached to either. A Gear card's ability
 * belongs to the card wearing it (docs/rulings.md §33).
 */
function abilitySources(state: GameState, player: PlayerId): number[] {
  const p = state.players[player]
  const hosts = [...p.field, ...p.legends.filter((uid) => state.cards[uid].faceUp)]
  const sources: number[] = []
  for (const uid of hosts) {
    sources.push(uid)
    sources.push(...state.cards[uid].attachedGear)
  }
  return sources
}

/**
 * The card an ability's `selfSpend` cost actually spends: the Gear's host if
 * the ability is printed on Gear, otherwise the source itself
 * (docs/rulings.md §33).
 */
export function abilityHost(state: GameState, uid: number): number {
  for (const player of [0, 1] as const) {
    const p = state.players[player]
    for (const host of [...p.field, ...p.legends]) {
      if (state.cards[host].attachedGear.includes(uid)) return host
    }
  }
  return uid
}

/** Can `player` pay this ability's cost right now? */
function canPayAbility(state: GameState, player: PlayerId, def: EffectDef, source: number): boolean {
  const host = abilityHost(state, source)
  if (def.cost?.selfSpend) {
    const card = state.cards[host]
    // Glossary SPEND/LAG: a spent card can't be spent again until it readies,
    // and a card with Lag can't be spent at all this turn.
    if (!card.ready || card.lag) return false
  }
  const eddies = def.cost?.eddies ?? 0
  if (eddies === 0) return true
  const exclude = def.cost?.selfSpend ? host : undefined
  return canonicalPayment(state, player, eddies, exclude) !== null
}

/**
 * One `activateAbility` per (activated ability x legal target tuple) `player`
 * can afford. `quickOnly` narrows the list to `quick: true` abilities, which is
 * what the react window offers; the main phase offers all of them (quick just
 * *adds* the react-window timing, it never removes the main-phase one).
 */
export function activatedAbilityActions(
  db: CardDb,
  state: GameState,
  player: PlayerId,
  quickOnly = false
): Action[] {
  const actions: Action[] = []
  for (const uid of abilitySources(state, player)) {
    const def = defOf(db, state, uid)
    if (!def) continue
    for (const [abilityIndex, effect] of def.effects.entries()) {
      if (effect.trigger !== 'activated') continue
      if (quickOnly && effect.quick !== true) continue
      if (!conditionMet(state, player, effect)) continue
      if (!canPayAbility(state, player, effect, uid)) continue
      // A costed ability with a dead target is never worth offering.
      if (hasUnfillableSlot(db, state, uid, effect)) continue
      for (const targets of effectTargetChoices(db, state, uid, effect)) {
        actions.push({ type: 'activateAbility', card: uid, abilityIndex, targets })
      }
    }
  }
  return actions
}

/**
 * Is this card def playable as a {quick} card from hand — i.e. during the
 * rival's attack? Programs only (guide p11 lists {Quick} on Programs and on
 * Gear abilities), marked either by the printed keyword or by a `quick: true`
 * onPlay EffectDef.
 */
export function isQuickPlayable(def: CardDef): boolean {
  if (def.type !== 'program') return false
  if (def.keywords.includes(QUICK)) return true
  return def.effects.some((effect) => effect.trigger === 'onPlay' && effect.quick === true)
}

/**
 * The defender's effect-driven reactions inside a react window: playing a
 * {quick} Program from hand (paid like any other play) and activating a
 * {quick} ability. Both leave the window open — reduce.ts only resolves the
 * attack on `pass` or `block`.
 */
export function quickReactionActions(db: CardDb, state: GameState, defender: PlayerId): Action[] {
  const actions: Action[] = []

  for (const uid of state.players[defender].hand) {
    const def = defOf(db, state, uid)
    if (!def || !isQuickPlayable(def)) continue
    const payment = canonicalPayment(state, defender, def.cost)
    if (payment === null) continue
    for (const targets of triggerTargetChoices(db, state, uid, 'onPlay')) {
      actions.push({ type: 'react', reaction: { type: 'quick', card: uid, payment, targets } })
    }
  }

  for (const action of activatedAbilityActions(db, state, defender, true)) {
    if (action.type !== 'activateAbility') continue
    actions.push({
      type: 'react',
      reaction: {
        type: 'quickAbility',
        card: action.card,
        abilityIndex: action.abilityIndex,
        targets: action.targets,
      },
    })
  }

  return actions
}

// ---------------------------------------------------------------------------
// Playing cards (shared by the main phase and the quick reaction)
// ---------------------------------------------------------------------------

/**
 * Does `uid` (a Legend in `player`'s legends zone) have a legal Go Solo play
 * right now? "Pay this Legend's cost to play it as a ready Unit." — the Legend
 * must be face-up (you cannot choose to play an identity you have not seen,
 * guide p10 "don't peek") and ready (a spent card cannot be used again until it
 * readies), and it may never help pay its own cost (docs/rulings.md §31).
 */
export function goSoloPayment(
  db: CardDb,
  state: GameState,
  player: PlayerId,
  uid: number
): number[] | null {
  const card = state.cards[uid]
  if (!card.faceUp || !card.ready) return null
  const def = db[card.defId]
  // Printed keywords only, deliberately: Gear may grant {blocker}/{adrenaline}
  // to its host, but never {go-solo} (docs/rulings.md §30).
  if (def.type !== 'legend' || !def.keywords.includes('go-solo')) return null
  return canonicalPayment(state, player, def.cost, uid)
}

/**
 * The `targets` array of a `playCard` action: the Gear equip target first (Gear
 * only), then one entry per fillable onPlay target slot (docs/rulings.md §34).
 */
export function playCardTargetChoices(db: CardDb, state: GameState, uid: number): number[][] {
  const def = defOf(db, state, uid)
  if (!def) return []
  const effectTuples = triggerTargetChoices(db, state, uid, 'onPlay')
  if (def.type !== 'gear') return effectTuples

  const tuples: number[][] = []
  for (const host of gearEquipTargets(db, state, uid)) {
    for (const extra of effectTuples) tuples.push([host, ...extra])
  }
  return tuples
}

/**
 * Resolves a card leaving `player`'s hand (or, for a Go Solo Legend, their
 * legends zone) onto the board, pays for it, then fires its onPlay effects:
 *   * Unit   — enters the field ready with Lag (guide p7);
 *   * Legend — {go-solo}: enters the field ready with NO Lag, "it can attack
 *              this turn" (docs/rulings.md §31);
 *   * Program— resolves, then goes to the trash (so a `self` reference still
 *              works while it resolves);
 *   * Gear   — equips to `targets[0]`.
 * Shared by reduce.ts's main-phase `playCard` and the `quick` reaction, so the
 * two can never drift apart.
 */
export function playCardOnDraft(
  db: CardDb,
  draft: GameState,
  player: PlayerId,
  cardUid: number,
  payment: number[],
  targets: number[]
): void {
  const p = draft.players[player]
  const card = draft.cards[cardUid]
  const def = db[card.defId]

  p.hand = p.hand.filter((uid) => uid !== cardUid)
  p.legends = p.legends.filter((uid) => uid !== cardUid)
  pay(draft, payment)
  draft.events.push({ type: 'cardPlayed', player, uid: cardUid })

  let effectTargets = targets
  switch (def.type) {
    case 'unit':
      card.ready = true
      card.lag = true
      p.field.push(cardUid)
      break
    case 'legend':
      card.ready = true
      card.lag = false
      card.faceUp = true
      p.field.push(cardUid)
      break
    case 'gear':
      draft.cards[targets[0]].attachedGear.push(cardUid)
      effectTargets = targets.slice(1)
      break
    case 'program':
      break
  }

  fireTriggerOnDraft(db, draft, 'onPlay', cardUid, effectTargets)

  if (def.type === 'program') {
    p.trash.push(cardUid)
    draft.events.push({ type: 'cardTrashed', uid: cardUid })
  }
}

/**
 * Activates an ability on a draft: pay (self-spend first, then €$ from the
 * canonical payment — the action carries no payment field, so the engine picks
 * it), log it, resolve it.
 */
export function activateAbilityOnDraft(
  db: CardDb,
  draft: GameState,
  player: PlayerId,
  cardUid: number,
  abilityIndex: number,
  targets: number[]
): void {
  const def = db[draft.cards[cardUid].defId]
  const effect = def.effects[abilityIndex]
  if (!effect) return

  const host = abilityHost(draft, cardUid)
  if (effect.cost?.selfSpend) draft.cards[host].ready = false
  const eddies = effect.cost?.eddies ?? 0
  if (eddies > 0) {
    const exclude = effect.cost?.selfSpend ? host : undefined
    const payment = canonicalPayment(draft, player, eddies, exclude)
    if (payment !== null) pay(draft, payment)
  }

  draft.events.push({ type: 'abilityActivated', player, uid: cardUid, abilityIndex })
  applyEffectDefOnDraft(db, draft, effect, cardUid, targets)
}
