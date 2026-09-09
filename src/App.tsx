import { useEffect, useMemo, useState } from 'react'
import { MatchTracker } from './ui/MatchTracker'
import { PlayView } from './ui/PlayView'
import { DeckBuilderView } from './ui/DeckBuilderView'
import { SimulateView } from './ui/SimulateView'
import { CollectionView } from './ui/CollectionView'
import { loadCardDb } from './engine/cardDb'
import { getSettings, saveSettings } from './ui/storage'
import { startCollectionSession } from './ui/collectionSession'
import catalogStatus from '../data/catalog-status.json'

type View = 'play' | 'deckBuilder' | 'simulate' | 'collection'

const TABS: { id: View; label: string }[] = [
  { id: 'play', label: 'Play' },
  { id: 'deckBuilder', label: 'Deck Builder' },
  { id: 'simulate', label: 'Simulate' },
  { id: 'collection', label: 'Collection' },
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
  const [playDeckRequest, setPlayDeckRequest] = useState<{ name: string; id: number } | undefined>()
  const [view, setView] = useState<View>('play')
  const [useOfficialImages, setUseOfficialImages] = useState(
    () => getSettings().useOfficialImages
  )
  const db = useMemo(() => loadCardDb(), [])
  const aiDelayMs = useMemo(() => aiDelayFromUrl(), [])

  useEffect(() => startCollectionSession(), [])

  function toggleOfficialImages() {
    const next = !useOfficialImages
    setUseOfficialImages(next)
    saveSettings({ useOfficialImages: next })
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
        <label className="settings-toggle chip">
          <input
            type="checkbox"
            checked={useOfficialImages}
            onChange={toggleOfficialImages}
          />
          Use official card images
        </label>
      </header>
      <main>
        <details className="catalog-status">
          <summary>Card data: {catalogStatus.cardCount} cards · checked {catalogStatus.retrievedAt.slice(0, 10)} · {catalogStatus.pendingCards.length} awaiting implementation</summary>
          <p>Comprehensive rules updated {catalogStatus.rulesUpdatedAt.slice(0, 10)}. Audited gameplay corrections are implemented. Official ambiguities and AI-policy limits still apply; results are practice estimates.</p>
          {catalogStatus.pendingCards.length > 0 && <p>Available for collecting and deck planning; gameplay support pending: {catalogStatus.pendingCards.map(id => db[id]?.name ?? id).join(', ')}.</p>}
          <a href="https://cyberpunktcg.com/cards" target="_blank" rel="noreferrer">Official card catalog</a>
        </details>
        {/* Kept mounted, only hidden: unmounting PlayView would throw away an
            in-progress game every time the player glanced at another tab. */}
        <div hidden={view !== 'play'}>
          <MatchTracker />
          <PlayView requestedDeck={playDeckRequest} db={db} useOfficialImages={useOfficialImages} aiDelayMs={aiDelayMs} />
        </div>
        {/* Kept mounted, only hidden: matches the Play tab's pattern (Task
            13) so a deck under construction survives a glance at another
            tab instead of being discarded. */}
        <div hidden={view !== 'deckBuilder'}>
          <DeckBuilderView onPlayDeck={name => { setPlayDeckRequest({ name, id: Date.now() }); setView("play") }} db={db} useOfficialImages={useOfficialImages} />
        </div>
        {/* Keep the run and its worker alive during navigation; Cancel remains explicit. */}
        <div hidden={view !== 'simulate'}><SimulateView db={db} /></div>
        {/* Kept mounted, only hidden: same pattern as Play/Deck Builder so
            filter state and an in-progress quick-add session survive a
            glance at another tab. */}
        <div hidden={view !== 'collection'}>
          <CollectionView db={db} useOfficialImages={useOfficialImages} />
        </div>
      </main>
    </div>
  )
}
