// Groups an action's recorded frames into presentation beats
// (docs/superpowers/specs/2026-09-28-effect-pacing-design.md §2).
// Pure: no React, no timers, and no captions. BeatLayer renders captions at
// display time.

import { opponentOf } from '../../engine/query'
import type { Frame } from '../../engine/timeline'
import type { Action, GameEvent, GameState, PlayerId } from '../../engine/types'

export type BeatKind = 'turnBanner' | 'spotlight' | 'effect' | 'attack' | 'block'
  | 'defeat' | 'steal' | 'dieRoll' | 'minor' | 'silent' | 'gameOver'

export interface Beat {
  id: number
  kind: BeatKind
  events: GameEvent[]
  firstIndex: number
  lastIndex: number
  board: GameState
  baseMs: number
  player: PlayerId | null
  sourceUid: number | null
  targets: (number | 'gigArea')[]
  step: number
  of: number
}

export const BEAT_MS: Record<BeatKind, number> = {
  turnBanner: 900, spotlight: 1400, effect: 1100, attack: 900, block: 700,
  defeat: 700, steal: 900, dieRoll: 700, minor: 350, silent: 0, gameOver: 600,
}

const KIND: Record<GameEvent['type'], BeatKind> = {
  gameStarted: 'silent', playOrderChosen: 'silent', turnEnded: 'silent',
  mulliganTaken: 'minor', handKept: 'minor', cardDrawn: 'minor', cardSold: 'minor',
  cardRevealed: 'minor', cardTrashed: 'minor', cardBottomDecked: 'minor', cardRemoved: 'minor',
  turnStarted: 'turnBanner', cardPlayed: 'spotlight', legendCalled: 'spotlight',
  abilityActivated: 'effect', effectResolved: 'effect', attackDeclared: 'attack',
  attackBlocked: 'block', unitDefeated: 'defeat', gigStolen: 'steal', dieRolled: 'dieRoll',
  gameEnded: 'gameOver',
}

/**
 * The beat kinds a human action produces itself, keyed on the action type
 * (final review I5). An action that is not listed (endTurn, a react pass,
 * keepHand, mulligan, choosePlayOrder, answerIntercept, sellCard, ...)
 * produces no primary beat: whatever primary beat follows it is a
 * consequence, and is paced.
 */
function chosenKinds(action: Action | undefined): ReadonlySet<BeatKind> {
  switch (action?.type) {
    case 'playCard': case 'callLegend': return new Set(['spotlight'])
    case 'attack': return new Set(['attack'])
    case 'activateAbility': return new Set(['effect'])
    case 'chooseGig': case 'chooseGigDie': case 'chooseGigReroll': return new Set(['dieRoll', 'steal'])
    case 'react':
      switch (action.reaction.type) {
        case 'block': return new Set(['block'])
        case 'callLegend': case 'quick': return new Set(['spotlight'])
        case 'quickAbility': return new Set(['effect'])
        default: return new Set()
      }
    default: return new Set()
  }
}
const EXITS = new Set<GameEvent['type']>(['cardTrashed', 'cardBottomDecked', 'cardRemoved'])

function uidOf(event: GameEvent): number | null {
  switch (event.type) {
    case 'cardDrawn': case 'cardSold': case 'cardPlayed': case 'legendCalled': case 'cardRevealed':
    case 'cardTrashed': case 'cardBottomDecked': case 'cardRemoved': case 'abilityActivated':
    case 'unitDefeated':
      return event.uid
    case 'effectResolved': return event.sourceUid
    case 'attackDeclared': return event.attacker
    case 'attackBlocked': return event.blocker
    default: return null
  }
}

function playerOf(event: GameEvent, board: GameState): PlayerId | null {
  if ('player' in event) return event.player
  if (event.type === 'gigStolen') return opponentOf(event.from)
  if (event.type === 'gameEnded') return event.winner
  const uid = uidOf(event)
  return uid === null ? null : board.cards[uid]?.owner ?? null
}

function targetsOf(event: GameEvent): (number | 'gigArea')[] {
  if (event.type === 'effectResolved') return event.targets ?? []
  if (event.type === 'attackDeclared') return [event.target]
  if (event.type === 'gigStolen') return ['gigArea']
  return []
}

function isModeNote(event: Extract<GameEvent, { type: 'effectResolved' }>): boolean {
  return /^mode \d+$/.test(event.description)
}

function absorbs(beat: Beat, event: GameEvent, player: PlayerId | null): boolean {
  const last = beat.events[beat.events.length - 1]
  const kind = KIND[event.type]
  if (beat.kind === 'effect' && last.type === 'abilityActivated' && event.type === 'effectResolved')
    return event.sourceUid === last.uid
  // A modal choice's `mode N` note is folded into the effect it chose.
  if (beat.kind === 'effect' && last.type === 'effectResolved' && isModeNote(last) && event.type === 'effectResolved')
    return event.sourceUid === last.sourceUid
  if (EXITS.has(event.type) && (beat.kind === 'defeat' || beat.kind === 'effect')) {
    const uid = uidOf(event)
    return beat.kind === 'defeat' ? uid === beat.sourceUid : uid !== null && beat.targets.includes(uid)
  }
  if (beat.kind === 'turnBanner') return kind === 'minor' && player === beat.player
  if (beat.kind === 'minor') return kind === 'minor' && event.type === last.type && player === beat.player
  return false
}

/**
 * `action` is the action that produced these frames. For a human action, the
 * leading minor/silent beats and the one beat the action itself produces
 * (`chosenKinds`) are instant; everything after is paced.
 */
export function buildBeats(frames: Frame[], actor: 'human' | 'ai', action?: Action): Beat[] {
  const beats: Beat[] = []
  for (const frame of frames) {
    const { event, board, eventIndex } = frame
    const player = playerOf(event, board)
    const open = beats[beats.length - 1]
    if (open !== undefined && absorbs(open, event, player)) {
      open.events.push(event)
      open.lastIndex = eventIndex
      open.id = eventIndex
      open.board = board
      if (event.type === 'effectResolved') open.targets = targetsOf(event)
      continue
    }
    const kind = KIND[event.type] ?? 'minor'
    beats.push({
      id: eventIndex, kind, events: [event], firstIndex: eventIndex, lastIndex: eventIndex, board,
      baseMs: BEAT_MS[kind], player, sourceUid: uidOf(event), targets: targetsOf(event), step: 0, of: 0,
    })
  }
  if (actor === 'human') {
    const chosen = chosenKinds(action)
    for (const beat of beats) {
      if (beat.kind === 'minor' || beat.kind === 'silent') { beat.baseMs = 0; continue }
      if (chosen.has(beat.kind)) beat.baseMs = 0
      break
    }
  }
  beats.forEach((beat, i) => { beat.step = i + 1; beat.of = beats.length })
  return beats
}
