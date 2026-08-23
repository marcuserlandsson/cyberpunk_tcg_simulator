import type { ReactElement } from 'react'
import { CardFrame, type CardFrameOwner } from './CardFrame'
import { effectivePower } from '../engine/query'
import { AI } from './useGame'
import type { BoardAffordances, BoardHandlers } from './playAffordances'
import type { CardDb, GameState, PlayerId } from '../engine/types'

export interface FieldProps {
  db: CardDb
  state: GameState
  player: PlayerId
  affordances: BoardAffordances
  handlers: BoardHandlers
  useOfficialImages: boolean
}

/**
 * One in-play card, with every affordance class the playmat can put on it.
 *
 * The classes are the whole interaction vocabulary: `is-playable` (cyan, a
 * legal `playCard`), `is-attacker` (magenta, a legal `attack`), `is-selected`
 * (the attacker whose target is being picked), `is-target` (a candidate of the
 * pending choice). Each one is derived from `legal` by playAffordances.ts, so a
 * glow and a legal action are the same fact.
 */
export function BoardCard(props: {
  db: CardDb
  state: GameState
  uid: number
  zone: string
  affordances: BoardAffordances
  handlers: BoardHandlers
  useOfficialImages: boolean
  faceDown?: boolean
}): ReactElement | null {
  const { db, state, uid, zone, affordances, handlers, useOfficialImages } = props
  const instance = state.cards[uid]
  if (instance === undefined) return null
  const def = db[instance.defId]
  if (def === undefined) return null

  const faceDown = props.faceDown ?? !instance.faceUp
  const playable = affordances.playable.has(uid)
  const attacker = affordances.attackers.has(uid)
  const target = affordances.targets.has(uid)
  const selected = affordances.selected === uid
  const hasAbility = affordances.abilities.has(uid)
  const sellable = affordances.sellable.has(uid)
  const clickable = playable || attacker || target

  const classes = [
    'board-card',
    `board-card--${zone}`,
    playable && 'is-playable',
    attacker && 'is-attacker',
    target && 'is-target',
    selected && 'is-selected',
    clickable && 'is-clickable',
  ]
    .filter(Boolean)
    .join(' ')

  // A face-down Legend has no public identity, so its power is not shown; the
  // effective power of everything else includes every live buff/static the
  // engine currently computes, which is the number that actually matters.
  const power = faceDown || def.power === null ? null : effectivePower(db, state, uid)
  const delta = power === null || def.power === null ? 0 : power - def.power
  // Red-keys the rival's own cards (frame, ready ring, face-down back) so a
  // glance at the field tells whose card is whose — the same `owner` prop
  // ZonePanels already threads through for eddies/deck/trash piles.
  const owner: CardFrameOwner = instance.owner === AI ? 'rival' : 'you'

  return (
    <div
      className={classes}
      data-testid="board-card"
      data-uid={uid}
      data-zone={zone}
      data-def-id={faceDown ? undefined : def.id}
      data-playable={playable ? 'true' : undefined}
      data-attacker={attacker ? 'true' : undefined}
      data-target={target ? 'true' : undefined}
    >
      {/* A `div role="button"` rather than a real <button>: CardFrame's root is
          a <div> (flow content), which a <button> may not legally contain. */}
      <div
        className="board-card__hit"
        role="button"
        tabIndex={clickable ? 0 : -1}
        aria-disabled={!clickable}
        data-testid={
          playable
            ? 'playable-card'
            : target
              ? 'target-card'
              : attacker
                ? 'attacker-card'
                : 'board-card-hit'
        }
        aria-label={faceDown ? 'Face-down card' : def.name}
        onClick={clickable ? () => handlers.onCard(uid) : undefined}
        onKeyDown={
          clickable
            ? (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                handlers.onCard(uid)
              }
            : undefined
        }
      >
        <CardFrame
          def={def}
          size="small"
          faceDown={faceDown}
          ready={instance.ready}
          lag={instance.lag}
          tempPower={delta}
          owner={owner}
          useOfficialImages={useOfficialImages}
        />
      </div>
      {instance.attachedGear.length > 0 && (
        <span className="board-card__gear" data-testid="gear-count">
          +{instance.attachedGear.length} gear
        </span>
      )}
      <div className="board-card__buttons">
        {sellable && (
          <button
            type="button"
            className="board-card__action"
            data-testid="sell-button"
            data-uid={uid}
            onClick={() => handlers.onSell(uid)}
          >
            Sell
          </button>
        )}
        {hasAbility && (
          <button
            type="button"
            className="board-card__action"
            data-testid="ability-button"
            data-uid={uid}
            onClick={() => handlers.onAbility(uid)}
          >
            Ability
          </button>
        )}
      </div>
    </div>
  )
}

/** A player's field: the Units in play, left to right in engine order. */
export function Field(props: FieldProps): ReactElement {
  const { db, state, player, affordances, handlers, useOfficialImages } = props
  const field = state.players[player].field

  return (
    <div className="zone zone--field" data-testid="field" data-player={player}>
      <span className="zone__label">Field</span>
      <div className="zone__cards">
        {field.length === 0 && <span className="zone__empty">empty</span>}
        {field.map((uid) => (
          <BoardCard
            key={uid}
            db={db}
            state={state}
            uid={uid}
            zone="field"
            affordances={affordances}
            handlers={handlers}
            useOfficialImages={useOfficialImages}
          />
        ))}
      </div>
    </div>
  )
}
