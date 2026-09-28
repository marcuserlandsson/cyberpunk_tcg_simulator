import { describe, expect, it } from 'vitest'
import { buildBeats, BEAT_MS } from '../../src/ui/presentation/beats'
import type { Frame } from '../../src/engine/timeline'
import type { GameEvent, GameState } from '../../src/engine/types'
import { startedGame } from '../engine/gameHelpers'

const base: GameState = startedGame()
// Owners for uid-only events: uid 900 belongs to player 1, 800 to player 0.
base.cards[900] = { ...Object.values(base.cards)[0], uid: 900, owner: 1 }
base.cards[800] = { ...Object.values(base.cards)[0], uid: 800, owner: 0 }

function frames(...events: GameEvent[]): Frame[] {
  return events.map((event, i) => ({ eventIndex: 100 + i, event, board: base }))
}

const kinds = (fs: Frame[], actor: 'human' | 'ai' = 'ai') => buildBeats(fs, actor).map((b) => b.kind)

describe('buildBeats', () => {
  it('maps each event kind to its beat', () => {
    expect(kinds(frames(
      { type: 'cardPlayed', player: 1, uid: 900 },
      { type: 'attackDeclared', attacker: 900, target: 'gigArea' },
      { type: 'attackBlocked', blocker: 800 },
      { type: 'unitDefeated', uid: 800 },
      { type: 'dieRolled', player: 1, size: 6, value: 3 },
      { type: 'gigStolen', from: 0, die: { size: 6, value: 3 } },
      { type: 'turnEnded', player: 1 },
      { type: 'gameEnded', winner: 1, reason: 'sevenGigs' },
    ))).toEqual(['spotlight', 'attack', 'block', 'defeat', 'dieRoll', 'steal', 'silent', 'gameOver'])
  })

  it('absorbs an ability activation into the effect it resolves', () => {
    const beats = buildBeats(frames(
      { type: 'abilityActivated', player: 1, uid: 900, abilityIndex: 0 },
      { type: 'effectResolved', sourceUid: 900, description: 'defeat 800', targets: [800] },
    ), 'ai')
    expect(beats).toHaveLength(1)
    expect(beats[0]).toMatchObject({ kind: 'effect', sourceUid: 900, targets: [800], firstIndex: 100, lastIndex: 101, player: 1 })
  })

  it('lets a defeat absorb the exit event of the same card', () => {
    const beats = buildBeats(frames(
      { type: 'unitDefeated', uid: 800 },
      { type: 'cardTrashed', uid: 800 },
      { type: 'cardTrashed', uid: 900 },
    ), 'ai')
    expect(beats.map((b) => [b.kind, b.firstIndex, b.lastIndex])).toEqual([['defeat', 100, 101], ['minor', 102, 102]])
  })

  it('lets an effect absorb the exit event of its target', () => {
    const beats = buildBeats(frames(
      { type: 'effectResolved', sourceUid: 900, description: 'bottom-deck 800', targets: [800] },
      { type: 'cardBottomDecked', uid: 800 },
    ), 'ai')
    expect(beats).toHaveLength(1)
    expect(beats[0].lastIndex).toBe(101)
  })

  it('merges consecutive same-kind minor events by the same player', () => {
    const beats = buildBeats(frames(
      { type: 'cardDrawn', player: 1, uid: 900 },
      { type: 'cardDrawn', player: 1, uid: 901 },
      { type: 'cardDrawn', player: 0, uid: 800 },
    ), 'ai')
    expect(beats.map((b) => b.events.length)).toEqual([2, 1])
  })

  it('folds the draws that follow a turn start into the banner', () => {
    const beats = buildBeats(frames(
      { type: 'turnStarted', player: 1, turn: 4 },
      { type: 'cardDrawn', player: 1, uid: 900 },
      { type: 'cardPlayed', player: 1, uid: 900 },
    ), 'ai')
    expect(beats.map((b) => b.kind)).toEqual(['turnBanner', 'spotlight'])
    expect(beats[0].events).toHaveLength(2)
  })

  it('gives each kind its base time and numbers the beats of the action', () => {
    const beats = buildBeats(frames(
      { type: 'cardPlayed', player: 1, uid: 900 },
      { type: 'effectResolved', sourceUid: 900, description: 'draw 1' },
    ), 'ai')
    expect(beats.map((b) => [b.baseMs, b.step, b.of, b.id])).toEqual([
      [BEAT_MS.spotlight, 1, 2, 100],
      [BEAT_MS.effect, 2, 2, 101],
    ])
  })

  it("resolves the human's chosen action instantly but paces its consequences", () => {
    const beats = buildBeats(frames(
      { type: 'cardSold', player: 0, uid: 800 },
      { type: 'cardPlayed', player: 0, uid: 800 },
      { type: 'effectResolved', sourceUid: 800, description: 'defeat 900', targets: [900] },
      { type: 'unitDefeated', uid: 900 },
    ), 'human')
    expect(beats.map((b) => b.baseMs)).toEqual([0, 0, BEAT_MS.effect, BEAT_MS.defeat])
  })

  it("still shows the rival's turn banner after the human ends their turn", () => {
    const beats = buildBeats(frames(
      { type: 'turnEnded', player: 0 },
      { type: 'turnStarted', player: 1, turn: 4 },
    ), 'human')
    expect(beats.map((b) => [b.kind, b.baseMs])).toEqual([['silent', 0], ['turnBanner', BEAT_MS.turnBanner]])
  })

  it('attributes attacks and steals to the acting player', () => {
    const beats = buildBeats(frames(
      { type: 'attackDeclared', attacker: 900, target: 800 },
      { type: 'gigStolen', from: 0, die: { size: 6, value: 3 } },
    ), 'ai')
    expect(beats.map((b) => [b.player, b.sourceUid, b.targets])).toEqual([[1, 900, [800]], [1, null, ['gigArea']]])
  })

  it('returns nothing for no frames', () => {
    expect(buildBeats([], 'ai')).toEqual([])
  })
})
