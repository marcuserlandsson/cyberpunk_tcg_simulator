import { useState } from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import type { CardDef } from '../engine/types'
import { getOfficialImageUrl } from './images'

export type CardFrameSize = 'small' | 'medium' | 'zoom'
export type CardFrameOwner = 'you' | 'rival'

export interface CardFrameProps {
  def: CardDef
  size: CardFrameSize
  faceDown?: boolean
  ready?: boolean
  lag?: boolean
  tempPower?: number
  useOfficialImages: boolean
  /** Keys the face-down back pattern and (later tasks) the ready ring to the
   *  human or the rival. Defaults to 'you' so every existing call site (which
   *  predates this prop) keeps rendering exactly as before. */
  owner?: CardFrameOwner
  /** Zoom-panel live-state strip (effective power, active keyword pips) shown
   *  alongside the official image. Task 6 wires richer live state (granted
   *  keywords, attachments, turn buffs) through this same strip; here it
   *  reflects only what CardFrame already knows (tempPower, printed
   *  keywords). Has no effect outside size="zoom" image mode. */
  showLiveChips?: boolean
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
  return RAM_COLOR_VARS[color] ?? 'var(--you)'
}

// The four mechanical keywords that get a single-letter pip on compact faces
// and the image overlay. Every other entry in `def.keywords` is an inert
// classification tag (faction/role labels like "corpo", "merc") rendered in
// the zoom face's tags row instead — see engine/types.ts's `Keyword` doc.
const MECHANICAL_KEYWORDS: readonly string[] = ['adrenaline', 'quick', 'blocker', 'go-solo']

const KEYWORD_LABELS: Record<string, string> = {
  adrenaline: 'Adrenaline',
  quick: 'Quick',
  blocker: 'Blocker',
  'go-solo': 'Go Solo',
}

interface KeywordPip {
  keyword: string
  letter: string
  label: string
}

function activeKeywordPips(def: CardDef): KeywordPip[] {
  return MECHANICAL_KEYWORDS.filter((keyword) => def.keywords.includes(keyword)).map(
    (keyword) => ({
      keyword,
      letter: keyword.charAt(0).toUpperCase(),
      label: KEYWORD_LABELS[keyword],
    })
  )
}

function classificationTags(def: CardDef): string[] {
  return def.keywords.filter((keyword) => !MECHANICAL_KEYWORDS.includes(keyword))
}

// React's CSSProperties doesn't model custom properties; this is the usual
// widening to let a component set them via `style`.
type StyleWithVars = CSSProperties & Record<`--${string}`, string>

/**
 * Splits rules text on `{Braced}` timing/keyword markers ("{Play}", "{Go
 * Solo}", "{Blocker}", ...) and wraps each one in a `card-frame__keyword`
 * span (styled as a `.kw-capsule`, the shared chrome utility) so they read as
 * distinct triggers from the surrounding rules text.
 */
function renderRulesText(text: string): ReactNode[] {
  return text.split(/(\{[^}]+\})/g).map((part, index) =>
    part.startsWith('{') && part.endsWith('}') ? (
      <span className="card-frame__keyword kw-capsule" key={index}>
        {part}
      </span>
    ) : (
      <span key={index}>{part}</span>
    )
  )
}

/** The small hex pip column for active mechanical keywords, shared by the
 *  compact text face and the image overlay. */
function KeywordPips({ def }: { def: CardDef }): ReactElement | null {
  const pips = activeKeywordPips(def)
  if (pips.length === 0) return null
  return (
    <div className="card-frame__kw-pips">
      {pips.map((pip) => (
        <span className="card-frame__kw-pip" key={pip.keyword} title={pip.label}>
          {pip.letter}
        </span>
      ))}
    </div>
  )
}

/**
 * One text/HTML card face. `compact` (true for size="small"/"medium") omits
 * the subtitle, faction/classification tags, rules text, and barcode decor —
 * exactly the print-card content that only matters on close inspection —
 * keeping the board and hand renditions to name/cost/power/keyword-pips.
 * `size="zoom"` (compact: false) renders the full printed layout.
 */
