import { deckSnapshotSchema } from './deckSchema'
import type { DeckList } from '../engine/deck'
import { listDecks, saveDeck } from './storage'

const PREFIX = 'ctcg:deckVersion:v1:'
export function listDeckVersions(name: string): DeckList[] {
  const versions: DeckList[] = []
  for (let i=0; i<localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key?.startsWith(PREFIX)) continue
    // Leave corrupt entries untouched. The active deck remains separately stored.
    try { const result = deckSnapshotSchema.safeParse(JSON.parse(localStorage.getItem(key)!)); if (result.success && result.data.name === name) versions.push(result.data) } catch { /* unreadable version */ }
  }
  return versions.sort((a,b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
}
export function saveDeckVersion(deck: DeckList): DeckList {
  const previous = listDecks().find(d => d.name === deck.name)
  if (previous && !previous.revisionId) {
    const prior = { ...previous, revisionId: crypto.randomUUID(), updatedAt: new Date().toISOString(), versionLabel: 'Before version tracking' }
    localStorage.setItem(PREFIX + prior.revisionId, JSON.stringify(prior))
  }
  const next = structuredClone({ ...deck, revisionId: crypto.randomUUID(), updatedAt: new Date().toISOString() })
  localStorage.setItem(PREFIX + next.revisionId, JSON.stringify(next))
  saveDeck(next)
  return next
}
