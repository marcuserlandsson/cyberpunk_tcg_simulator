// Pack-cracking entry: type a few letters, Enter adds 1 of the top match's
// printing in the "session set" (the set of boosters currently being
// opened — pick it once, every add lands there). Single-level undo.
//
// Enter only ever fires when the session set holds EXACTLY ONE printing of
// the matched card (110 of the 141 cards) — that unambiguous single-keystroke
// add is the whole reason this component exists. The other two cases are
// treated identically: no printing in the session set, and *more than one*
// (31 card+set combinations across 30 cards hold 2-3 printings each — the
// in-set alt arts and Iconic variants this feature exists to track). Both
// list the card's printings inline with collector number and rarity so the
// keystroke never guesses which art got the copy.

import { useMemo, useState, type KeyboardEvent, type ReactElement } from 'react'
import type { CardDb } from '../engine/types'
import { printingsByCard, listSets, type Printing } from './printings'
import { adjustCount } from './collection'
import { buildDisplayNames } from './storage'

const SESSION_SET_KEY = 'ctcg:quickAddSet:v1'
const MAX_MATCHES = 8

interface LastAdd {
  key: string
  label: string
}

/**
 * Default session set: the set with the MOST printings (ties broken by
 * first-appearance order), not simply `sets[0]`. Derived from the live
 * `printings` prop rather than a hardcoded set code, so a regenerated
 * dataset can't silently break it. On the real dataset first-appearance
 * order starts with a 14-printing demo deck (`arasakademodeck`) while the
 * core sets hold 160 and 131 printings — defaulting to "first" would make
 * quick-add answer "not in this set" for most cards on first use, exactly
 * the opposite of what this component exists for.
 */
function biggestSet(printings: Printing[]): string {
  const sets = listSets(printings)
  const counts = new Map<string, number>()
  for (const p of printings) counts.set(p.setCode, (counts.get(p.setCode) ?? 0) + 1)
  let best: { code: string; count: number } | undefined
  for (const s of sets) {
    const count = counts.get(s.code) ?? 0
    if (best === undefined || count > best.count) best = { code: s.code, count }
  }
  return best?.code ?? ''
}

export function QuickAddBar({ db, printings }: { db: CardDb; printings: Printing[] }): ReactElement {
  const sets = useMemo(() => listSets(printings), [printings])
  const byCard = useMemo(() => printingsByCard(printings), [printings])
  const names = useMemo(() => buildDisplayNames(db), [db])
  const defaultSet = useMemo(() => biggestSet(printings), [printings])

  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [lastAdd, setLastAdd] = useState<LastAdd | null>(null)
  const [sessionSet, setSessionSetState] = useState(() => {
    const saved = localStorage.getItem(SESSION_SET_KEY)
    return saved !== null && sets.some((s) => s.code === saved) ? saved : defaultSet
  })

  function setSessionSet(code: string): void {
    setSessionSetState(code)
    localStorage.setItem(SESSION_SET_KEY, code)
  }

  const matches = useMemo(() => {
    if (query.trim() === '') return []
    const needle = query.trim().toLowerCase()
    return [...names.entries()]
      .filter(([, name]) => name.toLowerCase().includes(needle))
      .slice(0, MAX_MATCHES)
      .map(([cardId, name]) => {
        const all = byCard.get(cardId) ?? []
        const inSet = all.filter((p) => p.setCode === sessionSet)
        // `undefined` unless the session set resolves the printing on its
        // own; anything else (0 or 2+) has to be disambiguated by a click.
        const unambiguous = inSet.length === 1 ? inSet[0] : undefined
        return { cardId, name, all, inSetCount: inSet.length, unambiguous }
      })
  }, [query, names, byCard, sessionSet])

  // Defensive clamp: `matches[selected]` is only ever safe to index directly
  // because `selected` is reset to 0 in the same handler that is the only
  // thing able to change `matches.length` (see the input's onChange below) —
  // sessionSet changes flip `unambiguous` on existing rows but never add/remove
  // rows. This clamp costs nothing and guards that invariant rather than
  // relying on the coupling never changing under future edits.
  const clampedSelected = matches.length === 0 ? 0 : Math.min(selected, matches.length - 1)

  function add(printing: Printing, name: string): void {
    adjustCount(printing.key, 1)
    // Collector number included on purpose: the set name alone cannot tell
    // β001 from β141, so a mis-credited copy would be invisible (and the
    // Undo button beside it pointless) without it.
    setLastAdd({
      key: printing.key,
      label: `Added 1x ${name} [${printing.setName} ${printing.collectorNumber}]`,
    })
    setQuery('')
    setSelected(0)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelected(Math.min(clampedSelected + 1, matches.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelected(Math.max(clampedSelected - 1, 0))
    } else if (event.key === 'Enter') {
      const match = matches[clampedSelected]
      if (match?.unambiguous !== undefined) add(match.unambiguous, match.name)
    }
  }

  return (
    <div className="quick-add" data-testid="quick-add">
      <input
        type="text"
        data-testid="quick-add-input"
        placeholder="Quick add — type a card name, Enter adds 1…"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setSelected(0)
        }}
        onKeyDown={onKeyDown}
      />
      <select
        data-testid="quick-add-set"
        value={sessionSet}
        title="Session set — which printing quick-add increments"
        onChange={(event) => setSessionSet(event.target.value)}
      >
        {sets.map((s) => (
          <option key={s.code} value={s.code}>{s.name}</option>
        ))}
      </select>
      {matches.length > 0 && (
        <ul className="quick-add__matches" role="listbox">
          {matches.map((match, index) => (
            <li
              key={match.cardId}
              role="option"
              aria-selected={index === clampedSelected}
              data-testid={`quick-add-match-${match.cardId}`}
            >
              {match.unambiguous !== undefined ? (
                <button type="button" onClick={() => add(match.unambiguous!, match.name)}>
                  {match.name}
                </button>
              ) : (
                <span className="quick-add__choices">
                  {match.name} —{' '}
                  {match.inSetCount === 0
                    ? 'not in this set; pick a printing:'
                    : `${match.inSetCount} printings in this set; pick one:`}
                  {match.all.map((p) => (
                    <button
                      type="button"
                      key={p.key}
                      data-testid={`quick-add-printing-${p.key}`}
                      onClick={() => add(p, match.name)}
                    >
                      {p.setName} {p.collectorNumber} · {p.rarity}
                    </button>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {lastAdd !== null && (
        <div className="quick-add__toast" data-testid="quick-add-toast">
          {lastAdd.label}
          <button
            type="button"
            data-testid="quick-add-undo"
            onClick={() => {
              adjustCount(lastAdd.key, -1)
              setLastAdd(null)
            }}
          >
            Undo
          </button>
        </div>
      )}
    </div>
  )
}
