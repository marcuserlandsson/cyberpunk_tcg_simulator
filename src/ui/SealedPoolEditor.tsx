import { useEffect,useState } from 'react'
import type { CardDb } from '../engine/types'
import type { DeckList } from '../engine/deck'
import { loadPrintings } from './printings'
export function parseSealedPool(db:CardDb,text:string):Record<string,number>{
  const prints=new Map(loadPrintings().map(p=>[p.key,p])),pool:Record<string,number>={}
  for(const line of text.split(/\r?\n/)){
    if(!line.trim())continue
    const match=line.trim().match(/^(.+?)[,\t]\s*(\d+)$/)
    if(!match)throw new Error('Use card-id,count or printing-key,count on each line.')
    const key=match[1].trim(),printing=prints.get(key),id=printing?.cardId??key,n=Number(match[2])
    if(!db[id] || printing?.playable===false || !Number.isSafeInteger(n))throw new Error('Invalid or collection-only pool entry: '+key)
    pool[id]=(pool[id]??0)+n
    if(!Number.isSafeInteger(pool[id]))throw new Error('Pool count is too large: '+key)
  }
  return pool
}
export function SealedPoolEditor({db,deck,onChange}:{db:CardDb;deck:DeckList;onChange:(deck:DeckList)=>void}){
  const [text,setText]=useState(''),[error,setError]=useState('')
  useEffect(()=>setText(Object.entries(deck.sealedPool??{}).map(([id,n])=>`${id},${n}`).join('\n')),[deck.sealedPool])
  const poolSize=Object.values(deck.sealedPool??{}).reduce((sum,n)=>sum+n,0)
  return <details open className="tool-panel tool-panel--nested"><summary>Opened sealed pool<span className="tool-panel__meta">{poolSize} copies</span></summary>
    <div className="tool-panel__body">
      <p className="tool-note">30+ main-deck cards, up to three main-deck colors, no RAM or copy limit. Exactly three distinct-name Legends from this pool; their colors are unrestricted. Unused pool cards remain available between matches.</p>
      <label className="field field--wide"><span className="field__label">Pool counts</span><textarea data-testid="sealed-pool-input" value={text} onChange={e=>setText(e.target.value)} placeholder="card-id,count or printing-key,count" /></label>
      <div className="tool-actions"><button type="button" data-testid="sealed-pool-apply" onClick={()=>{try{onChange({...deck,sealedPool:parseSealedPool(db,text)});setError('')}catch(e){setError(String(e))}}}>Set opened pool</button><span className="tool-status">{poolSize} pool copies recorded</span></div>
      <p className="tool-note">Card rows outside or beyond this pool are flagged by validation; inventory ownership is separate. <a href="https://cyberpunktcg.com/beta-event-guide" target="_blank" rel="noreferrer">Official Beta sealed rules</a></p>
      {error&&<p className="tool-error" role="alert">{error}</p>}
    </div>
  </details>
}
