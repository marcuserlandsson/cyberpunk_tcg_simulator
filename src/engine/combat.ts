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

import {
  fireCardTrigger,
  fireTriggerOnDraft,
  fireWatcherTrigger,
  hasPayableOptionalTrigger,
  quickReactionActions,
  resolveNodeOnDraft,
  spendOnDraft,
} from '../cards/effects'
import { canonicalPayment, legendCallPayment } from './economy'
import { askIntercept, DECLINE } from './intercept'
import {
  attackableReadyKeyword,
  ATTACK_READY,
  attackPowerBonus,
  canAttackGigAreaDespiteLag,
  canAttackUnitDespiteLag,
  cantAttack,
  cantAttackGigArea,
  cantBeBlocked,
  cardTags,
  defeatInterceptorFor,
  defeatShieldOf,
  effectivePower,
  fightPowerBonus,
  hasKeyword,
  opponentOf,
  rivalDeniesFreshAttacks,
  stealInterceptorFor,
  stealValueCap,
  winsFightRegardless,
} from './query'
import type { Action, CardDb, GameState, PendingSteal, PlayerId } from './types'

/** Keyword: "this Unit can attack the turn it's played" (docs/rulings.md §2). */
const ADRENALINE = 'adrenaline'
/** Keyword: "spend this Unit to redirect the attack to it instead" (guide p11). */
const BLOCKER = 'blocker'
/**
 * Internal, never-printed keyword granted via the ordinary `grantKeyword`
 * node: "A friendly Unit can't be defeated in a fight this turn"
 * (muamar-reyes-el-capitán, docs/rulings.md §81 ff.) — mirrors `ATTACK_READY`
 * (docs/rulings.md §43): a real card grants it, no card's printed `keywords`
 * ever contains it.
 */