function CardFrameFace(props: {
  def: CardDef
  tempPower: number
  lag: boolean
  compact: boolean
}): ReactElement {
  const { def, tempPower, lag, compact } = props
  const effectivePower = def.power === null ? null : def.power + tempPower
  const tags = classificationTags(def)

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
          <span className="card-frame__type-capsule">{def.type}</span>
          <div className="card-frame__ram-row">
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
      </div>

      <div className="card-frame__art">
        {lag && <span className="card-frame__lag-band">LAG</span>}
      </div>

      <KeywordPips def={def} />

      <div className="card-frame__name">
        {def.name}
        {!compact && def.subtitle && <span className="card-frame__subtitle">{def.subtitle}</span>}
      </div>

      {!compact && (def.faction || tags.length > 0) && (
        <div className="card-frame__tags">
          {def.faction && <span className="card-frame__tag">{def.faction}</span>}
          {tags.map((tag) => (
            <span className="card-frame__tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>
      )}

      {!compact && <div className="card-frame__text">{renderRulesText(def.text)}</div>}

      <div className="card-frame__bottom">
        {!compact && <div className="card-frame__barcode" aria-hidden="true" />}
        {effectivePower !== null && (
          <span
            className={[
              'card-frame__power',
              tempPower > 0 && 'is-buffed',
              tempPower < 0 && 'is-reduced',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {effectivePower}
          </span>
        )}
      </div>
    </>
  )
}

/**
 * Renders one of the card's three renditions:
 * - face down: just the owner-keyed card-back pattern;
 * - official image on (and resolvable, and not previously failed to load):
 *   the `<img>` plus status overlays (power chip, keyword pips, LAG band,
 *   and — size="zoom" only — the live-state chip strip);
 * - otherwise: the HTML text face (`CardFrameFace`), compact for
 *   size="small"/"medium", full for size="zoom". This is also the `onError`
 *   fallback for a broken image, so a card is never left blank.
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
    owner = 'you',
    showLiveChips = false,
    onClick,
  } = props

  const [imageFailed, setImageFailed] = useState(false)

  const classes = [
    'card-frame',
    `card-frame--${size}`,
    `card-frame--${owner}`,
    !ready && 'card-frame--spent',
    lag && 'card-frame--lag',
    faceDown && 'card-frame--face-down',
  ]
    .filter(Boolean)
    .join(' ')

  const style: StyleWithVars = { '--card-border-color': ramColorVar(def.color) }
  const imageUrl = useOfficialImages && !imageFailed ? getOfficialImageUrl(def.id) : undefined
  const effectivePower = def.power === null ? null : def.power + tempPower

  return (
    <div
      className={classes}
      style={style}
      onClick={onClick}
      data-testid="card-frame"
      data-def-id={faceDown ? undefined : def.id}
    >
      {faceDown ? (
        <div className="card-frame__back" aria-label="Face-down card" />
      ) : imageUrl ? (
        <div className="card-frame__image-wrap">
          <img
            className="card-frame__image"
            src={imageUrl}
            alt={def.name}
            onError={() => setImageFailed(true)}
          />
          {tempPower !== 0 && effectivePower !== null && (
            <span
              className={`card-frame__power-chip ${tempPower > 0 ? 'is-buffed' : 'is-reduced'}`}
            >
              {effectivePower}
            </span>
          )}
          <KeywordPips def={def} />
          {lag && <span className="card-frame__lag-band">LAG</span>}
          {size === 'zoom' && showLiveChips && (
            <div className="card-frame__live-chips">
              {effectivePower !== null && <span className="chip">PWR {effectivePower}</span>}
            </div>
          )}
        </div>
      ) : (
        <CardFrameFace def={def} tempPower={tempPower} lag={lag} compact={size !== 'zoom'} />
      )}
    </div>
  )
}
