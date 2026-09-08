import { stopAtHiddenInformation } from './preview'
import type { CardDb, GameState, PlayerId } from './types'
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

/** Printed discard instructions give the affected player the card decision. */
export function discardChosenCards(db: CardDb, state: GameState, player: PlayerId, sourceUid: number, count: number): number[] {
  const p = state.players[player]
  const discarded: number[] = []
  for (let i = 0; i < count && p.hand.length > 0; i++) {
    // The discarded identity (and any following cost comparison) is not known
    // to another player's lookahead before this choice has been made.
    stopAtHiddenInformation(state)
    const chosen = chooseEffectOption(state, player, sourceUid, 'Choose a card to discard', [...p.hand],
      Object.fromEntries(p.hand.map(uid => [uid, db[state.cards[uid].defId].name])), true)
    if (chosen === null) break
    p.hand = p.hand.filter(uid => uid !== chosen)
    p.trash.push(chosen)
    state.events.push({ type: 'cardTrashed', uid: chosen })
    discarded.push(chosen)
  }
  return discarded
}
