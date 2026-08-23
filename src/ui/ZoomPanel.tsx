import type { ReactElement } from 'react'
import { CardFrame, type CardFrameOwner } from './CardFrame'
import { effectiveKeywords, effectivePower } from '../engine/query'
import { AI } from './useGame'
import type { CardDb, GameState } from '../engine/types'

export interface ZoomPanelProps {
  db: CardDb
  state: GameState
  /** The uid the board/hand is currently hovering (or focused on), or null
   *  while nothing is. */
  uid: number | null
  useOfficialImages: boolean
}

/**
 * The fixed zoom panel a board/hand hover opens (design spec's "Card
 * renditions" §3 ZoomCard, "Play view" hand-fan paragraph): the full
 * `CardFrame size="zoom"` rendition of whatever `uid` names, plus a compact
 * live-state strip below it — effective power, granted keywords, and
 * attachment names, none of which the printed card face itself shows.
 *
 * INFORMATION HYGIENE. This is the single place that decides whether a
 * hovered card's identity may be shown: a face-down card (an uncalled
 * Legend, either side's) renders its back and nothing else, exactly like
 * every other face-down rendition in the app — never the live-state strip,
 * which would otherwise leak an effective power/keyword list for a card
 * whose very identity is supposed to be secret. The rival's hand never
 * reaches this component at all (`HandStrip` renders it as plain back divs
 * with no hover wiring), so the only face-down case this ever actually sees
 * is an uncalled Legend.
 */
export function ZoomPanel(props: ZoomPanelProps): ReactElement | null {
  const { db, state, uid, useOfficialImages } = props
  if (uid === null) return null
  const instance = state.cards[uid]
  if (instance === undefined) return null
  const def = db[instance.defId]
  if (def === undefined) return null

  const owner: CardFrameOwner = instance.owner === AI ? 'rival' : 'you'
  const faceDown = !instance.faceUp

  if (faceDown) {
    return (
      <div className="zoom-panel" data-testid="zoom-panel">
        <CardFrame
          def={def}
          size="zoom"
          faceDown
          owner={owner}
          useOfficialImages={useOfficialImages}
        />
      </div>
    )
  }

  const power = def.power === null ? null : effectivePower(db, state, uid)
  const tempPower = power === null ? 0 : power - (def.power ?? 0)
  const keywords = effectiveKeywords(db, state, uid)
  const attachmentNames = instance.attachedGear
    .map((gearUid) => db[state.cards[gearUid]?.defId ?? '']?.name)
    .filter((name): name is string => name !== undefined)

  return (
    <div className="zoom-panel" data-testid="zoom-panel">
      <CardFrame
        def={def}
        size="zoom"
        ready={instance.ready}
        lag={instance.lag}
        tempPower={tempPower}
        owner={owner}
        useOfficialImages={useOfficialImages}
      />
      <div className="zoom-panel__strip" data-testid="zoom-panel-strip">
        {power !== null && <span className="chip">Power {power}</span>}
        {keywords.map((keyword) => (
          <span className="chip" key={keyword}>
            {keyword}
          </span>
        ))}
        {attachmentNames.map((name, index) => (
          <span className="chip" key={`${name}-${index}`}>
            {name}
          </span>
        ))}
      </div>
    </div>
  )
}
