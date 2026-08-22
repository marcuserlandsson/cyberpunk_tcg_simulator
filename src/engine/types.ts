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

export type Trigger = 'onPlay' | 'onCall' | 'onAttack' | 'onDefeat' | 'activated' | 'static'

export type TargetSpec =
  | 'self'
  | 'friendlyUnit'
  | 'rivalUnit'
  | 'rivalSpentUnit'
  | 'anyUnit'
  | 'friendlyUnitOrLegend'

export type EffectNode =
  | { kind: 'draw'; count: number }
  | { kind: 'discardRandomRival'; count: number }
  | { kind: 'buffPower'; amount: number; target: TargetSpec; duration: 'turn' | 'permanent' }
  | { kind: 'staticPower'; amount: number }
  | { kind: 'defeat'; target: TargetSpec }
  | { kind: 'bounce'; target: TargetSpec }
  | { kind: 'readyCard'; target: TargetSpec }
  | { kind: 'spendCard'; target: TargetSpec }
  | { kind: 'stealGig'; count: number }
  | { kind: 'returnGig'; count: number }
  | { kind: 'rerollGig'; whose: 'friendly' | 'rival' }
  | { kind: 'trashFromDeck'; whose: 'friendly' | 'rival'; count: number }
  | { kind: 'bottomDeck'; target: TargetSpec }
  | { kind: 'gainEddieFromTopDeck'; count: number }
  | { kind: 'sequence'; effects: EffectNode[] }
  | { kind: 'scripted'; name: string }
  // Static restriction: "This Unit can't attack" (e.g. corpo-security,
  // misty-olszewski-...). Only meaningful with `trigger: 'static'`.
  | { kind: 'cantAttack' }

export interface EffectDef {
  trigger: Trigger
  cost?: { selfSpend?: boolean; eddies?: number }
  condition?: { streetCredAtLeast?: number }
  quick?: boolean
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

export interface GameState {
  players: [PlayerState, PlayerState]
  cards: Record<number, CardInstance>
  nextUid: number
  turnNumber: number // increments when player 'first' begins a turn; each player's Nth turn
  activePlayer: PlayerId
  firstPlayer: PlayerId
  phase: Phase
  pendingAttack: { attacker: number; target: number | 'gigArea'; redirectedTo?: number } | null
  // An unresolved Gig steal: the thief picks one die at a time (`chooseGig`).
  // `thief`/`resumePhase` are set only by *effect*-driven steals (a `stealGig`
  // EffectNode, docs/rulings.md §32); an attack-driven steal leaves them
  // undefined, which means "the active player, and closing the attack when the
  // last die is taken".
  pendingSteal: {
    attacker: number
    remaining: number
    thief?: PlayerId
    resumePhase?: Phase
  } | null
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
