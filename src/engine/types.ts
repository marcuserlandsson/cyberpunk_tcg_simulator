// Core engine types for the Cyberpunk TCG simulator.
// These are the exact shapes later tasks (AI, sim, UI) depend on — do not
// rename fields without updating every consumer.

import type { RngState } from './rng'

// ---------------------------------------------------------------------------
// Dice
// ---------------------------------------------------------------------------

export type PlayerId = 0 | 1
export type DieSize = 4 | 6 | 8 | 10 | 12 | 20
export interface GigDie {
  size: DieSize
  value: number // value 0 = unrolled (in fixer)
}

// ---------------------------------------------------------------------------
// Effect system (Task 7 introduces the full vocabulary; the shapes below are
// defined here so CardDef.effects and the cardDb zod schema can compile now)
// ---------------------------------------------------------------------------

/**
 * When an EffectDef fires. The four printed timing words ({Play}, {Call},
 * {Attack}, {Defeated}) plus the ones Task 8's card texts forced:
 *   * `onBlock`  — "When this Unit uses {Blocker}" (docs/rulings.md §41);
 *   * `onWinFight` — "when this Unit wins a fight" (docs/rulings.md §41);
 *   * `onSpend`  — "When this Unit or Legend is spent" (docs/rulings.md §47);
 *   * `onFriendlyStealDie` — the one *watcher* trigger: "When a friendly Unit
 *     steals a d6, ..." fires on every in-play card of the thief, not on the
 *     card that stole (docs/rulings.md §42).
 */
export type Trigger =
  | 'onPlay'
  | 'onCall'
  | 'onAttack'
  | 'onDefeat'
  | 'onBlock'
  | 'onWinFight'
  | 'onSpend'
  | 'onFriendlyStealDie'
  // Batch 2 (docs/rulings.md §55-§6x) — four more watcher-shaped triggers:
  //   * onFriendlyAttack — "the first time a friendly ARASAKA Unit attacks
  //     each turn" — fires on every in-play card of the ATTACKER'S owner,
  //     whenever any friendly Unit attacks;
  //   * onUnitDefeated — "the first time an ARASAKA Unit is defeated each
  //     turn" — bare, so it fires GLOBALLY (every in-play card of BOTH
  //     players), whichever side the defeated Unit belonged to;
  //   * onRivalAdjustFriendlyGig — "When a Rival adjusts ... friendly Gigs" —
  //     fires on the AFFECTED player's in-play cards when a `changeGig` node
  //     run by the other player touches one of their dice;
  //   * onEndTurn — "At the end of your turn, ..." — fires on every in-play
  //     card of the player whose turn is ending.
  | 'onFriendlyAttack'
  | 'onUnitDefeated'
  | 'onRivalAdjustFriendlyGig'
  | 'onEndTurn'
  // Batch 3 (docs/rulings.md §68 ff.): "When a friendly EQUIPPED Unit or
  // Legend is spent, ..." — a watcher, broadcast to every in-play card of the
  // SPENT card's own controller whenever a card meeting that description (in
  // play, type Unit/Legend, attachedGear.length > 0) is spent, from the same
  // `spendOnDraft` seam that already fires the self-referential `onSpend`.
  | 'onFriendlyEquippedSpend'
  | 'activated'
  | 'static'

/**
 * What a target slot admits. Card specs bind a **card uid**; the Gig-die specs
 * bind an **index into a `gigArea`** instead — a Gig die is not a card, but
 * "increase a Gig by up to 4" is as much a player decision as picking a Unit,
 * so it goes through the same slot machinery (docs/rulings.md §39).
 *
 * `anyGigDie` (bare "a Gig" on the card) indexes the controller's Gig area
 * followed by the rival's, as one list. `chosen` is not a decision at all: it
 * reads the uid the enclosing `sameTarget` bound (docs/rulings.md §53).
 */
