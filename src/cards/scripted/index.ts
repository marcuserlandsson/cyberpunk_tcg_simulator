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
import { hasKeyword, opponentOf } from '../../engine/query'
import { nextInt } from '../../engine/rng'
import type { CardDb, GameState, PlayerId } from '../../engine/types'
import { fireTriggerOnDraft, type EffectCtx } from '../effects'

export type ScriptedCard = (db: CardDb, state: GameState, ctx: EffectCtx) => GameState

/** Picks one element through the seeded rng, advancing it on the draft. */
function pick<T>(state: GameState, items: T[]): T | undefined {
  if (items.length === 0) return undefined
  const [index, rng] = nextInt(state.rng, items.length)
  state.rng = rng
  return items[index]
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
   * the pool is auto-taken); which Gear and which rival Unit are picked
   * through the rng, like any other script-internal choice the action space
   * cannot enumerate (docs/rulings.md §48).
   */
  'gilded-mato-n': (db, state, ctx) => {
    const gear = pick(state, friendlyGearUids(state, ctx.player))
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
   * at all (the flip that triggers it is random, docs/rulings.md §32), so the
   * "may" is auto-taken whenever a friendly Gear exists (docs/rulings.md
   * §50), with the Gear itself picked through the rng; the doubled draw
   * follows automatically from whether that pick found anything.
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
   * (docs/rulings.md §39's bare convention), and "its cost" names a property
   * of the specific Gear that was defeated, which only the script can carry
   * forward (docs/rulings.md §48).
   */
  'heywood-ripperdoc': (db, state, ctx) => {
    const gearUids = [0, 1].flatMap((player) => friendlyGearUids(state, player as PlayerId))
    const gear = pick(state, gearUids)
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
}