const FIGHT_IMMUNE = 'fight-immune'
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
 * *or* granted by its Gear (docs/rulings.md §30). A rival's
 * `rivalCantAttackWhenPlayed` static ("Rival Units can't attack the turn
 * they're played", maxtac-suppression-team) denies the {adrenaline} exception
 * outright — Lag still gates the attack even with the keyword (docs/rulings.md
 * §81 ff.).
 *
 * **Fix round 2 (docs/rulings.md §106):** Lag alone cannot tell "no Lag
 * because this Unit readied normally" apart from "no Lag because this is a
 * {Go Solo} Legend that entered the field THIS turn" (§31 — Go Solo
 * deliberately skips Lag entirely, "it can attack this turn"). The denial
 * must catch the second case too, or a rival's `maxtac-suppression-team`
 * would silently do nothing against a freshly-Go-Solo'd Legend. `card.
 * playedThisTurn` (set on every field entry, cleared at the same boundary
 * Lag clears) is the single source of truth for "entered the field this
 * turn," independent of whether Lag itself was ever applied.
 */
function canAttack(db: CardDb, state: GameState, uid: number): boolean {
  const card = state.cards[uid]
  if (!card.ready) return false
  if (cantAttack(db, state, uid)) return false
  if (card.lag) {
    if (!hasKeyword(db, state, uid, ADRENALINE)) return false
    return !rivalDeniesFreshAttacks(db, state, uid)
  }
  if (card.playedThisTurn === true) {
    return !rivalDeniesFreshAttacks(db, state, uid)
  }
  return true
}

/**
 * Everything an attack may be declared against: every **spent** rival field
 * Unit ("Ready Units can't be attacked", guide p11/glossary READY), plus the
 * rival Gig area — but only while it actually holds a die (docs/rulings.md
 * §24). Friendly Units and Legends in the legends zone are never targets.
 */
function attackTargets(
  db: CardDb,
  state: GameState,
  attacker: PlayerId,
  attackerUid: number,
  gigAreaOnly = false,
  unitOnly = false
): (number | 'gigArea')[] {
  const rival = state.players[opponentOf(attacker)]
  // "this Unit can attack their Gig area the turn it's played" (nadia-
  // fighting-through-grief, docs/rulings.md §92 ff.) — a Lag exception
  // narrower than {adrenaline}: it never unlocks a rival Unit, only the Gig
  // area.
  if (gigAreaOnly) {
    return rival.gigArea.length > 0 && !cantAttackGigArea(db, state, attackerUid)
      ? ['gigArea']
      : []
  }
  // "it may attack ready Units" — a granted permission that widens the target
  // list for that one attacker only (docs/rulings.md §43).
  const readyTooOk = hasKeyword(db, state, attackerUid, ATTACK_READY)
  // "this Unit can attack ready Units with {Blocker}" — narrower: only ready
  // Units carrying a specific keyword (docs/rulings.md §55 ff.).
  const readyKeyword = attackableReadyKeyword(db, state, attackerUid)
  const targets: (number | 'gigArea')[] = rival.field.filter(
    (uid) =>
      readyTooOk ||
      !state.cards[uid].ready ||
      (readyKeyword !== null && hasKeyword(db, state, uid, readyKeyword))
  )
  // "This Unit can attack rival Units the turn it's played" (sandayu-oda-
  // hanako-s-guardian, docs/rulings.md §107 ff.) — the mirror image of
  // `gigAreaOnly`: never unlocks the Gig area, only a rival Unit.
  if (unitOnly) return targets
  // "This Unit can only attack rival Units" (docs/rulings.md §55 ff.), on top
  // of §24's engine-wide "no dice, no attack" rule.
  if (rival.gigArea.length > 0 && !cantAttackGigArea(db, state, attackerUid)) {
    targets.push('gigArea')
  }
  return targets
}

/**
 * One `attack` per (eligible attacker x legal target) pair, for the `main`
 * phase — doubled for an attacker whose "{Attack} You may pay N €$" trigger is
 * affordable, so paying is a real decision (docs/rulings.md §49). The plain
 * variant (no `payOptionalCosts` key) always declines.
 */
export function attackActions(db: CardDb, state: GameState): Action[] {
  const player = state.activePlayer
  const actions: Action[] = []
  for (const attacker of state.players[player].field) {
    const full = canAttack(db, state, attacker)
    // "This Unit can attack their Gig area the turn it's played" — a narrower
    // Lag exception consulted only once the general one has already failed
    // (docs/rulings.md §92 ff.).
    const gigAreaOnly = !full && canAttackGigAreaDespiteLag(db, state, attacker)
    // The mirror image: "This Unit can attack rival Units the turn it's
    // played" (docs/rulings.md §107 ff.).
    const unitOnly = !full && !gigAreaOnly && canAttackUnitDespiteLag(db, state, attacker)
    if (!full && !gigAreaOnly && !unitOnly) continue
    const optional = hasPayableOptionalTrigger(db, state, attacker, 'onAttack')
    for (const target of attackTargets(db, state, player, attacker, gigAreaOnly, unitOnly)) {
      actions.push({ type: 'attack', attacker, target })
      if (optional) actions.push({ type: 'attack', attacker, target, payOptionalCosts: true })
    }
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
 *
 * No `block` reaction at all is offered while the current pending attack's
 * attacker carries a `cantBeBlocked` static (mt0d12-flathead, docs/rulings.md
 * §134 ff.) — the mirror image of `cantAttack` gating `attackTargets`.
 */
export function reactActions(db: CardDb, state: GameState): Action[] {
  const defender = opponentOf(state.activePlayer)
  const p = state.players[defender]
  const actions: Action[] = [{ type: 'react', reaction: { type: 'pass' } }]

  const attacker = state.pendingAttack?.attacker
  const blockable = attacker === undefined || !cantBeBlocked(db, state, attacker)

  if (blockable) {
    for (const uid of p.field) {
      const card = state.cards[uid]
      if (!card.ready) continue
      if (!hasKeyword(db, state, uid, BLOCKER)) continue
      actions.push({ type: 'react', reaction: { type: 'block', blocker: uid } })
    }
  }

  const payment = legendCallPayment(db, state, defender)
  if (payment !== null) actions.push({ type: 'react', reaction: { type: 'callLegend', payment } })

  // [trigger seam] {quick} programs from hand and {quick} activated abilities.
  actions.push(...quickReactionActions(db, state, defender))
  return actions
}

/**
 * Which of the victim's Gig dice this steal may actually take, as indexes into
 * their Gig area. The single authority on that question — `chooseGigActions`
 * enumerates it, `resolveAttack`/`stealGig` cap their counts by it, and
 * `takeStolenGig` ends an episode early when it runs empty — so a restriction
 * can never leave `chooseGig` with a pending steal and nothing to choose.
 *
 * Two narrowings, in this order:
 *   * a live `rivalStealCappedByPower` floating entry ("Until your next turn,
 *     rival Units can't steal friendly Gigs with value higher than their
 *     power" — chrome-fang, docs/rulings.md §141) is a hard PROHIBITION: dice
 *     above the stealing Unit's power are simply not stealable, even if that
 *     leaves none;
 *   * `distinctValueOnly` ("steal a rival Gig with a value not shared by a
 *     friendly Gig" — gorilla-arms, docs/rulings.md §68 ff.) is a PREFERENCE:
 *     it falls back to the whole (already prohibition-filtered) list when
 *     nothing qualifies, mirroring §25.
 */
export function stealableDieIndexes(
  db: CardDb,
  state: GameState,
  thief: PlayerId,
  stealerUid: number,
  distinctValueOnly = false
): number[] {
  const victim = opponentOf(thief)
  const dice = state.players[victim].gigArea
  const cap = stealValueCap(db, state, victim, stealerUid)
  let indexes = dice.map((_die, dieIndex) => dieIndex)
  if (cap !== null) indexes = indexes.filter((dieIndex) => dice[dieIndex].value <= cap)
  if (distinctValueOnly) {
    const friendlyValues = new Set(state.players[thief].gigArea.map((die) => die.value))
    const qualifying = indexes.filter((dieIndex) => !friendlyValues.has(dice[dieIndex].value))
    if (qualifying.length > 0) return qualifying
  }
  return indexes
}

/** The stealable indexes of the steal `state` currently has pending. */
function pendingStealableIndexes(db: CardDb, state: GameState): number[] {
  const steal = state.pendingSteal
  if (steal === null) return []
  const thief = steal.thief ?? state.activePlayer
  return stealableDieIndexes(db, state, thief, steal.attacker, steal.distinctValueOnly === true)
}

/**
 * One `chooseGig` per die in the victim's Gig area the current steal may take:
 * the attacker picks them one at a time (guide p11 step 04, "Choose a rival Gig
 * die and move it to your friendly Gig area"), so a multi-die steal is a
 * sequence of decisions rather than one bulk transfer.
 */
export function chooseGigActions(db: CardDb, state: GameState): Action[] {
  return pendingStealableIndexes(db, state).map((dieIndex) => ({ type: 'chooseGig', dieIndex }))
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

/**
 * Closes the attack: no pending attack or steal, back to the attacker's main
 * phase — except that an *effect*-driven steal (docs/rulings.md §32) outlives
 * the attack that spawned it. An on-defeat "steal a Gig" fired inside the fight
 * still owes its controller a die choice, so the phase stays `chooseGig` and
 * resumes into `main` once the dice are taken.
 */
function endAttack(draft: GameState): void {
  draft.pendingAttack = null
  const steal = draft.pendingSteal
  if (steal !== null && steal.thief !== undefined) {
    steal.resumePhase = 'main'
    draft.phase = 'chooseGig'
    return
  }
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
  target: number | 'gigArea',
  payOptionalCosts = false
): void {
  // "A rival Unit must attack next turn if it can." (mox-inciters,
  // evelyn-parker-beautiful-enigma, docs/rulings.md §142) — the obligation is
  // discharged by attacking, so it lapses here rather than waiting for its
  // turn boundary: a Unit readied again mid-turn is not forced to attack twice.
  draft.floatingEffects = draft.floatingEffects.filter(
    (entry) => !(entry.kind === 'mustAttack' && entry.unitUid === attacker)
  )

  // Spending the attacker is a spend like any other: "When this Unit is spent"
  // fires here (docs/rulings.md §47).
  spendOnDraft(db, draft, [attacker])
  // An on-spend effect can end the game; never open a window over `gameOver`.
  if (draft.winner !== null) return
  draft.events.push({ type: 'attackDeclared', attacker, target })

  // [trigger seam] on-attack effects on the attacking Unit (and its Gear)
  // resolve here — after it is spent (guide step 01) and before the rival
  // reacts, so a Unit this defeats never gets to block (guide: "before your
  // Rival reacts"). `sourcePower` answers "if this Unit has power N+"
  // (docs/rulings.md §55 ff.).
  fireTriggerOnDraft(db, draft, 'onAttack', attacker, [], {
    payOptionalCosts,
    sourcePower: effectivePower(db, draft, attacker),
  })

  // An on-attack effect can end the game (a forced draw off an empty deck, an
  // overtime-winning steal). Never re-open a decision window over `gameOver`.
  if (draft.winner !== null) return

  // [trigger seam] "The first time a friendly ARASAKA Unit attacks each turn,
  // ..." — a watcher, broadcast to every in-play card of the ATTACKER'S OWN
  // side (docs/rulings.md §55 ff.), never the attacker's own printed text.
  fireWatcherTrigger(db, draft, 'onFriendlyAttack', draft.cards[attacker].owner, {
    attackerTags: cardTags(db[draft.cards[attacker].defId]),
  })
  if (draft.winner !== null) return

  draft.pendingAttack = { attacker, target }

  // An on-attack effect can also owe the attacker a Gig-die choice
  // (docs/rulings.md §32). They take it first; the react window opens when the
  // steal is done, which is what `pendingSteal.resumePhase` says.
  if (draft.phase === 'chooseGig' && draft.pendingSteal !== null) {
    draft.pendingSteal.resumePhase = 'react'
    return
  }

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
  // A face-up Legend still in the legends zone can leave play too: its own
  // "defeat this Legend instead" interception reaches it there
  // (jackie-welles-mama-s-favorite, docs/rulings.md §144). Filtering both
  // zones keeps the {Go Solo} case (already off `legends` when it was played)
  // untouched, and stops a legends-zone exit from landing in `removed` while
  // still being listed as a Legend.
  owner.legends = owner.legends.filter((u) => u !== uid)

  const gear = card.attachedGear
  card.attachedGear = []
  card.tempPower = 0
  card.permPower = 0
  card.tempKeywords = []
  // docs/rulings.md §106 fix round 2: a card replayed later is a fresh
  // field entry, so its "played this turn" flag must not survive the exit.
  card.playedThisTurn = false

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
 *
 * `allowIntercept: false` skips the would-be-defeated interception
 * (docs/rulings.md §144) — used for the substitute defeat an interception
 * itself applies, so a chain of interceptors can never recurse.
 */
export function defeatUnit(
  draft: GameState,
  db: CardDb,
  uid: number,
  opts: { allowIntercept?: boolean } = {}
): void {
  // "If this Unit would be defeated, defeat its DEADMAN TRANSMITTER instead":
  // the Gear soaks the hit and the Unit stays put (docs/rulings.md §46). An
  // unconditional, costless substitution, so it settles the question before
  // any *decision* is offered — nothing is "would be defeated" any more.
  const shield = defeatShieldOf(db, draft, uid)
  if (shield !== null) {
    const host = draft.cards[uid]
    host.attachedGear = host.attachedGear.filter((gearUid) => gearUid !== shield)
    draft.players[draft.cards[shield].owner].trash.push(shield)
    draft.events.push({ type: 'cardTrashed', uid: shield })
    return
  }

  // [interception seam] "If a friendly Unit would be defeated, you may spend
  // 1 €$ to defeat this Legend instead." (jackie-welles-mama-s-favorite,
  // docs/rulings.md §144). Every defeat path in the engine funnels through
  // here — fights, effect nodes, mass-defeat scripts — so this one seam covers
  // all of them.
  if (opts.allowIntercept !== false) {
    const intercept = defeatInterceptorFor(db, draft, uid)
    if (intercept !== null) {
      const owner = draft.cards[intercept.protector].owner
      const answer = askIntercept(draft, {
        kind: 'defeat',
        player: owner,
        protector: intercept.protector,
        subject: uid,
        options: [DECLINE, intercept.protector],
      })
      if (answer !== DECLINE) {
        const payment = canonicalPayment(draft, owner, intercept.eddies, intercept.protector)
        if (payment !== null) {
          spendOnDraft(db, draft, payment)
          draft.events.push({
            type: 'effectResolved',
            sourceUid: intercept.protector,
            description: `intercepts the defeat of ${uid}`,
          })
          defeatUnit(draft, db, intercept.protector, { allowIntercept: false })
          return
        }
      }
    }
  }

  const controller = draft.cards[uid].owner
  // `leaveField` detaches the Gear, so capture it first: a Gear card's
  // "{Defeated} ..." text is about the Unit wearing it being defeated
  // (docs/rulings.md §37), and it resolves for that Unit's controller.
  const gear = [...draft.cards[uid].attachedGear]
  // Capture the defeated Unit's own tags before anything moves it — a Unit's
  // faction membership does not depend on its (about-to-be-detached) Gear.
  const defeatedTags = cardTags(db[draft.cards[uid].defId])
  // "if it's [equipped]" (river-ward-detective-on-the-hunt, docs/rulings.md
  // §81 ff.) — captured the same way, before `leaveField` clears it.
  const defeatedWasEquipped = gear.length > 0

  draft.events.push({ type: 'unitDefeated', uid })
  leaveField(draft, db, uid, 'trash')

  // [trigger seam] "The first time an ARASAKA Unit is defeated each turn,
  // ..." — bare, so it watches GLOBALLY: every in-play card of BOTH players,
  // whichever side the defeated Unit belonged to (docs/rulings.md §55 ff.,
  // mirroring §39's bare-Gig convention). `defeatedOwner`/`defeatedWasEquipped`
  // answer a "friendly equipped Unit" condition (docs/rulings.md §81 ff.).
  fireWatcherTrigger(db, draft, 'onUnitDefeated', 0, {
    defeatedTags,
    defeatedOwner: controller,
    defeatedWasEquipped,
  })
  fireWatcherTrigger(db, draft, 'onUnitDefeated', 1, {
    defeatedTags,
    defeatedOwner: controller,
    defeatedWasEquipped,
  })
  if (draft.winner !== null) return

  // [trigger seam] on-defeat effects resolve once the Unit and its Gear have
  // left the field (guide step 04). A Gear's own "{Defeated} ..." text means
  // its HOST being defeated (docs/rulings.md §37); `defeatedHostUid` lets that
  // effect reach "this Unit" — the host, now sitting in the trash
  // (the-relic-experimental-biochip, docs/rulings.md §81 ff.).
  fireCardTrigger(db, draft, 'onDefeat', uid, [], controller)
  for (const gearUid of gear) {
    fireCardTrigger(db, draft, 'onDefeat', gearUid, [], controller, { defeatedHostUid: uid })
  }
}

/**
 * Defeats an attached Gear card directly — not a Unit, so no `unitDefeated`
 * event and no `onUnitDefeated` watcher fire, but the Gear's own printed
 * "{Defeated} ..." text (if any, docs/rulings.md §37) still resolves for the
 * Gear's own owner. Used by the several batch-3 "defeat a [friendly] Gear"
 * scripts (docs/rulings.md §68 ff.) rather than by any vocabulary node — no
 * card needs "defeat a Gear" as a real, enumerated decision yet.
 */
export function defeatGear(draft: GameState, db: CardDb, gearUid: number): void {
  let host: number | null = null
  for (const player of [0, 1] as const) {
    for (const candidate of [...draft.players[player].field, ...draft.players[player].legends]) {
      if (draft.cards[candidate].attachedGear.includes(gearUid)) {
        host = candidate
        break
      }
    }
    if (host !== null) break
  }
  if (host === null) return
  draft.cards[host].attachedGear = draft.cards[host].attachedGear.filter((uid) => uid !== gearUid)
  const owner = draft.cards[gearUid].owner
  draft.players[owner].trash.push(gearUid)
  draft.events.push({ type: 'cardTrashed', uid: gearUid })
  fireCardTrigger(db, draft, 'onDefeat', gearUid, [], owner)
}

/**
 * Guide p11 step 04 FIGHT: "Compare both Units' power. The higher power Unit
 * defeats the other. On a tie, they defeat each other." Power is
 * `effectivePower` (printed power + until-end-of-turn deltas, and Gear
 * bonuses once Task 7 lands), so `>=` in both directions is exactly
 * "strictly higher wins, tie kills both".
 */
function fight(draft: GameState, db: CardDb, attacker: number, defender: number): void {
  // "+2 power while fighting a Legend" — a bonus that only exists for the
  // duration of this specific fight, never folded into `effectivePower`
  // (docs/rulings.md §55 ff.).
  // "... have +N power while attacking" (saburo-arasaka-stubborn-patriarch,
  // saul-bright-stormrider, docs/rulings.md §107 ff.) only ever applies to
  // the ATTACKER's own side of this fight, never the defender's.
  const attackPower =
    effectivePower(db, draft, attacker) +
    fightPowerBonus(db, draft, attacker, defender) +
    attackPowerBonus(db, draft, attacker)
  const defendPower = effectivePower(db, draft, defender) + fightPowerBonus(db, draft, defender, attacker)
  // "This Unit wins all fights against CORPO Units" overrides the power
  // comparison in that Unit's favour (docs/rulings.md §41).
  const attackerAlwaysWins = winsFightRegardless(db, draft, attacker, defender)
  const defenderAlwaysWins = winsFightRegardless(db, draft, defender, attacker)
  const wouldDefeat: number[] = []
  if (!defenderAlwaysWins && (attackerAlwaysWins || attackPower >= defendPower)) {
    wouldDefeat.push(defender)
  }
  if (!attackerAlwaysWins && (defenderAlwaysWins || defendPower >= attackPower)) {
    wouldDefeat.push(attacker)
  }
  // "A friendly Unit can't be defeated in a fight this turn"
  // (muamar-reyes-el-capitán, docs/rulings.md §81 ff.): an until-end-of-turn
  // immunity granted via the ordinary `grantKeyword` machinery. The fight
  // still happens normally for the OTHER combatant — this only saves whichever
  // side(s) carry the granted keyword right now.
  let defeated = wouldDefeat.filter((uid) => !hasKeyword(db, draft, uid, FIGHT_IMMUNE))

  // "The next time a rival Unit fights this turn, it doesn't defeat the
  // opposing friendly Unit." (reboot-optics, docs/rulings.md §141) — a
  // one-shot floating entry consumed by the first fight its controller has a
  // combatant in, applied at exactly the same seam as FIGHT_IMMUNE above (the
  // fight still happens normally for the other side; a loser who is never
  // defeated leaves nobody to have "won", per §46's `defeatShield` reading).
  const noDefeatIndex = draft.floatingEffects.findIndex(
    (entry) =>
      entry.kind === 'rivalFightNoDefeat' &&
      (entry.controller === draft.cards[attacker].owner ||
        entry.controller === draft.cards[defender].owner)
  )
  if (noDefeatIndex !== -1) {
    const protectedPlayer = draft.floatingEffects[noDefeatIndex].controller
    draft.floatingEffects.splice(noDefeatIndex, 1)
    defeated = defeated.filter((uid) => draft.cards[uid].owner !== protectedPlayer)
  }

  // "If that Unit steals or fights, defeat it at the end of this turn."
  // (cyberpsychosis, docs/rulings.md §141) — *fighting* is one of the two
  // qualifying acts, and it counts for BOTH combatants, win or lose.
  for (const entry of draft.floatingEffects) {
    if (entry.kind !== 'defeatIfActed') continue
    if (entry.unitUid === attacker || entry.unitUid === defender) entry.acted = true
  }

  // [trigger seam] "When this Unit loses a fight, ..." (maelstrom-zealots,
  // docs/rulings.md §92 ff.) — fired for each loser BEFORE either combatant
  // actually leaves the field, so "the opposing rival Unit" (`fightFoeUid`)
  // is still resolvable through the ordinary `defeat` node even when both
  // sides lose a tie.
  for (const uid of defeated) {
    const foe = uid === attacker ? defender : attacker
    fireTriggerOnDraft(db, draft, 'onLoseFight', uid, [], { fightFoeUid: foe })
  }

  for (const uid of defeated) {
    // An on-defeat effect from the first casualty (or a retaliation from
    // `onLoseFight` above) could already have removed the second one from
    // the field; never defeat a card twice.
    if (!onField(draft, uid)) continue
    defeatUnit(draft, db, uid)
  }

  // [trigger seam] "when this Unit wins a fight": the survivor of a fight that
  // actually defeated the other side (docs/rulings.md §41). A tie has no
  // winner, and neither does a fight whose loser was saved by a `defeatShield`
  // (§46) — it was never defeated, so nobody won.
  const loser = defeated.length === 1 ? defeated[0] : null
  const winner = loser === null ? null : loser === defender ? attacker : defender
  if (winner !== null && loser !== null && !onField(draft, loser) && onField(draft, winner)) {
    fireTriggerOnDraft(db, draft, 'onWinFight', winner, [])
  }

  // Delayed, one-shot floating consequences of this fight (docs/rulings.md
  // §141), both resolved AFTER the fight itself is completely settled — the
  // printed texts speak of a fight that has already been won or lost:
  //   * "The next time a friendly Unit wins a fight by 3+ power this turn, it
  //     also steals a Gig." (appetite-for-destruction);
  //   * "The next time a friendly Unit loses a fight this turn, defeat the
  //     opposing rival Unit." (safety-override).
  if (winner !== null && loser !== null && onField(draft, winner)) {
    const margin =
      winner === attacker ? attackPower - defendPower : defendPower - attackPower
    const index = draft.floatingEffects.findIndex(
      (entry) =>
        entry.kind === 'winFightMarginSteal' &&
        entry.controller === draft.cards[winner].owner &&
        margin >= (entry.margin ?? 0)
    )
    if (index !== -1) {
      const [entry] = draft.floatingEffects.splice(index, 1)
      resolveNodeOnDraft(
        db,
        draft,
        { kind: 'stealGig', count: entry.count ?? 1 },
        winner,
        entry.controller
      )
    }
  }

  for (const uid of defeated) {
    const foe = uid === attacker ? defender : attacker
    const index = draft.floatingEffects.findIndex(
      (entry) => entry.kind === 'loseFightDefeatFoe' && entry.controller === draft.cards[uid].owner
    )
    if (index === -1) continue
    draft.floatingEffects.splice(index, 1)
    if (onField(draft, foe)) defeatUnit(draft, db, foe)
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

  spendOnDraft(db, draft, [blocker])
  attack.redirectedTo = blocker
  draft.events.push({ type: 'attackBlocked', blocker })
  // [trigger seam] "When this Unit uses {Blocker}, ..." — before the fight, so
  // a buff or a Gig gain it grants is live for that fight (docs/rulings.md §41).
  fireTriggerOnDraft(db, draft, 'onBlock', blocker, [])
  // [trigger seam] "When a FRIENDLY Unit uses {Blocker}, ..." — a watcher,
  // broadcast to every in-play card of the blocking Unit's own controller
  // (goro-takemura-vengeful-bodyguard, docs/rulings.md §92 ff.), unlike the
  // self-referential `onBlock` fired just above.
  fireWatcherTrigger(db, draft, 'onFriendlyBlock', draft.cards[blocker].owner, {})
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

  // "... have +N power while attacking" applies to a Gig-area steal exactly
  // like a fight (docs/rulings.md §107 ff.); "steals 1 fewer Gig this turn"
  // (take-control, docs/rulings.md §107 ff.) then reduces the resulting
  // count, floored at 0.
  const power = effectivePower(db, draft, attacker) + attackPowerBonus(db, draft, attacker)
  const reduction = draft.cards[attacker].stealReduction ?? 0
  const rawCount = Math.max(0, stealCount(power) - reduction)
  // Capped by what this attacker may actually take, not merely by how many
  // dice exist: a `rivalStealCappedByPower` restriction (chrome-fang,
  // docs/rulings.md §141) can put some — or all — of them out of reach.
  const count = Math.min(
    rawCount,
    stealableDieIndexes(db, draft, draft.activePlayer, attacker).length
  )
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
export function takeStolenGig(draft: GameState, db: CardDb, dieIndex: number): void {
  const steal = draft.pendingSteal
  // Unreachable: `legalActions` only offers `chooseGig` with a pending steal.
  if (steal === null) return

  // The thief is the attacking active player, except for an effect-driven steal,
  // which names its own controller (docs/rulings.md §32).
  const thief = steal.thief ?? draft.activePlayer
  const victim = opponentOf(thief)
  const chosen = draft.players[victim].gigArea[dieIndex]
  // Unreachable: `legalActions` only offers indexes the victim's area holds.
  if (chosen === undefined) return

  // [interception seam] "When a rival Unit would steal a Gig, you may discard 1
  // with cost equal to that Gig's value. If you do, the Gig isn't stolen."
  // (alt-cunningham-mother-of-daemons, docs/rulings.md §72/§144) — asked
  // BEFORE the die moves, and the die then stays where it is.
  let prevented = false
  const intercept = stealInterceptorFor(db, draft, victim, steal.attacker, chosen.value)
  if (intercept !== null) {
    const answer = askIntercept(draft, {
      kind: 'steal',
      player: victim,
      protector: intercept.protector,
      subject: dieIndex,
      options: [DECLINE, ...intercept.candidates],
    })
    if (answer !== DECLINE && intercept.candidates.includes(answer)) {
      const p = draft.players[victim]
      p.hand = p.hand.filter((uid) => uid !== answer)
      p.trash.push(answer)
      draft.events.push({ type: 'cardTrashed', uid: answer })
      draft.events.push({
        type: 'effectResolved',
        sourceUid: intercept.protector,
        description: `prevents the steal of d${chosen.size}:${chosen.value}`,
      })
      prevented = true
    }
  }

  if (!prevented) {
    const [die] = draft.players[victim].gigArea.splice(dieIndex, 1)
    draft.players[thief].gigArea.push(die)
    draft.events.push({ type: 'gigStolen', from: victim, die: { ...die } })
    steal.taken = (steal.taken ?? 0) + 1

    // "if this Unit stole a Gig this turn" (delamain-cab, docs/rulings.md §120
    // ff.) — set on the card that actually did the stealing, attack- or
    // effect-driven alike; cleared alongside `tempPower` in `clearTurnBuffs`.
    if (draft.cards[steal.attacker]) draft.cards[steal.attacker].stoleGigThisTurn = true

    // "If that Unit steals or fights, defeat it at the end of this turn."
    // (cyberpsychosis, docs/rulings.md §141) — *stealing* is the other
    // qualifying act (the fight one is marked inside `fight`).
    for (const entry of draft.floatingEffects) {
      if (entry.kind === 'defeatIfActed' && entry.unitUid === steal.attacker) entry.acted = true
    }

    // [trigger seam] "When a friendly Unit steals a d6, ..." — a watcher trigger,
    // fired on every in-play card of the thief (docs/rulings.md §42), ONCE PER
    // DIE. `stealerUid` answers "When THIS Unit steals a Gig" (docs/rulings.md
    // §55 ff.). `stolenDieValue`/`stealerIsLegend` answer "if its value is
    // even/odd" and "a friendly LEGEND steals" (rogue-amendiares-preem-solo,
    // docs/rulings.md §81 ff.).
    fireWatcherTrigger(db, draft, 'onFriendlyStealDie', thief, {
      stolenDieSize: die.size,
      stolenDieValue: die.value,
      stealerUid: steal.attacker,
      stealerIsLegend: db[draft.cards[steal.attacker].defId]?.type === 'legend',
    })
  }

  steal.remaining -= 1
  // The episode continues only while there is still something this steal may
  // legally take — the victim's area running dry, or a `rivalStealCappedByPower`
  // restriction putting every remaining die out of reach (docs/rulings.md
  // §141), both end it here rather than leaving `chooseGig` with no choice.
  if (steal.remaining > 0 && pendingStealableIndexes(db, draft).length > 0) return

  // [trigger seam] "When a friendly Unit steals 1 or more Gigs, ..." — a
  // watcher trigger fired ONCE, when the whole steal EPISODE this
  // `takeStolenGig` call is resolving finishes (however many dice it took),
  // unlike `onFriendlyStealDie` above (docs/rulings.md §133 — batch 7 fix
  // round 1, evelyn-parker-beautiful-enigma). `stealerTags` answers "a
  // CORPO or GANGER Unit steals." An episode whose every die was intercepted
  // (docs/rulings.md §144) stole nothing, so "1 or more Gigs" is false and it
  // does not fire at all.
  if ((steal.taken ?? 0) > 0) {
    fireWatcherTrigger(db, draft, 'onFriendlyStealComplete', thief, {
      stealerUid: steal.attacker,
      stealerIsLegend: db[draft.cards[steal.attacker].defId]?.type === 'legend',
      stealerTags: db[draft.cards[steal.attacker].defId] ? cardTags(db[draft.cards[steal.attacker].defId]) : [],
    })
  }

  finishSteal(draft, steal)
}

/**
 * The head steal is done. If another steal is queued behind it (a tied fight
 * where both casualties steal — docs/rulings.md §32), it becomes the new head
 * and inherits the resume target, because the interrupted phase only resumes
 * after the *last* steal. Otherwise: an attack steal closes the attack, and an
 * effect steal hands control back to whatever it interrupted (the main phase, or
 * a react window whose attack is still pending).
 */
function finishSteal(draft: GameState, head: PendingSteal): void {
  const queue = head.queue ?? []
  const next = queue.shift()
  if (next !== undefined) {
    next.resumePhase = next.resumePhase ?? head.resumePhase
    if (queue.length > 0) next.queue = queue
    else delete next.queue
    draft.pendingSteal = next
    draft.phase = 'chooseGig'
    return
  }

  if (head.resumePhase === undefined) {
    // An attack steal: the last die closes the attack.
    endAttack(draft)
    return
  }
  draft.pendingSteal = null
  draft.phase = head.resumePhase
}