export type TargetSpec =
  | 'self'
  | 'chosen'
  | 'friendlyUnit'
  | 'rivalUnit'
  | 'rivalSpentUnit'
  | 'anyUnit'
  | 'friendlyUnitOrLegend'
  | 'friendlyGigDie'
  | 'rivalGigDie'
  | 'anyGigDie'
  // Batch 2 (docs/rulings.md §55-§6x): zones no earlier card needed to reach.
  | 'friendlyTrashCard'
  | 'friendlyHandCard'
  | 'friendlyHandOrTrashUnit'
  // Batch 3 fix round 1 (docs/rulings.md §73/§80): "a friendly Gear" / bare
  // "a Gear" — every Gear card attached anywhere on the controller's side
  // (`friendlyGear`), or on either side, controller's first (`anyGear`,
  // §39's bare convention). A real, enumerable decision — "which Gear" is
  // never left to the rng when the firing action can carry a target.
  | 'friendlyGear'
  | 'anyGear'

/** The three Gig-die scopes a card's text can name (docs/rulings.md §39). */
export type GigDieSpec = 'friendlyGigDie' | 'rivalGigDie' | 'anyGigDie'

/**
 * Narrows a card target spec to the cards a printed line actually allows:
 * "a rival Unit with power 4 or less" (`maxPower`), "a CORPO Unit"
 * (`keyword`), "*another* friendly Unit" (`excludeSelf`), "a rival Unit with
 * less power than a friendly Unit" (`weakerThanAFriendlyUnit`).
 */
export interface TargetFilter {
  maxPower?: number
  minPower?: number
  keyword?: string
  excludeSelf?: boolean
  weakerThanAFriendlyUnit?: boolean
  /** "a Unit" restricted to CardDef.type (docs/rulings.md §55 ff.). */
  cardType?: CardType
  /** "with cost 4 or less" (yorinobu-arasaka-steel-dragon). */
  maxCost?: number
  /**
   * "power 2 or less ... power 3 or less INSTEAD" (royce-don-t-call-me-simon):
   * the alternate `maxPower` used when the controller has more Street Cred
   * than the rival, replacing `maxPower` rather than adding to it.
   */
  maxPowerIfAheadOnStreetCred?: number
  /** "power equal to or less than the value of a friendly d20" (over-the-edge). */
  maxPowerVsFriendlyD20?: boolean
}

/**
 * "-1 €$ for each friendly Gig with 8+ value, to a minimum of 1 €$" — the
 * pool's one cost-reduction shape, used both as a `static` node (a card's own
 * play cost) and inside an activated ability's `cost` (docs/rulings.md §44).
 */
export interface CostReduction {
  per: 'friendlyGigValueAtLeast'
  value: number
  amount: number
  minimum: number
}

/**
 * A power amount read off the board instead of printed on the card.
 * `{ perEquippedGear: N }` is "+N power for each of its equipped Gear"
 * (royce-psycho-on-the-edge, docs/rulings.md §55 ff.) — N times the subject
 * card's own `attachedGear.length`.
 */
export type DynamicAmount =
  | 'friendlyMaxGig'
  | { perEquippedGear: number }
  // "+2 power for each friendly Gig with an even value" / "Draw 1 for each
  // friendly Gig with an odd value" (jackie-welles-ride-or-die-choom,
  // docs/rulings.md §68 ff.) — `amount` times the count of the controller's
  // own Gig dice matching `parity`.
  | { perFriendlyGigParity: { parity: 'even' | 'odd'; amount: number } }

