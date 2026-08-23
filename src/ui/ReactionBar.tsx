import type { ReactElement } from 'react'
import type { Action, CardDb, GameState, Reaction } from '../engine/types'

export interface ReactionBarProps {
  db: CardDb
  state: GameState
  /** Every `react` entry of the current `legal` list — one button each. */
  reactions: Extract<Action, { type: 'react' }>[]
  onPick: (action: Extract<Action, { type: 'react' }>) => void
}

function nameOf(db: CardDb, state: GameState, uid: number): string {
  const instance = state.cards[uid]
  if (instance === undefined) return `#${uid}`
  return db[instance.defId]?.name ?? instance.defId
}

/** Target uids appended to a label, so two variants of one card stay distinct. */
function targetSuffix(db: CardDb, state: GameState, targets: number[]): string {
  if (targets.length === 0) return ''
  const named = targets.map((uid) =>
    state.cards[uid] === undefined ? `#${uid}` : nameOf(db, state, uid)
  )
  return ` → ${named.join(', ')}`
}

function reactionLabel(db: CardDb, state: GameState, reaction: Reaction): string {
  switch (reaction.type) {
    case 'pass':
      return 'Pass'
    case 'block':
      return `Block with ${nameOf(db, state, reaction.blocker)}`
    case 'callLegend':
      return 'Call a Legend'
    case 'quick':
      return `{Quick} ${nameOf(db, state, reaction.card)}${targetSuffix(db, state, reaction.targets)}`
    case 'quickAbility':
      return `{Quick} ability: ${nameOf(db, state, reaction.card)}${targetSuffix(
        db,
        state,
        reaction.targets
      )}`
  }
}

/**
 * The defender's reaction window. Every legal reaction is one button — no
 * hidden modes, no implicit pass — and `Pass` is always last so the safe answer
 * is never in the position a fast click lands on.
 *
 * This bar is also the reason the whole view is driven by `actingPlayer` rather
 * than `activePlayer`: it appears during the *rival's* turn, when it is the
 * human's decision but not the human's turn.
 */
export function ReactionBar({ db, state, reactions, onPick }: ReactionBarProps): ReactElement {
  // `Pass` last, everything else in the engine's own enumeration order.
  const ordered = [
    ...reactions.filter((action) => action.reaction.type !== 'pass'),
    ...reactions.filter((action) => action.reaction.type === 'pass'),
  ]

  return (
    <div className="prompt-bar prompt-bar--react" data-testid="reaction-bar" role="group">
      <span className="prompt-bar__label">
        Your Unit is under attack — react or pass:
      </span>
      <div className="prompt-bar__options">
        {ordered.map((action, index) => {
          const isPass = action.reaction.type === 'pass'
          return (
            <button
              type="button"
              key={index}
              className={`prompt-bar__option${isPass ? ' prompt-bar__option--pass' : ''}`}
              data-testid={isPass ? 'reaction-pass' : 'reaction-option'}
              onClick={() => onPick(action)}
            >
              {reactionLabel(db, state, action.reaction)}
            </button>
          )
        })}
      </div>
    </div>
  )
}
