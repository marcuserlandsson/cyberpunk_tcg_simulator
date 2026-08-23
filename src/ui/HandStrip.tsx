import type { ReactElement } from 'react'
import { BoardCard } from './Field'
import type { BoardAffordances, BoardHandlers } from './playAffordances'
import type { CardDb, GameState, PlayerId } from '../engine/types'

export interface HandStripProps {
  db: CardDb
  state: GameState
  player: PlayerId
  /** The human's own hand is face-up; the rival's is a face-down count. */
  hidden: boolean
  affordances: BoardAffordances
  handlers: BoardHandlers
  useOfficialImages: boolean
}

/**
 * A player's hand. The rival's is rendered as face-down backs only — the count
 * is public on a real table, the contents are not, and the view must not leak
 * what the log deliberately hides (see `describeEvent`).
 */
export function HandStrip(props: HandStripProps): ReactElement {
  const { db, state, player, hidden, affordances, handlers, useOfficialImages } = props
  const hand = state.players[player].hand

  return (
    <div
      className={`zone zone--hand${hidden ? ' zone--hand-hidden' : ''}`}
      data-testid="hand"
      data-player={player}
    >
      <span className="zone__label">
        Hand <span data-testid="hand-count">{hand.length}</span>
      </span>
      <div className="zone__cards">
        {hand.length === 0 && <span className="zone__empty">empty</span>}
        {hidden
          ? hand.map((uid) => (
              <div className="board-card board-card--hand-back" key={uid} data-testid="hand-back">
                <div className="card-frame card-frame--small card-frame--face-down">
                  <div className="card-frame__back" aria-label="Face-down card" />
                </div>
              </div>
            ))
          : hand.map((uid) => (
              <BoardCard
                key={uid}
                db={db}
                state={state}
                uid={uid}
                zone="hand"
                affordances={affordances}
                handlers={handlers}
                useOfficialImages={useOfficialImages}
              />
            ))}
      </div>
    </div>
  )
}
