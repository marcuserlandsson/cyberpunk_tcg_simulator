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
  return <details className="tool-panel" data-testid="deck-diagnostics"><summary>Deck diagnostics and opening hands</summary>
    <div className="tool-panel__body">
      <div className="field-row">
        <label className="field"><span className="field__label">Early Unit cost at most</span><input type="number" min="0" max="30" value={threshold} onChange={e=>setThreshold(Math.max(0,Math.min(30,Number(e.target.value)||0)))} /></label>
        <div className="chip-row">
          <span className="chip">Sell-tag copies: {ratio(stats.sell)}</span>
          <span className="chip">Early Units: {ratio(stats.early)}</span>
          {Object.entries(stats.types).map(([type,count])=><span key={type} className="chip">{type}: {count}</span>)}
        </div>
      </div>
      <p className="tool-note">These are printed costs and tags; discounts, payment access and board conditions can change what you can play.</p>
      {stats.unknown > 0 && <p className="tool-error">{stats.unknown} copies have unknown card definitions.</p>}
      <div className="tool-table-wrap"><table className="data-table"><caption>Cost curve · main-deck copies</caption><thead><tr><th className="num">Cost</th><th className="num">Copies</th><th>Share</th></tr></thead><tbody>{Object.entries(stats.curve).map(([cost,count])=><tr key={cost}><td className="num">{cost}</td><td className="num">{count}</td><td><meter min={0} max={Math.max(1,stats.total)} value={count} />{ratio(count)}</td></tr>)}</tbody></table></div>
      <div className="field-row">
        <label className="field"><span className="field__label">Opening-hand seed</span><input data-testid="opening-seed" type="number" value={seed} onChange={e=>setSeed(e.target.value)} /></label>
        <button type="button" data-testid="sample-hand" disabled={!isDeckPickable(db,deck) || !Number.isSafeInteger(Number(seed))} onClick={()=>{const n=Number(seed);setSample({hand:sampleOpeningHand(db,deck,n),deck:structuredClone(deck),seed:n})}}>Sample opening six</button>
        <button type="button" disabled={!sample} onClick={()=>setSeed(String((sample?.seed ?? 42)+1))}>Use next seed</button>
      </div>
      {sample && <div className="tool-preview" data-testid="opening-hand">
        <p className="tool-status">{sample.deck.name} · seed {sample.seed} · before mulligan. {JSON.stringify(sample.deck)!==JSON.stringify(deck) && 'The deck has changed since this sample.'}</p>
        <div className="tool-cards">{sample.hand.map((id,i)=><CardFrame key={i} def={db[id]} size="small" useOfficialImages={useOfficialImages} />)}</div>
      </div>}
    </div>
  </details>
}
