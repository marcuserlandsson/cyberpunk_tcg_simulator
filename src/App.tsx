import { useMemo, useState } from 'react'
import { PlayView } from './ui/PlayView'
import { loadCardDb } from './engine/cardDb'
import type { DeckList } from './engine/deck'
import { deleteDeck, getSettings, listDecks, saveSettings } from './ui/storage'

type View = 'play' | 'deckBuilder' | 'simulate'

const TABS: { id: View; label: string }[] = [
  { id: 'play', label: 'Play' },
  { id: 'deckBuilder', label: 'Deck Builder' },
  { id: 'simulate', label: 'Simulate' },
]

/**
 * `?aiDelay=<ms>` overrides the AI's pacing delay. It exists for the E2E suite
 * (which would otherwise spend its whole budget watching the opponent think)
 * and for anyone who finds 300ms per AI action too slow; an absent or
 * unparseable value leaves the hook's own default in place.
 */
function aiDelayFromUrl(): number | undefined {
  if (typeof window === 'undefined') return undefined
  const raw = new URLSearchParams(window.location.search).get('aiDelay')
  if (raw === null) return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

export default function App() {
  const [view, setView] = useState<View>('play')
  const [useOfficialImages, setUseOfficialImages] = useState(
    () => getSettings().useOfficialImages
  )
  const [decks, setDecks] = useState<DeckList[]>(() => listDecks())
  const [deckError, setDeckError] = useState<string | null>(null)

  const db = useMemo(() => loadCardDb(), [])
  const aiDelayMs = useMemo(() => aiDelayFromUrl(), [])

  function toggleOfficialImages() {
    const next = !useOfficialImages
    setUseOfficialImages(next)
    saveSettings({ useOfficialImages: next })
  }

  function handleDeleteDeck(name: string) {
    try {
      deleteDeck(name)
      setDecks(listDecks())
      setDeckError(null)
    } catch (err) {
      setDeckError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div>
      <header>
        <h1>Cyberpunk TCG Simulator</h1>
        <nav>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-pressed={view === tab.id}
              data-testid={`tab-${tab.id}`}
              onClick={() => setView(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={useOfficialImages}
            onChange={toggleOfficialImages}
          />
          Use official card images
        </label>
      </header>
      <main>
        {view === 'play' && (
          <PlayView db={db} useOfficialImages={useOfficialImages} aiDelayMs={aiDelayMs} />
        )}
        {view === 'deckBuilder' && (
          <section aria-label="Deck Builder">
            <h2>Decks</h2>
            {deckError && <p className="deck-error">{deckError}</p>}
            <ul className="deck-list">
              {decks.map((deck) => (
                <li key={deck.name}>
                  <span>{deck.name}</span>
                  <button type="button" onClick={() => handleDeleteDeck(deck.name)}>
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {view === 'simulate' && (
          <section aria-label="Simulate">
            <p>Simulate placeholder</p>
          </section>
        )}
      </main>
    </div>
  )
}
