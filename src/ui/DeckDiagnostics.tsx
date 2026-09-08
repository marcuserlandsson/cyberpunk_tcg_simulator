import { useState } from 'react'
import type { CardDb } from '../engine/types'
import type { DeckList } from '../engine/deck'
import { analyzeDeck, sampleOpeningHand } from './deckAnalysis'
import { isDeckPickable } from './deckPicker'
import { CardFrame } from './CardFrame'

export function DeckDiagnostics({ db, deck, useOfficialImages }: { db: CardDb; deck: DeckList; useOfficialImages: boolean }) {
  const [threshold,setThreshold] = useState(3), [seed,setSeed] = useState('42')
  const [sample,setSample] = useState<{ hand:string[]; deck:DeckList; seed:number } | null>(null)
  const stats = analyzeDeck(db,deck,threshold)
  const ratio = (n:number) => stats.total ? `${n}/${stats.total} (${(100*n/stats.total).toFixed(1)}%)` : '0/0'
  return <details className="panel" data-testid="deck-diagnostics"><summary>Deck diagnostics and opening hands</summary>
    <p>Sell-tag copies: {ratio(stats.sell)}. <label>Early Unit cost at most <input type="number" min="0" max="30" value={threshold} onChange={e=>setThreshold(Math.max(0,Math.min(30,Number(e.target.value)||0)))} /></label> Early Units: {ratio(stats.early)}.</p>
    <p>These are printed costs and tags; discounts, payment access and board conditions can change what you can play.</p>
    {stats.unknown > 0 && <p>{stats.unknown} copies have unknown card definitions.</p>}
    <table><caption>Cost curve · main-deck copies</caption><thead><tr><th>Cost</th><th>Copies</th><th>Share</th></tr></thead><tbody>{Object.entries(stats.curve).map(([cost,count])=><tr key={cost}><td>{cost}</td><td>{count}</td><td><meter min={0} max={Math.max(1,stats.total)} value={count} /> {ratio(count)}</td></tr>)}</tbody></table>
    <p>{Object.entries(stats.types).map(([type,count])=>`${type}: ${count}`).join(' · ')}</p>
    <label>Opening-hand seed<input data-testid="opening-seed" type="number" value={seed} onChange={e=>setSeed(e.target.value)} /></label>
    <button data-testid="sample-hand" disabled={!isDeckPickable(db,deck) || !Number.isSafeInteger(Number(seed))} onClick={()=>{const n=Number(seed);setSample({hand:sampleOpeningHand(db,deck,n),deck:structuredClone(deck),seed:n})}}>Sample opening six</button>
    <button disabled={!sample} onClick={()=>setSeed(String((sample?.seed ?? 42)+1))}>Use next seed</button>
    {sample && <div data-testid="opening-hand"><p>{sample.deck.name} · seed {sample.seed} · before mulligan. {JSON.stringify(sample.deck)!==JSON.stringify(deck) && 'The deck has changed since this sample.'}</p><div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{sample.hand.map((id,i)=><CardFrame key={i} def={db[id]} size="small" useOfficialImages={useOfficialImages} />)}</div></div>}
  </details>
}
