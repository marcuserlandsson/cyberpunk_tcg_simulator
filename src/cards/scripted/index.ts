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

import { defeatGear, defeatUnit } from '../../engine/combat'
import { endGame, drawCards } from '../../engine/game'
import { cardTags, effectivePower, hasKeyword, opponentOf, valuePairCount } from '../../engine/query'
import { nextInt, shuffle } from '../../engine/rng'
import type { CardDb, GameState, PlayerId } from '../../engine/types'
import { fireTriggerOnDraft, spendOnDraft, type EffectCtx } from '../effects'

export type ScriptedCard = (db: CardDb, state: GameState, ctx: EffectCtx) => GameState

/** Picks one element through the seeded rng, advancing it on the draft. */
function pick<T>(state: GameState, items: T[]): T | undefined {
  if (items.length === 0) return undefined
  const [index, rng] = nextInt(state.rng, items.length)
  state.rng = rng
  return items[index]
}

/**
 * Picks up to `n` distinct items through the seeded rng — every item if the
 * pool holds `n` or fewer (docs/rulings.md §107 ff.'s "up to N, no printed
 * tie-breaker" convention: when the pool exceeds `n`, nothing on the card
 * distinguishes *which* ones, so those are chosen uniformly at random, the
 * same "no enumerable decision left" reasoning as `viktor-vektor-sit-down-
 * and-relax`'s "reveal up to 2 Gears" — extended here from a mid-resolution
 * reveal to an already-visible board zone).
 */
function pickN<T>(state: GameState, items: T[], n: number): T[] {
  if (items.length <= n) return [...items]
  const pool = [...items]
  const taken: T[] = []
  while (taken.length < n && pool.length > 0) {
    const [index, rng] = nextInt(state.rng, pool.length)
    state.rng = rng
    taken.push(...pool.splice(index, 1))
  }
  return taken
}

