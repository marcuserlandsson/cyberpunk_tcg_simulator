import { useMemo, useState } from 'react'
import type { CardDb } from '../engine/types'
import { validateDeck } from '../engine/deck'
import type { Printing } from './printings'
import { useDecks, buildDisplayNames } from './storage'
import { acquisitionPlan } from './acquisitionPlan'

export function AcquisitionPlanner({db,printings,counts,known}:{db:CardDb;printings:Printing[];counts:Record<string,number>;known:boolean}) {
  const decks=useDecks(), [selected,setSelected]=useState<string[]>([]), [mode,setMode]=useState<'shared'|'assembled'>('shared'), [reserve,setReserve]=useState(false)
  const [copyError,setCopyError]=useState('')
  const names=useMemo(()=>buildDisplayNames(db),[db])
  const chosen=decks.filter(d=>selected.includes(d.name))
  const rows=useMemo(()=>acquisitionPlan(db,chosen,printings,counts,mode,reserve),[db,decks,selected,printings,counts,mode,reserve])
  const missing=rows.filter(r=>r.missing>0)
  const text=missing.map(r=>`${r.missing}x ${names.get(r.id)??r.id}${!reserve && r.missingArts.length ? ' — choosing a missing artwork can also advance the artwork goal' : ''}`).join('\n')
  return <details className="tool-panel" data-testid="acquisition-planner"><summary>Plan purchases across decks</summary>
    <div className="tool-panel__body">
      <fieldset className="check-list"><legend>Decks to prepare</legend>
        {decks.length===0 && <span className="check-list--empty">No saved decks yet.</span>}
        {decks.map(d=><label key={d.name} className="check-chip"><input type="checkbox" checked={selected.includes(d.name)} onChange={e=>setSelected(old=>e.target.checked?[...old,d.name]:old.filter(n=>n!==d.name))} />{d.name}</label>)}
      </fieldset>
      <div className="field-row">
        <label className="field"><span className="field__label">How you use the cards</span><select data-testid="acquisition-mode" value={mode} onChange={e=>setMode(e.target.value as typeof mode)}><option value="shared">Share cards between decks · maximum needed</option><option value="assembled">Keep all decks assembled · add requirements</option></select></label>
        <label className="check-chip"><input type="checkbox" data-testid="reserve-artwork" checked={reserve} onChange={e=>setReserve(e.target.checked)} />Reserve one owned copy of each artwork for the binder</label>
      </div>
      <p className="tool-note">{reserve ? 'Binder copies are removed from deck availability. A newly acquired missing artwork kept in the binder needs an extra playable copy to fill a deck gap.' : 'Artwork copies may also be used in decks. One purchase can fill a deck gap and a missing-artwork goal.'} Playset progress still counts all eligible owned copies.</p>
      {chosen.filter(d=>validateDeck(db,d).length>0).map(d=><p key={d.name} className="tool-error">Planning draft: {d.name} has deck validation errors; this shopping list does not make it legal.</p>)}
      {!known ? <p className="tool-note">Ownership unavailable — load the collection before calculating purchases.</p> : !chosen.length ? <p className="tool-note">Select decks to calculate requirements.</p> : <>
        <p className="tool-figure" data-testid="acquisition-total">{missing.reduce((sum,r)=>sum+r.missing,0)} copies needed across {missing.length} distinct cards</p>
        <div className="tool-table-wrap"><table className="data-table"><thead><tr><th>Card</th><th className="num">Needed</th><th className="num">Owned</th><th className="num">Binder</th><th className="num">Available</th><th className="num">Buy</th><th>Playset gap / artwork options</th></tr></thead><tbody>{rows.map(r=><tr key={r.identity} data-testid="acquisition-row" data-card-id={r.id}><td>{names.get(r.id)??r.id}</td><td className="num">{r.required}</td><td className="num">{r.owned}</td><td className="num">{r.reserved}</td><td className="num">{r.available}</td><td className="num">{r.missing}</td><td>Playset gap: {r.playsetMissing}{r.missingArts.length>0 && <details className="tool-panel tool-panel--nested"><summary>{r.missingArts.length} missing artworks with playable printings</summary><div className="tool-panel__body">{r.missingArts.map(art=><p key={art.id} className="tool-note">Choose one: {art.choices.join(' OR ')}</p>)}</div></details>}</td></tr>)}</tbody></table></div>
        <label className="field field--wide"><span className="field__label">Deck shopping list</span><textarea readOnly data-testid="acquisition-list" value={text} /></label>
        <div className="tool-actions"><button type="button" disabled={!text} onClick={()=>{navigator.clipboard.writeText(text).then(()=>setCopyError('Copied.')).catch(()=>setCopyError('Could not copy; select the list text above.'))}}>Copy deck shopping list</button>{copyError && <span className="tool-status" role="status">{copyError}</span>}</div>
      </>}
    </div>
  </details>
}
