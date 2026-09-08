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
  return <details className="panel" data-testid="acquisition-planner"><summary>Plan purchases across decks</summary>
    <fieldset><legend>Decks to prepare</legend>{decks.map(d=><label key={d.name}><input type="checkbox" checked={selected.includes(d.name)} onChange={e=>setSelected(old=>e.target.checked?[...old,d.name]:old.filter(n=>n!==d.name))} />{d.name}</label>)}</fieldset>
    <label>How you use the cards<select data-testid="acquisition-mode" value={mode} onChange={e=>setMode(e.target.value as typeof mode)}><option value="shared">Share cards between decks · maximum needed</option><option value="assembled">Keep all decks assembled · add requirements</option></select></label>
    <label><input type="checkbox" data-testid="reserve-artwork" checked={reserve} onChange={e=>setReserve(e.target.checked)} />Reserve one owned copy of each artwork for the binder</label>
    <p>{reserve ? 'Binder copies are removed from deck availability. A newly acquired missing artwork kept in the binder needs an extra playable copy to fill a deck gap.' : 'Artwork copies may also be used in decks. One purchase can fill a deck gap and a missing-artwork goal.'} Playset progress still counts all eligible owned copies.</p>
    {chosen.filter(d=>validateDeck(db,d).length>0).map(d=><p key={d.name}>Planning draft: {d.name} has deck validation errors; this shopping list does not make it legal.</p>)}
    {!known ? <p>Ownership unavailable — load the collection before calculating purchases.</p> : !chosen.length ? <p>Select decks to calculate requirements.</p> : <>
      <p data-testid="acquisition-total">{missing.reduce((sum,r)=>sum+r.missing,0)} copies needed across {missing.length} distinct cards</p>
      <div style={{overflowX:'auto'}}><table><thead><tr><th>Card</th><th>Needed</th><th>Owned</th><th>Binder</th><th>Available</th><th>Buy</th><th>Playset gap / artwork options</th></tr></thead><tbody>{rows.map(r=><tr key={r.identity} data-testid="acquisition-row" data-card-id={r.id}><td>{names.get(r.id)??r.id}</td><td>{r.required}</td><td>{r.owned}</td><td>{r.reserved}</td><td>{r.available}</td><td>{r.missing}</td><td>Playset gap: {r.playsetMissing}{r.missingArts.length>0 && <details><summary>{r.missingArts.length} missing artworks with playable printings</summary>{r.missingArts.map(art=><p key={art.id}>Choose one: {art.choices.join(' OR ')}</p>)}</details>}</td></tr>)}</tbody></table></div>
      <label>Deck shopping list<textarea readOnly data-testid="acquisition-list" value={text} /></label><button disabled={!text} onClick={()=>{navigator.clipboard.writeText(text).then(()=>setCopyError('Copied.')).catch(()=>setCopyError('Could not copy; select the list text above.'))}}>Copy deck shopping list</button>{copyError && <p role="status">{copyError}</p>}
    </>}
  </details>
}
