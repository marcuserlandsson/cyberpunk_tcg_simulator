import { useEffect, useRef, type ReactElement } from 'react'
import type { LogLine } from './useGame'

export interface LogPanelProps {
  lines: LogLine[]
}

/**
 * The event log: newest at the bottom, auto-scrolled so the latest line is
 * always visible. Lines come straight from `useGame`'s `eventsForLog`, which
 * renders every `GameEvent` through `describeEvent` — so the panel is a pure
 * view of the engine's own history, with no separate narration to drift out of
 * sync (and undo removes lines simply because the events are gone).
 */
export function LogPanel({ lines }: LogPanelProps): ReactElement {
  const scroller = useRef<HTMLOListElement>(null)

  useEffect(() => {
    const element = scroller.current
    if (element !== null) element.scrollTop = element.scrollHeight
  }, [lines.length])

  return (
    <aside className="log-panel" data-testid="log-panel" aria-label="Game log">
      <h3 className="log-panel__title">Log</h3>
      <ol className="log-panel__lines" ref={scroller} data-testid="log-lines">
        {lines.map((line, index) => (
          <li className="log-panel__line" key={index} data-testid="log-line" data-turn={line.turn}>
            <span className="log-panel__turn">{line.turn > 0 ? `T${line.turn}` : '—'}</span>
            <span className="log-panel__text">{line.text}</span>
          </li>
        ))}
      </ol>
    </aside>
  )
}
