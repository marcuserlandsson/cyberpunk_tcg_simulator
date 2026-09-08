import type { Printing } from './printings'
import type { CardDef } from '../engine/types'
export function matchesPrinting(def: CardDef, p: Printing, search: string, setCode: string, rarities: Set<string>): boolean {
  if (setCode && p.setCode !== setCode) return false
  if (rarities.size && !rarities.has(p.rarity)) return false
  const haystack=[def.name,def.subtitle,def.text,p.key,p.collectorNumber,p.setName,p.rarity,p.finish,p.artist].join(' ').toLocaleLowerCase()
  return search.trim().toLocaleLowerCase().split(/\s+/).every(word=>haystack.includes(word))
}
export function parseBulkCounts(text: string, printings: Printing[]): Record<string,number> {
  const known=new Set(printings.map(p=>p.key)), result:Record<string,number>={}
  for(const [index,line] of text.split(/\r?\n/).entries()) {
    if(!line.trim())continue
    const match=line.trim().match(/^(.+?)[,\t]\s*(\d+)$/)
    if(!match)throw new Error(`Line ${index+1}: use printing-key,whole-number-count.`)
    const key=match[1].trim(),count=Number(match[2])
    if(!known.has(key))throw new Error(`Line ${index+1}: unknown printing ${key}.`)
    if(!Number.isSafeInteger(count))throw new Error(`Line ${index+1}: count is too large.`)
    if(Object.hasOwn(result,key))throw new Error(`Line ${index+1}: duplicate printing ${key}.`)
    result[key]=count
  }
  if(!Object.keys(result).length)throw new Error('Enter at least one printing count.')
  return result
}
