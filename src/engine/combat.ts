// Combat: declaring an attack, the react window, blocks, fights and Gig
// stealing. The rules authority is the gameplay guide's ATTACK (p10) and
// ATTACKING (p10-11) sections plus the glossary entries SPEND/READY, LAG,
// POWER, GIGS and CALL A LEGEND; the judgment calls are docs/rulings.md
// §24-§28.
//
// The guide's attack sequence, and where each step lives:
//   01 SPEND THE ATTACKING UNIT ....... `declareAttack`
//   02 DECLARE A TARGET ............... `attackActions` (legality) + `declareAttack`
//   03 RIVAL REACTS ................... `reactActions` + reduce.ts's `react` handler
//   04 FIGHT / STEAL .................. `resolveAttack` -> `fight` / `takeStolenGig`
//
// Responsibility split: this file owns the combat mechanics *and* the combat
// slices of `legalActions`; `reduce.ts` keeps owning action dispatch and
// mutates combat state only through the functions exported here. Nothing here
// imports legal.ts or reduce.ts, so there is no import cycle.
//
// TRIGGER SEAMS (wired in Task 7, each marked `[trigger seam]` below):
//   * on-attack, in `declareAttack`, after the attacker is spent and before
//     the react window opens (guide step 01: "Spend the attacking Unit.
//     Resolve any [on-attack] effects on the Unit.");
//   * on-defeat, in `defeatUnit`, once the unit and its gear are in the trash
//     (guide step 04: "Move defeated Units to the trash and resolve any
//     [on-defeat] effects on them.");
//   * quick / quickAbility reactions, in `reactActions` — the react window
//     already stays open across every non-resolving reaction.
// The card layer (src/cards/effects.ts) is imported for those three; see the
// import-cycle note at the top of that file.

import { fireTriggerOnDraft, quickReactionActions } from '../cards/effects'
import { legendCallPayment } from './economy'
import { cantAttack, effectivePower, hasKeyword, opponentOf } from './query'
import type { Action, CardDb, GameState, PlayerId } from './types'

/** Keyword: "this Unit can attack the turn it's played" (docs/rulings.md §2). */
const ADRENALINE = 'adrenaline'
/** Keyword: "spend this Unit to redirect the attack to it instead" (guide p11). */
const BLOCKER = 'blocker'
/** A Unit steals one extra Gig per this much power (guide p11). */
const POWER_PER_EXTRA_GIG = 10

// ---------------------------------------------------------------------------
// Derived views used by legalActions
// ---------------------------------------------------------------------------

/**
 * How many Gig dice a Unit of `power` steals from an un-blocked attack on the
 * rival Gig area: "Units steal an additional Gig at power 10, two more at
 * power 20, and so on (and 0 Gigs at power 0)" — guide p11. Non-positive
 * power steals nothing at all; the caller caps the result at the rival's Gig
 * area size.
 */
export function stealCount(power: number): number {
  if (power <= 0) return 0
  return 1 + Math.floor(power / POWER_PER_EXTRA_GIG)
}

/**
 * May this friendly Unit attack? "Only ready Units can attack" (glossary
 * READY) and "Units with Lag can't attack" (glossary LAG) — except Units with
 * {adrenaline}, which "can attack the turn they're played" and so ignore Lag.
 * Being spent is never ignorable: a spent card "can't be spent again until it
 * readies" (glossary SPEND), and attacking spends the attacker. A static
 * `cantAttack` effect ("This Unit can't attack", e.g. corpo-security) vetoes
 * everything (docs/rulings.md §35), and {adrenaline} may be printed on the Unit
 * *or* granted by its Gear (docs/rulings.md §30).
 */
function canAttack(db: CardDb, state: GameState, uid: number): boolean {
  const card = state.cards[uid]
  if (!card.ready) return false
  if (cantAttack(db, state, uid)) return false
  if (!card.lag) return true
  return hasKeyword(db, state, uid, ADRENALINE)
}

/**
 * Everything an attack may be declared against: every **spent** rival field
 * Unit ("Ready Units can't be attacked", guide p11/glossary READY), plus the
 * rival Gig area — but only while it actually holds a die (docs/rulings.md
 * §24). Friendly Units and Legends in the legends zone are never targets.
 */
function attackTargets(state: GameState, attacker: PlayerId): (number | 'gigArea')[] {
  const rival = state.players[opponentOf(attacker)]
  const targets: (number | 'gigArea')[] = rival.field.filter((uid) => !state.cards[uid].ready)
  if (rival.gigArea.length > 0) targets.push('gigArea')
  return targets
}

/** One `attack` per (eligible attacker x legal target) pair, for the `main` phase. */
export function attackActions(db: CardDb, state: GameState): Action[] {
  const player = state.activePlayer
  const targets = attackTargets(state, player)
  if (targets.length === 0) return []

  const actions: Action[] = []
  for (const attacker of state.players[player].field) {
    if (!canAttack(db, state, attacker)) continue
    for (const target of targets) actions.push({ type: 'attack', attacker, target })
  }
  return actions
}

