// @vitest-environment jsdom
import { describe,it,expect } from 'vitest'
import { matchesPrinting,parseBulkCounts } from '../../src/ui/collectionEntry'
import { loadCardDb } from '../../src/engine/cardDb'
import { loadPrintings } from '../../src/ui/printings'
const db=loadCardDb(),prints=loadPrintings(),p=prints.find(p=>p.key==='arasakademodeck/006')!
describe('printing search and bulk entry',()=>{
  it('requires the same printing to satisfy every selected filter and every search word',()=>{
    expect(matchesPrinting(db[p.cardId],p,'Industrial 006',p.setCode,new Set([p.rarity]))).toBe(true)
    expect(matchesPrinting(db[p.cardId],p,'Industrial 006','welcometonightcityretail',new Set([p.rarity]))).toBe(false)
    expect(matchesPrinting(db[p.cardId],p,'Industrial 999','',new Set())).toBe(false)
  })
  it('parses exact counts atomically and rejects duplicates, unknown keys and bad values',()=>{
    expect(parseBulkCounts('arasakademodeck/006,3\nwelcometonightcityretail/033\t0',prints)).toEqual({'arasakademodeck/006':3,'welcometonightcityretail/033':0})
    for(const text of ['arasakademodeck/006,-1','unknown,2','arasakademodeck/006,1\narasakademodeck/006,2','arasakademodeck/006,1.5'])expect(()=>parseBulkCounts(text,prints)).toThrow()
  })
})
