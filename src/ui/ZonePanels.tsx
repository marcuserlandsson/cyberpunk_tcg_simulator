import type { ReactElement } from 'react'
import { BoardCard } from './Field'
import type { BoardAffordances, BoardHandlers } from './playAffordances'
import type { CardDb, GameState, PlayerId } from '../engine/types'

export interface ZonePanelsProps {
  db: CardDb
  state: GameState
  player: PlayerId
  affordances: BoardAffordances
  handlers: BoardHandlers
  useOfficialImages: boolean
}

/**
 * The card-holding side zones: Legends (face-down until Called, and playable
 * from here when they print {Go Solo}), Eddies, Deck and Trash. Deck and Trash
 * are counts rather than card lists — the deck is hidden information, and the
 * trash is public but not a place anything is clicked from.
 */
function CardZones(props: ZonePanelsProps): ReactElement {
  const { db, state, player, affordances, handlers, useOfficialImages } = props
  const p = state.players[player]
  const readyEddies = p.eddies.filter((uid) => state.cards[uid].ready).length

  return (
    <>
      <div className="zone zone--legends" data-testid="legends" data-player={player}>
        <span className="zone__label">Legends</span>
        <div className="zone__cards">
          {p.legends.map((uid) => (
            <BoardCard
              key={uid}
              db={db}
              state={state}
              uid={uid}
              zone="legend"
              affordances={affordances}
              handlers={handlers}
              useOfficialImages={useOfficialImages}
            />
          ))}
        </div>
      </div>

      <div className="zone zone--counts" data-testid="counts" data-player={player}>
        <span className="zone__count" data-testid="eddies-count">
          €$ {readyEddies}/{p.eddies.length}
        </span>
        <span className="zone__count" data-testid="deck-count">
          Deck {p.deck.length}
        </span>
        <span className="zone__count" data-testid="trash-count">
          Trash {p.trash.length}
        </span>
        {p.removed.length > 0 && (
          <span className="zone__count" data-testid="removed-count">
            Removed {p.removed.length}
          </span>
        )}
      </div>
    </>
  )
}

/** One player's half of the playmat, minus the field, hand and dice pool. */
export function ZonePanels(props: ZonePanelsProps): ReactElement {
  return (
    <div className="zone-panels" data-testid="zone-panels" data-player={props.player}>
      <CardZones {...props} />
    </div>
  )
}