/**
 * The defender's react window (guide p10 step 03 / p11): "The attacked Rival
 * may take any number of these reactions." Always `pass` (which closes the
 * window and resolves the attack), one `block` per ready {blocker} Unit, and
 * `callLegend` while the shared once-per-turn call is still available.
 *
 * `block` needs no payment — the cost of blocking is the blocker itself being
 * spent (guide p11: "Spend a Unit with the {blocker} keyword"). Only field
 * Units are considered, so a Gear card that carries {blocker}
 * (`mandibular-upgrade`, `riot-shield`) can never block by itself — it grants
 * the keyword to the Unit or Legend wearing it instead (docs/rulings.md §30),
 * which is why the test below is `hasKeyword`, not the printed keyword list.
 */
export function reactActions(db: CardDb, state: GameState): Action[] {
  const defender = opponentOf(state.activePlayer)
  const p = state.players[defender]
  const actions: Action[] = [{ type: 'react', reaction: { type: 'pass' } }]

  for (const uid of p.field) {
    const card = state.cards[uid]
    if (!card.ready) continue
    if (!hasKeyword(db, state, uid, BLOCKER)) continue
    actions.push({ type: 'react', reaction: { type: 'block', blocker: uid } })
  }

  const payment = legendCallPayment(state, defender)
  if (payment !== null) actions.push({ type: 'react', reaction: { type: 'callLegend', payment } })

  // [trigger seam] {quick} programs from hand and {quick} activated abilities.
  actions.push(...quickReactionActions(db, state, defender))
  return actions
}

/**
 * One `chooseGig` per die in the victim's Gig area: the attacker picks the
 * dice to steal one at a time (guide p11 step 04, "Choose a rival Gig die and
 * move it to your friendly Gig area"), so a multi-die steal is a sequence of
 * decisions rather than one bulk transfer.
 */
export function chooseGigActions(state: GameState): Action[] {
  if (state.pendingSteal === null) return []
  const victim = opponentOf(state.activePlayer)
  return state.players[victim].gigArea.map((_die, dieIndex) => ({ type: 'chooseGig', dieIndex }))
}

// ---------------------------------------------------------------------------
// Mutations on a draft (see game.ts's `draftState`)
// ---------------------------------------------------------------------------

/** Is `uid` still a Unit on its owner's field? */
function onField(state: GameState, uid: number): boolean {
  const card = state.cards[uid]
  if (card === undefined) return false
  return state.players[card.owner].field.includes(uid)
}

/** Closes the attack: no pending attack or steal, back to the attacker's main phase. */
function endAttack(draft: GameState): void {
  draft.pendingAttack = null
  draft.pendingSteal = null
  draft.phase = 'main'
}

/**
 * Guide step 01+02: spend the attacker, declare the target, then hand the
 * decision to the defender (`phase = 'react'`, which flips
 * `query.actingPlayer` to the rival). The attacker stays spent whatever
 * happens next — a blocked attack, a lost fight and a 0-Gig steal all cost
 * the same tap (docs/rulings.md §28).
 */
export function declareAttack(
  draft: GameState,
  db: CardDb,
  attacker: number,
  target: number | 'gigArea'
): void {
  draft.cards[attacker].ready = false
  draft.events.push({ type: 'attackDeclared', attacker, target })

  // [trigger seam] on-attack effects on the attacking Unit resolve here — after
  // it is spent (guide step 01) and before the rival reacts, so a Unit this
  // defeats never gets to block (guide: "before your Rival reacts").
  fireTriggerOnDraft(db, draft, 'onAttack', attacker, [])

  draft.pendingAttack = { attacker, target }
  draft.phase = 'react'
}

/** Where a card goes when it leaves the field. */
export type FieldExit = 'trash' | 'hand' | 'deckBottom'

/**
 * Moves a card off the field to `exit`, dropping everything equipped to it
 * (guide p11 step 04). Details, all shared by every exit route (defeat, bounce,
 * bottom-deck) so they cannot drift apart:
 *   * attached Gear goes to *its own* owner's trash, which matters for the one
 *     card that can equip to a rival Unit (docs/rulings.md §8);
 *   * power buffs die with the field exit — a bounced Unit replayed later is a
 *     fresh, unbuffed card (docs/rulings.md §29);
 *   * a Legend on the field is a {go-solo} Legend, and "if it leaves the field,
 *     remove it from the game" — whatever the exit (docs/rulings.md §31).
 */
export function leaveField(draft: GameState, db: CardDb, uid: number, exit: FieldExit): void {
  const card = draft.cards[uid]
  const owner = draft.players[card.owner]
  owner.field = owner.field.filter((u) => u !== uid)

  const gear = card.attachedGear
  card.attachedGear = []
  card.tempPower = 0
  card.permPower = 0

  if (db[card.defId].type === 'legend') {
    owner.removed.push(uid)
    draft.events.push({ type: 'cardRemoved', uid })
  } else {
    switch (exit) {
      case 'trash':
        owner.trash.push(uid)
        draft.events.push({ type: 'cardTrashed', uid })
        break
      case 'hand':
        owner.hand.push(uid)
        break
      case 'deckBottom':
        owner.deck.push(uid)
        draft.events.push({ type: 'cardBottomDecked', uid })
        break
    }
  }

  for (const gearUid of gear) {
    draft.players[draft.cards[gearUid].owner].trash.push(gearUid)
    draft.events.push({ type: 'cardTrashed', uid: gearUid })
  }
}

