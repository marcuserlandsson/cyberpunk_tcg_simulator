import type { Printing } from './printings'
import type { DeckList } from '../engine/deck'
export function sessionCounts(text:string,printings:Printing[],before:Record<string,number>):Record<string,number> {
  const known=new Set(printings.map(p=>p.key)),delta:Record<string,number>={}
  for(const [i,line] of text.split(/\r?\n/).entries()){
    if(!line.trim())continue
    const match=line.trim().match(/^(.+?)[,\t]\s*([+-]?\d+)$/)
    if(!match)throw new Error(`Line ${i+1}: use printing-key,+count or printing-key,-count.`)
    const key=match[1].trim(),n=Number(match[2])
    if(!known.has(key))throw new Error(`Line ${i+1}: unknown printing ${key}.`)
    if(!Number.isSafeInteger(n))throw new Error(`Line ${i+1}: invalid count.`)
    delta[key]=(delta[key]??0)+n
  }
  if(!Object.keys(delta).length)throw new Error('Add at least one printing to the session.')
  const after={...before}
  for(const [key,n] of Object.entries(delta)){
    const count=(before[key]??0)+n
    if(!Number.isSafeInteger(count)||count<0)throw new Error(`${key}: this session would leave an invalid count (${count}).`)
    if(count===0)delete after[key];else after[key]=count
  }
  return after
}
export function starterEntry(deck:DeckList,setCode:string,printings:Printing[]):string {
  const rows=[...Object.entries(deck.cards),...deck.legends.map(id=>[id,1] as [string,number])]
  return rows.map(([id,count])=>{
    const matches=printings.filter(p=>p.cardId===id&&p.setCode===setCode)
    if(matches.length!==1)throw new Error(`${id}: expected one printing in this starter set; check its contents manually.`)
    return `${matches[0].key},+${count}`
  }).join('\n')
}
