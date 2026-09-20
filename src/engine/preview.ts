import type { GameState, InformationBoundary } from './types'

/** Stop AI lookahead before reading information its current decision cannot know. */
export class PreviewStopped extends Error {
  constructor(readonly state: GameState, readonly boundary: InformationBoundary = { viewer: 'all' }) {
    super('Lookahead reached an unknown card or random reveal')
  }
}

export function stopAtHiddenInformation(state: GameState, boundary: InformationBoundary = { viewer: 'all' }): void {
  const index = state.informationTrace?.length ?? 0
  if (state.simulationPreview) {
    const known = state.previewRevealed?.[index]
    const observedLegend = state.previewObserver !== undefined && boundary.kind === 'legend'
      && !!boundary.uids?.length && boundary.uids.every(uid => state.cards[uid]?.knownTo?.includes(state.previewObserver!))
    if (!observedLegend && (state.previewObserver === undefined || !known || (known.viewer !== 'all' && known.viewer !== state.previewObserver)
      || known.kind !== boundary.kind || known.sourceUid !== boundary.sourceUid || known.script !== boundary.script
      || known.player !== boundary.player || JSON.stringify(known.uids) !== JSON.stringify(boundary.uids))) {
      throw new PreviewStopped(state, boundary)
    }
  }
  // Never mutate a trace shared with an earlier state or a pending choice.
  state.informationTrace = [...(state.informationTrace ?? []), boundary]
}