/** Every Gear card attached anywhere on `player`'s side (field + legends). */
function friendlyGearUids(state: GameState, player: PlayerId): number[] {
  const p = state.players[player]
  return [
    ...p.field.flatMap((uid) => state.cards[uid].attachedGear),
    ...p.legends.flatMap((uid) => state.cards[uid].attachedGear),
  ]
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

  /**
   * `v-roamer-of-the-badlands` — "When this Unit steals a Gig, increase it by
   * up to 5." Attached to `onFriendlyStealDie` with `condition.selfIsStealer`
   * (docs/rulings.md §55 ff.), so this only runs when V itself did the
   * stealing. Unlike a general `changeGig` node (any Gig, a real choice of
   * die), here BOTH the target (the die that was just stolen — always the
   * last one pushed onto the thief's own Gig area, per docs/rulings.md §42)
   * and the amount (a fixed-sign "by up to N" always takes the full clamped
   * N, docs/rulings.md §39) are forced, so there is no real decision left to
   * route through the slot machinery.
   */
  'v-roamer-of-the-badlands': (_db, state, ctx) => {
    const p = state.players[ctx.player]
    const die = p.gigArea[p.gigArea.length - 1]
    if (die !== undefined) die.value = Math.min(die.size, die.value + 5)
    return state
  },

  /**
   * `yorinobu-arasaka-steel-dragon` — "{Play} You may play a Unit with cost 4
   * or less from your hand or trash for free. It can attack rival Units this
   * turn." Wrapped in a `sameTarget` (docs/rulings.md §53) whose target spec
   * (`friendlyHandOrTrashUnit`, filtered to cost 4 or less) is the real,
   * enumerated decision — this script only performs the "play it for free"
   * half; the second child of the `sameTarget` grants {adrenaline} so it can
   * attack despite the Lag every freshly-played Unit gets (docs/rulings.md §55
   * ff.). "Play" means the full thing: the card's own onPlay effects fire too,
   * auto-targeted per docs/rulings.md §32 (a script-driven play carries no
   * player decision of its own for them).
   */
  'yorinobu-arasaka-steel-dragon': (db, state, ctx) => {
    const target = ctx.chosen
    if (target === undefined) return state
    const p = state.players[ctx.player]
    const inHand = p.hand.includes(target)
    const inTrash = p.trash.includes(target)
    if (!inHand && !inTrash) return state
    if (inHand) p.hand = p.hand.filter((uid) => uid !== target)
    if (inTrash) p.trash = p.trash.filter((uid) => uid !== target)
    const card = state.cards[target]
    card.ready = true
    card.lag = true
    card.playedThisTurn = true // docs/rulings.md §106 fix round 2
    p.field.push(target)
    state.events.push({ type: 'cardPlayed', player: ctx.player, uid: target })
    fireTriggerOnDraft(db, state, 'onPlay', target, [])
    return state
  },

  /**
   * `shattered-memories` — "Each player discards their hand and may draw 5.
   * If the total number of discarded cards equals the value of a friendly
   * Gig, draw 2."
   *
   * A one-off shape (no other card in the pool shares it), so it is fully
   * scripted rather than grown into vocabulary (docs/rulings.md §48/§55 ff.).
   * "May draw 5" is taken whenever possible, but — unlike a mandatory `draw`
   * node (docs/rulings.md §17/§36) — it draws only *up to* 5 and never decks
   * a player out, the same "up to what the deck holds" reading
   * `trashFromDeck` already uses (docs/rulings.md §36). The bonus "draw 2" IS
   * a mandatory draw and can end the game on an empty deck, like any other
   * `draw` node.
   */
  'shattered-memories': (db, state, ctx) => {
    let totalDiscarded = 0
    for (const player of [0, 1] as const) {
      const p = state.players[player]
      totalDiscarded += p.hand.length
      for (const uid of p.hand) {
        p.trash.push(uid)
        state.events.push({ type: 'cardTrashed', uid })
      }
      p.hand = []
      for (let i = 0; i < 5; i++) {
        const drawn = p.deck.shift()
        if (drawn === undefined) break
        p.hand.push(drawn)
        state.events.push({ type: 'cardDrawn', player, uid: drawn })
      }
    }
    const matches = state.players[ctx.player].gigArea.some((die) => die.value === totalDiscarded)
    if (matches && !drawCards(state, ctx.player, 2)) {
      endGame(state, opponentOf(ctx.player), 'deckout')
    }
    return state
  },

  // -------------------------------------------------------------------------
  // Task 8 batch 3 (Yellow) — docs/rulings.md §68 ff.
  // -------------------------------------------------------------------------

  /**
   * `adam-smasher-metal-over-meat` — "{Play} Defeat all other Units." A mass,
   * unconditional multi-target effect with no per-target decision — no other
   * pool card shares this exact shape, so it is scripted rather than grown
   * into a one-card `defeatAll` vocabulary node. Snapshots both fields before
   * defeating anything, since `defeatUnit` mutates the very zones being
   * iterated; a field card is a "Unit" for this purpose whether it got there
   * as a Unit or as a {go-solo} Legend (docs/rulings.md §31/§39's convention).
   */
  'adam-smasher-metal-over-meat': (db, state, ctx) => {
    const targets = [...state.players[0].field, ...state.players[1].field].filter(
      (uid) => uid !== ctx.sourceUid
    )
    for (const uid of targets) {
      if (state.players[state.cards[uid].owner].field.includes(uid)) {
        defeatUnit(state, db, uid)
      }
    }
    return state
  },

  /**
   * `gilded-mato-n` — "{Play} You may defeat a friendly Gear. If you do,
   * defeat a rival Unit with cost 3 or less." The "if you do" dependency
   * between the two defeats cannot be expressed with the target-slot
   * machinery — a `sequence`'s second node has no way to see whether the
   * first one actually found a target (docs/rulings.md §32/§57) — so both
   * halves are scripted together. "You may" is taken whenever a friendly
   * Gear exists (docs/rulings.md §50, extended here to an uncosted "you may
   * [defeat your own card]" exactly as every other cost-free "you may" in
   * the pool is auto-taken). **Fix round 1 (docs/rulings.md §73/§80):**
   * *which* Gear is a real, enumerated decision — `onPlay` carries a real
   * `targets` array, so this is declared as the scripted node's own
   * `friendlyGear` target slot rather than an rng pick. Which rival Unit to
   * defeat is still picked through the rng: the review that requested this
   * fix only flagged the Gear choice, and — unlike the Gear, which is always
   * a specific, known card the player is choosing to give up — "a rival
   * Unit with cost 3 or less" has no `TargetFilter` support inside a
   * scripted node's declared targets today, so exposing it as a second real
   * decision would need that extension too; left as the existing
   * script-internal rng choice (docs/rulings.md §48) pending a real card
   * that needs a filtered scripted target.
   */
  'gilded-mato-n': (db, state, ctx) => {
    const gear = ctx.targets[0]
    if (gear === undefined) return state
    defeatGear(state, db, gear)
    const rival = opponentOf(ctx.player)
    const candidates = state.players[rival].field.filter(
      (uid) => db[state.cards[uid].defId].cost <= 3
    )
    const target = pick(state, candidates)
    if (target !== undefined) defeatUnit(state, db, target)
    return state
  },

  /**
   * `dum-dum-maelstrom-triggerman` — "{Call} You may defeat a friendly Gear.
   * If you do, draw 2. Otherwise, draw 1." {Call} carries no player decision
   * at all — the flip that triggers it is random and the `callLegend` action
   * has no `targets` field for the same reason (docs/rulings.md §32), a rule
   * batch 1 already leaned on for an on-{Call} `chooseOne` (§45:
   * "a chooseOne reached from a trigger that carries no player choice
   * ({Call}) picks its mode off the rng"). **This is unlike
   * `gilded-mato-n`/`heywood-ripperdoc` below (docs/rulings.md §73/§80
   * fix round 1):** those fire from `onPlay`, which already carries a real
   * `targets` array the player commits to when playing the card, so their
   * Gear choice could become a declared target; `onCall`'s target (which
   * face-down Legend flips) is only known *after* the action resolves, so
   * there is no action-carrying seam to attach a pre-commitment to without a
   * new decision phase (the same class of gap §78 defers
   * `kerry-eurodyne-axe-attitude-audience` for). "You may" is still taken
   * whenever a friendly Gear exists (docs/rulings.md §50), with the Gear
   * itself picked through the rng; the doubled draw follows automatically
   * from whether that pick found anything.
   */
  'dum-dum-maelstrom-triggerman': (db, state, ctx) => {
    const gear = pick(state, friendlyGearUids(state, ctx.player))
    if (gear !== undefined) defeatGear(state, db, gear)
    if (!drawCards(state, ctx.player, gear === undefined ? 1 : 2)) {
      endGame(state, opponentOf(ctx.player), 'deckout')
    }
    return state
  },

  /**
   * `heywood-ripperdoc` — "{Play} You may defeat a Gear. If its cost equals
   * the value of a friendly Gig, draw 1." Bare "a Gear" reaches either side
   * (docs/rulings.md §39's bare convention — the `anyGear` `TargetSpec`
   * enumerates the controller's own Gear first, then the rival's), and "its
   * cost" names a property of the specific Gear that was defeated, read off
   * the chosen uid before it is trashed. **Fix round 1 (docs/rulings.md
   * §73/§80):** which Gear is now the scripted node's own declared
   * `anyGear` target — a real, enumerated decision (spanning both sides) —
   * rather than an rng pick.
   */
  'heywood-ripperdoc': (db, state, ctx) => {
    const gear = ctx.targets[0]
    if (gear === undefined) return state
    const cost = db[state.cards[gear].defId].cost
    defeatGear(state, db, gear)
    const matches = state.players[ctx.player].gigArea.some((die) => die.value === cost)
    if (matches && !drawCards(state, ctx.player, 1)) {
      endGame(state, opponentOf(ctx.player), 'deckout')
    }
    return state
  },

  /**
   * `hanako-arasaka-in-a-gilded-cage` — "{Play} Search the top 4 cards of
   * your deck. Reveal any number of cards with cost equal to any friendly
   * Gig values and add them to your hand. Bottom-deck the rest." A pure
   * search: every qualifying card is worth taking (no downside), so "any
   * number" reads as "every card that qualifies" (docs/rulings.md §50's
   * convention) — the qualifying set is known before any card moves, so no
   * rng choice is needed at all. Order among the bottom-decked rest is kept
   * as encountered (top to bottom of the searched 4).
   */
  'hanako-arasaka-in-a-gilded-cage': (db, state, ctx) => {
    const p = state.players[ctx.player]
    const top: number[] = []
    for (let i = 0; i < 4; i++) {
      const uid = p.deck.shift()
      if (uid === undefined) break
      top.push(uid)
    }
    const values = new Set(p.gigArea.map((die) => die.value))
    for (const uid of top) {
      if (values.has(db[state.cards[uid].defId].cost)) p.hand.push(uid)
      else p.deck.push(uid)
    }
    return state
  },

  /**
   * `kiroshi-optics` — "{Attack} Look at a friendly face-down Legend. (Don't
   * reveal it.)" A private-information peek with no representable
   * game-state effect: this engine models full state visibility (no
   * separate per-player knowledge layer, unlike a physical table), so
   * "looking" changes nothing. The EffectDef exists to prove the {Attack}
   * gear-trigger propagation (docs/rulings.md §37/§38) actually reaches
   * Kiroshi Optics's own effect — exercised through the host's attack by
   * asserting the `effectResolved` event the interpreter always logs after a
   * scripted node runs (docs/rulings.md §68 ff.).
   */
  'kiroshi-optics': (_db, state, _ctx) => state,

  /**
   * `live-with-the-aftermath` — "Each player defeats one of their Units."
   * The controller's own casualty is a real, enumerated decision
   * (`friendlyUnit`, declared as this scripted node's own target slot,
   * docs/rulings.md §48); the RIVAL's casualty is not a choice this action's
   * single acting player can make on the rival's behalf, so it is picked
   * through the rng — the same way `discardRandomRival` treats the rival's
   * hand as private/unpredictable (docs/rulings.md §32).
   */
  'live-with-the-aftermath': (db, state, ctx) => {
    const own = ctx.targets[0]
    if (own !== undefined && state.players[ctx.player].field.includes(own)) {
      defeatUnit(state, db, own)
    }
    const rival = opponentOf(ctx.player)
    const rivalUnit = pick(state, state.players[rival].field)
    if (rivalUnit !== undefined) defeatUnit(state, db, rivalUnit)
    return state
  },

  // -------------------------------------------------------------------------
  // Task 8 batch 4 (Yellow) — docs/rulings.md §81 ff.
  // -------------------------------------------------------------------------

  /**
   * `sketchy-ripper` — "{Attack} Search the top 3 cards of your deck. Reveal
   * a Gear and add it to your hand. Bottom-deck the rest." The candidates
   * (whatever is on top of the deck) only exist once the effect resolves, so
   * which Gear (if more than one turns up) is picked through the rng, exactly
   * like `all-is-lost` (docs/rulings.md §48). Non-chosen cards return to the
   * BOTTOM of the deck, per the card's own explicit instruction.
   */
  'sketchy-ripper': (db, state, ctx) => {
    const p = state.players[ctx.player]
    const top: number[] = []
    for (let i = 0; i < 3; i++) {
      const uid = p.deck.shift()
      if (uid === undefined) break
      top.push(uid)
    }
    const gears = top.filter((uid) => db[state.cards[uid].defId].type === 'gear')
    const chosen = pick(state, gears)
    for (const uid of top) {
      if (uid === chosen) p.hand.push(uid)
      else p.deck.push(uid)
    }
    return state
  },

  /**
   * `t-bug-amateur-philosopher` — "{Defeated} Look at all friendly face-down
   * Legends. Then, you may Call a Legend for free. (You can only Call a
   * Legend once per turn.)" "Look" is a no-op under this engine's
   * full-visibility model (docs/rulings.md §77 — kiroshi-optics); the free
   * Call is taken whenever available (docs/rulings.md §50), and which Legend
   * flips is picked through the rng exactly like the paid action
   * (docs/rulings.md §23) — there is no "which Legend" decision printed here
   * at all, unlike `arasaka-emergency-radioport`'s gated version.
   */
  't-bug-amateur-philosopher': (db, state, ctx) => {
    const p = state.players[ctx.player]
    if (p.calledLegendThisTurn) return state
    const legend = pick(
      state,
      p.legends.filter((uid) => !state.cards[uid].faceUp)
    )
    if (legend === undefined) return state
    state.cards[legend].faceUp = true
    p.calledLegendThisTurn = true
    state.events.push({ type: 'legendCalled', player: ctx.player, uid: legend })
    fireTriggerOnDraft(db, state, 'onCall', legend, [])
    return state
  },

  /**
   * `the-heist` — "Trash 4. Add a Gear from among them to your hand. If that
   * Gear's cost equals the value of a friendly Gig, you may play it for free
   * instead." Which Gear (if several turn up among the trashed 4) is picked
   * through the rng, exactly like `all-is-lost` (docs/rulings.md §48); "you
   * may play it for free instead" has no stated cost or drawback, so it is
   * taken whenever the condition holds (docs/rulings.md §50) — including
   * picking its equip host through the rng, since no action carries a
   * pre-committed target for a card whose very existence is only known mid-
   * resolution. With no legal host, it falls back to landing in hand instead
   * of being lost entirely.
   */
  'the-heist': (db, state, ctx) => {
    const trashed = trashFromTop(state, ctx.player, 4)
    const gears = trashed.filter((uid) => db[state.cards[uid].defId].type === 'gear')
    const chosen = pick(state, gears)
    if (chosen === undefined) return state
    const p = state.players[ctx.player]
    const cost = db[state.cards[chosen].defId].cost
    const matches = p.gigArea.some((die) => die.value === cost)
    if (matches) {
      const hosts = [...p.field, ...p.legends.filter((uid) => state.cards[uid].faceUp)]
      const host = pick(state, hosts)
      if (host !== undefined) {
        p.trash = p.trash.filter((uid) => uid !== chosen)
        state.cards[host].attachedGear.push(chosen)
        state.events.push({ type: 'cardPlayed', player: ctx.player, uid: chosen })
        fireTriggerOnDraft(db, state, 'onPlay', chosen, [])
        return state
      }
    }
    p.trash = p.trash.filter((uid) => uid !== chosen)
    p.hand.push(chosen)
    return state
  },

  /**
   * `the-relic-experimental-biochip` — "{Defeated} Play another Unit with
   * cost 9 or less from your trash for free. Then, bottom-deck this Unit."
   * Printed on a Gear card, whose own "{Defeated}" text is about its HOST
   * being defeated (docs/rulings.md §37) — "this Unit" is that host, already
   * sitting in the trash by the time this fires. `ctx.context.defeatedHostUid`
   * (docs/rulings.md §81 ff.) carries that uid through; with no host known
   * (the Gear was defeated directly, not via a host defeat) this safely
   * no-ops. Which trashed Unit to retrieve is picked through the rng: no
   * on-defeat trigger carries an action-level target (docs/rulings.md §32).
   */
  'the-relic-experimental-biochip': (db, state, ctx) => {
    const hostUid = ctx.context?.defeatedHostUid
    if (hostUid === undefined) return state
    const p = state.players[ctx.player]
    const candidates = p.trash.filter((uid) => {
      if (uid === hostUid) return false
      const candidateDef = db[state.cards[uid].defId]
      return candidateDef.type === 'unit' && candidateDef.cost <= 9
    })
    const chosen = pick(state, candidates)
    if (chosen !== undefined) {
      p.trash = p.trash.filter((uid) => uid !== chosen)
      const card = state.cards[chosen]
      card.ready = true
      card.lag = true
      card.playedThisTurn = true // docs/rulings.md §106 fix round 2
      p.field.push(chosen)
      state.events.push({ type: 'cardPlayed', player: ctx.player, uid: chosen })
      fireTriggerOnDraft(db, state, 'onPlay', chosen, [])
    }
    if (p.trash.includes(hostUid)) {
      p.trash = p.trash.filter((uid) => uid !== hostUid)
      p.deck.push(hostUid)
      state.events.push({ type: 'cardBottomDecked', uid: hostUid })
    }
    return state
  },

  /**
   * `viktor-vektor-sit-down-and-relax` — "{Call} Search the top 5 cards of
   * your deck. Reveal up to 2 Gears with cost 2 or less and add them to your
   * hand. Bottom-deck the rest in a random order." Every qualifying Gear is
   * worth taking (§50's convention), capped at the printed 2; if more than 2
   * qualify, which 2 is picked through the rng — nothing distinguishes them
   * and {Call} carries no player-facing target (docs/rulings.md §32/§45).
   * "In a random order" is the one place this batch needs an explicit
   * shuffle rather than "as encountered" (docs/rulings.md §81 ff.).
   */
  'viktor-vektor-sit-down-and-relax': (db, state, ctx) => {
    const p = state.players[ctx.player]
    const top: number[] = []
    for (let i = 0; i < 5; i++) {
      const uid = p.deck.shift()
      if (uid === undefined) break
      top.push(uid)
    }
    const qualifying = top.filter((uid) => {
      const def = db[state.cards[uid].defId]
      return def.type === 'gear' && def.cost <= 2
    })
    const taken: number[] = []
    const pool = [...qualifying]
    while (taken.length < 2 && pool.length > 0) {
      const [index, rng] = nextInt(state.rng, pool.length)
      state.rng = rng
      taken.push(...pool.splice(index, 1))
    }
    const rest = top.filter((uid) => !taken.includes(uid))
    const [shuffled, rng2] = shuffle(state.rng, rest)
    state.rng = rng2
    for (const uid of taken) p.hand.push(uid)
    for (const uid of shuffled) p.deck.push(uid)
    return state
  },

  /**
   * `river-ward-detective-on-the-hunt:free-gear` — "{Quick} {Spend} Play a
   * Gear with cost 2 or less from your hand for free." Both "which Gear" and
   * "which host" are real, enumerated decisions declared as this scripted
   * node's own `targets` (docs/rulings.md §81 ff.) — this activated ability
   * fires from an action that already carries a committed `targets` array
   * (docs/rulings.md §34/§73), unlike the several onDefeat/onCall scripts
   * above.
   */
  'river-ward-detective-on-the-hunt:free-gear': (db, state, ctx) => {
    const [gear, host] = ctx.targets
    if (gear === undefined || host === undefined) return state
    const p = state.players[ctx.player]
    if (!p.hand.includes(gear)) return state
    p.hand = p.hand.filter((uid) => uid !== gear)
    state.cards[host].attachedGear.push(gear)
    state.events.push({ type: 'cardPlayed', player: ctx.player, uid: gear })
    fireTriggerOnDraft(db, state, 'onPlay', gear, [])
    return state
  },

  /**
   * `river-ward-detective-on-the-hunt:defeat-search` — "When a friendly
   * equipped Unit is defeated, search the top 2 cards of your deck and trash
   * 1." No filter narrows which of the 2 is trashed, so it is picked through
   * the rng (this fires from `onUnitDefeated`, which carries no action-level
   * target, docs/rulings.md §32); the other card returns to the TOP of the
   * deck, following the sibling card `tetratronic-rippler`'s explicit
   * "(Otherwise, keep it on the top of your deck.)" clarification for the
   * same "search the top N, act on some of them" shape (docs/rulings.md §81
   * ff.).
   */
  'river-ward-detective-on-the-hunt:defeat-search': (_db, state, ctx) => {
    const p = state.players[ctx.player]
    const top: number[] = []
    for (let i = 0; i < 2; i++) {
      const uid = p.deck.shift()
      if (uid === undefined) break
      top.push(uid)
    }
    const chosen = pick(state, top)
    if (chosen === undefined) return state
    p.trash.push(chosen)
    state.events.push({ type: 'cardTrashed', uid: chosen })
    for (const uid of top) {
      if (uid !== chosen) p.deck.unshift(uid)
    }
    return state
  },

  /**
   * `viktor-vektor-you-might-feel-a-little-pinch` — "{Play} Play a CYBERWARE
   * Gear with cost 2 or less from your trash for free. Equip it only to
   * another friendly Unit." Both "which Gear" (from trash, filtered) and
   * "which host" (another friendly Unit, `excludeSelf`) are declared as this
   * scripted node's own `targets`, real decisions an `onPlay` action already
   * carries (docs/rulings.md §81 ff.).
   */
  'viktor-vektor-you-might-feel-a-little-pinch': (db, state, ctx) => {
    const [gear, host] = ctx.targets
    if (gear === undefined || host === undefined) return state
    const p = state.players[ctx.player]
    if (!p.trash.includes(gear)) return state
    p.trash = p.trash.filter((uid) => uid !== gear)
    state.cards[host].attachedGear.push(gear)
    state.events.push({ type: 'cardPlayed', player: ctx.player, uid: gear })
    fireTriggerOnDraft(db, state, 'onPlay', gear, [])
    return state
  },

  // -------------------------------------------------------------------------
  // Task 8 batch 5 (Green) — docs/rulings.md §92 ff.
  // -------------------------------------------------------------------------

  /**
   * `don-t-fear-the-reaper` — "Spend all rival Units. Then, defeat a spent
   * Unit." A mass, unconditional spend with no per-target decision (the same
   * shape as `adam-smasher-metal-over-meat`'s mass defeat, docs/rulings.md
   * §68 ff., but a different verb/scope), followed by "a spent Unit" — bare,
   * either side, and only meaningfully choosable once the mass-spend above
   * has actually happened (a fresh rival Unit only becomes "spent" mid-
   * resolution). Per docs/rulings.md §57's residual note, splitting this into
   * two same-trigger `EffectDef`s would desync `legalActions`' enumerated
   * targets from what actually resolves, so both clauses are scripted
   * together; which spent Unit to defeat is picked through the rng, exactly
   * like `all-is-lost`'s "candidates only exist mid-resolution" case
   * (docs/rulings.md §48).
   */
  'don-t-fear-the-reaper': (db, state, ctx) => {
    const rival = opponentOf(ctx.player)
    spendOnDraft(db, state, [...state.players[rival].field])
    const spentUnits = [0, 1]
      .flatMap((player) => state.players[player as PlayerId].field)
      .filter((uid) => !state.cards[uid].ready)
    const target = pick(state, spentUnits)
    if (target !== undefined) defeatUnit(state, db, target)
    return state
  },

  /**
   * `overwatch-panam-s-gift` — "{Quick} 1 €$, {Spend} Discard 1. Defeat a
   * spent rival Unit with cost equal to or less than the discarded card's
   * cost." "Its cost" names a property of whichever card was just discarded,
   * the same "read a property of what a prior step touched" shape §73
   * already forced into a script for `heywood-ripperdoc`'s "its cost" — no
   * vocabulary node reads a target's numeric property into a later filter.
   * Which card to discard is a real, declared target (`friendlyHandCard`,
   * docs/rulings.md §73/§80's "a real decision when the firing action can
   * carry one"); which rival Unit to defeat afterward has no filtered
   * scripted-target support yet (docs/rulings.md §73), so it is picked
   * through the rng among the cards that qualify once the discard's cost is
   * known.
   */
  'overwatch-panam-s-gift': (db, state, ctx) => {
    const discarded = ctx.targets[0]
    if (discarded === undefined) return state
    const p = state.players[ctx.player]
    if (!p.hand.includes(discarded)) return state
    p.hand = p.hand.filter((uid) => uid !== discarded)
    p.trash.push(discarded)
    state.events.push({ type: 'cardTrashed', uid: discarded })
    const cost = db[state.cards[discarded].defId].cost
    const rival = opponentOf(ctx.player)
    const candidates = state.players[rival].field.filter(
      (uid) => !state.cards[uid].ready && db[state.cards[uid].defId].cost <= cost
    )
    const target = pick(state, candidates)
    if (target !== undefined) defeatUnit(state, db, target)
    return state
  },

  /**
   * `fool-on-the-hill` — "Reveal the top 2 cards of your deck. A Rival
   * chooses whether you add them to your hand or trash them. If you trash
   * them, draw 2." No other pool card shares this "reveal, RIVAL picks the
   * outcome" shape, and the two candidate cards only exist once revealed
   * mid-resolution (docs/rulings.md §48). The rival's choice is never the
   * controller's to enumerate (docs/rulings.md §45), so it is resolved off
   * the rng exactly like every other unenumerable rival decision. "Draw 2" on
   * the trash branch is unconditional (no "may"), so it is a genuine
   * required draw that can end the game on an empty deck (docs/rulings.md
   * §17/§36).
   */
  'fool-on-the-hill': (_db, state, ctx) => {
    const p = state.players[ctx.player]
    const revealed: number[] = []
    for (let i = 0; i < 2; i++) {
      const uid = p.deck.shift()
      if (uid === undefined) break
      revealed.push(uid)
    }
    if (revealed.length === 0) return state
    const [modeIndex, rng] = nextInt(state.rng, 2)
    state.rng = rng
    if (modeIndex === 0) {
      p.hand.push(...revealed)
    } else {
      for (const uid of revealed) {
        p.trash.push(uid)
        state.events.push({ type: 'cardTrashed', uid })
      }
      if (!drawCards(state, ctx.player, 2)) {
        endGame(state, opponentOf(ctx.player), 'deckout')
      }
    }
    return state
  },

  /**
   * `goro-takemura-vengeful-bodyguard` — "When a friendly Unit uses
   * {Blocker}, you may discard 1. If you do, draw 1." Fired from the new
   * `onFriendlyBlock` watcher trigger, which (like every watcher) carries no
   * player-supplied target — "which card to discard" is picked through the
   * rng (docs/rulings.md §32). "If you do" makes the draw depend on whether
   * the discard actually happened (an empty hand declines the "you may" by
   * having nothing to give up), the same target-slot-dependency shape §73
   * already forced into a script for `dum-dum-maelstrom-triggerman`/
   * `gilded-mato-n`'s "if you do, X".
   */
  'goro-takemura-vengeful-bodyguard': (_db, state, ctx) => {
    const p = state.players[ctx.player]
    const discarded = pick(state, p.hand)
    if (discarded === undefined) return state
    p.hand = p.hand.filter((uid) => uid !== discarded)
    p.trash.push(discarded)
    state.events.push({ type: 'cardTrashed', uid: discarded })
    if (!drawCards(state, ctx.player, 1)) {
      endGame(state, opponentOf(ctx.player), 'deckout')
    }
    return state
  },

  // -------------------------------------------------------------------------
  // Task 8 batch 6 (Green) — docs/rulings.md §107 ff.
  // -------------------------------------------------------------------------

  /**
   * `sandevistan` — "At the end of your turn, ready this Unit or Legend."
   * Printed on Gear, fired via the `onEndTurn` watcher; `'self'` on a Gear's
   * own EffectDef resolves to the GEAR's own uid (readying it is a no-op —
   * nothing ever reads a Gear card's own `ready` flag), so this reads the
   * host uid `fireWatcherTrigger` now threads through
   * `ctx.context.equipHostUid` instead (docs/rulings.md §107 ff.).
   */
  sandevistan: (_db, state, ctx) => {
    const hostUid = ctx.context?.equipHostUid
    if (hostUid === undefined || !state.cards[hostUid]) return state
    state.cards[hostUid].ready = true
    return state
  },

  /**
   * `panam-palmer-nomad-cavalry` — "2 €$, {Spend} Move a Gear from this
   * Legend to an unequipped friendly Unit. If you do, ready that Unit."
   * Both "which Gear" (`selfGear` — Gear attached to Panam herself only, not
   * any friendly Gear) and "which Unit" (`friendlyUnit`, filtered
   * `unequipped`) are real, declared target slots (docs/rulings.md §48) —
   * this activated ability's action already carries a committed `targets`
   * array. "If you do" is automatic here: both slots are real decisions, so
   * either they are both filled (the move — and the ready — happens) or the
   * whole activation was never legal/offered in the first place (no
   * partial-move case to gate on).
   */
  'panam-palmer-nomad-cavalry:move-gear': (_db, state, ctx) => {
    const [gear, host] = ctx.targets
    if (gear === undefined || host === undefined) return state
    const source = state.cards[ctx.sourceUid]
    if (!source.attachedGear.includes(gear)) return state
    source.attachedGear = source.attachedGear.filter((uid) => uid !== gear)
    state.cards[host].attachedGear.push(gear)
    state.cards[host].ready = true
    return state
  },

  /**
   * `panam-palmer-nomad-cavalry` — "At the end of your turn, if 5 or more
   * friendly Units and/or Legends are equipped, ready them." A mass,
   * unconditional (once the printed count gate is met) ready with no
   * per-target decision — the same shape as `adam-smasher-metal-over-meat`'s
   * mass defeat (docs/rulings.md §68 ff.), but readying every EQUIPPED
   * friendly Unit/Legend rather than every Unit.
   */
  'panam-palmer-nomad-cavalry:ready-equipped': (_db, state, ctx) => {
    const p = state.players[ctx.player]
    const equipped = [...p.field, ...p.legends.filter((uid) => state.cards[uid].faceUp)].filter(
      (uid) => state.cards[uid].attachedGear.length > 0
    )
    for (const uid of equipped) state.cards[uid].ready = true
    return state
  },

  /**
   * `panam-palmer-strength-through-family` — "{Attack} Discard 1. If you do,
   * draw 1 for each friendly face-up Legend." "Which card to discard" is a
   * real, declared target (`friendlyHandCard`, docs/rulings.md §73/§80's
   * convention); the dynamic draw amount depends on whether the discard
   * actually happened (an empty hand declines by having nothing to give
   * up), the same "if you do" target-dependency shape §102/§103 already
   * forced into a script.
   */
  'panam-palmer-strength-through-family': (_db, state, ctx) => {
    const discarded = ctx.targets[0]
    if (discarded === undefined) return state
    const p = state.players[ctx.player]
    if (!p.hand.includes(discarded)) return state
    p.hand = p.hand.filter((uid) => uid !== discarded)
    p.trash.push(discarded)
    state.events.push({ type: 'cardTrashed', uid: discarded })
    const count = p.legends.filter((uid) => state.cards[uid].faceUp).length
    if (count > 0 && !drawCards(state, ctx.player, count)) {
      endGame(state, opponentOf(ctx.player), 'deckout')
    }
    return state
  },

  /**
   * `pepe-najarro-working-doubles` — "{Attack} If you control a value-pair
   * of Gigs, ready up to 2 MERC Legends in your Legends area." No printed
   * criterion distinguishes *which* 2 when more than 2 face-up MERC Legends
   * are in play, so this is `pickN`'s "act on all if ≤N, else N at random"
   * convention (docs/rulings.md §107 ff.).
   */
  'pepe-najarro-working-doubles': (db, state, ctx) => {
    const p = state.players[ctx.player]
    const eligible = p.legends.filter(
      (uid) => state.cards[uid].faceUp && hasKeyword(db, state, uid, 'merc')
    )
    for (const uid of pickN(state, eligible, 2)) state.cards[uid].ready = true
    return state
  },

  /**
   * `saul-bright-stormrider` — "At the end of your turn, ready up to 3
   * friendly Units." Same "act on all if ≤N, else N at random" convention as
   * `pepe-najarro-working-doubles` above (docs/rulings.md §107 ff.).
   */
  'saul-bright-stormrider': (_db, state, ctx) => {
    const p = state.players[ctx.player]
    for (const uid of pickN(state, p.field, 3)) state.cards[uid].ready = true
    return state
  },

  /**
   * `sandayu-oda-hanako-s-guardian` — "{Play} Spend a rival Unit for each
   * friendly value-pair of Gigs." A dynamic, mass spend with no per-target
   * decision beyond "which N of the rival's field" when the rival controls
   * more Units than the value-pair count owes — the same "act on all if
   * ≤N, else N at random" convention (docs/rulings.md §107 ff.).
   */
  'sandayu-oda-hanako-s-guardian': (db, state, ctx) => {
    const pairs = valuePairCount(state, ctx.player)
    if (pairs <= 0) return state
    const rival = opponentOf(ctx.player)
    const targets = pickN(state, state.players[rival].field, pairs)
    if (targets.length > 0) spendOnDraft(db, state, targets)
    return state
  },

  /**
   * `take-control` — "{Quick} A rival Unit steals 1 fewer Gig this turn. If
   * that Unit is an AI, DRONE, or VEHICLE, draw 1." "Which rival Unit" is a
   * real, declared target (`rivalUnit`); the bonus draw reads a property
   * (its own tags) of that SAME chosen Unit, the same "read a property of
   * what a prior step touched" shape §73 already forced into a script for
   * `heywood-ripperdoc`'s "its cost".
   */
  'take-control': (db, state, ctx) => {
    const target = ctx.targets[0]
    if (target === undefined) return state
    const card = state.cards[target]
    card.stealReduction = (card.stealReduction ?? 0) + 1
    const tags = cardTags(db[card.defId])
    if (['ai', 'drone', 'vehicle'].some((keyword) => tags.includes(keyword))) {
      if (!drawCards(state, ctx.player, 1)) {
        endGame(state, opponentOf(ctx.player), 'deckout')
      }
    }
    return state
  },

  /**
   * `wraith-marauders` — "When this Unit steals a Gig, ready another
   * friendly Unit with power equal to the Gig's value." Fired from
   * `onFriendlyStealDie` (gated `condition.selfIsStealer`), which — like
   * every non-`onPlay` trigger — carries no action-level target
   * (docs/rulings.md §32); "power equal to the Gig's value" also names a
   * fact only the firing context knows (`ctx.context.stolenDieValue`), which
   * the ordinary `TargetFilter` vocabulary has no way to read, so both the
   * candidate search and the pick (when more than one qualifies) stay here
   * rather than becoming a declared target slot.
   */
  'wraith-marauders': (db, state, ctx) => {
    const stolenValue = ctx.context?.stolenDieValue
    if (stolenValue === undefined) return state
    const candidates = state.players[ctx.player].field.filter(
      (uid) => uid !== ctx.sourceUid && effectivePower(db, state, uid) === stolenValue
    )
    const target = pick(state, candidates)
    if (target !== undefined) state.cards[target].ready = true
    return state
  },
}
