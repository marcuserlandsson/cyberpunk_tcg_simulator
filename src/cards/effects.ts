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
import {
  conditionHolds,
  conditionMet,
  effectiveCardCost,
  firstMatchingPlayDiscountSources,
  opponentOf,
  reducedCost,
  resolvePowerAmount,
  rivalGoSoloTax,
  streetCred,
  type ConditionContext,
} from '../engine/query'
import { nextInt, rollDie } from '../engine/rng'
import { scriptedCards } from './scripted/index'
import {
  filterTargets,
  gearEquipTargets,
  gigDieAt,
  gigDieOwner,
  isGigDieSpec,
  targetsFor,
} from './targets'
import type {
  Action,
  CardDb,
  CardDef,
  EffectDef,
  EffectNode,
  GameState,
  PlayerId,
  PlayerState,
  TargetFilter,
  TargetSpec,
  Trigger,
} from '../engine/types'

export interface EffectCtx {
  player: PlayerId
  sourceUid: number
  targets: number[]
  /** The uid bound by an enclosing `sameTarget`, read by `target: 'chosen'`. */
  chosen?: number
  /**
   * The `TriggerContext` this def's firing carried, threaded through so a
   * `scripted` node can read a fact beyond player/sourceUid/targets/chosen —
   * e.g. `defeatedHostUid` (docs/rulings.md §81 ff.,
   * the-relic-experimental-biochip). Absent for a def resolved directly
   * (`resolveEffect`) rather than through a trigger firing.
   */
  context?: TriggerContext
}

/**
 * Facts a trigger firing carries that no read of the state can supply: the size
 * of the Gig die that was just stolen (docs/rulings.md §42) and the answer to a
 * "You may pay N €$" optional cost (docs/rulings.md §49). Absent
 * `payOptionalCosts` means *declined*, so a costed trigger fired from a path
 * that cannot offer the choice never spends the player's €$.
 */
