import type { GameState, PlayerId } from './types'
import { askIntercept } from './intercept'
import { nextInt } from './rng'

/** Resolution-time choice. Action replays pause; low-level fixtures can supply answers. */
export function chooseEffectOption(
  state: GameState,
  player: PlayerId,
  sourceUid: number,
  prompt: string,
  options: number[],
  optionLabels: Record<number, string>,
  cardOptions = false,
  disclosedCards: { uid: number; viewer: PlayerId | 'all' }[] = [],
): number | null {
  if (options.length === 0) return null
  if (options.length === 1) return options[0]
  if (state.effectQueue === undefined && state.interceptAnswers.length === 0) {
    // Low-level effect fixtures have no action to resume. Gameplay always uses
    // applyAction's transaction and reaches the explicit decision below.
    const [index, rng] = nextInt(state.rng, options.length)
    state.rng = rng
    return options[index]
  }
  return askIntercept(state, {
    kind: 'effectChoice', player, protector: sourceUid, subject: sourceUid,
    options, prompt, optionLabels,
    knownCards: [
      ...(state.cards[sourceUid] ? [{ uid: sourceUid, viewer: 'all' as const }] : []),
      ...disclosedCards,
      ...(cardOptions ? options.filter(uid => state.cards[uid]).map(uid => ({ uid, viewer: player })) : []),
    ],
  })
}
