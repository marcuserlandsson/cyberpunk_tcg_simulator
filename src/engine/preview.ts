import type { GameState } from './types'

/** Stop AI lookahead before reading information its current decision cannot know. */
export class PreviewStopped extends Error {
  constructor(readonly state: GameState) {
    super('Lookahead reached an unknown card or random reveal')
  }
}

export function stopAtHiddenInformation(state: GameState): void {
  if (state.simulationPreview) throw new PreviewStopped(state)
}
