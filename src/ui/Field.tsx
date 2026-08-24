import type { CSSProperties, ReactElement } from 'react'
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
  /** The attacker whose lunge (Task 8) is currently playing, if any. */
  lungeUid?: number | null
}

// React's CSSProperties doesn't model custom properties; this is the usual
// widening to let a component set them via `style` (mirrors CardFrame.tsx's
// own `StyleWithVars`).
type LungeVars = CSSProperties & { '--lunge-dir': string }

/**
 * One in-play card, with every affordance class the playmat can put on it.
 *
 * The classes are the whole interaction vocabulary: `is-playable` (yellow
 * pulse, a legal `playCard`), `is-attacker` (yellow pulse, a legal `attack`)
 * — both read as "you can act with this right now", per tokens.css's
 * cyan/red/yellow semantics — `is-selected` (a solid yellow outline on the
 * attacker whose target is being picked), `is-target` (cyan, a candidate of
 * the pending choice — a thing you can choose, not something you can act
 * with unilaterally). Each one is derived from `legal` by playAffordances.ts,
 * so a glow and a legal action are the same fact.
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
  /** The hand fan's `--i`/`--n` custom properties (board.css), set on THIS
   *  element deliberately — it is the actual flex item inside `.zone__cards`,
   *  so a margin computed off those vars here is what pulls fanned siblings
   *  into their overlap; a margin set one wrapper div further out would not
   *  (mirrors ZonePanels.tsx's own note on `.eddie-card` vs `.card-frame`). */
  style?: CSSProperties
  /** Task 8's lunge: set only by `Field`'s field-zone cards (hand/legend cards
   *  never attack, so they never pass this). */
  lungeUid?: number | null
}): ReactElement | null {
  const { db, state, uid, zone, affordances, handlers, useOfficialImages, style } = props
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
  const lunging = props.lungeUid !== undefined && props.lungeUid !== null && props.lungeUid === uid

  const classes = [
    'board-card',
    `board-card--${zone}`,
    playable && 'is-playable',
    attacker && 'is-attacker',
    target && 'is-target',
    selected && 'is-selected',
    clickable && 'is-clickable',
    lunging && 'is-lunging',
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

  // Human attackers lunge up (the keyframe's own default, `-14px`); the
  // rival's lunge down, which needs an explicit override.
  const lungeStyle: LungeVars | undefined =
    lunging && owner === 'rival' ? { '--lunge-dir': '14px' } : undefined
  const cardStyle: CSSProperties | undefined =
    style === undefined && lungeStyle === undefined ? undefined : { ...style, ...lungeStyle }

  return (
    <div
      className={classes}
      style={cardStyle}
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
        // Drives the zoom panel (Task 6). Wired on every BoardCard — field,
        // legend, and (the human's own) hand — not just clickable ones: the
        // brief's own worked example hovers a `board-card-hit` (non-legal)
        // card just as readily as a `playable-card` one. `onFocus`/`onBlur`
        // give the same reveal to keyboard navigation, not just a mouse.
        // Info hygiene is ZoomPanel's job, not this handler's: a face-down
        // card's uid is just as safe to report as any other, since ZoomPanel
        // renders nothing but the back for one.
        onMouseEnter={() => handlers.onHover?.(uid)}
        onMouseLeave={() => handlers.onHover?.(null)}
        onFocus={() => handlers.onHover?.(uid)}
        onBlur={() => handlers.onHover?.(null)}
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
  const { db, state, player, affordances, handlers, useOfficialImages, lungeUid } = props
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
            lungeUid={lungeUid}
          />
        ))}
      </div>
    </div>
  )
}