export type EffectNode =
  // "Draw 1 for each friendly Gig with an odd value" needs a board-read count
  // too, not just a printed one (docs/rulings.md §68 ff.).
  | { kind: 'draw'; count: number | DynamicAmount }
  | { kind: 'discardRandomRival'; count: number }
  | {
      kind: 'buffPower'
      amount: number | DynamicAmount
      target: TargetSpec
      filter?: TargetFilter
      duration: 'turn' | 'permanent'
    }
  | { kind: 'staticPower'; amount: number | DynamicAmount }
  | { kind: 'defeat'; target: TargetSpec; filter?: TargetFilter }
  | { kind: 'bounce'; target: TargetSpec; filter?: TargetFilter }
  | { kind: 'readyCard'; target: TargetSpec; filter?: TargetFilter }
  | { kind: 'spendCard'; target: TargetSpec; filter?: TargetFilter }
  // `distinctValueOnly`: "steal a rival Gig with a value not shared by a
  // friendly Gig" (gorilla-arms, docs/rulings.md §68 ff.) — narrows which die
  // `chooseGig` offers for this steal to ones whose value the thief does not
  // already hold, falling back to every die if none qualifies (never
  // deadlocking `chooseGig`, mirroring §25).
  | { kind: 'stealGig'; count: number; distinctValueOnly?: boolean }
  | { kind: 'returnGig'; count: number }
  | { kind: 'rerollGig'; whose: 'friendly' | 'rival' }
  | { kind: 'trashFromDeck'; whose: 'friendly' | 'rival'; count: number }
  | { kind: 'bottomDeck'; target: TargetSpec; filter?: TargetFilter }
  | { kind: 'gainEddieFromTopDeck'; count: number }
  | { kind: 'sequence'; effects: EffectNode[] }
  | { kind: 'scripted'; name: string; targets?: TargetSpec[] }
  // Static restriction: "This Unit can't attack" (e.g. corpo-security,
  // misty-olszewski-...). Only meaningful with `trigger: 'static'`.
  | { kind: 'cantAttack' }
  // "Increase/decrease a Gig by up to N": moves one Gig die's top face by
  // `amount` (negative decreases), clamped to [1, die size]
  // (docs/rulings.md §39). With `adjust: true` ("Adjust a Gig by up to N") the
  // sign *and* the magnitude are the player's decision, enumerated as a slot.
  | { kind: 'changeGig'; amount: number; target: GigDieSpec; adjust?: boolean }
  // "Give a friendly Unit these effects": one target slot, shared by every
  // child that names `target: 'chosen'` (docs/rulings.md §53).
  | {
      kind: 'sameTarget'
      target: TargetSpec
      filter?: TargetFilter
      effects: EffectNode[]
    }
  // "Give a friendly Unit {adrenaline} this turn" and friends — an
  // until-end-of-turn keyword grant (docs/rulings.md §43).
  | {
      kind: 'grantKeyword'
      keyword: string
      target: TargetSpec
      filter?: TargetFilter
      duration: 'turn'
    }
  // "Choose one effect. A // B" — the mode is a slot like any other target
  // (docs/rulings.md §45). `chooser`:
  //   * 'controller' (default) — the acting player picks one mode;
  //   * 'rivalIfBehindStreetCred' — the rival picks one while the controller is
  //     behind on ☆, so the mode is not enumerated;
  //   * 'allUnlessBehindStreetCred' — **every** mode resolves, unless the
  //     controller is behind on ☆, in which case the rival picks exactly one
  //     ("Give a friendly Unit these effects. If you have less ☆ than a Rival,
  //     they instead choose one effect for you." — gunpoint-diplomacy).
  | {
      kind: 'chooseOne'
      modes: EffectNode[]
      chooser?: 'controller' | 'rivalIfBehindStreetCred' | 'allUnlessBehindStreetCred'
    }
  // Static, printed on Gear: "If this Unit would be defeated, defeat its
  // <gear> instead" (docs/rulings.md §46).
  | { kind: 'defeatShield' }
  // Static: "This Unit wins all fights against CORPO Units."
  | { kind: 'winsFightVsKeyword'; keyword: string }
  // Static: this card's own play cost is reduced (docs/rulings.md §44).
  | { kind: 'costReduction'; reduction: CostReduction }
  // Batch 2 additions (docs/rulings.md §55 ff.):
  // Static: "+N power while fighting a [cardType]" (meredith-stout). Only
  // consulted by combat.ts's `fight()`, never by the generic `effectivePower`
  // (there is no "current foe" outside a fight).
  | { kind: 'powerVsCardType'; cardType: CardType; amount: number }
  // "Add a card from your trash to your hand" / "...another Unit..." /
  // "...1 BRAINDANCE Program...": moves a trash-zone card to hand.
  | { kind: 'retrieveFromTrash'; target: TargetSpec; filter?: TargetFilter }
  // "Then, ... discard 1": moves a hand-zone card to the trash. Unlike
  // `discardRandomRival` (forced, on the RIVAL, at random) this is the
  // controller discarding their OWN hand, so it goes through the ordinary
  // target-slot machinery — a real decision whenever the firing action can
  // carry one, an rng fallback otherwise (docs/rulings.md §32/§55).
  | { kind: 'discardCard'; target: TargetSpec; filter?: TargetFilter }
  // Static: "this Unit can attack ready Units with {Blocker}" — widens
  // `attackTargets` to ready Units carrying `keyword`, narrower than the
  // granted-only `attack-ready` keyword which allows ANY ready Unit
  // (docs/rulings.md §43 vs §55).
  | { kind: 'attackReadyWithKeyword'; keyword: string }
  // Static: "This Unit can only attack rival Units. (It can't attack Gig
  // areas.)" — the mirror image of §24's engine-level Gig-area omission, but
  // printed on one specific card rather than universal.
  | { kind: 'cantAttackGigArea' }
  // Batch 3 addition (docs/rulings.md §68 ff.): a CONDITIONAL keyword grant,
  // live only while this def's own `condition` holds — unlike a card's
  // printed `keywords` (always active) and unlike `grantKeyword` (a one-shot,
  // until-end-of-turn grant fired from a trigger's resolution). Masks the
  // matching entry in the card's/Gear's own printed `keywords` so the gate is
  // the sole authority ("If a Rival controls at least 2 more Gigs than you,
  // this Unit has {Adrenaline}." — adrenaline-converter).
  | { kind: 'grantKeywordWhile'; keyword: string }

