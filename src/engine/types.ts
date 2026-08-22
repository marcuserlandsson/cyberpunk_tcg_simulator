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
  | 'activated'
  | 'static'

/**
 * What a target slot admits. Card specs bind a **card uid**; the two Gig-die
 * specs bind an **index into that player's `gigArea`** instead — a Gig die is
 * not a card, but "increase a Gig by up to 4" is as much a player decision as
 * picking a Unit, so it goes through the same slot machinery
 * (docs/rulings.md §39).
 */
export type TargetSpec =
  | 'self'
  | 'friendlyUnit'
  | 'rivalUnit'
  | 'rivalSpentUnit'
  | 'anyUnit'
  | 'friendlyUnitOrLegend'
  | 'friendlyGigDie'
  | 'rivalGigDie'

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

/** A power amount read off the board instead of printed on the card. */
export type DynamicAmount = 'friendlyMaxGig'

export type EffectNode =
  | { kind: 'draw'; count: number }
  | { kind: 'discardRandomRival'; count: number }
  | {
      kind: 'buffPower'
      amount: number | DynamicAmount
      target: TargetSpec
      filter?: TargetFilter
      duration: 'turn' | 'permanent'
    }
  | { kind: 'staticPower'; amount: number }
  | { kind: 'defeat'; target: TargetSpec; filter?: TargetFilter }
  | { kind: 'bounce'; target: TargetSpec; filter?: TargetFilter }
  | { kind: 'readyCard'; target: TargetSpec; filter?: TargetFilter }
  | { kind: 'spendCard'; target: TargetSpec; filter?: TargetFilter }
  | { kind: 'stealGig'; count: number }
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
  // (docs/rulings.md §39).
  | { kind: 'changeGig'; amount: number; target: 'friendlyGigDie' | 'rivalGigDie' }
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
  // (docs/rulings.md §45).
  | {
      kind: 'chooseOne'
      modes: EffectNode[]
      chooser?: 'controller' | 'rivalIfBehindStreetCred'
    }
  // Static, printed on Gear: "If this Unit would be defeated, defeat its
  // <gear> instead" (docs/rulings.md §46).
  | { kind: 'defeatShield' }
  // Static: "This Unit wins all fights against CORPO Units."
  | { kind: 'winsFightVsKeyword'; keyword: string }
  // Static: this card's own play cost is reduced (docs/rulings.md §44).
  | { kind: 'costReduction'; reduction: CostReduction }

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
  }
  quick?: boolean
  /** "The first time ... each turn" — one firing per game turn, per source. */
  oncePerTurn?: boolean
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
  | { type: 'attack'; attacker: number; target: number | 'gigArea' }
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
