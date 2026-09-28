//
// Surplus for the Sell mode: per card identity, how many owned copies are
// not needed by the chosen decks, the binder (one copy per held artwork) or
// a playset, and which printings to part with. Deck need comes from the same
// `deckRequirements` Plan purchases uses, so buying and selling agree.
import { cardIdentity, type DeckList } from '../engine/deck'
import type { CardDb } from '../engine/types'
import type { Printing } from './printings'
import { playsetTarget } from './collection'
import { deckRequirements, type DeckMode } from './acquisitionPlan'

export interface SplitLine { key: string; count: number }
export interface SurplusRow { identity: string; id: string; owned: number; deckNeed: number; binderHold: number; playsetHold: number; keep: number; surplus: number; split: SplitLine[] }
export interface SurplusOptions { mode: DeckMode; keepBinderArt: boolean; keepPlayset: boolean }

const isBeta = (p: Printing) => /beta/i.test(p.setCode)

export function surplusPlan(db: CardDb, decks: DeckList[], printings: Printing[], counts: Record<string, number>, opts: SurplusOptions): SurplusRow[] {
  const required = deckRequirements(db, decks, opts.mode)
  const identity = (id: string) => db[id] ? cardIdentity(db[id]) : id
  const held = new Map<string, { p: Printing; n: number }[]>()
  for (const p of printings) {
    const n = counts[p.key] ?? 0
    if (!Number.isSafeInteger(n) || n < 1) continue
    const key = identity(p.cardId)
    held.set(key, [...(held.get(key) ?? []), { p, n }])
  }
  const rows: SurplusRow[] = []
  for (const [key, list] of held) {
    const def = list.map(h => db[h.p.cardId]).find(Boolean)
    const owned = list.reduce((s, h) => s + h.n, 0)
    const deckNeed = required.get(key)?.count ?? 0
    const remaining = new Map(list.map(h => [h.p.key, h.n]))
    let binderHold = 0
    if (opts.keepBinderArt) {
      const arts = new Map<string, Printing[]>()
      for (const h of list) if (h.p.artworkId) arts.set(h.p.artworkId, [...(arts.get(h.p.artworkId) ?? []), h.p])
      for (const group of arts.values()) {
        // A collection-only printing fills the binder copy without consuming a playable one (acquisitionPlan's rule).
        const chosen = [...group].sort((a, b) => Number(a.playable !== false) - Number(b.playable !== false) || a.key.localeCompare(b.key))[0]
        remaining.set(chosen.key, remaining.get(chosen.key)! - 1); binderHold++
      }
    }
    const playsetHold = opts.keepPlayset && def ? playsetTarget(def) : 0
    const keep = Math.min(owned, Math.max(deckNeed + binderHold, playsetHold))
    const surplus = owned - keep
    const playableLeft = () => list.reduce((s, h) => s + (h.p.playable === false ? 0 : remaining.get(h.p.key)!), 0)
    const deckFloor = Math.min(deckNeed, playableLeft())
    const order = (a: { p: Printing }, b: { p: Printing }) => Number(a.p.playable === false) - Number(b.p.playable === false) || remaining.get(b.p.key)! - remaining.get(a.p.key)! || Number(isBeta(a.p)) - Number(isBeta(b.p)) || a.p.key.localeCompare(b.p.key)
    const sold = new Map<string, number>()
    // One copy at a time, so "most copies left" is re-evaluated after each sale.
    // Always finds a copy: surplus ≤ owned − binderHold − deckFloor.
    for (let i = 0; i < surplus; i++) {
      const next = [...list].sort(order).find(h => remaining.get(h.p.key)! > 0 && (h.p.playable === false || playableLeft() - 1 >= deckFloor))!
      remaining.set(next.p.key, remaining.get(next.p.key)! - 1)
      sold.set(next.p.key, (sold.get(next.p.key) ?? 0) + 1)
    }
    rows.push({ identity: key, id: def?.id ?? list[0].p.cardId, owned, deckNeed, binderHold, playsetHold, keep, surplus, split: [...sold].map(([k, count]) => ({ key: k, count })) })
  }
  return rows.sort((a, b) => b.surplus - a.surplus || a.id.localeCompare(b.id))
}

/** The part of a suggested split not yet on the sell list, up to `want` copies. */
export function pendingSplit(split: SplitLine[], listed: Record<string, number>, want: number): SplitLine[] {
  const out: SplitLine[] = []
  let left = want
  for (const line of split) {
    const n = Math.min(left, Math.max(0, line.count - (listed[line.key] ?? 0)))
    if (n > 0) { out.push({ key: line.key, count: n }); left -= n }
  }
  return out
}
