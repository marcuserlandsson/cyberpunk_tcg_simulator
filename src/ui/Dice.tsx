import type { ReactElement } from 'react'
import type { DieSize, GigDie } from '../engine/types'

export interface DieProps {
  die: GigDie
  /** Whether this die has been rolled — an unrolled die (fixer, value 0) shows "?". */
  rolled: boolean
}

const SIZE_PX: Record<DieSize, number> = {
  4: 44,
  6: 48,
  8: 48,
  10: 52,
  12: 56,
  20: 56,
}

/** Evenly-spaced polygon vertices around a circle inscribed in `sizePx`. */
function polygonPoints(sides: number, sizePx: number, rotationDeg: number): string {
  const center = sizePx / 2
  const radius = sizePx / 2 - 3
  const points: string[] = []
  for (let i = 0; i < sides; i++) {
    const angle = ((rotationDeg + (360 / sides) * i) * Math.PI) / 180
    const x = center + radius * Math.cos(angle)
    const y = center + radius * Math.sin(angle)
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`)
  }
  return points.join(' ')
}

/**
 * One silhouette per die size, so a d4/d6/d8/d10/d12/d20 stay visually
 * distinct even before the reader looks at the value: triangle, square,
 * diamond, pentagon, hexagon, circle.
 */
function Silhouette({ size, sizePx }: { size: DieSize; sizePx: number }): ReactElement {
  switch (size) {
    case 4:
      return <polygon className="die__shape" points={polygonPoints(3, sizePx, -90)} />
    case 6:
      return (
        <rect
          className="die__shape"
          x={3}
          y={3}
          width={sizePx - 6}
          height={sizePx - 6}
          rx={4}
        />
      )
    case 8:
      return <polygon className="die__shape" points={polygonPoints(4, sizePx, -90)} />
    case 10:
      return <polygon className="die__shape" points={polygonPoints(5, sizePx, -90)} />
    case 12:
      return <polygon className="die__shape" points={polygonPoints(6, sizePx, -90)} />
    case 20:
      return <circle className="die__shape" cx={sizePx / 2} cy={sizePx / 2} r={sizePx / 2 - 3} />
  }
}

/**
 * Renders one Gig die as an SVG: a size-distinct silhouette with the value
 * (or "?" while unrolled) centered on top. Color is left to the parent
 * (e.g. a friendly/rival wrapper applying `color: var(--neon-cyan)`) via
 * `currentColor`, per the brief.
 */
export function Die({ die, rolled }: DieProps): ReactElement {
  const sizePx = SIZE_PX[die.size]
  const label = rolled ? `d${die.size} showing ${die.value}` : `d${die.size}, unrolled`

  return (
    <svg
      className={`die die--d${die.size}${rolled ? '' : ' die--unrolled'}`}
      width={sizePx}
      height={sizePx}
      viewBox={`0 0 ${sizePx} ${sizePx}`}
      role="img"
      aria-label={label}
      data-testid="die"
    >
      <Silhouette size={die.size} sizePx={sizePx} />
      <text
        className="die__value"
        x={sizePx / 2}
        y={sizePx / 2}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {rolled ? die.value : '?'}
      </text>
    </svg>
  )
}
