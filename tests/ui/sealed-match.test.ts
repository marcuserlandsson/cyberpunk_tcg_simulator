// @vitest-environment jsdom
import { beforeEach,describe,it,expect } from 'vitest'
import { loadCardDb } from '../../src/engine/cardDb'
import { validateDeck,type DeckList } from '../../src/engine/deck'
import { listDecks,exportDeckText,importDeckText } from '../../src/ui/storage'
import { parseSealedPool } from '../../src/ui/SealedPoolEditor'
import { newMatch,matchWinner,finalGameWinner,saveMatch,readMatches,matchSchema } from '../../src/ui/matchRecords'
const db=loadCardDb(),base=listDecks()[0]
const blue=Object.values(db).find(c=>c.type!=='legend'&&c.color==='Blue'&&c.ram?.value)! // unavailable under Arasaka RAM
const sealed:DeckList={...base,format:'sealed',cards:{[blue.id]:30},sealedPool:{[blue.id]:30,...Object.fromEntries(base.legends.map(id=>[id,1]))}}
beforeEach(()=>localStorage.clear())
describe('sealed format and pools',()=>{
  it('waives copy/RAM limits but enforces a real opened pool and a 30-card minimum',()=>{
    expect(validateDeck(db,sealed)).toEqual([])
    expect(validateDeck(db,{...sealed,cards:{[blue.id]:29}}).join()).toContain('minimum is 30')
    expect(validateDeck(db,{...sealed,cards:{[blue.id]:31}}).join()).toContain('exceeds opened pool')
    expect(validateDeck(db,{...sealed,sealedPool:undefined}).join()).toContain('opened sealed pool')
    expect(validateDeck(db,{...sealed,format:'constructed'}).join()).toContain('maximum is 3')
  })
  it('counts main-deck colors independently of Legend colors',()=>{
    const units=['Red','Yellow','Green','Blue'].map(color=>Object.values(db).find(c=>c.type==='unit'&&c.color===color)!)
    const cards=Object.fromEntries(units.map(c=>[c.id,10]))
    expect(validateDeck(db,{...sealed,cards,sealedPool:{...sealed.sealedPool,...cards}}).join()).toContain('at most 3 colors')
    delete cards[units[3].id]
    expect(validateDeck(db,{...sealed,cards,sealedPool:{...sealed.sealedPool,...cards}})).toEqual([])
  })
  it('parses printing keys and preserves pool identity through deck export/import',()=>{
    expect(parseSealedPool(db,'arasakademodeck/006,3')).toEqual({'industrial-assembly':3})
    expect(()=>parseSealedPool(db,'unknown,2')).toThrow()
    expect(importDeckText(db,exportDeckText(db,sealed))).toEqual(sealed)
  })
})
describe('best-of-three tracking',()=>{
  it('keeps immutable decks, round deadline and records across reload',()=>{
    const deck=structuredClone(base),match=newMatch(deck,deck,1000);deck.cards={}
    expect(match.deadline).toBe(3_001_000)
    expect(Object.keys(match.deckA.cards).length).toBeGreaterThan(0)
    expect(saveMatch(match)).toBe('')
    expect(readMatches()[0]).toEqual(match)
    expect(matchSchema.parse(JSON.parse(JSON.stringify(match)))).toEqual(match)
  })
  it('uses two wins normally and most wins only after the round ends, with ties',()=>{
    const match=newMatch(base,base)
    const game=(winner:0|1|null)=>({winner,notes:'',recordedAt:'now'})
    match.games=[game(0),game(null)]
    expect(matchWinner(match)).toBeNull()
    expect(matchWinner({...match,phase:'ended'})).toBe(0)
    match.games.push(game(1));expect(matchWinner({...match,phase:'ended'})).toBe('draw')
    match.games.push(game(0));expect(matchWinner(match)).toBe(0)
    expect(finalGameWinner(6,5)).toBeNull();expect(finalGameWinner(7,5)).toBe(0)
    expect(finalGameWinner(5,7)).toBe(1)
  })
})
