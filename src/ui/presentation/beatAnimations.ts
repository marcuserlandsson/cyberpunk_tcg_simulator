// The four showpiece flags (lunge, tumble, steal-fly, glitch) that Field and
// StreetStrip already know how to play, now driven by the current beat
// instead of a diff of the event log (this replaces useAnimations.ts).

import type { DieSize, PlayerId } from '../../engine/types'
import type { Beat } from './beats'

export interface AnimationState {
  lungeUid: number | null
  tumble: { player: PlayerId; size: DieSize } | null
  steal: { from: PlayerId; size: DieSize; value: number } | null
  glitch: boolean
}

const NONE: AnimationState = { lungeUid: null, tumble: null, steal: null, glitch: false }

export function beatAnimations(beat: Beat | null): AnimationState {
  if (beat === null) return NONE
  const event = beat.events[0]
  switch (event.type) {
    case 'attackDeclared': return { ...NONE, lungeUid: event.attacker }
    case 'dieRolled': return { ...NONE, tumble: { player: event.player, size: event.size } }
    case 'gigStolen': return { ...NONE, steal: { from: event.from, size: event.die.size, value: event.die.value } }
    case 'gameEnded': return { ...NONE, glitch: true }
    default: return NONE
  }
}
