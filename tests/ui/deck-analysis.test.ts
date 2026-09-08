// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { analyzeDeck, fitsRam, sampleOpeningHand } from '../../src/ui/deckAnalysis'
import { loadCardDb } from '../../src/engine/cardDb'
import { listDecks } from '../../src/ui/storage'
import { newGame } from '../../src/engine/game'
import { applyAction } from '../../src/engine/reduce'
const db=loadCardDb()
describe('deck diagnostics',()=>{
  it('counts copies rather than rows and separates null costs from cheap Units',()=>{
    const base=listDecks()[0]
    const custom={...db, nullunit:{...db.minotaur,id:'nullunit',printedCost:null,cost:0,sellTag:false}}
    const result=analyzeDeck(custom,{...base,cards:{minotaur:3,'mantis-blades':2,nullunit:1}},30)
    expect(result.total).toBe(6);expect(result.types).toEqual({unit:4,gear:2})
    expect(result.early).toBe(3);expect(result.curve.Unpayable).toBe(1)
    expect(result.sell).toBe((db.minotaur.sellTag?3:0)+(db['mantis-blades'].sellTag?2:0))
  })
  it('filters by combined selected Legend RAM and handles empty slots',()=>{
    const deck=listDecks()[0], blue=Object.values(db).find(c=>c.ram?.color==='Blue' && c.ram.value>0)!
    expect(fitsRam(db,deck.legends,blue)).toBe(false)
    expect(fitsRam(db,['','',''],blue)).toBe(false)
    expect(fitsRam(db,deck.legends,db['mantis-blades'])).toBe(true)
  })
  it('samples the real opening six deterministically without mutating the deck',()=>{
    const deck=listDecks()[0], before=JSON.stringify(deck)
    const actual=applyAction(db,newGame(db,{decks:[deck,deck],seed:42}),{type:'choosePlayOrder',goFirst:true})
    const hand=sampleOpeningHand(db,deck,42)
    expect(hand).toHaveLength(6)
    expect(hand).toEqual(actual.players[0].hand.map(uid=>actual.cards[uid].defId))
    expect(sampleOpeningHand(db,deck,42)).toEqual(hand)
    expect(JSON.stringify(deck)).toBe(before)
  })
})
