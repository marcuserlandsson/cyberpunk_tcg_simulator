import type { CardDb, CardDef } from '../engine/types'
import type { DeckList } from '../engine/deck'
import { newGame } from '../engine/game'
import { applyAction } from '../engine/reduce'

export function fitsRam(db: CardDb, legends: readonly string[], card: CardDef): boolean {
  if (!card.ram || card.type === 'legend') return true
  const limit = legends.reduce((sum,id) => sum + (db[id]?.ramLimit?.color === card.ram!.color ? db[id].ramLimit!.value : 0), 0)
  return card.ram.value <= limit
}
export function analyzeDeck(db: CardDb, deck: DeckList, earlyCost = 3) {
  const curve: Record<string,number> = {}, types: Record<string,number> = {}
  let total = 0, sell = 0, early = 0, unknown = 0
  for (const [id,count] of Object.entries(deck.cards)) {
    if (!Number.isSafeInteger(count) || count <= 0) continue
    total += count
    const card = db[id]
    if (!card) { unknown += count; continue }
    types[card.type] = (types[card.type] ?? 0) + count
    const cost = card.printedCost === null ? 'Unpayable' : String(card.cost)
    curve[cost] = (curve[cost] ?? 0) + count
    if (card.sellTag) sell += count
    if (card.type === 'unit' && card.printedCost !== null && card.cost <= earlyCost) early += count
  }
  return { total, sell, early, curve, types, unknown }
}
/** Uses the actual game deal, including its shuffle/order-roll RNG consumption. */
export function sampleOpeningHand(db: CardDb, deck: DeckList, seed: number): string[] {
  const game = applyAction(db,newGame(db,{decks:[deck,deck],seed}),{type:'choosePlayOrder',goFirst:true})
  return game.players[0].hand.map(uid => game.cards[uid].defId)
}
