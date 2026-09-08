import type { CardDb, EffectDef, GameState, PlayerId } from './types'
import { applyEffectDefOnDraft, type TriggerContext } from '../cards/effects'
import { askIntercept } from './intercept'
import { checkOvertimeWin } from './game'

/** One printed effect, including its compound clauses, survives its source leaving play. */
export interface PendingEffect {
  sourceUid: number
  controller: PlayerId
  clauses: { def: EffectDef; targets: number[] }[]
  context: TriggerContext
}

/** CR 10.11–10.16: finish a resolution before starting any triggered effect. */
export function flushPendingEffects(db: CardDb, draft: GameState): void {
  if (!draft.effectQueue || draft.resolvingEffects) return
  draft.resolvingEffects = true
  let player = draft.activePlayer
  try {
    while (draft.effectQueue.length > 0 && draft.winner === null) {
      let indexes = draft.effectQueue.flatMap((effect, index) => effect.controller === player ? [index] : [])
      if (indexes.length === 0) {
        player = player === 0 ? 1 : 0
        indexes = draft.effectQueue.flatMap((effect, index) => effect.controller === player ? [index] : [])
      }
      const index = indexes.length === 1 ? indexes[0] : askIntercept(draft, {
        kind: 'effectOrder', player, protector: draft.effectQueue[indexes[0]].sourceUid,
        subject: 0, options: indexes, prompt: 'Choose your next pending effect to resolve',
        optionLabels: Object.fromEntries(indexes.map(index => {
          const pending = draft.effectQueue![index]
          const card = db[draft.cards[pending.sourceUid].defId]
          return [index, `${card.name} #${pending.sourceUid}${card.text ? ` — ${card.text}` : ''}`]
        })),
      })
      const [pending] = draft.effectQueue.splice(index, 1)
      for (const clause of pending.clauses) {
        if (draft.winner !== null) break
        applyEffectDefOnDraft(db, draft, clause.def, pending.sourceUid, clause.targets, pending.controller, pending.context)
        checkOvertimeWin(draft)
      }
    }
  } finally {
    draft.resolvingEffects = false
  }
}
