import { useEffect, useRef, type ReactElement, type ReactNode } from 'react'
import type { LogLine } from './useGame'

export interface LogPanelProps {
  lines: LogLine[]
  /** Rendered beside the "Feed" title — the seed chip lives here now (moved
   *  out of the old control bar per the playmat restyle). */
  headerExtra?: ReactNode
}

/**
 * A line's actor, read off the rendered text only (a presentation heuristic —
 * the engine has no notion of "actor", so this never feeds back into game
 * logic). `describeEvent` always starts a line with one of these words when it
 * is that actor's own line; anything else (card-specific effect text with no
 * leading pronoun, e.g. "Floor It: -1 power on 12.") falls through to the
 * default, unclassed style.
 */
function actorClass(text: string): string | null {
  if (/^(You|Your)\b/.test(text)) return 'log-line--you'
  if (/^Rival/.test(text)) return 'log-line--rival'
  if (/^(Turn|Game|Order|Overtime)/.test(text)) return 'log-line--sys'
  return null
}

/**
 * The event log: newest at the bottom, auto-scrolled so the latest line is
 * always visible — but only while the reader is already at the bottom.
 * Scrolling up to reread history holds still (`isAtBottom`'s 40px slack
 * absorbs sub-pixel rounding) rather than being yanked back down by the next
 * line the feed grows.
 *
 * Lines come straight from `useGame`'s `eventsForLog`, which renders every
 * `GameEvent` through `describeEvent` — so the panel is a pure view of the
 * engine's own history, with no separate narration to drift out of sync (and
 * undo removes lines simply because the events are gone).
 */
export function LogPanel({ lines, headerExtra }: LogPanelProps): ReactElement {
  const scroller = useRef<HTMLOListElement>(null)
  const wasAtBottom = useRef(true)

  useEffect(() => {
    const element = scroller.current
    if (element === null) return
    if (wasAtBottom.current) element.scrollTop = element.scrollHeight
  }, [lines.length])

  function isAtBottom(element: HTMLOListElement): boolean {
    return element.scrollHeight - element.scrollTop - element.clientHeight < 40
  }

  return (
    <aside className="log-panel" data-testid="log-panel" aria-label="Game log">
      <h3 className="log-panel__title">
        <span>Feed</span>
        {headerExtra}
      </h3>
      <ol
        className="log-panel__lines"
        ref={scroller}
        data-testid="log-lines"
        onScroll={(event) => {
          wasAtBottom.current = isAtBottom(event.currentTarget)
        }}
      >
        {lines.map((line, index) => {
          const actor = actorClass(line.text)
          return (
            <li
              className={['log-panel__line', actor].filter(Boolean).join(' ')}
              key={index}
              data-testid="log-line"
              data-turn={line.turn}
            >
              <span className="log-panel__turn">{line.turn > 0 ? `T${line.turn}` : '—'}</span>
              <span className="log-panel__text">{line.text}</span>
            </li>
          )
        })}
      </ol>
    </aside>
  )
}