/**
 * Defeats a Unit: `unitDefeated`, then the field exit to the trash, then its
 * on-defeat effects.
 */
export function defeatUnit(draft: GameState, db: CardDb, uid: number): void {
  draft.events.push({ type: 'unitDefeated', uid })
  leaveField(draft, db, uid, 'trash')

  // [trigger seam] on-defeat effects resolve once the Unit and its Gear have
  // left the field (guide step 04).
  fireTriggerOnDraft(db, draft, 'onDefeat', uid, [])
}

/**
 * Guide p11 step 04 FIGHT: "Compare both Units' power. The higher power Unit
 * defeats the other. On a tie, they defeat each other." Power is
 * `effectivePower` (printed power + until-end-of-turn deltas, and Gear
 * bonuses once Task 7 lands), so `>=` in both directions is exactly
 * "strictly higher wins, tie kills both".
 */
function fight(draft: GameState, db: CardDb, attacker: number, defender: number): void {
  const attackPower = effectivePower(db, draft, attacker)
  const defendPower = effectivePower(db, draft, defender)
  const defeated: number[] = []
  if (attackPower >= defendPower) defeated.push(defender)
  if (defendPower >= attackPower) defeated.push(attacker)
  for (const uid of defeated) {
    // An on-defeat effect from the first casualty could already have removed
    // the second one from the field; never defeat a card twice.
    if (!onField(draft, uid)) continue
    defeatUnit(draft, db, uid)
  }
}

/**
 * Guide p11 BLOCKER: "Spend a Unit with the {blocker} keyword to redirect the
 * attack to it instead." The attack then resolves at once as a fight against
 * the blocker, and steals nothing — "When a Unit redirects your attempt to
 * attack your Rival directly, a fight plays out as though your Unit attacked
 * the blocking Unit instead. Even if you defeat it, you don't steal any Gigs
 * for that attack." (docs/rulings.md §27 for why the window closes here.)
 */
export function blockAttack(draft: GameState, db: CardDb, blocker: number): void {
  const attack = draft.pendingAttack
  // Unreachable: `legalActions` only offers `block` inside a react window.
  if (attack === null) return

  draft.cards[blocker].ready = false
  attack.redirectedTo = blocker
  draft.events.push({ type: 'attackBlocked', blocker })
  resolveAttack(draft, db)
}

/**
 * Guide p11 step 04, reached when the defender passes (or immediately after a
 * block). A redirected attack, and any attack on a spent Unit, is a fight; an
 * un-blocked Gig-area attack sets up the steal and hands the `chooseGig`
 * decision back to the attacker. A steal of 0 dice — a 0-power attacker, or an
 * empty Gig area after a Task-7 effect — skips `chooseGig` entirely
 * (docs/rulings.md §25).
 */
export function resolveAttack(draft: GameState, db: CardDb): void {
  const attack = draft.pendingAttack
  // Unreachable: `legalActions` only offers reactions inside a react window.
  if (attack === null) return

  const attacker = attack.attacker
  const fightTarget = attack.redirectedTo ?? (attack.target === 'gigArea' ? null : attack.target)

  // Defensive against Task 7: a quick effect could defeat or bounce either
  // combatant during the react window. A vanished combatant fizzles the
  // attack rather than crashing or stealing.
  if (!onField(draft, attacker)) {
    endAttack(draft)
    return
  }

  if (fightTarget !== null) {
    if (onField(draft, fightTarget)) fight(draft, db, attacker, fightTarget)
    endAttack(draft)
    return
  }

  const victim = opponentOf(draft.activePlayer)
  const power = effectivePower(db, draft, attacker)
  const count = Math.min(stealCount(power), draft.players[victim].gigArea.length)
  if (count === 0) {
    endAttack(draft)
    return
  }

  draft.pendingSteal = { attacker, remaining: count }
  draft.phase = 'chooseGig'
}

/**
 * Steals one chosen die: it leaves the victim's Gig area and joins the
 * attacker's. The attack closes when the last die of the steal is taken, or
 * early if the victim's Gig area runs out first.
 */
export function takeStolenGig(draft: GameState, dieIndex: number): void {
  const steal = draft.pendingSteal
  // Unreachable: `legalActions` only offers `chooseGig` with a pending steal.
  if (steal === null) return

  const thief = draft.activePlayer
  const victim = opponentOf(thief)
  const [die] = draft.players[victim].gigArea.splice(dieIndex, 1)
  draft.players[thief].gigArea.push(die)
  draft.events.push({ type: 'gigStolen', from: victim, die: { ...die } })

  steal.remaining -= 1
  if (steal.remaining <= 0 || draft.players[victim].gigArea.length === 0) endAttack(draft)
}
