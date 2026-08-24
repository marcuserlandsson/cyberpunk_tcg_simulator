import type { CSSProperties, ReactElement } from 'react'
import { Die } from './Dice'
import { isOvertime, GIGS_TO_WIN } from '../engine/game'
import { streetCred } from '../engine/query'
import { AI, HUMAN } from './useGame'
import type { BoardAffordances, BoardHandlers } from './playAffordances'
import type { CardDb, DieSize, GameState, PlayerId } from '../engine/types'

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
  /** Task 8: the Gig die whose tumble is currently playing, if any. */
  tumble?: { player: PlayerId; size: DieSize } | null
  /** Task 8: the Gig die whose steal flight is currently playing, if any. */
  steal?: { from: PlayerId; size: DieSize; value: number } | null
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
  /** Task 8: this side's own Gig area holds the die whose tumble is playing. */
  tumbling: boolean
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
    tumbling,
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
            // The most recent die of this side's own Gig area — the only one
            // a `dieRolled` event for this player could be describing
            // (docs/rulings.md's own "reroll re-uses the just-rolled index"
            // shape, see src/engine/reduce.ts's `chooseGigDie`/`chooseGigReroll`).
            const tumblingHere = tumbling && index === p.gigArea.length - 1
            return (
              <button
                type="button"
                key={index}
                className={`die-slot${stealable ? ' is-stealable' : ''}${tumblingHere ? ' is-tumbling' : ''}`}
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
  const { state, affordances, handlers, tumble, steal } = props

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
        tumbling={tumble?.player === AI}
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
        tumbling={tumble?.player === HUMAN}
      />

      {steal != null && (
        // The victim's side is where the die visually WAS; the thief's side
        // is where it just went — `.street` lays rival out on the left and
        // the human out on the right (board.css `.street { display: flex }`),
        // so a steal flies left-to-right or right-to-left depending on which
        // side was robbed. Keyed by its own content (not a counter — Task 8's
        // `AnimationState` carries none) so it remounts and replays the
        // keyframe from scratch whenever a *different* die is stolen; two
        // steals of the identical size/value back to back within one
        // 600ms window is the one case this key would miss, which is cosmetic
        // only (the flag itself still flips and reverts correctly).
        <div
          key={`${steal.from}-${steal.size}-${steal.value}`}
          className={`steal-ghost ${steal.from === AI ? 'street__side--rival' : 'street__side--you'}`}
          style={
            {
              left: steal.from === AI ? '6%' : '80%',
              top: '6px',
              '--fly-x': steal.from === AI ? '260px' : '-260px',
              '--fly-y': '10px',
            } as CSSProperties
          }
          aria-hidden="true"
        >
          <Die die={{ size: steal.size, value: steal.value }} rolled />
        </div>
      )}
    </div>
  )
}
