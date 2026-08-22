import { useState } from 'react'

type View = 'play' | 'deckBuilder' | 'simulate'

const TABS: { id: View; label: string }[] = [
  { id: 'play', label: 'Play' },
  { id: 'deckBuilder', label: 'Deck Builder' },
  { id: 'simulate', label: 'Simulate' },
]

export default function App() {
  const [view, setView] = useState<View>('play')

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
      </header>
      <main>
        {view === 'play' && (
          <section aria-label="Play">
            <p>Play placeholder</p>
          </section>
        )}
        {view === 'deckBuilder' && (
          <section aria-label="Deck Builder">
            <p>Deck Builder placeholder</p>
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
