import type { CardDb, CardDef, GameState, PlayerId } from '../engine/types'

export interface DeckStrategy {
  minD4: boolean
  minGig: boolean
  lowCred: boolean
  pairs: boolean
  programs: number
  braindances: number
  units: number
  total: number
}

const descriptions = new WeakMap<CardDef, string>()
function description(def: CardDef): string {
  let text = descriptions.get(def)
  if (text === undefined) { text = JSON.stringify(def.effects); descriptions.set(def, text) }
  return text
}

/** Own deck composition is known, but the position of any hidden card is not.
 * For an opponent, only publicly exposed cards inform the estimate. */
export function deckStrategy(db: CardDb, state: GameState, player: PlayerId, observer: PlayerId): DeckStrategy {
  const publicUids = new Set([...state.players[player].field, ...state.players[player].trash,
    ...state.players[player].legends.filter(uid => state.cards[uid].faceUp)])
  const cards = Object.values(state.cards).filter(c => player === observer ? c.owner === player : publicUids.has(c.uid))
  const result: DeckStrategy = { minD4: false, minGig: false, lowCred: false, pairs: false, programs: 0, braindances: 0, units: 0, total: 0 }
  for (const card of cards) {
    const def = db[card.defId]
    const text = description(def)
    result.minD4 ||= text.includes('"friendlyGigSizeAtMin":4')
    result.minGig ||= text.includes('"friendlyGigValueEquals":1') || text.includes('"friendlyMinGig"')
    result.lowCred ||= text.includes('"streetCredBehindRival":true')
    result.pairs ||= text.includes('friendlyGigValuePair') || def.text.includes('value-pair')
    if (def.type === 'legend') continue
    result.total++
    if (def.type === 'program') result.programs++
    if (def.keywords.includes('braindance')) result.braindances++
    if (def.type === 'unit') result.units++
  }
  result.minGig ||= result.minD4
  return result
}

export interface EvaluationKnowledge {
  observer: PlayerId
  turnPlayer: PlayerId
  /** Only identities already in the observer's hand or disclosed to them. */
  hand: ReadonlyMap<number, string>
  strategies: [DeckStrategy, DeckStrategy]
}

export function evaluationKnowledge(db: CardDb, state: GameState, observer: PlayerId): EvaluationKnowledge {
  const view = state.pendingIntercept?.view ?? state
  const hand = new Map(state.players[observer].hand.map(uid => [uid, state.cards[uid].defId]))
  for (const uid of view.players[observer].hand) hand.set(uid, view.cards[uid].defId)
  for (const card of state.pendingIntercept?.knownCards ?? []) {
    if (card.viewer === 'all' || card.viewer === observer) hand.set(card.uid, view.cards[card.uid]?.defId ?? state.cards[card.uid].defId)
  }
  return { observer, turnPlayer: state.activePlayer, hand, strategies: [deckStrategy(db, state, 0, observer), deckStrategy(db, state, 1, observer)] }
}

/** Marginal value of retaining a known card, in addition to generic hand size.
 * Values depend on playable roles, redundancy, and available resources. */
export function retainedCardValue(db: CardDb, state: GameState, player: PlayerId, defId: string): number {
  const def = db[defId]
  const p = state.players[player]
  const resources = p.eddies.length + p.legends.length
  const affordableSoon = def.cost <= resources + 1
  const text = description(def)
  let value = affordableSoon ? 14 : 4
  if (def.type === 'unit') value += p.field.length < 2 ? 24 : 8
  if (def.keywords.includes('blocker') && p.field.length < 3) value += 12
  if (text.includes('bottomDeck') || text.includes('towerfall') || text.includes('unitCantAttack') || text.includes('unitCantReady')) {
    value += state.players[player === 0 ? 1 : 0].field.length > 0 ? 22 : 8
  }
  if (text.includes('"draw"') || text.includes('search')) value += p.hand.length < 3 ? 18 : 4
  // A spare sellable card matters while building income, not just its spell.
  if (def.sellTag && p.eddies.length < 4) value += 6
  return value
}
