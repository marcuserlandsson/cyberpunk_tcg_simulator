import { stillLive } from './game'
import { fireWatcherTrigger } from '../cards/effects'
import { chooseEffectOption } from './choices'
import { checkOvertimeWin } from './game'
import { askIntercept, DECLINE } from './intercept'
import { cardTags, opponentOf, stealInterceptorsFor } from './query'
import type { CardDb, GameState, PlayerId } from './types'

/** CR 6.7/9.23: all choices precede prevention; all transfers precede triggers. */
export function transferStolenGigs(db: CardDb, draft: GameState, sourceUid: number, thief: PlayerId, selected: number[]): number {
  const victim = opponentOf(thief)
  const area = draft.players[victim].gigArea
  const accepted: number[] = []
  for (const index of [...new Set(selected)]) {
    const die = area[index]
    if (!die) continue
    const intercepts = stealInterceptorsFor(db, draft, victim, sourceUid, die.value)
    const protector = chooseEffectOption(draft, victim, sourceUid, 'Choose the steal-prevention effect to use', intercepts.map(effect => effect.protector),
      Object.fromEntries(intercepts.map(effect => [effect.protector, `${db[draft.cards[effect.protector].defId].name} #${effect.protector}`])), true)
    const intercept = intercepts.find(effect => effect.protector === protector)
    if (intercept) {
      const answer = askIntercept(draft, {
        kind: 'steal', player: victim, protector: intercept.protector, subject: index,
        options: [DECLINE, ...intercept.candidates],
      })
      if (answer !== DECLINE) {
        const p = draft.players[victim]
        p.hand = p.hand.filter(uid => uid !== answer)
        p.trash.push(answer)
        draft.events.push({ type: 'cardTrashed', uid: answer })
        draft.events.push({ type: 'effectResolved', sourceUid: intercept.protector,
          description: `prevents the steal of d${die.size}:${die.value}` })
        continue
      }
    }
    accepted.push(index)
  }
  const stolen = accepted.map(index => area[index])
  const indexes = new Set(accepted)
  draft.players[victim].gigArea = area.filter((_die, index) => !indexes.has(index))
  draft.players[thief].gigArea.push(...stolen)
  for (const die of stolen) draft.events.push({ type: 'gigStolen', from: victim, die: { ...die } })
  if (stolen.length === 0) return 0
  if (draft.cards[sourceUid]) draft.cards[sourceUid].stoleGigThisTurn = true
  for (const effect of draft.floatingEffects) {
    if (effect.kind === 'defeatIfActed' && effect.unitUid === sourceUid) effect.acted = true
  }
  // A winning transfer ends the game before any following instruction/draw.
  checkOvertimeWin(draft)
  if (!stillLive(draft)) return stolen.length
  const def = db[draft.cards[sourceUid]?.defId]
  for (const [offset, die] of stolen.entries()) fireWatcherTrigger(db, draft, 'onFriendlyStealDie', thief, {
    stolenDieId: die.id, stolenDieSize: die.size, stolenDieValue: die.value, stealerUid: sourceUid,
    stolenDieIndex: draft.players[thief].gigArea.length - stolen.length + offset,
    stealerIsLegend: def?.type === 'legend',
  })
  fireWatcherTrigger(db, draft, 'onFriendlyStealComplete', thief, {
    stealerUid: sourceUid, stealerIsLegend: def?.type === 'legend', stealerTags: def ? cardTags(def) : [],
  })
  return stolen.length
}

/** Effect instructions finish their entire steal before continuing to the next clause. */
export function chooseAndStealGigs(db: CardDb, draft: GameState, sourceUid: number, thief: PlayerId, count: number, eligible: number[]): void {
  const selected: number[] = []
  const area = draft.players[opponentOf(thief)].gigArea
  const amount = Math.min(count, eligible.length)
  while (selected.length < amount) {
    const options = eligible.filter(index => !selected.includes(index))
    const index = chooseEffectOption(draft, thief, sourceUid,
      `Choose Gig ${selected.length + 1} of ${amount} to steal`, options,
      Object.fromEntries(options.map(index => [index, `d${area[index].size}: ${area[index].value}`])))
    if (index === null) break
    selected.push(index)
  }
  transferStolenGigs(db, draft, sourceUid, thief, selected)
}
