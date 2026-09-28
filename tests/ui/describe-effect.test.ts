// Readable effect captions (final-review I1): the one UI formatter behind the
// BeatLayer callout and the log's `effectResolved` line.

import { describe, expect, it } from 'vitest'
import { describeEffect } from '../../src/ui/presentation/describeEffect'
import { describeEvent } from '../../src/ui/useGame'
import { db, startedGame } from '../engine/gameHelpers'
import type { GameEvent, GameState } from '../../src/engine/types'

type EffectEvent = Extract<GameEvent, { type: 'effectResolved' }>

const board: GameState = structuredClone(startedGame())
const unit = board.players[0].hand[0]
const unitName = db[board.cards[unit].defId].name
const source = board.players[1].hand[0]
const sourceName = db[board.cards[source].defId].name
const legend = board.players[1].legends[0] // face-down by default
const legendName = db[board.cards[legend].defId].name
// A scripted card for the "printed text" rule.
const scripted = board.players[1].hand[1]
board.cards[scripted] = { ...board.cards[scripted], defId: 'viktor-vektor-sit-down-and-relax' }
const viktorText = db['viktor-vektor-sit-down-and-relax'].text

const effect = (description: string, sourceUid = source, targets?: number[]): EffectEvent =>
  targets === undefined
    ? { type: 'effectResolved', sourceUid, description }
    : { type: 'effectResolved', sourceUid, description, targets }

function printed(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= 140 ? flat : `${flat.slice(0, 139).trimEnd()}…`
}

describe('describeEffect', () => {
  it.each<[string, EffectEvent, string]>([
    ['leaves plain descriptions alone', effect('draw 2'), 'draw 2'],
    ['names only the trailing "on" slot, never an amount', effect(`+2 power (turn) on ${unit}`, source, [unit]), `+2 power (turn) on ${unitName}`],
    ['does not rewrite an amount that equals the target uid', effect(`+${unit} power (turn) on ${unit}`, source, [unit]), `+${unit} power (turn) on ${unitName}`],
    ['names the leading uid after a verb', effect(`defeat ${unit}`, source, [unit]), `defeat ${unitName}`],
    ['names the uid after bottom-deck', effect(`bottom-deck ${unit}`, source, [unit]), `bottom-deck ${unitName}`],
    ['names the uid after retrieve', effect(`retrieve ${unit} from the trash`, source, [unit]), `retrieve ${unitName} from the trash`],
    ['names the subject of an intercepted defeat', effect(`intercepts the defeat of ${unit}`, source, [unit]), `intercepts the defeat of ${unitName}`],
    ['names a card that skips its ready step', effect(`${unit} skips its next ready step`, source, [unit]), `${unitName} skips its next ready step`],
    ['hides a face-down target', effect(`defeat ${legend}`, source, [legend]), 'defeat a face-down card'],
    ['shows a scripted card\'s printed text', effect('scripted:viktor-vektor-sit-down-and-relax', scripted), printed(viktorText)],
    ['hides a face-down scripted source', effect('scripted:whatever', legend), 'resolves its ability'],
    ['reads a mode choice', effect('mode 1'), 'chooses an effect'],
    ['reads a Gig change', effect('gig 3 -> 5'), 'sets a Gig from 3 to 5'],
    ['reads a matched Gig', effect('gig 3 -> 5 (matched)'), 'matches a Gig: 3 → 5'],
    ['reads a Gig swap', effect('swap gig d6:4 <-> d8:2'), 'swaps two Gigs'],
    ['reads a keyword grant', effect(`grant {blocker} to ${unit} this turn`, source, [unit]), `gives ${unitName} {Blocker} this turn`],
    ['reads a hyphenated keyword grant', effect(`grant {go-solo} to ${unit} this turn`, source, [unit]), `gives ${unitName} {Go Solo} this turn`],
  ])('%s', (_name, event, expected) => {
    expect(describeEffect(db, board, event)).toBe(expected)
  })

  it('trims long printed text with an ellipsis', () => {
    const long = structuredClone(board)
    const def = { ...db['viktor-vektor-sit-down-and-relax'], text: 'x '.repeat(200) }
    const text = describeEffect({ ...db, [def.id]: def }, long, effect('scripted:viktor-vektor-sit-down-and-relax', scripted))
    expect(text.length).toBeLessThanOrEqual(140)
    expect(text.endsWith('…')).toBe(true)
  })

  it('never names a face-down card anywhere in the caption', () => {
    const text = describeEffect(db, board, effect(`grant {blocker} to ${legend} this turn`, legend, [legend]))
    expect(text).not.toContain(legendName)
    expect(text).toContain('a face-down card')
  })
})

describe("describeEvent's effect line", () => {
  it('uses the readable caption', () => {
    expect(describeEvent(db, board, effect(`+2 power (turn) on ${unit}`, source, [unit])))
      .toBe(`${sourceName}: +2 power (turn) on ${unitName}.`)
    expect(describeEvent(db, board, effect('mode 0'))).toBe(`${sourceName}: chooses an effect.`)
  })

  it('does not double the full stop after printed text', () => {
    const line = describeEvent(db, board, effect('scripted:viktor-vektor-sit-down-and-relax', scripted))
    expect(line).not.toMatch(/[.…]\.$/)
  })

  it('names a face-down source neutrally', () => {
    const line = describeEvent(db, board, effect('scripted:whatever', legend))
    expect(line).not.toContain(legendName)
    expect(line).toBe('A face-down card: resolves its ability.')
  })
})
