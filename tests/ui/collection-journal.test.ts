// @vitest-environment jsdom
import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest'
import { setCount,getCollection,replaceCollection,_resetCollectionCacheForTests,previewCollectionImport } from '../../src/ui/collection'
import { readCollectionJournal,restoreJournalChange,importCollectionJournal } from '../../src/ui/collectionJournal'
import { sessionCounts,starterEntry } from '../../src/ui/sessionCounts'
import { loadPrintings } from '../../src/ui/printings'
import arasaka from '../../data/decks/arasaka-embracing-power.json'
import mercs from '../../data/decks/mercs-the-heist.json'
import embracingPower from '../../data/decks/embracing-power-starter.json'
import theHeist from '../../data/decks/the-heist-starter.json'
import type { DeckList } from '../../src/engine/deck'
const prints=loadPrintings(),key='arasakademodeck/006',other='welcometonightcityretail/033'
beforeEach(()=>{localStorage.clear();_resetCollectionCacheForTests()})
afterEach(()=>vi.restoreAllMocks())
describe('recoverable collection sessions',()=>{
  it('records all edits and undoes only affected rows while preserving later acquisitions',()=>{
    setCount(key,3);const entry=readCollectionJournal().entries[0]
    setCount(other,2)
    replaceCollection({counts:restoreJournalChange(getCollection().counts,entry,'undo')},{kind:'Undo'})
    expect(getCollection().counts).toEqual({[other]:2})
    expect(readCollectionJournal().entries).toHaveLength(3)
    expect(restoreJournalChange(getCollection().counts,entry,'reapply')).toEqual({[key]:3,[other]:2})
    setCount(key,7)
    expect(()=>restoreJournalChange(getCollection().counts,entry,'undo')).toThrow('changed since')
  })
  it('keeps journal and collection edits in memory when browser storage fails, and exports/restores history',()=>{
    const spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('Quota')})
    setCount(key,2)
    expect(getCollection().counts[key]).toBe(2)
    const journal=readCollectionJournal()
    expect(journal.entries).toHaveLength(1);expect(journal.warning).toContain('memory')
    const text=JSON.stringify({version:1,entries:journal.entries})
    spy.mockRestore();_resetCollectionCacheForTests()
    importCollectionJournal(text)
    expect(readCollectionJournal().entries).toEqual(journal.entries)
  })
  it('stages signed trade changes and rejects inventory underflow before any write',()=>{
    expect(sessionCounts(`${key},-2\n${other},+3`,prints,{[key]:2})).toEqual({[other]:3})
    expect(()=>sessionCounts(`${key},-3`,prints,{[key]:2})).toThrow('invalid count')
    expect(getCollection().counts).toEqual({})
  })
  it('previews merge and replace without changing inventory or discarding unknown keys on merge',()=>{
    setCount('legacy-key',4)
    expect(previewCollectionImport(JSON.stringify({version:1,counts:{[key]:2}}),'merge').after).toEqual({'legacy-key':4,[key]:2})
    expect(previewCollectionImport(JSON.stringify({version:1,counts:{[key]:2}}),'replace').after).toEqual({[key]:2})
    expect(getCollection().counts).toEqual({'legacy-key':4})
  })
  it('maps every bundled product to unambiguous printing identities including the three Legends',()=>{
    for(const [deck,set] of [
      [arasaka,'arasakademodeck'],[mercs,'mercdemodeck'],
      [embracingPower,'embracingpowerretailstarterdeck'],[embracingPower,'embracingpowerbetastarterdeck'],
      [theHeist,'theheistretailstarterdeck'],[theHeist,'theheistbetastarterdeck'],
    ] as const){
      const text=starterEntry(deck as unknown as DeckList,set,prints),counts=sessionCounts(text,prints,{})
      expect(Object.values(counts).reduce((a,b)=>a+b,0)).toBe(Object.values(deck.cards).reduce((a,b)=>a+b,0)+3)
      expect(Object.keys(counts).every(key=>key.startsWith(set+'/'))).toBe(true)
    }
  })
  it('stages a full 43-card starter deck against retail and beta printings independently',()=>{
    const retail=sessionCounts(starterEntry(embracingPower as unknown as DeckList,'embracingpowerretailstarterdeck',prints),prints,{})
    const both=sessionCounts(starterEntry(embracingPower as unknown as DeckList,'embracingpowerbetastarterdeck',prints),prints,retail)
    expect(Object.values(retail).reduce((a,b)=>a+b,0)).toBe(43)
    expect(Object.values(both).reduce((a,b)=>a+b,0)).toBe(86)
    expect(Object.keys(both)).toHaveLength(40)
  })
})
