import type { CSSProperties, ReactElement, ReactNode } from 'react'
import type { CardDef } from '../engine/types'
import { getOfficialImageUrl } from './images'

export type CardFrameSize = 'small' | 'medium' | 'zoom'

export interface CardFrameProps {
  def: CardDef
  size: CardFrameSize
  faceDown?: boolean
  ready?: boolean
  lag?: boolean
  tempPower?: number
  useOfficialImages: boolean
  onClick?: () => void
}

// The game's four RAM colors, mapped onto theme.css custom properties.
const RAM_COLOR_VARS: Record<string, string> = {
  Red: 'var(--ram-red)',
  Yellow: 'var(--ram-yellow)',
  Green: 'var(--ram-green)',
  Blue: 'var(--ram-blue)',
}

function ramColorVar(color: string): string {
  return RAM_COLOR_VARS[color] ?? 'var(--neon-cyan)'
}

// React's CSSProperties doesn't model custom properties; this is the usual
// widening to let a component set them via `style`.
type StyleWithVars = CSSProperties & Record<`--${string}`, string>

/**
 * Splits rules text on `{Braced}` timing/keyword markers ("{Play}", "{Go
 * Solo}", "{Blocker}", ...) and wraps each one in a `card-frame__keyword`
 * span so they can be styled distinctly from the surrounding rules text.
 */
function renderRulesText(text: string): ReactNode[] {
  return text.split(/(\{[^}]+\})/g).map((part, index) =>
    part.startsWith('{') && part.endsWith('}') ? (
      <span className="card-frame__keyword" key={index}>
        {part}
      </span>
    ) : (
      <span key={index}>{part}</span>
    )
  )
}

function CardFrameFace(props: {
  def: CardDef
  tempPower: number
  lag: boolean
}): ReactElement {
  const { def, tempPower, lag } = props
  const effectivePower = def.power === null ? null : def.power + tempPower

  return (
    <>
      <div className="card-frame__top">
        <div className="card-frame__cost-badge">
          <span className="card-frame__cost-value">{def.cost}</span>
          {def.sellTag && (
            <span className="card-frame__sell-tag" aria-label="Sell tag" title="Sell tag">
              €$
            </span>
          )}
        </div>
        <div className="card-frame__type-col">
          <div className="card-frame__type-label">{def.type}</div>
          {def.ram && (
            <div
              className="card-frame__ram-pips"
              aria-label={`${def.ram.value} ${def.ram.color} RAM`}
            >
              {Array.from({ length: def.ram.value }, (_, index) => (
                <span
                  className="card-frame__ram-pip"
                  key={index}
                  style={{ backgroundColor: ramColorVar(def.ram!.color) }}
                />
              ))}
            </div>
          )}
          {def.ramLimit && (
            <div
              className="card-frame__ram-limit-badge"
              style={{ borderColor: ramColorVar(def.ramLimit.color) }}
              aria-label={`RAM limit ${def.ramLimit.value} ${def.ramLimit.color}`}
            >
              ×{def.ramLimit.value}
            </div>
          )}
        </div>
      </div>

      <div className="card-frame__name">
        {def.name}
        {def.subtitle && <span className="card-frame__subtitle">{def.subtitle}</span>}
      </div>

      {(def.faction || def.keywords.length > 0) && (
        <div className="card-frame__tags">
          {def.faction && <span className="card-frame__tag">{def.faction}</span>}
          {def.keywords.map((keyword) => (
            <span className="card-frame__tag" key={keyword}>
              {keyword}
            </span>
          ))}
        </div>
      )}

      <div className="card-frame__text">{renderRulesText(def.text)}</div>

      <div className="card-frame__bottom">
        {lag && <span className="card-frame__lag-chip">LAG</span>}
        {effectivePower !== null && (
          <span className="card-frame__power">
            {effectivePower}
            {tempPower !== 0 && (
              <span className="card-frame__power-delta">
                {tempPower > 0 ? `+${tempPower}` : tempPower}
              </span>
            )}
          </span>
        )}
      </div>
    </>
  )
}

/**
 * Renders one card face: cost/sell-tag badge, type label, RAM pips/limit
 * badge, name/subtitle, faction/keyword tags, rules text (with `{...}`
 * keyword highlighting), and power — or, face down, just a card-back
 * pattern. `ready`/`lag` drive the spent rotation and Lag dimming; official
 * art (via `useOfficialImages`) falls back to the same text face on hover so
 * the card is always legible.
 */
export function CardFrame(props: CardFrameProps): ReactElement {
  const {
    def,
    size,
    faceDown = false,
    ready = true,
    lag = false,
    tempPower = 0,
    useOfficialImages,
    onClick,
  } = props

  const classes = [
    'card-frame',
    `card-frame--${size}`,
    !ready && 'card-frame--spent',
    lag && 'card-frame--lag',
    faceDown && 'card-frame--face-down',
  ]
    .filter(Boolean)
    .join(' ')

  const style: StyleWithVars = { '--card-border-color': ramColorVar(def.color) }
  const imageUrl = useOfficialImages ? getOfficialImageUrl(def.id) : undefined

  return (
    <div
      className={classes}
      style={style}
      onClick={onClick}
      data-testid="card-frame"
      data-def-id={def.id}
    >
      {faceDown ? (
        <div className="card-frame__back" aria-label="Face-down card" />
      ) : imageUrl ? (
        <div className="card-frame__image-wrap">
          <img className="card-frame__image" src={imageUrl} alt={def.name} />
          <div className="card-frame__zoom-fallback">
            <CardFrameFace def={def} tempPower={tempPower} lag={lag} />
          </div>
        </div>
      ) : (
        <CardFrameFace def={def} tempPower={tempPower} lag={lag} />
      )}
    </div>
  )
}
