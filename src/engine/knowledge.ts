import { fireTriggerOnDraft } from '../cards/effects'
import { chooseEffectOption } from './choices'
import { askIntercept } from './intercept'
import { stopAtHiddenInformation } from './preview'
import type { CardDb, GameState, PlayerId } from './types'

/** Choose a physical position without disclosing the identity underneath it. */
export function chooseFaceDownLegend(state: GameState, player: PlayerId, sourceUid = -1, optional = false): number | null {
  const legends = state.players[player].legends
  const options = legends.filter(uid => !state.cards[uid].faceUp)
  if (!options.length) return null
  const labels = Object.fromEntries(options.map(uid => [uid, `Face-down Legend ${legends.indexOf(uid) + 1}${state.cards[uid].knownTo?.includes(player) ? ' (previously seen)' : ''}`]))
  if (optional) { options.push(-1); labels[-1] = 'Decline' }
  const chosen = chooseEffectOption(state, player, sourceUid, 'Choose a face-down Legend position', options, labels)
  return chosen === -1 ? null : chosen
}

/** Show the identity only during this permitted peek. The board retains a public marker. */
export function peekLegends(db: CardDb, state: GameState, player: PlayerId, uids: number[], sourceUid: number): void {
  if (!uids.length) return
  stopAtHiddenInformation(state)
  const legends = state.players[player].legends
  for (const uid of uids) state.cards[uid].knownTo = [...new Set([...(state.cards[uid].knownTo ?? []), player])]
  if (state.effectQueue === undefined && state.interceptAnswers.length === 0) return
  askIntercept(state, {
    kind: 'effectChoice', player, protector: sourceUid, subject: sourceUid, options: [0], optionLabels: { 0: 'Finish looking' },
    prompt: `Private peek: ${uids.map(uid => {
      const def = db[state.cards[uid].defId]
      return `Legend ${legends.indexOf(uid) + 1}: ${def.name}${def.subtitle ? ` — ${def.subtitle}` : ''}. Cost ${def.printedCost === null ? '—' : def.cost}; power ${def.power ?? '—'}; RAM ${def.ramLimit ? `${def.ramLimit.color} ${def.ramLimit.value}` : def.ram ? `${def.ram.color} ${def.ram.value}` : '—'}; ${def.color}. ${def.text}`
    }).join(' | ')}`,
    knownCards: uids.map(uid => ({ uid, viewer: player })),
  })
}

export function callChosenLegend(db: CardDb, state: GameState, player: PlayerId, sourceUid = -1, optional = false, chosen?: number): void {
  const p = state.players[player]
  if (p.calledLegendThisTurn) return
  const uid = chosen ?? chooseFaceDownLegend(state, player, sourceUid, optional)
  if (uid === null || !p.legends.includes(uid) || state.cards[uid].faceUp) return
  stopAtHiddenInformation(state)
  state.cards[uid].faceUp = true
  p.calledLegendThisTurn = true
  state.events.push({ type: 'legendCalled', player, uid })
  fireTriggerOnDraft(db, state, 'onCall', uid, [])
}
