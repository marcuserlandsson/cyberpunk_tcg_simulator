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
  return <details open className="panel"><summary>Opened sealed pool</summary><p>30+ main-deck cards, up to three main-deck colors, no RAM or copy limit. Exactly three distinct-name Legends from this pool; their colors are unrestricted. Unused pool cards remain available between matches.</p>
    <label>Pool counts<textarea data-testid="sealed-pool-input" value={text} onChange={e=>setText(e.target.value)} placeholder="card-id,count or printing-key,count" /></label><button data-testid="sealed-pool-apply" onClick={()=>{try{onChange({...deck,sealedPool:parseSealedPool(db,text)});setError('')}catch(e){setError(String(e))}}}>Set opened pool</button>
    <p>{Object.values(deck.sealedPool??{}).reduce((sum,n)=>sum+n,0)} pool copies recorded. Card rows outside or beyond this pool are flagged by validation; inventory ownership is separate.</p>{error&&<p role="alert">{error}</p>}
    <a href="https://cyberpunktcg.com/beta-event-guide" target="_blank" rel="noreferrer">Official Beta sealed rules</a>
  </details>
}
