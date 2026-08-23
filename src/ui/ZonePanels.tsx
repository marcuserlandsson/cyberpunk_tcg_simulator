import type { ReactElement } from 'react'
import { BoardCard } from './Field'
import { Die } from './Dice'
import { streetCred } from '../engine/query'
import type { BoardAffordances, BoardHandlers } from './playAffordances'
import type { CardDb, GameState, PlayerId } from '../engine/types'

export interface ZonePanelsProps {
  db: CardDb
  state: GameState
  player: PlayerId
  affordances: BoardAffordances
  handlers: BoardHandlers
  useOfficialImages: boolean
  /** This player's fixer offers the pending `chooseGigDie` decision. */
  fixerInteractive: boolean
  /** This player's Gig area is the victim of a pending steal the human owns. */
  gigStealInteractive: boolean
  /** This player's Gig area is a legal target of the selected attack. */
  gigAreaTargetable: boolean
}

/**
 * The Fixer area (unrolled dice, per the official playmat) and the Gig area
 * (rolled dice, plus the Street Cred they add up to).
 *
 * A Gig die is interactive in exactly two situations, both of them entries in
 * `legal`: a `chooseGigDie` on your own fixer at the start of your turn, and a
 * `chooseGig` on the victim's Gig area while a steal you own is pending.
 */
function DicePanels(props: ZonePanelsProps): ReactElement {
  const { state, player, affordances, handlers, fixerInteractive, gigStealInteractive } = props
  const p = state.players[player]

  return (
    <>
      <div className="zone zone--fixer" data-testid="fixer" data-player={player}>
        <span className="zone__label">Fixer</span>
        <div className="zone__dice">
          {p.fixer.length === 0 && <span className="zone__empty">empty</span>}
          {p.fixer.map((die, index) => {
            const choosable = fixerInteractive && affordances.fixerSizes.has(die.size)
            return (
              <button
                type="button"
                key={`${die.size}-${index}`}
                className={`die-slot${choosable ? ' is-choosable' : ''}`}
                data-testid="fixer-die"
                data-size={die.size}
                data-choosable={choosable ? 'true' : undefined}
                disabled={!choosable}
                onClick={() => handlers.onFixerDie(die.size)}
              >
                <Die die={die} rolled={false} />
              </button>
            )
          })}
        </div>
      </div>

      <div
        className={`zone zone--gig${props.gigAreaTargetable ? ' is-target' : ''}`}
        data-testid="gig-area"
        data-player={player}
        data-target={props.gigAreaTargetable ? 'true' : undefined}
      >
        <span className="zone__label">
          Gig area <span data-testid="gig-count">{p.gigArea.length}</span> · ☆
          <span data-testid="street-cred">{streetCred(state, player)}</span>
        </span>
        <div className="zone__dice">
          {p.gigArea.length === 0 && <span className="zone__empty">empty</span>}
          {p.gigArea.map((die, index) => {
            const stealable = gigStealInteractive && affordances.stealableGigIndexes.has(index)
            return (
              <button
                type="button"
                key={index}
                className={`die-slot${stealable ? ' is-stealable' : ''}`}
                data-testid="gig-die"
                data-index={index}
                data-size={die.size}
                data-stealable={stealable ? 'true' : undefined}
                disabled={!stealable}
                onClick={() => handlers.onGigDie(index)}
              >
                <Die die={die} rolled />
              </button>
            )
          })}
        </div>
        {props.gigAreaTargetable && (
          <button
            type="button"
            className="zone__attack-gig"
            data-testid="attack-gig-area"
            onClick={handlers.onGigArea}
          >
            Attack this Gig area
          </button>
        )}
      </div>
    </>
  )
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

/** One player's half of the playmat, minus the field and hand. */
export function ZonePanels(props: ZonePanelsProps): ReactElement {
  return (
    <div className="zone-panels" data-testid="zone-panels" data-player={props.player}>
      <DicePanels {...props} />
      <CardZones {...props} />
    </div>
  )
}
