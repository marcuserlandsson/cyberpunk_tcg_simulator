import { cardIdentity, type DeckList } from '../engine/deck'
import type { CardDb } from '../engine/types'
import type { Printing } from './printings'
import { artworkGroups, missingArtworks } from './artworks'
import { playsetTarget } from './collection'

export interface AcquisitionNeed {
  identity: string; id: string; required: number; owned: number; reserved: number; available: number; missing: number
  playsetMissing: number; missingArts: { id: string; choices: string[] }[]
}
export function acquisitionPlan(db: CardDb, decks: DeckList[], printings: Printing[], counts: Record<string,number>, mode: 'shared' | 'assembled', reserveArtwork: boolean): AcquisitionNeed[] {
  const required = new Map<string,{id:string; count:number}>()
  const identity = (id:string) => db[id] ? cardIdentity(db[id]) : id
  for (const deck of decks) {
    const own = new Map<string,{id:string; count:number}>()
    for (const [id,n] of [...Object.entries(deck.cards), ...deck.legends.filter(Boolean).map(id=>[id,1] as [string,number])]) {
      if (!Number.isSafeInteger(n) || n < 1) continue
      const key = identity(id); own.set(key,{id,count:(own.get(key)?.count ?? 0)+n})
    }
    for (const [key,value] of own) required.set(key,{id:value.id,count:mode==='shared' ? Math.max(required.get(key)?.count ?? 0,value.count) : (required.get(key)?.count ?? 0)+value.count})
  }
  const owned = new Map<string,number>(), reserved = new Map<string,number>()
  for (const p of printings) if(p.playable!==false) owned.set(identity(p.cardId),(owned.get(identity(p.cardId))??0)+(counts[p.key]??0))
  if(reserveArtwork) for(const art of artworkGroups(printings)) {
    // A collection-only printing can satisfy the binder reservation without consuming a playable copy.
    const held = art.printings.filter(p=>(counts[p.key]??0)>0).sort((a,b)=>Number(a.playable!==false)-Number(b.playable!==false) || a.key.localeCompare(b.key))
    const selected=held[0]
    if(selected && selected.playable!==false) reserved.set(identity(selected.cardId),(reserved.get(identity(selected.cardId))??0)+1)
  }
  const missing = missingArtworks(printings,counts)
  return [...required].map(([key,{id,count}])=>{
    const total=owned.get(key)??0, binder=reserved.get(key)??0, available=Math.max(0,total-binder)
    return {identity:key,id,required:count,owned:total,reserved:binder,available,missing:Math.max(0,count-available),
      playsetMissing:Math.max(0,(db[id]?playsetTarget(db[id]):0)-total),
      missingArts:missing.filter(a=>identity(a.cardId)===key).map(a=>({id:a.id,choices:a.printings.filter(p=>p.playable!==false).map(p=>p.key)})).filter(a=>a.choices.length>0)}
  }).sort((a,b)=>b.missing-a.missing || a.id.localeCompare(b.id))
}
