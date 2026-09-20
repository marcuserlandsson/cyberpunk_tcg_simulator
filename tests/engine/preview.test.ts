import { describe, expect, it } from 'vitest'
import { fixtureWithHand } from '../cards/fixtures'
import { draftState } from '../../src/engine/game'
import { PreviewStopped, stopAtHiddenInformation } from '../../src/engine/preview'
import type { InformationBoundary } from '../../src/engine/types'

describe('viewer-scoped AI replay', () => {
  it('replays disclosed information, then stops before the next unknown draw', () => {
    const { state } = fixtureWithHand(0, [])
    const revealed: InformationBoundary = { viewer: 'all', kind: 'script', player: 0, sourceUid: 1, script: 'fool-on-the-hill' }
    state.simulationPreview = true
    state.previewObserver = 1
    state.previewRevealed = [revealed]
    expect(() => stopAtHiddenInformation(state, revealed)).not.toThrow()
    expect(() => stopAtHiddenInformation(state, { viewer: 0, kind: 'draw', player: 0, uids: [2] })).toThrow(PreviewStopped)
  })

  it('does not reuse another player’s private disclosure or a different reveal', () => {
    const { state } = fixtureWithHand(0, [])
    const privatePeek: InformationBoundary = { viewer: 0, kind: 'peek', sourceUid: 1, uids: [2] }
    state.simulationPreview = true
    state.previewObserver = 1
    state.previewRevealed = [privatePeek]
    expect(() => stopAtHiddenInformation(state, privatePeek)).toThrow(PreviewStopped)
    state.previewObserver = 0
    expect(() => stopAtHiddenInformation(state, { ...privatePeek, uids: [3] })).toThrow(PreviewStopped)
  })

  it('can evaluate a previously seen Legend while preserving the original trace', () => {
    const { state } = fixtureWithHand(0, [])
    const uid = state.players[0].legends[0]
    state.cards[uid].knownTo = [0]
    state.informationTrace = []
    const preview = draftState(state)
    preview.simulationPreview = true
    preview.previewObserver = 0
    const reveal: InformationBoundary = { viewer: 'all', kind: 'legend', player: 0, uids: [uid] }
    expect(() => stopAtHiddenInformation(preview, reveal)).not.toThrow()
    expect(state.informationTrace).toEqual([])
    const rival = draftState(state)
    rival.simulationPreview = true
    rival.previewObserver = 1
    expect(() => stopAtHiddenInformation(rival, reveal)).toThrow(PreviewStopped)
  })
})
