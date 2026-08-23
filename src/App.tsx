import { useMemo, useState } from 'react'
import { CardFrame } from './ui/CardFrame'
import { Die } from './ui/Dice'
import { loadCardDb } from './engine/cardDb'
import type { DeckList } from './engine/deck'
import { deleteDeck, getSettings, listDecks, saveSettings } from './ui/storage'
import type { GigDie } from './engine/types'

type View = 'play' | 'deckBuilder' | 'simulate'

const TABS: { id: View; label: string }[] = [
  { id: 'play', label: 'Play' },
  { id: 'deckBuilder', label: 'Deck Builder' },
  { id: 'simulate', label: 'Simulate' },
]

// A one-of-each-size sample, mixing rolled and unrolled dice, just to prove
// out `Die`'s silhouettes until Task 13 wires real Gig areas into this tab.
const SAMPLE_DICE: GigDie[] = [
  { size: 4, value: 3 },
  { size: 6, value: 5 },
  { size: 8, value: 0 },
  { size: 10, value: 7 },
  { size: 12, value: 11 },
  { size: 20, value: 20 },
]

export default function App() {
  const [view, setView] = useState<View>('play')
  const [useOfficialImages, setUseOfficialImages] = useState(
    () => getSettings().useOfficialImages
  )
  const [decks, setDecks] = useState<DeckList[]>(() => listDecks())
  const [deckError, setDeckError] = useState<string | null>(null)

  const db = useMemo(() => loadCardDb(), [])
  const sampleDeck = decks[0]
  const sampleCardIds = sampleDeck ? Object.keys(sampleDeck.cards).slice(0, 4) : []

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
          <section aria-label="Play">
            <h2>Sample cards</h2>
            <div className="card-row">
              {sampleCardIds.map((id) => {
                const def = db[id]
                return def ? (
                  <CardFrame
                    key={id}
                    def={def}
                    size="small"
                    useOfficialImages={useOfficialImages}
                  />
                ) : null
              })}
            </div>
            <h2>Gig dice</h2>
            <div className="die-row">
              {SAMPLE_DICE.map((die) => (
                <Die key={die.size} die={die} rolled={die.value > 0} />
              ))}
            </div>
          </section>
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
