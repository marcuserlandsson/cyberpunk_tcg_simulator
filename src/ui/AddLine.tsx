//
// Pack-cracking entry, shared by Browse (quick add) and Add cards: type a few
// letters, Enter stages 1 copy of the top match's printing in the "session
// set" into the draft (sessionDraft.ts). Nothing here writes the collection;
// Apply in Add cards does. Enter only fires when the session set holds
// EXACTLY ONE printing of the matched card; 0 or 2+ printings show the card's
// printings as chips so the keystroke never guesses which art got the copy
// (31 card+set combinations hold 2-3 printings each).
import { useMemo, useState, type KeyboardEvent, type ReactElement } from 'react'
import type { CardDb } from '../engine/types'
import { printingsByCard, listSets, type Printing } from './printings'
import { buildDisplayNames } from './storage'
import { stageLine, useDraft } from './sessionDraft'

const SESSION_SET_KEY = 'ctcg:quickAddSet:v1'
const MAX_MATCHES = 8

/** Default session set: the set with the MOST printings, so first use does
 *  not answer "not in this set" for most cards (the demo deck comes first in
 *  file order but holds 14 printings against the core sets' 170+). */
function biggestSet(printings: Printing[]): string {
  const counts = new Map<string, number>()
  for (const p of printings) counts.set(p.setCode, (counts.get(p.setCode) ?? 0) + 1)
  let best: { code: string; count: number } | undefined
  for (const s of listSets(printings)) {
    const count = counts.get(s.code) ?? 0
    if (best === undefined || count > best.count) best = { code: s.code, count }
  }
  return best?.code ?? ''
}

export function AddLine({ db, printings, testIdPrefix, autoFocus }: { db: CardDb; printings: Printing[]; testIdPrefix: 'quick-add' | 'add-line'; autoFocus?: boolean }): ReactElement {
  const draft = useDraft()
  const sets = useMemo(() => listSets(printings), [printings])
  const byCard = useMemo(() => printingsByCard(printings), [printings])
  const names = useMemo(() => buildDisplayNames(db), [db])
  const defaultSet = useMemo(() => biggestSet(printings), [printings])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const [sessionSet, setSessionSetState] = useState(() => {
    try { const saved = localStorage.getItem(SESSION_SET_KEY); return saved !== null && sets.some((s) => s.code === saved) ? saved : defaultSet } catch { return defaultSet }
  })
  function setSessionSet(code: string): void {
    setSessionSetState(code)
    try { localStorage.setItem(SESSION_SET_KEY, code) } catch { /* usable in this tab regardless */ }
  }

  const matches = useMemo(() => {
    if (query.trim() === '') return []
    const needle = query.trim().toLowerCase()
    return [...names.entries()].filter(([, name]) => name.toLowerCase().includes(needle)).slice(0, MAX_MATCHES).map(([cardId, name]) => {
      const all = byCard.get(cardId) ?? []
      const inSet = all.filter((p) => p.setCode === sessionSet)
      return { cardId, name, all, inSetCount: inSet.length, unambiguous: inSet.length === 1 ? inSet[0] : undefined }
    })
  }, [query, names, byCard, sessionSet])
  const clamped = matches.length === 0 ? 0 : Math.min(selected, matches.length - 1)

  function stage(printing: Printing, name: string, remove: boolean): void {
    const line = draft.mode === 'signed' ? { key: printing.key, delta: remove ? -1 : 1 } : { key: printing.key, exact: remove ? 0 : 1 }
    stageLine(line)
    const staged = draft.lines.length + 1
    setToast(`${draft.mode === 'signed' ? (remove ? '−1' : '+1') : (remove ? 'set 0' : 'set 1')} ${name} · ${printing.setName} ${printing.collectorNumber} → ${staged} staged`)
    setQuery(''); setSelected(0)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') { event.preventDefault(); setSelected(Math.min(clamped + 1, matches.length - 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setSelected(Math.max(clamped - 1, 0)) }
    else if (event.key === 'Escape') { setQuery(''); setSelected(0) }
    else if (event.key === 'Enter') { const m = matches[clamped]; if (m?.unambiguous !== undefined) stage(m.unambiguous, m.name, event.shiftKey) }
  }

  const p = testIdPrefix
  return (
    <div className="add-line" data-testid={p}>
      <div className="add-line__bar">
        <input type="text" data-testid={`${p}-input`} autoFocus={autoFocus} value={query}
          placeholder={draft.mode === 'signed' ? 'Type a card name — Enter stages 1 copy' : 'Type a card name — Enter stages "exactly 1"'}
          onChange={(e) => { setQuery(e.target.value); setSelected(0) }} onKeyDown={onKeyDown} />
        <label className="add-line__to">to
          <select data-testid={`${p}-set`} value={sessionSet} title="Session set — which printing a name resolves to" onChange={(e) => setSessionSet(e.target.value)}>
            {sets.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select>
        </label>
        <span className="add-line__hint"><kbd>Enter</kbd> +1 · <kbd>Shift</kbd><kbd>Enter</kbd> −1</span>
      </div>
      {matches.length > 0 && (
        <ul className="add-line__matches" role="listbox">
          {matches.map((m, index) => (
            <li key={m.cardId} role="option" aria-selected={index === clamped} data-testid={`${p}-match-${m.cardId}`}>
              {m.unambiguous !== undefined ? (
                <button type="button" onClick={() => stage(m.unambiguous!, m.name, false)}>{m.name}</button>
              ) : (
                <span className="add-line__choices">
                  <span className="add-line__choices-label">{m.name} — {m.inSetCount === 0 ? 'not in this set; pick a printing:' : `${m.inSetCount} printings in this set; pick one:`}</span>
                  {m.all.map((pr) => <button type="button" key={pr.key} className="fchip" data-testid={`${p}-printing-${pr.key}`} onClick={() => stage(pr, m.name, false)}>{pr.setName} {pr.collectorNumber} · {pr.rarity}{pr.finish ? ` · ${pr.finish}` : ''}</button>)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {toast !== null && <div className="add-line__toast" data-testid={`${p}-toast`} role="status">{toast}</div>}
    </div>
  )
}