export interface TriggerContext extends ConditionContext {
  payOptionalCosts?: boolean
  /**
   * `onDefeat`, when fired for an attached Gear (docs/rulings.md §81 ff.): the
   * uid of the host Unit that was just defeated (already in the trash) — "this
   * Unit" in the Gear's own printed text (the-relic-experimental-biochip).
   */
  defeatedHostUid?: number
  /**
   * `onLoseFight` only (docs/rulings.md §92 ff.): the specific card this loser
   * just fought, read by the `'fightFoe'` `TargetSpec` (maelstrom-zealots).
   */
  fightFoeUid?: number
  /**
   * A Gear's own trigger, fired via `fireWatcherTrigger` (docs/rulings.md
   * §107 ff.): the uid of the Unit/Legend wearing it, since `'self'` on the
   * Gear's own EffectDef reads the GEAR's own uid, not its host — a
   * `scripted` node reads this directly (`sandevistan`), the same shape as
   * `defeatedHostUid`.
   */
  equipHostUid?: number
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
 * One decision an EffectNode tree needs. Two shapes:
 *   * `target` — a card uid, or (for the two Gig-die specs) an index into a
 *     player's Gig area (docs/rulings.md §39);
 *   * `mode`   — which branch of a "Choose one effect" node to take
 *     (docs/rulings.md §45).
 */
type SlotSpec =
  | { kind: 'target'; spec: TargetSpec; filter?: TargetFilter }
  | {
      kind: 'mode'
      count: number
      chooser: 'controller' | 'rivalIfBehindStreetCred' | 'allUnlessBehindStreetCred'
    }
  // "Adjust a Gig by up to N": the signed amounts the player may pick from
  // (docs/rulings.md §39).
  | { kind: 'amount'; options: number[] }

/**
 * The slots an EffectNode tree needs, in resolution order. `self` needs no
 * decision (it is always the source card) and so takes no slot. A `chooseOne`
 * contributes its own mode slot followed by the slots of **every** mode, in
 * printed order: only the chosen mode's slots are consumed at resolution time,
 * but reserving them all keeps the slot list state-independent, which is what
 * lets enumeration and binding agree (docs/rulings.md §45).
 */
function slotSpecs(node: EffectNode): SlotSpec[] {
  switch (node.kind) {
    case 'buffPower':
    case 'defeat':
    case 'bounce':
    case 'readyCard':
    case 'spendCard':
    case 'bottomDeck':
    case 'grantKeyword':
    case 'retrieveFromTrash':
    case 'discardCard':
    case 'skipNextReady':
      // `self`, `chosen` and `fightFoe` are references, not decisions: no slot.
      return node.target === 'self' || node.target === 'chosen' || node.target === 'fightFoe'
        ? []
        : [{ kind: 'target', spec: node.target, filter: node.filter }]
    case 'changeGig':
      return [
        { kind: 'target', spec: node.target },
        ...(node.adjust === true ? [{ kind: 'amount' as const, options: adjustOptions(node.amount) }] : []),
      ]
    // "Swap a friendly Gig with a rival Gig": two fixed-role die slots
    // (docs/rulings.md §92 ff.).
    case 'swapGig':
      return [
        { kind: 'target', spec: 'friendlyGigDie' },
        { kind: 'target', spec: 'rivalGigDie' },
      ]
    // "Set a Gig's value to the value of another Gig" — two `anyGigDie`
    // slots: the die being set, then the die being read from (docs/rulings.md
    // §107 ff.).
    case 'matchGig':
      return [
        { kind: 'target', spec: 'anyGigDie' },
        { kind: 'target', spec: 'anyGigDie' },
      ]
    case 'buffFightPower':
      return node.target === 'self' || node.target === 'chosen' || node.target === 'fightFoe'
        ? []
        : [{ kind: 'target', spec: node.target, filter: node.filter }]
    // Gates its single child's slots on a board condition, without gating the
    // whole enclosing EffectDef (docs/rulings.md §92 ff.) — the child's slots
    // are still reserved either way, matching `sameTarget`'s "step over the
    // fizzled construct's own slots" rule.
    case 'conditionalEffect':
      return slotSpecs(node.effect)
    case 'sameTarget':
      return [
        ...(node.target === 'self' || node.target === 'chosen' || node.target === 'fightFoe'
          ? []
          : [{ kind: 'target' as const, spec: node.target, filter: node.filter }]),
        ...node.effects.flatMap(slotSpecs),
      ]
    case 'scripted':
      // `filters[i]` narrows `targets[i]` exactly like any other node's
      // `filter` (docs/rulings.md §81 ff.) — absent (a shorter/omitted array)
      // means no filter for that slot.
      return (node.targets ?? []).map((spec, index) => ({
        kind: 'target' as const,
        spec,
        filter: node.filters?.[index],
      }))
    case 'chooseOne':
      return [
        { kind: 'mode', count: node.modes.length, chooser: node.chooser ?? 'controller' },
        ...node.modes.flatMap(slotSpecs),
      ]
    case 'sequence':
      return node.effects.flatMap(slotSpecs)
    default:
      return []
  }
}

/** How many slots a node subtree reserves (used to skip past unchosen modes). */
function slotWidth(node: EffectNode): number {
  return slotSpecs(node).length
}

/**
 * The signed amounts "Adjust a Gig by up to N" offers: -N..-1 and 1..N, never 0
 * (adjusting by nothing is not one of the printed options).
 */
function adjustOptions(amount: number): number[] {
  const magnitude = Math.abs(amount)
  const options: number[] = []
  for (let i = magnitude; i >= 1; i--) options.push(-i)
  for (let i = 1; i <= magnitude; i++) options.push(i)
  return options
}

/** "If you have less ☆ (Street Cred) than a Rival" (docs/rulings.md §45). */
function behindOnStreetCred(state: GameState, player: PlayerId): boolean {
  return streetCred(state, player) < streetCred(state, opponentOf(player))
}

/** The candidates a slot admits right now (empty = no decision to offer). */
function candidatesFor(
  db: CardDb,
  state: GameState,
  slot: SlotSpec,
  sourceUid: number,
  controller: PlayerId
): number[] {
  if (slot.kind === 'amount') return slot.options.map((_option, index) => index)

  if (slot.kind === 'mode') {
    // "If you have less ☆ than a Rival, they instead choose one effect for
    // you" — a rival's private choice is not ours to enumerate, so the slot
    // offers nothing and resolution falls back to the rng (docs/rulings.md §45).
    if (behindOnStreetCred(state, controller)) {
      if (slot.chooser !== 'controller') return []
    } else if (slot.chooser === 'allUnlessBehindStreetCred') {
      // Not behind: every mode resolves, so there is nothing to choose.
      return []
    }
    return Array.from({ length: slot.count }, (_value, index) => index)
  }
  const candidates = targetsFor(db, state, slot.spec, sourceUid, controller)
  if (isGigDieSpec(slot.spec)) return candidates
  return filterTargets(db, state, candidates, slot.filter, sourceUid, controller)
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
  def: EffectDef,
  controller: PlayerId
): { slot: SlotSpec; candidates: number[] }[] {
  const slots = slotSpecs(def.effect).map((slot) => ({
    slot,
    candidates: candidatesFor(db, state, slot, sourceUid, controller),
  }))
  // An `amount` slot always follows the die slot it belongs to (see the
  // `changeGig` case of `slotSpecs`). "How much" is not a decision worth
  // offering when there is no die to adjust, so it dies with its die — the slot
  // *count* is untouched, which is what keeps the offsets stable.
  for (let i = 1; i < slots.length; i++) {
    if (slots[i].slot.kind === 'amount' && slots[i - 1].candidates.length === 0) {
      slots[i] = { slot: slots[i].slot, candidates: [] }
    }
  }
  return slots
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
  def: EffectDef,
  controller?: PlayerId
): number[][] {
  let tuples: number[][] = [[]]
  const player = controller ?? effectController(state, uid)
  for (const slot of fillableSlots(db, state, uid, def, player)) {
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
  return fillableSlots(db, state, uid, def, effectController(state, uid)).some(
    (slot) => slot.candidates.length === 0
  )
}

/** The target tuples for every EffectDef of `uid` that fires on `trigger`. */
export function triggerTargetChoices(
  db: CardDb,
  state: GameState,
  uid: number,
  trigger: Trigger,
  controller?: PlayerId
): number[][] {
  const def = defOf(db, state, uid)
  if (!def) return [[]]
  let tuples: number[][] = [[]]
  for (const effect of def.effects) {
    if (effect.trigger !== trigger) continue
    const own = effectTargetChoices(db, state, uid, effect, controller)
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
  supplied: number[],
  controller: PlayerId
): Slots {
  const assigned: (number | null)[] = []
  let supply = 0
  for (const slot of fillableSlots(db, draft, sourceUid, def, controller)) {
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
function slotDemand(
  db: CardDb,
  state: GameState,
  sourceUid: number,
  def: EffectDef,
  controller: PlayerId
): number {
  return fillableSlots(db, state, sourceUid, def, controller).filter(
    (slot) => slot.candidates.length > 0
  ).length
}

function note(draft: GameState, sourceUid: number, description: string): void {
  draft.events.push({ type: 'effectResolved', sourceUid, description })
}

/** The next bound slot value, or null when it could not be filled. */
function takeSlot(slots: Slots): number | null {
  const value = slots.assigned[slots.next]
  slots.next += 1
  return value ?? null
}

/** The next bound target for a node, or null when the slot could not be filled. */
function takeTarget(node: { target: TargetSpec }, ctx: EffectCtx, slots: Slots): number | null {
  if (node.target === 'self') return ctx.sourceUid
  // A `chosen` reference reads the enclosing sameTarget's binding, and consumes
  // no slot (docs/rulings.md §53).
  if (node.target === 'chosen') return ctx.chosen ?? null
  // `fightFoe` reads the specific card this fight-loser just fought, carried
  // through `EffectCtx.context` (docs/rulings.md §92 ff.) — also consumes no
  // slot, the same reference-not-decision shape as `chosen`.
  if (node.target === 'fightFoe') return ctx.context?.fightFoeUid ?? null
  return takeSlot(slots)
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
      // "Draw 1 for each friendly Gig with an odd value" needs a board-read
      // count, not just a printed one (docs/rulings.md §68 ff.).
      const count =
        typeof node.count === 'number'
          ? node.count
          : resolvePowerAmount(draft, node.count, ctx.sourceUid, ctx.player)
      if (!drawCards(draft, ctx.player, count)) {
        // Same rule as the start-of-turn draw (docs/rulings.md §17): being
        // asked to draw from an empty deck loses the game.
        endGame(draft, opponentOf(ctx.player), 'deckout')
        return
      }
      note(draft, ctx.sourceUid, `draw ${count}`)
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
      // "gains power equal to a friendly max Gig" / "... for each of its
      // equipped Gear" — an amount read off the board instead of printed
      // (docs/rulings.md §39, §55 ff.).
      const amount = resolvePowerAmount(draft, node.amount, target, ctx.player)
      if (node.duration === 'turn') draft.cards[target].tempPower += amount
      else draft.cards[target].permPower += amount
      const sign = amount >= 0 ? '+' : ''
      note(draft, ctx.sourceUid, `${sign}${amount} power (${node.duration}) on ${target}`)
      return
    }

    case 'grantKeyword': {
      const target = takeTarget(node, ctx, slots)
      if (target === null || !draft.cards[target]) return
      if (!draft.cards[target].tempKeywords.includes(node.keyword)) {
        draft.cards[target].tempKeywords.push(node.keyword)
      }
      note(draft, ctx.sourceUid, `grant {${node.keyword}} to ${target} this turn`)
      return
    }

    case 'changeGig': {
      const index = takeSlot(slots)
      // "Adjust ..." carries a second slot for the signed amount; it must be
      // consumed whether or not the die slot was filled, or the nodes after
      // this one would read the wrong slots (docs/rulings.md §39).
      const options = node.adjust === true ? adjustOptions(node.amount) : null
      const pick = options === null ? null : takeSlot(slots)
      if (index === null) return
      const die = gigDieAt(draft, node.target, index, ctx.player)
      if (die === null) return
      const amount =
        options === null ? node.amount : options[pick ?? randomIndex(draft, options.length)]
      // "by up to N": the amount, clamped to the faces the die actually has
      // (docs/rulings.md §39).
      const before = die.value
      die.value = Math.max(1, Math.min(die.size, die.value + amount))
      note(draft, ctx.sourceUid, `gig ${before} -> ${die.value}`)
      // "When a Rival adjusts ... friendly Gigs" — fired on the AFFECTED
      // player, from their own point of view, whenever the die touched
      // belongs to someone other than this effect's controller
      // (docs/rulings.md §55 ff.).
      const dieOwner = gigDieOwner(draft, node.target, index, ctx.player)
      if (dieOwner !== ctx.player) {
        fireWatcherTrigger(db, draft, 'onRivalAdjustFriendlyGig', dieOwner, {})
      }
      return
    }

    case 'swapGig': {
      const friendlyIndex = takeSlot(slots)
      const rivalIndex = takeSlot(slots)
      if (friendlyIndex === null || rivalIndex === null) return
      const mine = draft.players[ctx.player].gigArea
      const theirs = draft.players[opponentOf(ctx.player)].gigArea
      const mineDie = mine[friendlyIndex]
      const theirDie = theirs[rivalIndex]
      if (mineDie === undefined || theirDie === undefined) return
      mine[friendlyIndex] = theirDie
      theirs[rivalIndex] = mineDie
      note(
        draft,
        ctx.sourceUid,
        `swap gig d${mineDie.size}:${mineDie.value} <-> d${theirDie.size}:${theirDie.value}`
      )
      // "When a Rival adjusts or swaps 1 or more friendly Gigs" — the rival's
      // own die was just reached into by this effect's controller
      // (docs/rulings.md §55 ff./§92 ff.).
      fireWatcherTrigger(db, draft, 'onRivalAdjustFriendlyGig', opponentOf(ctx.player), {})
      return
    }

    case 'matchGig': {
      const targetIndex = takeSlot(slots)
      const sourceIndex = takeSlot(slots)
      if (targetIndex === null || sourceIndex === null) return
      const targetDie = gigDieAt(draft, 'anyGigDie', targetIndex, ctx.player)
      const sourceDie = gigDieAt(draft, 'anyGigDie', sourceIndex, ctx.player)
      if (targetDie === null || sourceDie === null) return
      const before = targetDie.value
      targetDie.value = Math.max(1, Math.min(targetDie.size, sourceDie.value))
      note(draft, ctx.sourceUid, `gig ${before} -> ${targetDie.value} (matched)`)
      const dieOwner = gigDieOwner(draft, 'anyGigDie', targetIndex, ctx.player)
      if (dieOwner !== ctx.player) {
        fireWatcherTrigger(db, draft, 'onRivalAdjustFriendlyGig', dieOwner, {})
      }
      return
    }

    case 'buffFightPower': {
      const target = takeTarget(node, ctx, slots)
      if (target === null || !draft.cards[target]) return
      const amount = resolvePowerAmount(draft, node.amount, target, ctx.player)
      draft.cards[target].fightPowerBonusThisTurn = (draft.cards[target].fightPowerBonusThisTurn ?? 0) + amount
      note(draft, ctx.sourceUid, `+${amount} fight power (this turn) on ${target}`)
      return
    }

    case 'skipNextReady': {
      const target = takeTarget(node, ctx, slots)
      if (target === null || !draft.cards[target]) return
      draft.cards[target].skipNextReady = true
      note(draft, ctx.sourceUid, `${target} skips its next ready step`)
      return
    }

    case 'conditionalEffect': {
      // Consumes the child's slots whether or not the condition holds, so a
      // later sibling still reads the right ones (docs/rulings.md §92 ff.,
      // the same "step over a fizzled construct's slots" rule as sameTarget).
      const width = slotWidth(node.effect)
      if (!conditionHolds(draft, ctx.player, node.condition, ctx.context ?? {}, ctx.sourceUid)) {
        slots.next += width
        return
      }
      applyNode(db, draft, node.effect, ctx, slots)
      return
    }

    case 'sameTarget': {
      // One target, every child effect (docs/rulings.md §53).
      const target = takeTarget(node, ctx, slots)
      const end = slots.next + node.effects.reduce((sum, child) => sum + slotWidth(child), 0)
      if (target === null || !draft.cards[target]) {
        // The whole construct fizzles, but the children's slots must still be
        // stepped over so the nodes after it read the right ones.
        slots.next = end
        return
      }
      const shared: EffectCtx = { ...ctx, chosen: target }
      for (const child of node.effects) {
        if (draft.winner !== null) break
        applyNode(db, draft, child, shared, slots)
      }
      slots.next = end
      return
    }

    case 'chooseOne': {
      const base = slots.next
      const chosen = takeSlot(slots)
      const firstMode = base + 1
      const end = firstMode + node.modes.reduce((sum, child) => sum + slotWidth(child), 0)
      /** Resolves one mode with the cursor on that mode's own slots (§45). */
      const applyMode = (index: number): void => {
        const mode = node.modes[index]
        if (mode === undefined) return
        let offset = firstMode
        for (let i = 0; i < index; i++) offset += slotWidth(node.modes[i])
        slots.next = offset
        note(draft, ctx.sourceUid, `mode ${index}`)
        applyNode(db, draft, mode, ctx, slots)
      }

      // "Give a friendly Unit these effects. If you have less ☆ than a Rival,
      // they instead choose one effect for you." — all of them, unless behind.
      if (
        node.chooser === 'allUnlessBehindStreetCred' &&
        !behindOnStreetCred(draft, ctx.player)
      ) {
        for (let index = 0; index < node.modes.length; index++) {
          if (draft.winner !== null) break
          applyMode(index)
        }
        slots.next = end
        return
      }

      applyMode(chosen ?? randomIndex(draft, node.modes.length))
      slots.next = end
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

    case 'retrieveFromTrash': {
      const target = takeTarget(node, ctx, slots)
      if (target === null || !draft.cards[target]) return
      const p = draft.players[draft.cards[target].owner]
      if (!p.trash.includes(target)) return
      p.trash = p.trash.filter((uid) => uid !== target)
      p.hand.push(target)
      note(draft, ctx.sourceUid, `retrieve ${target} from the trash`)
      return
    }

    case 'discardCard': {
      const target = takeTarget(node, ctx, slots)
      if (target === null || !draft.cards[target]) return
      const p = draft.players[draft.cards[target].owner]
      if (!p.hand.includes(target)) return
      p.hand = p.hand.filter((uid) => uid !== target)
      p.trash.push(target)
      draft.events.push({ type: 'cardTrashed', uid: target })
      note(draft, ctx.sourceUid, `discard ${target}`)
      return
    }

    case 'readyCard': {
      const target = takeTarget(node, ctx, slots)
      if (target === null || !draft.cards[target]) return
      draft.cards[target].ready = true
      note(draft, ctx.sourceUid, `ready ${target}`)
      return
    }

    case 'spendCard': {
      const target = takeTarget(node, ctx, slots)
      if (target === null || !draft.cards[target]) return
      note(draft, ctx.sourceUid, `spend ${target}`)
      // Being spent by an effect is still being spent (docs/rulings.md §47).
      spendOnDraft(db, draft, [target])
      return
    }

    case 'stealGig': {
      // Which dice are stolen is a real decision — it moves street cred and the
      // win condition — so an effect steal routes through the same
      // pendingSteal/chooseGig machinery as an attack steal, with this effect's
      // controller as the thief (docs/rulings.md §32).
      const victim = opponentOf(ctx.player)
      const available = draft.players[victim].gigArea.length
      const count = Math.min(node.count, available)
      if (count <= 0) return
      const head = draft.pendingSteal
      // An attack-driven steal leaves `thief` undefined, meaning "the active
      // player" (docs/rulings.md §32) — compare against the EFFECTIVE thief so
      // a bonus `stealGig` firing mid-attack (gorilla-arms) merges into it
      // instead of being mistaken for a different thief's steal.
      const headThief = head === null ? null : head.thief ?? draft.activePlayer
      if (head === null) {
        draft.pendingSteal = {
          attacker: ctx.sourceUid,
          remaining: count,
          thief: ctx.player,
          resumePhase: draft.phase === 'chooseGig' ? 'main' : draft.phase,
          ...(node.distinctValueOnly === true ? { distinctValueOnly: true } : {}),
        }
        draft.phase = 'chooseGig'
      } else if (headThief === ctx.player && (head.queue ?? []).length === 0) {
        // Same controller, nothing queued behind: one longer choice sequence.
        head.remaining += count
        // A filtered bonus steal merging into an already-pending one applies
        // its filter to the whole remaining choice (a documented
        // simplification, docs/rulings.md §68 ff.).
        if (node.distinctValueOnly === true) head.distinctValueOnly = true
      } else {
        // A steal for a *different* thief (a tied fight defeating two stealing
        // Units) waits its turn instead of overwriting — docs/rulings.md §32.
        const queue = head.queue ?? []
        const last = queue[queue.length - 1]
        if (last !== undefined && last.thief === ctx.player) {
          last.remaining += count
          if (node.distinctValueOnly === true) last.distinctValueOnly = true
        } else {
          queue.push({
            attacker: ctx.sourceUid,
            remaining: count,
            thief: ctx.player,
            ...(node.distinctValueOnly === true ? { distinctValueOnly: true } : {}),
          })
        }
        head.queue = queue
      }
      note(draft, ctx.sourceUid, `steal ${count} gig(s)`)
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
      // A scripted node may declare its own target slots; the script reads the
      // bound uids off `ctx.targets` (docs/rulings.md §48).
      const declared = node.targets ?? []
      const bound = declared.map(() => takeSlot(slots))
      const scriptCtx: EffectCtx =
        declared.length === 0
          ? ctx
          : { ...ctx, targets: bound.filter((uid): uid is number => uid !== null) }
      const result = script(db, draft, scriptCtx)
      // Scripts may mutate the draft or return a fresh state; fold either in.
      if (result !== draft) Object.assign(draft, result)
      note(draft, ctx.sourceUid, `scripted:${node.name}`)
      return
    }

    case 'staticPower':
    case 'cantAttack':
    case 'defeatShield':
    case 'winsFightVsKeyword':
    case 'costReduction':
    case 'powerVsCardType':
    case 'attackReadyWithKeyword':
    case 'cantAttackGigArea':
    case 'attackGigAreaDespiteLag':
    case 'freeLegendCall':
    case 'goSoloTax':
    case 'attackPowerBonus':
    case 'attackUnitDespiteLag':
      // Static layers, read by query.ts — nothing to do at resolution time.
      return
  }
}

/**
 * Applies one EffectDef (condition + target binding + nodes) to a draft.
 * `controller` overrides who the effect acts *for*; it defaults to
 * `effectController` (the source's owner, or the host's controller for an
 * effect printed on attached Gear — docs/rulings.md §33).
 */
export function applyEffectDefOnDraft(
  db: CardDb,
  draft: GameState,
  def: EffectDef,
  sourceUid: number,
  targets: number[],
  controller?: PlayerId,
  context: TriggerContext = {}
): void {
  const card = draft.cards[sourceUid]
  if (!card) return
  if (draft.winner !== null) return
  const player = controller ?? effectController(draft, sourceUid)
  if (!conditionMet(draft, player, def, context, sourceUid)) return
  // A *triggered* def may carry an optional cost ("{Attack} You may pay 2 €$.
  // If you do, ..."). Paying is the controller's decision, carried on the
  // action that fired the trigger; an unanswered option is declined, and the
  // def does not resolve (docs/rulings.md §49). An activated ability's cost is
  // mandatory and paid by `activateAbilityOnDraft` before this runs.
  if (def.trigger !== 'activated' && def.cost !== undefined) {
    if (context.payOptionalCosts !== true) return
    if (!payTriggerCost(db, draft, def, sourceUid, player)) return
  }
  const ctx: EffectCtx = { player, sourceUid, targets, context }
  const slots = bindSlots(db, draft, def, sourceUid, targets, player)
  applyNode(db, draft, def.effect, ctx, slots)
}

/** The €$ an EffectDef's cost actually asks for, after its reduction. */
export function abilityEddieCost(
  db: CardDb,
  state: GameState,
  player: PlayerId,
  def: EffectDef
): number {
  return reducedCost(db, state, player, def.cost?.eddies ?? 0, def.cost?.reduction)
}

/**
 * Pays a triggered def's optional cost on the draft, or reports that it could
 * not be paid (in which case the def does not resolve at all).
 */
function payTriggerCost(
  db: CardDb,
  draft: GameState,
  def: EffectDef,
  sourceUid: number,
  player: PlayerId
): boolean {
  if (!canPayAbility(db, draft, player, def, sourceUid)) return false
  const host = abilityHost(draft, sourceUid)
  if (def.cost?.selfSpend) spendOnDraft(db, draft, [host])
  const eddies = abilityEddieCost(db, draft, player, def)
  if (eddies > 0) {
    const payment = canonicalPayment(draft, player, eddies, def.cost?.selfSpend ? host : undefined)
    if (payment === null) return false
    spendOnDraft(db, draft, payment)
  }
  return true
}

/** The `oncePerTurnUsed` key of one EffectDef of one card instance. */
function oncePerTurnKey(sourceUid: number, index: number): string {
  return `${sourceUid}:${index}`
}

/**
 * Has this `oncePerTurn` def already fired this game turn? ("The first time
 * this Unit wins a fight each turn, ready it" — docs/rulings.md §40.)
 */
export function oncePerTurnSpent(
  state: GameState,
  sourceUid: number,
  index: number,
  def: EffectDef
): boolean {
  if (def.oncePerTurn !== true) return false
  return state.oncePerTurnUsed.includes(oncePerTurnKey(sourceUid, index))
}

function markOncePerTurn(draft: GameState, sourceUid: number, index: number): void {
  const key = oncePerTurnKey(sourceUid, index)
  if (!draft.oncePerTurnUsed.includes(key)) draft.oncePerTurnUsed.push(key)
}

/**
 * Fires every EffectDef *printed on `sourceUid` itself* matching `trigger`, in
 * printed order. `targets` is one flat array shared by all of them, consumed
 * left to right (each def taking as many entries as it has fillable slots) —
 * the same order `triggerTargetChoices` enumerates.
 *
 * `EffectDef.onceKey` (docs/rulings.md §67) groups several `oncePerTurn` defs
 * on this card into one shared allowance for a single compound printed
 * sentence ("The first time ... draw 1. Then, if ..., discard 1."). A
 * pre-scan decides, group by group, whether THIS firing "evaluates" it — any
 * not-yet-spent member whose own `condition` holds counts, even a narrower
 * sibling's — using the state as it stood before any of this firing's defs
 * resolved, so a sibling that fires later in this same pass is never blocked
 * by its own group's marking (only a LATER firing is).
 */
export function fireCardTrigger(
  db: CardDb,
  draft: GameState,
  trigger: Trigger,
  sourceUid: number,
  targets: number[],
  controller?: PlayerId,
  context: TriggerContext = {}
): void {
  const def = defOf(db, draft, sourceUid)
  if (!def) return
  const player = controller ?? effectController(draft, sourceUid)

  // Snapshot "already spent before this event", and which onceKey groups
  // this event evaluates (docs/rulings.md §67), before any def resolves.
  const alreadySpent = def.effects.map((effect, index) =>
    oncePerTurnSpent(draft, sourceUid, index, effect)
  )
  const groupEvaluated = new Set<string>()
  for (const [index, effect] of def.effects.entries()) {
    if (effect.trigger !== trigger || effect.oncePerTurn !== true) continue
    if (effect.onceKey === undefined || alreadySpent[index]) continue
    if (conditionMet(draft, player, effect, context, sourceUid)) {
      groupEvaluated.add(effect.onceKey)
    }
  }

  let offset = 0
  for (const [index, effect] of def.effects.entries()) {
    if (effect.trigger !== trigger) continue
    const demand = slotDemand(db, draft, sourceUid, effect, player)
    const slice = targets.slice(offset, offset + demand)
    offset += demand
    if (alreadySpent[index]) continue
    const met = conditionMet(draft, player, effect, context, sourceUid)
    if (effect.oncePerTurn === true) {
      const groupSpent = effect.onceKey !== undefined && groupEvaluated.has(effect.onceKey)
      if (groupSpent || met) markOncePerTurn(draft, sourceUid, index)
    }
    if (!met) continue
    applyEffectDefOnDraft(db, draft, effect, sourceUid, slice, player, context)
  }
}

/**
 * Triggers an attached Gear card propagates from the card wearing it: the ones
 * that are *about the host acting* — "{Attack} ..." and "{Defeated} ..." on a
 * Gear card describe what happens when the equipped Unit attacks or is defeated
 * (docs/rulings.md §37). `onPlay`/`onCall` are deliberately excluded: a Gear
 * card's own onPlay already fired when the Gear itself was played, and re-firing
 * it because its host entered the field would double up.
 */
const GEAR_PROPAGATED_TRIGGERS: readonly Trigger[] = [
  'onAttack',
  'onDefeat',
  'onBlock',
  'onWinFight',
  'onSpend',
  // Batch 5 (docs/rulings.md §92 ff.): "when this Unit loses a fight" is about
  // the host acting (losing), the same shape as onWinFight's mirror image.
  'onLoseFight',
]

/**
 * Fires `trigger` for `sourceUid` *and* for its attached Gear (for the triggers
 * Gear propagates). Gear effects resolve with the Gear as their source — so
 * "this Unit" style targeting still reads off the Gear's own def — but for the
 * *host's* controller. Only the host's own defs consume the supplied `targets`;
 * Gear defs auto-target (docs/rulings.md §32), because `legalActions` enumerates
 * the played/attacking card's own slots.
 */
export function fireTriggerOnDraft(
  db: CardDb,
  draft: GameState,
  trigger: Trigger,
  sourceUid: number,
  targets: number[],
  context: TriggerContext = {}
): void {
  const card = draft.cards[sourceUid]
  if (!card) return
  const controller = effectController(draft, sourceUid)
  fireCardTrigger(db, draft, trigger, sourceUid, targets, controller, context)

  if (!GEAR_PROPAGATED_TRIGGERS.includes(trigger)) return
  for (const gearUid of [...card.attachedGear]) {
    fireCardTrigger(db, draft, trigger, gearUid, [], controller, context)
  }
}

/**
 * Does `uid` (or its propagated Gear) have a `trigger` EffectDef with an
 * *optional* cost the controller could pay right now? `legalActions` uses this
 * to decide whether to offer the pay/decline pair (docs/rulings.md §49).
 */
export function hasPayableOptionalTrigger(
  db: CardDb,
  state: GameState,
  uid: number,
  trigger: Trigger
): boolean {
  const card = state.cards[uid]
  if (!card) return false
  const controller = effectController(state, uid)
  const sources = GEAR_PROPAGATED_TRIGGERS.includes(trigger)
    ? [uid, ...card.attachedGear]
    : [uid]
  for (const source of sources) {
    const def = defOf(db, state, source)
    if (!def) continue
    for (const effect of def.effects) {
      if (effect.trigger !== trigger || effect.cost === undefined) continue
      if (!conditionMet(state, controller, effect, {}, source)) continue
      if (canPayAbility(db, state, controller, effect, source)) return true
    }
  }
  return false
}

/** Is `uid` on the field, or a face-up Legend in the legends zone? */
function inPlay(state: GameState, uid: number): boolean {
  const card = state.cards[uid]
  if (!card) return false
  const p = state.players[card.owner]
  if (p.field.includes(uid)) return true
  return p.legends.includes(uid) && card.faceUp
}

/**
 * Spends cards (a payment, an attacker, a {Spend} cost) and fires their
 * `onSpend` triggers. Only a card *in play* triggers: a face-down eddie has no
 * revealed identity and no live abilities (docs/rulings.md §47).
 */
export function spendOnDraft(db: CardDb, draft: GameState, uids: number[]): void {
  pay(draft, uids)
  for (const uid of uids) {
    if (!inPlay(draft, uid)) continue
    fireTriggerOnDraft(db, draft, 'onSpend', uid, [])
    // "When a friendly EQUIPPED Unit or Legend is spent, ..." — a watcher on
    // the spent card's own controller, broadcast whenever the just-spent card
    // is a Unit/Legend carrying at least one attached Gear (alt-cunningham,
    // docs/rulings.md §68 ff.). "A friendly ... Unit" includes the watching
    // card itself, mirroring §42's onFriendlyStealDie convention.
    const card = draft.cards[uid]
    const def = db[card.defId]
    if (card.attachedGear.length > 0 && (def.type === 'unit' || def.type === 'legend')) {
      fireWatcherTrigger(db, draft, 'onFriendlyEquippedSpend', card.owner, {})
    }
  }
}

/**
 * Fires a **watcher** trigger: one that lives on a card but is about something
 * another card did. Every in-play card of `player` (and its Gear) gets a look,
 * in field order (docs/rulings.md §42).
 */
export function fireWatcherTrigger(
  db: CardDb,
  draft: GameState,
  trigger: Trigger,
  player: PlayerId,
  context: TriggerContext
): void {
  const p = draft.players[player]
  const watchers = [...p.field, ...p.legends.filter((uid) => draft.cards[uid].faceUp)]
  for (const uid of watchers) {
    const hosts = [uid, ...draft.cards[uid].attachedGear]
    for (const host of hosts) {
      // A Gear's own EffectDef reads `equipHostUid` for "this Unit" (its
      // host), since `'self'` on that def resolves to the Gear's own uid
      // (docs/rulings.md §107 ff., sandevistan).
      const hostContext = host === uid ? context : { ...context, equipHostUid: uid }
      fireCardTrigger(db, draft, trigger, host, [], player, hostContext)
    }
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
  const slots = bindSlots(db, draft, def, ctx.sourceUid, ctx.targets, ctx.player)
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
 * Who an effect printed on `uid` acts for: the owner of the card wearing it if
 * `uid` is attached Gear, otherwise `uid`'s own owner. Gear equipped to a rival
 * Unit hands its abilities and triggers to that Unit's controller — they gate
 * on, are paid by, and resolve for the host's side (docs/rulings.md §33).
 */
export function effectController(state: GameState, uid: number): PlayerId {
  const host = abilityHost(state, uid)
  const card = state.cards[host] ?? state.cards[uid]
  if (!card) throw new Error(`Unknown card instance uid: ${uid}`)
  return card.owner
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
function canPayAbility(
  db: CardDb,
  state: GameState,
  player: PlayerId,
  def: EffectDef,
  source: number
): boolean {
  const host = abilityHost(state, source)
  if (def.cost?.selfSpend) {
    const card = state.cards[host]
    // Glossary SPEND/LAG: a spent card can't be spent again until it readies,
    // and a card with Lag can't be spent at all this turn.
    if (!card.ready || card.lag) return false
  }
  const eddies = abilityEddieCost(db, state, player, def)
  if (eddies <= 0) return true
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
      if (oncePerTurnSpent(state, uid, abilityIndex, effect)) continue
      if (!conditionMet(state, player, effect, {}, uid)) continue
      if (!canPayAbility(db, state, player, effect, uid)) continue
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
    const payment = canonicalPayment(state, defender, effectiveCardCost(db, state, defender, uid))
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
  // The same reduced cost `reduce.ts` validates the payment against (§44),
  // plus a RIVAL's "Rivals must pay +N €$ to use {Go Solo}" tax if active
  // (riot-shield, docs/rulings.md §107 ff.).
  const cost = effectiveCardCost(db, state, player, uid) + rivalGoSoloTax(db, state, player)
  return canonicalPayment(state, player, cost, uid)
}

/**
 * The `targets` array of a `playCard` action: the Gear equip target first (Gear
 * only), then one entry per fillable onPlay target slot (docs/rulings.md §34).
 */
export function playCardTargetChoices(db: CardDb, state: GameState, uid: number): number[][] {
  const def = defOf(db, state, uid)
  if (!def) return []
  // onPlay effects resolve *after* the card has entered its zone, so their
  // targets must be enumerated against that same state — otherwise a Unit could
  // never target itself, and a slot that only fills once the card is on the
  // field would shift every later slot (docs/rulings.md §34). The controller is
  // always the player *playing* the card, even for a Gear card equipped to a
  // rival Unit (docs/rulings.md §38).
  const player = state.cards[uid].owner
  const effectTuples = triggerTargetChoices(
    db,
    stateAfterEntry(db, state, uid),
    uid,
    'onPlay',
    player
  )
  if (def.type !== 'gear') return effectTuples

  const tuples: number[][] = []
  for (const host of gearEquipTargets(db, state, uid)) {
    for (const extra of effectTuples) tuples.push([host, ...extra])
  }
  return tuples
}

/**
 * The zones as they will be the moment `uid`'s onPlay effects resolve: out of
 * hand (or the legends zone), and on the field for a Unit or a {go-solo}
 * Legend. Only the zone arrays that target enumeration reads are rebuilt, so
 * this stays cheap enough to call once per playable hand card in
 * `legalActions`; card instances are shared, never mutated.
 */
function stateAfterEntry(db: CardDb, state: GameState, uid: number): GameState {
  const card = state.cards[uid]
  const def = db[card.defId]
  const player = card.owner
  const p = state.players[player]
  const entersField = def.type === 'unit' || def.type === 'legend'
  const moved: PlayerState = {
    ...p,
    hand: p.hand.filter((u) => u !== uid),
    legends: p.legends.filter((u) => u !== uid),
    field: entersField ? [...p.field, uid] : p.field,
  }
  const players: [PlayerState, PlayerState] =
    player === 0 ? [moved, state.players[1]] : [state.players[0], moved]
  return { ...state, players }
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
  spendOnDraft(db, draft, payment)
  draft.events.push({ type: 'cardPlayed', player, uid: cardUid })

  let effectTargets = targets
  switch (def.type) {
    case 'unit':
      card.ready = true
      card.lag = true
      card.playedThisTurn = true
      p.field.push(cardUid)
      break
    case 'legend':
      card.ready = true
      card.lag = false
      card.faceUp = true
      // {Go Solo} deliberately skips Lag ("it can attack this turn", §31),
      // but it still entered the field THIS turn — `playedThisTurn` is what
      // lets a rival's `rivalCantAttackWhenPlayed` static (maxtac-suppression-
      // team) still deny it (docs/rulings.md §106 fix round 2).
      card.playedThisTurn = true
      p.field.push(cardUid)
      break
    case 'gear':
      draft.cards[targets[0]].attachedGear.push(cardUid)
      effectTargets = targets.slice(1)
      break
    case 'program':
      break
  }

  // "Play your first CYBERWARE Gear each turn for -3 €$, to a minimum of
  // 1 €$" (viktor-vektor-drop-your-illusions, docs/rulings.md §81 ff.) — mark
  // every matching, still-unused discount used the moment a qualifying card
  // is actually played. `effectiveCardCost` already priced (and `isLegal`
  // already validated) this play with the discount applied; this just
  // retires the allowance for the rest of the game turn.
  for (const { hostUid, index, node } of firstMatchingPlayDiscountSources(db, draft, player)) {
    if (def.type === node.cardType && def.keywords.includes(node.keyword)) {
      markOncePerTurn(draft, hostUid, index)
    }
  }

  // A card's own onPlay belongs to the player who played and paid for it — even
  // a Gear card equipped to a rival Unit, whose *ongoing* statics, triggers and
  // abilities do transfer to the host's controller (docs/rulings.md §38). This
  // is `fireCardTrigger`, not `fireTriggerOnDraft`, for the same reason: onPlay
  // never propagates to the host's other Gear (docs/rulings.md §37).
  fireCardTrigger(db, draft, 'onPlay', cardUid, effectTargets, player)

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
  const eddies = abilityEddieCost(db, draft, player, effect)
  const payment = eddies > 0
    ? canonicalPayment(draft, player, eddies, effect.cost?.selfSpend ? host : undefined)
    : []

  draft.events.push({ type: 'abilityActivated', player, uid: cardUid, abilityIndex })
  if (effect.oncePerTurn === true) markOncePerTurn(draft, cardUid, abilityIndex)
  // The self-spend and the €$ are one cost: pay them both before anything
  // resolves, so an `onSpend` trigger cannot see a half-paid cost.
  if (effect.cost?.selfSpend) spendOnDraft(db, draft, [host])
  if (payment !== null && payment.length > 0) spendOnDraft(db, draft, payment)
  applyEffectDefOnDraft(db, draft, effect, cardUid, targets)
}
