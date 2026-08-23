import type { ReactElement } from 'react'
import { effectivePower } from '../engine/query'
import type { Action, CardDb, GameEvent, GameState, Reaction } from '../engine/types'

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

/**
 * `nameOf` above always resolves the real name, which is correct for every
 * existing call site (blockers/quick cards/targets are always face-up cards
 * once they're legal reaction/choice material) but would leak a hidden
 * identity if it were ever handed a face-down uid — this is that guard,
 * used only by the newly-derived attack label below.
 */
function safeName(db: CardDb, state: GameState, uid: number): string {
  const instance = state.cards[uid]
  if (instance === undefined) return `#${uid}`
  if (!instance.faceUp) return 'a face-down card'
  return nameOf(db, state, uid)
}

/**
 * The attack this react window is over — the latest `attackDeclared` event
 * in `state.events`, which is always present while a react window is open
 * (docs/rulings.md: the window opens as the direct result of that event). A
 * reverse loop rather than `Array.prototype.findLast`, which the project's
 * `lib` (ES2022) does not type.
 */
function lastAttackDeclared(
  state: GameState
): Extract<GameEvent, { type: 'attackDeclared' }> | undefined {
  for (let index = state.events.length - 1; index >= 0; index -= 1) {
    const event = state.events[index]
    if (event.type === 'attackDeclared') return event
  }
  return undefined
}

/** "X (power) attacks Y (power) — react or pass:", or "...attacks your Gig
 *  area — react or pass:" when the attack targets the defender's Gig area
 *  rather than a Unit. */
function attackLabel(db: CardDb, state: GameState): string {
  const declared = lastAttackDeclared(state)
  if (declared === undefined) return 'Your Unit is under attack — react or pass:'
  const attacker = `${safeName(db, state, declared.attacker)} (${effectivePower(
    db,
    state,
    declared.attacker
  )})`
  if (declared.target === 'gigArea') {
    return `${attacker} attacks your Gig area — react or pass:`
  }
  const target = `${safeName(db, state, declared.target)} (${effectivePower(
    db,
    state,
    declared.target
  )})`
  return `${attacker} attacks ${target} — react or pass:`
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
      <span className="prompt-bar__label">{attackLabel(db, state)}</span>
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
