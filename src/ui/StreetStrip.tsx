import type { ReactElement } from 'react'
import { Die } from './Dice'
import { isOvertime, GIGS_TO_WIN } from '../engine/game'
import { streetCred } from '../engine/query'
import { AI, HUMAN } from './useGame'
import type { BoardAffordances, BoardHandlers } from './playAffordances'
import type { CardDb, GameState, PlayerId } from '../engine/types'

export interface StreetStripProps {
  db: CardDb
  state: GameState
  affordances: BoardAffordances
  handlers: BoardHandlers
  /** The human's fixer offers the pending `chooseGigDie` decision. */
  humanFixerInteractive: boolean
  /** The rival's Gig area is the victim of a pending steal the human owns. */
  rivalGigStealInteractive: boolean
  /** The rival's Gig area is a legal target of the selected attack. */
  rivalGigAreaTargetable: boolean
}

// Same phase labels PlayView's control bar uses — duplicated rather than
// shared, since the two call sites have no other reason to depend on each
// other and this table is tiny.
const PHASE_LABELS: Record<string, string> = {
  chooseOrder: 'Choosing play order',
  mulligan: 'Mulligan',
  start: 'Start of turn',
  main: 'Main phase',
  react: 'Reaction window',
  chooseGig: 'Stealing a Gig',
  gigReroll: 'Gig reroll',
  intercept: 'Interception',
  gameOver: 'Game over',
}

interface GigPoolProps {
  state: GameState
  player: PlayerId
  affordances: BoardAffordances
  handlers: BoardHandlers
  fixerInteractive: boolean
  gigStealInteractive: boolean
  gigAreaTargetable: boolean
  side: 'you' | 'rival'
  label: string
}

/**
 * One player's dice pool: the Gig area's rolled dice followed by the Fixer's
 * unrolled ones, laid out as a single row (per the mockup's "street" strip —
 * fixer dice show as dim outlines until rolled) while keeping the two
 * testid groups (`fixer`, `gig-area`) `ZonePanels`'s old `DicePanels` used to
 * carry, since the E2E suite clicks into them directly.
 */
function GigPool(props: GigPoolProps): ReactElement {
  const {
    state,
    player,
    affordances,
    handlers,
    fixerInteractive,
    gigStealInteractive,
    gigAreaTargetable,
    side,
    label,
  } = props
  const p = state.players[player]

  return (
    <div className={`street__side street__side--${side}`}>
      <span className="street__label">
        {label} · <span data-testid="gig-count">{p.gigArea.length}</span>{' '}
        <span aria-hidden="true">★</span>{' '}
        <span data-testid="street-cred">{streetCred(state, player)}</span>
      </span>
      <div className="street__pool">
        <div
          className={`zone zone--gig${gigAreaTargetable ? ' is-target' : ''}`}
          data-testid="gig-area"
          data-player={player}
          data-target={gigAreaTargetable ? 'true' : undefined}
        >
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
        <div className="zone zone--fixer" data-testid="fixer" data-player={player}>
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
      {gigAreaTargetable && (
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
  )
}

/**
 * The "street" — both players' Gig/Fixer dice facing each other across the
 * table, with the contested win condition centered between them. This is the
 * one place on the board both sides' dice render, so it owns the `fixer` and
 * `gig-area` testid groups outright (moved wholesale out of `ZonePanels`'s
 * old `DicePanels`).
 */
export function StreetStrip(props: StreetStripProps): ReactElement {
  const { state, affordances, handlers } = props

  return (
    <div className="street" data-testid="center-strip">
      <GigPool
        state={state}
        player={AI}
        affordances={affordances}
        handlers={handlers}
        fixerInteractive={false}
        gigStealInteractive={props.rivalGigStealInteractive}
        gigAreaTargetable={props.rivalGigAreaTargetable}
        side="rival"
        label="Rival gigs"
      />

      <div className="street__vs">
        <div className="street__turn" data-testid="center-turn">
          Turn {state.turnNumber} · {PHASE_LABELS[state.phase] ?? state.phase}
        </div>
        <div
          className={`street__active street__active--${state.activePlayer === HUMAN ? 'you' : 'rival'}`}
        >
          {state.activePlayer === HUMAN ? 'Your turn' : "Rival's turn"}
        </div>
        <div className="street__win-condition">
          {isOvertime(state) ? 'OVERTIME — majority wins' : `first to ${GIGS_TO_WIN} gigs wins`}
        </div>
      </div>

      <GigPool
        state={state}
        player={HUMAN}
        affordances={affordances}
        handlers={handlers}
        fixerInteractive={props.humanFixerInteractive}
        gigStealInteractive={false}
        gigAreaTargetable={false}
        side="you"
        label="Your gigs"
      />
    </div>
  )
}