export interface EffectDef {
  trigger: Trigger
  cost?: { selfSpend?: boolean; eddies?: number; reduction?: CostReduction }
  condition?: {
    streetCredAtLeast?: number
    /** "If you control a Gig with 8+ value" */
    friendlyGigValueAtLeast?: number
    /** "if a Rival controls at least 2 Gigs more than you" */
    rivalGigLeadAtLeast?: number
    /** Watcher triggers only: the size of the Gig die that was just stolen. */
    stolenDieSize?: DieSize
    // Batch 2 additions (docs/rulings.md §55 ff.):
    /** "If you have more ☆ (Street Cred) than a Rival" — strictly greater. */
    streetCredAheadOfRival?: boolean
    /** "if you have less than N ☆ (Street Cred)" — strictly less. */
    streetCredBelow?: number
    /** "During your turn, ..." — only while the controller is the active player. */
    duringOwnTurn?: boolean
    /** `onAttack` only: "if this Unit has power N+" — the attacker's own power. */
    sourcePowerAtLeast?: number
    /** `onFriendlyStealDie` only: "When THIS Unit steals a Gig" (not any friendly Unit). */
    selfIsStealer?: boolean
    /** `onFriendlyAttack` only: the attacking Unit's own faction/keyword tag. */
    attackerKeyword?: string
    /** `onUnitDefeated` only: the defeated Unit's own faction/keyword tag. */
    defeatedKeyword?: string
    /** "if you control 2 or more Gigs with 8+ value" */
    friendlyGigsAtLeastValueCount?: { value: number; count: number }
    // Batch 3 additions (docs/rulings.md §68 ff.):
    /** "if you control 2 or more Gigs with different values" (afterparty-at-lizzie-s). */
    friendlyGigDistinctValuesAtLeast?: number
    /** "if you control a Gig with an even value and a Gig with an odd value" (bootleg-black-sapphire-show). */
    friendlyGigEvenAndOdd?: boolean
    /** "if [a fixed number, e.g. this card's own cost] equals the value of a friendly Gig" (caliber-totentanz-s-top-dog). */
    friendlyGigValueEquals?: number
    /** "if your ☆ (Street Cred) differs from a Rival's by N+" — |own - rival| >= N (dexter-deshawn-one-last-chance). */
    streetCredDiffAtLeast?: number
    /** "if it's equipped" — does the SOURCE card itself carry ≥1 attached Gear (maelstrom-goons). */
    sourceEquipped?: boolean
  }
  quick?: boolean
  /** "The first time ... each turn" — one firing per game turn, per source. */
  oncePerTurn?: boolean
  /**
   * Groups this `oncePerTurn` def with every other def on the same card
   * (same `sourceUid`) carrying the identical string, into ONE shared
   * allowance for a single compound printed sentence spanning several defs
   * (docs/rulings.md §67 — "The first time a friendly ARASAKA Unit attacks
   * each turn, draw 1. Then, if you have less than 20 ☆, discard 1." is one
   * event, not two independently-gated ones). The first def in the group
   * whose OWN `condition` is met "evaluates the group": every def sharing the
   * key is marked used from that moment, whether or not each one's own
   * (possibly narrower) condition also held — so a later qualifying event
   * this turn cannot re-open a clause the group already decided.
   */
  onceKey?: string
  effect: EffectNode
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export type CardType = 'legend' | 'unit' | 'program' | 'gear'

// 'adrenaline' = can-attack-turn-played (formerly planned as 'rush');
// 'go-solo' = legend playable as a ready unit (formerly planned as 'merc');
// role/classification tags ('merc', 'corpo', 'ganger', 'netrunner', ...) are
// inert strings that also live in `keywords` — see docs/rulings.md.
export type Keyword = 'adrenaline' | 'quick' | 'blocker' | 'go-solo' | string

export interface CardDef {
  id: string
  name: string
  subtitle?: string
  color: string
  faction?: string
  type: CardType
  cost: number
  power: number | null
  ram: { color: string; value: number } | null // null for legends
  ramLimit: { color: string; value: number } | null // legends only
  sellTag: boolean
  keywords: Keyword[]
  text: string
  effects: EffectDef[]
  scripted?: string
}

export type CardDb = Record<string, CardDef>

export interface CardInstance {
  uid: number
  defId: string
  owner: PlayerId
  ready: boolean
  lag: boolean
  faceUp: boolean // faceUp for legends/eddies; true otherwise
  attachedGear: number[]
  // Until-end-of-turn power delta. Cleared for EVERY card of BOTH players when
  // the game turn ends (docs/rulings.md §20), not at the owner's next turn.
  tempPower: number
  // Power delta that outlives the turn (`buffPower` with duration
  // 'permanent'). Both deltas are wiped when the card leaves the field.
  permPower: number
  // Keywords granted until the end of the game turn (`grantKeyword`), cleared
  // alongside `tempPower` and wiped on a field exit (docs/rulings.md §43).
  tempKeywords: Keyword[]
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

export interface PlayerState {
  deck: number[]
  hand: number[]
  field: number[]
  legends: number[] // order preserved, index 0 = leftmost
  eddies: number[]
  trash: number[]
  // Removed from the game: a {go-solo} Legend that left the field goes here
  // instead of the trash and can never come back (docs/rulings.md §31).
  removed: number[]
  gigArea: GigDie[]
  fixer: GigDie[]
  soldThisTurn: boolean
  calledLegendThisTurn: boolean
  mulliganDone: boolean
}

export type Phase = 'chooseOrder' | 'mulligan' | 'start' | 'main' | 'react' | 'chooseGig' | 'gameOver'

/**
 * An unresolved Gig steal: the thief picks one die at a time (`chooseGig`).
 *
 * `thief`/`resumePhase` are set only by *effect*-driven steals (a `stealGig`
 * EffectNode, docs/rulings.md §32); an attack-driven steal leaves them
 * undefined, which means "the active player, and close the attack when the last
 * die is taken". `queue` holds the steals waiting behind this one, oldest
 * first — two casualties of one tied fight can each owe their own controller a
 * choice, and neither may be dropped.
 */
export interface PendingSteal {
  attacker: number
  remaining: number
  thief?: PlayerId
  resumePhase?: Phase
  queue?: PendingSteal[]
  /**
   * "steal a rival Gig with a value not shared by a friendly Gig"
   * (gorilla-arms, docs/rulings.md §68 ff.): narrows `chooseGig`'s offered
   * dice to ones whose value the thief does not already hold. Applies to the
   * whole steal for as long as it is set — a documented simplification when a
   * filtered bonus steal merges into an already-larger, unfiltered one.
   */
  distinctValueOnly?: boolean
}

export interface GameState {
  players: [PlayerState, PlayerState]
  cards: Record<number, CardInstance>
  nextUid: number
  turnNumber: number // increments when player 'first' begins a turn; each player's Nth turn
  activePlayer: PlayerId
  firstPlayer: PlayerId
  phase: Phase
  pendingAttack: { attacker: number; target: number | 'gigArea'; redirectedTo?: number } | null
  pendingSteal: PendingSteal | null
  /**
   * Keys (`"<uid>:<effectIndex>"`) of the `oncePerTurn` EffectDefs that have
   * already fired during this game turn — "the first time ... each turn"
   * (docs/rulings.md §40). Cleared with the turn buffs when the turn ends.
   */
  oncePerTurnUsed: string[]
  winner: PlayerId | null
  rng: RngState
  events: GameEvent[]
}

// ---------------------------------------------------------------------------
// Actions & reactions
// ---------------------------------------------------------------------------

export type Action =
  | { type: 'choosePlayOrder'; goFirst: boolean }
  | { type: 'mulligan' }
  | { type: 'keepHand' }
  | { type: 'chooseGigDie'; size: DieSize }
  | { type: 'sellCard'; card: number }
  | { type: 'playCard'; card: number; payment: number[]; targets: number[] }
  | { type: 'callLegend'; payment: number[] }
  | { type: 'activateAbility'; card: number; abilityIndex: number; targets: number[] }
  // `payOptionalCosts` answers a "{Attack} You may pay N €$" trigger: omitted
  // (or false) declines, true pays. `legalActions` offers both variants only
  // when the attacker actually has such a trigger and can afford it
  // (docs/rulings.md §49).
  | {
      type: 'attack'
      attacker: number
      target: number | 'gigArea'
      payOptionalCosts?: boolean
    }
  | { type: 'chooseGig'; dieIndex: number }
  | { type: 'react'; reaction: Reaction }
  | { type: 'endTurn' }

export type Reaction =
  | { type: 'pass' }
  | { type: 'block'; blocker: number }
  | { type: 'callLegend'; payment: number[] }
  | { type: 'quick'; card: number; payment: number[]; targets: number[] }
  | { type: 'quickAbility'; card: number; abilityIndex: number; targets: number[] }

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type GameEvent =
  | { type: 'gameStarted'; seed: number; orderRolls: [number, number] }
  | { type: 'playOrderChosen'; first: PlayerId }
  | { type: 'mulliganTaken'; player: PlayerId }
  | { type: 'handKept'; player: PlayerId }
  | { type: 'turnStarted'; player: PlayerId; turn: number }
  | { type: 'cardDrawn'; player: PlayerId; uid: number }
  | { type: 'dieRolled'; player: PlayerId; size: DieSize; value: number }
  | { type: 'cardSold'; player: PlayerId; uid: number }
  | { type: 'cardPlayed'; player: PlayerId; uid: number }
  | { type: 'legendCalled'; player: PlayerId; uid: number }
  | { type: 'attackDeclared'; attacker: number; target: number | 'gigArea' }
  | { type: 'attackBlocked'; blocker: number }
  | { type: 'unitDefeated'; uid: number }
  | { type: 'gigStolen'; from: PlayerId; die: GigDie }
  | { type: 'effectResolved'; sourceUid: number; description: string }
  | { type: 'cardTrashed'; uid: number }
  | { type: 'cardBottomDecked'; uid: number }
  | { type: 'cardRemoved'; uid: number }
  | { type: 'abilityActivated'; player: PlayerId; uid: number; abilityIndex: number }
  | { type: 'turnEnded'; player: PlayerId }
  | { type: 'gameEnded'; winner: PlayerId; reason: 'sevenGigs' | 'overtimeMajority' | 'deckout' | 'concede' }
