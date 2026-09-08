// @vitest-environment jsdom
import { describe,it,expect } from 'vitest'
import { acquisitionPlan } from '../../src/ui/acquisitionPlan'
import { loadCardDb } from '../../src/engine/cardDb'
import { loadPrintings } from '../../src/ui/printings'
import { listDecks } from '../../src/ui/storage'
const db=loadCardDb(), printings=loadPrintings(), base=listDecks()[0]
const decks=[{...base,cards:{'industrial-assembly':3}},{...base,cards:{'industrial-assembly':2}}]
const counts={'arasakademodeck/006':2,'welcometonightcityretail/033':1}
const row=(mode:'shared'|'assembled',binder=false)=>acquisitionPlan(db,decks,printings,counts,mode,binder).find(r=>r.id==='industrial-assembly')!
describe('acquisition planning',()=>{
  it('uses max for shared decks and sum for simultaneously assembled decks',()=>{
    expect(row('shared')).toMatchObject({required:3,owned:3,available:3,missing:0})
    expect(row('assembled')).toMatchObject({required:5,owned:3,missing:2})
    const legends=acquisitionPlan(db,decks,printings,counts,'assembled',false).filter(r=>db[r.id].type==='legend')
    expect(legends.every(r=>r.required===2)).toBe(true)
  })
  it('reserves one copy per artwork rather than per finish or printing',()=>{
    expect(row('shared',true)).toMatchObject({reserved:1,available:2,missing:1,playsetMissing:0})
    expect(counts).toEqual({'arasakademodeck/006':2,'welcometonightcityretail/033':1})
  })
  it('groups equivalent playable identities before aggregating across decks',()=>{
    const alias={...db,'same-card':{...db['industrial-assembly'],id:'same-card'}}
    const deck={...base,cards:{'industrial-assembly':2,'same-card':1}}
    const rows=acquisitionPlan(alias,[deck],printings,counts,'shared',false)
    expect(rows.filter(r=>r.identity===JSON.stringify([db['industrial-assembly'].name,db['industrial-assembly'].subtitle??'']))).toHaveLength(1)
    expect(rows.find(r=>r.id==='same-card')).toMatchObject({required:3,owned:3,missing:0})
  })
  it('suggests only playable printings of missing artworks for deck purchases',()=>{
    const rows=acquisitionPlan(db,decks,printings,{},'shared',false)
    const art=rows.find(r=>r.id==='industrial-assembly')!.missingArts
    expect(art).toHaveLength(1)
    expect(art[0].choices).toContain('arasakademodeck/006')
  })
})
