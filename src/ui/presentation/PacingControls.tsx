// Speed / pause / skip-turn for beat playback. Lives in the playmat rail and
// uses the shared check-chip and ghost-button vocabulary (tools.css,
// chrome.css).

import type { ReactElement } from 'react'
import type { Beat } from './beats'
import { SPEEDS, type Speed } from './speed'

const LABELS: Record<Speed, string> = { slow: 'Slow', normal: 'Normal', fast: 'Fast', instant: 'Instant' }

export interface PacingControlsProps {
  speed: Speed
  onSpeed: (speed: Speed) => void
  paused: boolean
  onPause: () => void
  onSkipTurn: () => void
  beat: Beat | null
  /** Instant is forced (aiDelay=0 or reduced motion): speeds are read-only. */
  disabled: boolean
}

export function PacingControls(props: PacingControlsProps): ReactElement {
  const { speed, onSpeed, paused, onPause, onSkipTurn, beat, disabled } = props
  return (
    <div className="pacing-controls" data-testid="pacing-controls">
      <fieldset className="check-list" aria-label="Playback speed">
        {SPEEDS.map((option) => (
          <label key={option} className="check-chip">
            <input
              type="radio"
              name="pacing-speed"
              data-testid={`pacing-speed-${option}`}
              checked={speed === option}
              disabled={disabled}
              onChange={() => onSpeed(option)}
            />
            {LABELS[option]}
          </label>
        ))}
      </fieldset>
      <div className="pacing-controls__row">
        <button type="button" className="btn--ghost" data-testid="pacing-pause" aria-pressed={paused} disabled={beat === null} onClick={onPause}>
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" className="btn--ghost" data-testid="pacing-skip-turn" disabled={beat === null} onClick={onSkipTurn}>
          Skip turn
        </button>
        {beat !== null && (
          <span className="chip" data-testid="pacing-step">Beat {beat.step}/{beat.of}</span>
        )}
      </div>
    </div>
  )
}
