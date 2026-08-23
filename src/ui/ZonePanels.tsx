import type { ReactElement } from 'react'
import { BoardCard } from './Field'
import { CardFrame, type CardFrameOwner } from './CardFrame'
import { AI } from './useGame'
import type { BoardAffordances, BoardHandlers } from './playAffordances'
import type { CardDb, CardDef, GameState, PlayerId } from '../engine/types'

export interface ZonePanelsProps {
  db: CardDb
  state: GameState
  player: PlayerId
  affordances: BoardAffordances
  handlers: BoardHandlers
  useOfficialImages: boolean
}

/**
 * Fed to every face-down `CardFrame` this module renders (eddies, deck pile,
 * trash pile) instead of the real card's def. `CardFrame` never shows a
 * face-down card's name/text, but it does still read `def.id` (its
 * `data-def-id` attribute) and `def.color` (the border accent) even when
 * face down — using this fixed, contentless def instead of the real sold/
 * deck/trash card's keeps that plumbing from ever leaking a hidden card's
 * identity. Per docs/rulings.md (a face-down €$ is worth exactly 1 €$
 * whichever card it is; its identity is never material), that hygiene
 * matters more than which specific def happens to be in a pile.
 */
const FACE_DOWN_DEF: CardDef = {
  id: 'face-down',
  name: '',
  color: '',
  type: 'unit',
  cost: 0,
  power: null,
  ram: null,
  ramLimit: null,
  sellTag: false,
  keywords: [],
  text: '',
  effects: [],
}

/** Eddies past this count start overlapping instead of wrapping the strip. */
const EDDIES_DENSE_THRESHOLD = 6

/**
 * The card-holding side zones: Legends (face-down until Called, and playable
 * from here when they print {Go Solo}), Eddies, Deck and Trash. Deck and Trash
 * are visual piles (a face-down back + count chip) rather than card lists —
 * the deck is hidden information, and the trash is public but not a place
 * anything is clicked from. Eddies render physically too — one small
 * face-down back per sold card, tapping when spent — with the ready/total
 * chip beside the row as the at-a-glance summary.
 */
function CardZones(props: ZonePanelsProps): ReactElement {
  const { db, state, player, affordances, handlers, useOfficialImages } = props
  const p = state.players[player]
  const readyEddies = p.eddies.filter((uid) => state.cards[uid].ready).length
  const owner: CardFrameOwner = player === AI ? 'rival' : 'you'
  const eddiesClasses = [
    'zone',
    'zone--eddies',
    p.eddies.length > EDDIES_DENSE_THRESHOLD && 'zone--eddies--dense',
  ]
    .filter(Boolean)
    .join(' ')

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

      <div className={eddiesClasses} data-testid="eddies" data-player={player}>
        <span className="zone__label">Eddies</span>
        <div className="zone__cards">
          {p.eddies.map((uid) => {
            const ready = state.cards[uid].ready
            return (
              <div
                key={uid}
                className="eddie-card"
                data-testid="eddie-card"
                data-ready={ready ? 'true' : 'false'}
              >
                <CardFrame
                  def={FACE_DOWN_DEF}
                  size="small"
                  faceDown
                  ready={ready}
                  owner={owner}
                  useOfficialImages={useOfficialImages}
                />
              </div>
            )
          })}
        </div>
        <span className="zone__count chip" data-testid="eddies-count">
          €$ {readyEddies}/{p.eddies.length}
        </span>
      </div>

      <div className="zone zone--counts" data-testid="counts" data-player={player}>
        <div className="pile">
          <CardFrame
            def={FACE_DOWN_DEF}
            size="small"
            faceDown
            owner={owner}
            useOfficialImages={useOfficialImages}
          />
          <span className="chip pile__count" data-testid="deck-count">
            Deck {p.deck.length}
          </span>
        </div>
        <div className="pile">
          <CardFrame
            def={FACE_DOWN_DEF}
            size="small"
            faceDown
            owner={owner}
            useOfficialImages={useOfficialImages}
          />
          <span className="chip pile__count" data-testid="trash-count">
            Trash {p.trash.length}
          </span>
        </div>
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
