import type { CSSProperties, ReactElement } from 'react'
import { BoardCard } from './Field'
import { AI } from './useGame'
import type { BoardAffordances, BoardHandlers } from './playAffordances'
import type { CardDb, GameState, PlayerId } from '../engine/types'

// React's CSSProperties doesn't model custom properties; this is the usual
// widening to let a component set them via `style` (mirrors CardFrame.tsx's
// own `StyleWithVars`).
type FanVars = CSSProperties & { '--i': number; '--n': number }
type FanCountVar = CSSProperties & { '--n': number }

/** The `--i`/`--n` custom properties board.css's hand-fan CSS reads to spread
 *  and curl a hand of `n` cards, index `i`, into an arc — wider hands
 *  overlap more (via the CSS's own `--n` clamp) so 10+ cards stay inside the
 *  strip rather than overflowing it. */
function fanStyle(index: number, n: number): FanVars {
  return { '--i': index, '--n': n }
}

/**
 * `--n` alone, set on the `.zone__cards` row itself (not just on each card):
 * `transform` never affects an element's own layout box, so the per-card
 * downward droop the fan's `--i`/`--n` transform paints (verified in a real
 * browser: a real transform, even auto-detected, does not inflate its
 * ancestor's `scrollHeight`) would otherwise paint straight past this row's
 * bottom edge — clipped by `.playmat__board`'s `overflow-y: auto` with no
 * way to scroll to it (that container's scrollable area is computed from
 * flow layout alone). board.css reads this `--n` to reserve real
 * padding-bottom sized to the fan's own worst-case droop, so the room is
 * counted in layout and the fan is guaranteed to fit (or, in an extreme
 * hand size, to genuinely scroll into view) rather than being invisibly cut
 * off.
 */
function fanRowStyle(n: number): FanCountVar {
  return { '--n': n }
}

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
      <div className="zone__cards" style={fanRowStyle(hand.length)}>
        {hand.length === 0 && <span className="zone__empty">empty</span>}
        {hidden
          ? hand.map((uid, index) => (
              <div
                className="board-card board-card--hand-back"
                key={uid}
                data-testid="hand-back"
                style={fanStyle(index, hand.length)}
              >
                {/* Red-keyed to the rival (`card-frame--rival`, matching every
                    other rival-owned face-down back — eddies, deck/trash
                    piles) rather than the un-keyed back this used to render,
                    so a glance at the fan itself reads as the rival's. */}
                <div
                  className={`card-frame card-frame--small card-frame--face-down${
                    player === AI ? ' card-frame--rival' : ''
                  }`}
                >
                  <div className="card-frame__back" aria-label="Face-down card" />
                </div>
              </div>
            ))
          : hand.map((uid, index) => (
              <BoardCard
                key={uid}
                db={db}
                state={state}
                uid={uid}
                zone="hand"
                affordances={affordances}
                handlers={handlers}
                useOfficialImages={useOfficialImages}
                style={fanStyle(index, hand.length)}
              />
            ))}
      </div>
    </div>
  )
}
