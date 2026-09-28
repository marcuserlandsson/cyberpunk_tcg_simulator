// Readable text for an `effectResolved` note (final-review I1). The engine's
// notes are terse and machine-shaped (`scripted:<id>`, `mode 1`,
// `gig 3 -> 5`, `+2 power (turn) on 17`); this is the one UI formatter that
// turns them into a caption for both the BeatLayer callout and the log.
//
// Card uids are named only in their own slot (a trailing `on N` / `to N`, or
// the single uid after a verb such as `defeat`), never with a global replace:
// the amount in `+2 power (turn) on 2` is not a card. A face-down card reads
// "a face-down card" wherever it would be named.

import type { CardDb, GameEvent, GameState } from '../../engine/types'

type EffectEvent = Extract<GameEvent, { type: 'effectResolved' }>

const MAX_TEXT = 140

/** A card's name, or "a face-down card" for one the human may not identify. */
export function visibleCardName(db: CardDb, board: GameState, uid: number): string | undefined {
  const instance = board.cards[uid]
  if (instance === undefined) return undefined
  if (instance.faceUp === false) return 'a face-down card'
  return db[instance.defId]?.name
}

function named(db: CardDb, board: GameState, uid: string): string {
  return visibleCardName(db, board, Number(uid)) ?? 'a card'
}

function keywordLabel(keyword: string): string {
  return keyword.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

function printedText(db: CardDb, board: GameState, uid: number): string {
  const instance = board.cards[uid]
  const text = instance === undefined || instance.faceUp === false ? '' : db[instance.defId]?.text ?? ''
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat === '') return 'resolves its ability'
  return flat.length <= MAX_TEXT ? flat : `${flat.slice(0, MAX_TEXT - 1).trimEnd()}…`
}

const LEADING_VERB = /^(defeat|bounce|bottom-deck|retrieve|discard|ready|spend|intercepts the defeat of) (\d+)\b(.*)$/

export function describeEffect(db: CardDb, board: GameState, event: EffectEvent): string {
  const text = event.description
  if (text.startsWith('scripted:')) return printedText(db, board, event.sourceUid)
  if (/^mode \d+$/.test(text)) return 'chooses an effect'
  let match = /^gig (\d+) -> (\d+) \(matched\)$/.exec(text)
  if (match) return `matches a Gig: ${match[1]} → ${match[2]}`
  match = /^gig (\d+) -> (\d+)$/.exec(text)
  if (match) return `sets a Gig from ${match[1]} to ${match[2]}`
  if (text.startsWith('swap gig ')) return 'swaps two Gigs'
  match = /^grant \{([^}]+)\} to (\d+) this turn$/.exec(text)
  if (match) return `gives ${named(db, board, match[2])} {${keywordLabel(match[1])}} this turn`
  match = LEADING_VERB.exec(text)
  if (match) return `${match[1]} ${named(db, board, match[2])}${match[3]}`
  match = /^(\d+) skips its next ready step$/.exec(text)
  if (match) return `${named(db, board, match[1])} skips its next ready step`
  match = /^(.* (?:on|to)) (\d+)$/.exec(text)
  if (match) return `${match[1]} ${named(db, board, match[2])}`
  return text
}
