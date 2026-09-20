import embracingPower from '../../data/decks/embracing-power-starter.json'
import theHeist from '../../data/decks/the-heist-starter.json'
import arasakaDemo from '../../data/decks/arasaka-embracing-power.json'
import mercsDemo from '../../data/decks/mercs-the-heist.json'
import judyReference from '../../data/ai/bbg-judy-reference.json'
import judyDrawAndWipe from '../../data/ai/bbg-draw-and-wipe-reference.json'
import type { DeckList } from '../engine/deck'

/** Public reference archetypes, never the selected opponent's private state.
 * Four shipped starters and two BBG reference lists. Publicly exposed cards
 * condition this prior; unfamiliar lists retain a broad catalog hypothesis.
 */
export const REFERENCE_ARCHETYPES = [embracingPower, theHeist, arasakaDemo, mercsDemo,
  judyReference, judyDrawAndWipe] as unknown as readonly DeckList[]
