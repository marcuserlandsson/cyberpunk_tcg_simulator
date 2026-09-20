import { cardIdentity, type DeckList } from '../engine/deck'
import { draftState } from '../engine/game'
import { opponentOf } from '../engine/query'
import { createRng, nextInt, shuffle } from '../engine/rng'
import type { CardDb, CardDef, GameState, PlayerId } from '../engine/types'

/** A hypothetical position consistent with the observer's known information.
 * Own deck composition is known; its unseen order and Legend positions are not.
 * Rival unseen identities come from compatible reference lists when supplied,
 * or plausible catalog rosters, never their actual hidden cards. The game RNG
 * is replaced by an independent sample stream.
 * Pending transaction choices use protected previews instead: replaying their
 * already-observed random prefix requires the real knowledge-boundary mechanism.
 */
export function sampleHiddenState(db: CardDb, state: GameState, observer: PlayerId, seed: number, archetypes: readonly DeckList[] = []): GameState {
  if (state.pendingIntercept) throw new Error('Sample only committed positions; resolve pending choices with protected previews')
  const sample = draftState(state)
  let rng = createRng(seed)
  const known = new Set(Object.values(state.cards).filter(c => c.knownTo?.includes(observer)).map(c => c.uid))
  const canonicalSlots = (uids: number[]) => {
    const unknown = uids.filter(uid => !known.has(uid)).sort((a,b) => a-b)
    let index = 0
    return uids.map(uid => known.has(uid) ? uid : unknown[index++])
  }
  const permuteIdentities = (uids: number[]) => {
    const slots = uids.filter(uid => !known.has(uid)).sort((a,b) => a-b)
    const [ids, after] = shuffle(rng, slots.map(uid => state.cards[uid].defId).sort())
    rng = after
    slots.forEach((uid,i) => { sample.cards[uid].defId = ids[i] })
  }
  // Canonical slots prevent the hidden physical order from becoming a seed.
  sample.players[observer].deck = canonicalSlots(sample.players[observer].deck)
  permuteIdentities(sample.players[observer].deck)
  permuteIdentities(sample.players[observer].legends.filter(uid => !sample.cards[uid].faceUp))
  const rival = opponentOf(observer)
  const rivalState = state.players[rival]
  const exposed = [...rivalState.field, ...rivalState.trash, ...rivalState.removed,
    ...rivalState.legends.filter(uid => state.cards[uid].faceUp),
    ...rivalState.eddies.filter(uid => state.cards[uid].faceUp)]
  for (const uid of [...exposed]) exposed.push(...state.cards[uid].attachedGear)
  exposed.forEach(uid => known.add(uid))
  const publicCards = [...new Set([...exposed, ...known])].map(uid => state.cards[uid])
    .filter(card => card.owner === rival).map(card => db[card.defId])
  const hiddenLegends = rivalState.legends.filter(uid => !known.has(uid)).sort((a, b) => a - b)
  const hiddenMain = [...rivalState.deck, ...rivalState.hand, ...rivalState.eddies].filter(uid => !known.has(uid)).sort((a,b) => a-b)
  const compatiblePriors: { main: string[]; legends: string[] }[] = []
  for (const deck of archetypes) {
    if ([...deck.legends, ...Object.keys(deck.cards)].some(id => !db[id])) continue
    const main = Object.entries(deck.cards).flatMap(([id, count]) => Array<string>(count).fill(id))
    const legends: string[] = [...deck.legends]
    let compatible = true
    for (const def of publicCards) {
      const pool = def.type === 'legend' ? legends : main
      const index = pool.findIndex(id => cardIdentity(db[id]) === cardIdentity(def))
      if (index === -1) { compatible = false; break }
      pool.splice(index, 1)
    }
    if (compatible && main.length === hiddenMain.length && legends.length === hiddenLegends.length) compatiblePriors.push({ main, legends })
  }
  if (compatiblePriors.length) {
    // Keep a broad component even when a familiar list fits, so one exposed
    // card does not turn an archetype guess into certainty about a hidden hand.
    const [usePrior, afterChoice] = nextInt(rng, 5)
    rng = afterChoice
    if (usePrior !== 0) {
      const [index, afterIndex] = nextInt(rng, compatiblePriors.length)
      const [main, afterMain] = shuffle(afterIndex, compatiblePriors[index].main)
      const [legends, afterLegends] = shuffle(afterMain, compatiblePriors[index].legends)
      sample.players[rival].deck = canonicalSlots(sample.players[rival].deck)
      sample.players[rival].hand = canonicalSlots(sample.players[rival].hand)
      hiddenMain.forEach((uid, i) => { sample.cards[uid].defId = main[i] })
      hiddenLegends.forEach((uid, i) => { sample.cards[uid].defId = legends[i] })
      return finishSample(sample, afterLegends)
    }
  }
  const catalog = Object.values(db).filter(def => def.implementation !== 'pending').sort((a,b) => a.id.localeCompare(b.id))
  const pinned = publicCards.filter(def => def.type === 'legend')
  const candidates = catalog.filter(def => def.type === 'legend' && (def.ramLimit || def.text))
  const requirements: Record<string, number> = {}
  for (const def of publicCards) if (def.ram) requirements[def.ram.color] = Math.max(requirements[def.ram.color] ?? 0, def.ram.value)
  const ramPool = (defs: CardDef[]) => {
    const pool: Record<string, number> = {}
    for (const def of defs) if (def.ramLimit) pool[def.ramLimit.color] = (pool[def.ramLimit.color] ?? 0) + def.ramLimit.value
    return pool
  }
  // Sample a coherent Legend roster consistent with publicly exposed RAM costs.
  // Restricting cards to the first revealed color invents an implausible mono-color
  // rival; independent Legend draws can even invent duplicate character names.
  const rosters: CardDef[][] = []
  const visit = (chosen: CardDef[], start: number) => {
    if (chosen.length === hiddenLegends.length) {
      const ram = ramPool([...pinned, ...chosen])
      if (Object.entries(requirements).every(([color, cost]) => (ram[color] ?? 0) >= cost)) rosters.push(chosen)
      return
    }
    const names = new Set([...pinned, ...chosen].map(def => def.name))
    for (let i = start; i < candidates.length; i++) if (!names.has(candidates[i].name)) visit([...chosen, candidates[i]], i + 1)
  }
  visit([], 0)
  // Generated cards and sealed pools can violate a constructed roster prior.
  // In that case keep a broad hypothesis, still without reading hidden identities.
  let chosen: CardDef[] = []
  if (rosters.length) {
    const [index, after] = nextInt(rng, rosters.length)
    rng = after
    const [shuffled, next] = shuffle(rng, rosters[index])
    rng = next
    chosen = shuffled
  } else {
    const available = candidates.filter(def => !pinned.some(known => known.name === def.name))
    const [shuffled, next] = shuffle(rng, available)
    rng = next
    chosen = shuffled.filter((def, i, list) => list.findIndex(other => other.name === def.name) === i).slice(0, hiddenLegends.length)
  }
  hiddenLegends.forEach((uid, i) => { sample.cards[uid].defId = chosen[i].id })
  const ram = ramPool([...pinned, ...chosen])
  const main = catalog.filter(def => def.type !== 'legend')
  const compatible = rosters.length ? main.filter(def => !def.ram || (ram[def.ram.color] ?? 0) >= def.ram.value) : main
  const counts = new Map<string, number>()
  for (const def of publicCards) if (def.type !== 'legend') {
    const key = cardIdentity(def)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  sample.players[rival].deck = canonicalSlots(sample.players[rival].deck)
  sample.players[rival].hand = canonicalSlots(sample.players[rival].hand)
  for (const uid of [...rivalState.deck, ...rivalState.hand, ...rivalState.eddies].sort((a,b) => a-b)) {
    if (known.has(uid)) continue
    const remaining = compatible.filter(def => (counts.get(cardIdentity(def)) ?? 0) < 3)
    const pool = remaining.length ? remaining : compatible.length ? compatible : main
    const [index, after] = nextInt(rng, pool.length)
    rng = after
    const def = pool[index]
    sample.cards[uid].defId = def.id
    delete sample.cards[uid].knownTo
    const key = cardIdentity(def)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return finishSample(sample, rng)
}

function finishSample(sample: GameState, rng: number): GameState {
  sample.rng = rng
  delete sample.simulationPreview
  delete sample.previewObserver
  delete sample.previewRevealed
  delete sample.informationTrace
  return sample
}
