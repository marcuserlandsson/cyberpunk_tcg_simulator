// Task 7: the data-driven effect system — the interpreter (one test per
// EffectNode kind), trigger timing, target enumeration, activated abilities,
// quick reactions, keyword grants and go-solo.
//
// Almost everything here runs on *synthetic* CardDefs built inline: the real
// 141-card pool still carries `effects: []` (Task 8 fills it in), and synthetic
// defs let each node kind be exercised in isolation without waiting for a card
// that happens to use it. The two exceptions are the data-coupled rulings —
// gear keyword grants (`riot-shield`) and the `kiroshi-optics` equip
// exception — which are keyed off real card ids and so use the real CardDb.

import { describe, expect, it } from 'vitest'
import { effectTargetChoices, fireTrigger, resolveEffect } from '../../src/cards/effects'
import { scriptedCards } from '../../src/cards/scripted/index'
import { gearEquipTargets } from '../../src/cards/targets'
import { loadCardDb } from '../../src/engine/cardDb'
import { createRng } from '../../src/engine/rng'
import { legalActions } from '../../src/engine/legal'
import { effectiveKeywords, effectivePower, streetCred } from '../../src/engine/query'
import { applyAction } from '../../src/engine/reduce'
import type {
  Action,
  CardDb,
  CardDef,
  CardType,
  EffectDef,
  EffectNode,
  GameState,
  PlayerId,
  PlayerState,
  Reaction,
} from '../../src/engine/types'

// ---------------------------------------------------------------------------
// Synthetic card DB + scenario helpers
// ---------------------------------------------------------------------------

interface DefOpts {
  cost?: number
  power?: number | null
  keywords?: string[]
  effects?: EffectDef[]
  sellTag?: boolean
}

function def(id: string, type: CardType, opts: DefOpts = {}): CardDef {
  return {
    id,
    name: id,
    color: 'Grey',
    type,
    cost: opts.cost ?? 0,
    power: opts.power === undefined ? 1 : opts.power,
    ram: null,
    ramLimit: null,
    sellTag: opts.sellTag ?? false,
    keywords: opts.keywords ?? [],
    text: '',
    effects: opts.effects ?? [],
  }
}

function makeDb(defs: CardDef[]): CardDb {
  const db: CardDb = {}
  for (const d of defs) db[d.id] = d
  return db
}

function emptyPlayer(): PlayerState {
  return {
    deck: [],
    hand: [],
    field: [],
    legends: [],
    eddies: [],
    trash: [],
    removed: [],
    gigArea: [],
    fixer: [],
    soldThisTurn: false,
    calledLegendThisTurn: false,
    mulliganDone: true,
  }
}

/** Player 0 active, `main` phase, turn 3 (never overtime), everything empty. */
function scenario(seed = 7): GameState {
  return {
    players: [emptyPlayer(), emptyPlayer()],
    cards: {},
    nextUid: 1,
    turnNumber: 3,
    activePlayer: 0,
    firstPlayer: 0,
    phase: 'main',
    pendingAttack: null,
    pendingSteal: null,
    winner: null,
    rng: createRng(seed),
    events: [],
  }
}

type Zone = 'deck' | 'hand' | 'field' | 'legends' | 'eddies' | 'trash'

interface MintOpts {
  ready?: boolean
  lag?: boolean
  faceUp?: boolean
  tempPower?: number
}

/** Mints a fresh instance of `defId` into a zone. Mutates `state`. */
function mint(
  state: GameState,
  player: PlayerId,
  zone: Zone,
  defId: string,
  opts: MintOpts = {}
): number {
  const uid = state.nextUid++
  state.cards[uid] = {
    uid,
    defId,
    owner: player,
    ready: opts.ready ?? true,
    lag: opts.lag ?? false,
    faceUp: opts.faceUp ?? true,
    attachedGear: [],
    tempPower: opts.tempPower ?? 0,
    permPower: 0,
  }
  state.players[player][zone].push(uid)
  return uid
}

/** Mints a gear instance already attached to `host` (owned by `player`). */
function mintGear(state: GameState, player: PlayerId, defId: string, host: number): number {
  const uid = state.nextUid++
  state.cards[uid] = {
    uid,
    defId,
    owner: player,
    ready: true,
    lag: false,
    faceUp: true,
    attachedGear: [],
    tempPower: 0,
    permPower: 0,
  }
  state.cards[host].attachedGear.push(uid)
  return uid
}

function gigs(state: GameState, player: PlayerId, values: number[]): void {
  state.players[player].gigArea = values.map((value) => ({ size: 6, value }))
}

function fire(db: CardDb, state: GameState, uid: number, targets: number[] = []): GameState {
  return fireTrigger(db, state, 'onPlay', uid, targets)
}

function onPlay(effect: EffectNode, extra: Partial<EffectDef> = {}): EffectDef {
  return { trigger: 'onPlay', effect, ...extra }
}

function reactions(db: CardDb, state: GameState): Reaction[] {
  return legalActions(db, state).flatMap((a) => (a.type === 'react' ? [a.reaction] : []))
}

function abilityActions(db: CardDb, state: GameState): Extract<Action, { type: 'activateAbility' }>[] {
  return legalActions(db, state).filter(
    (a): a is Extract<Action, { type: 'activateAbility' }> => a.type === 'activateAbility'
  )
}

function playActions(db: CardDb, state: GameState): Extract<Action, { type: 'playCard' }>[] {
  return legalActions(db, state).filter(
    (a): a is Extract<Action, { type: 'playCard' }> => a.type === 'playCard'
  )
}

const pass: Reaction = { type: 'pass' }

// ---------------------------------------------------------------------------
// Node kinds
// ---------------------------------------------------------------------------

describe('resolveEffect', () => {
  it('resolves a bare node against an explicit context', () => {
    const db = makeDb([def('grunt', 'unit')])
    const s = scenario()
    const src = mint(s, 0, 'field', 'grunt')
    const node: EffectNode = { kind: 'buffPower', amount: 2, target: 'self', duration: 'turn' }

    const next = resolveEffect(db, s, node, { player: 0, sourceUid: src, targets: [] })
    expect(next.cards[src].tempPower).toBe(2)
    expect(s.cards[src].tempPower).toBe(0)
  })
})

describe('EffectNode: draw', () => {
  it('draws the stated number of cards and logs cardDrawn + effectResolved', () => {
    const db = makeDb([def('drawer', 'program', { effects: [onPlay({ kind: 'draw', count: 2 })] })])
    const s = scenario()
    const src = mint(s, 0, 'trash', 'drawer')
    const a = mint(s, 0, 'deck', 'drawer')
    const b = mint(s, 0, 'deck', 'drawer')

    const next = fire(db, s, src)
    expect(next.players[0].hand).toEqual([a, b])
    expect(next.players[0].deck).toEqual([])
    expect(next.events.filter((e) => e.type === 'cardDrawn')).toHaveLength(2)
    expect(next.events.some((e) => e.type === 'effectResolved')).toBe(true)
  })

  it('does not mutate the state it was given', () => {
    const db = makeDb([def('drawer', 'program', { effects: [onPlay({ kind: 'draw', count: 1 })] })])
    const s = scenario()
    const src = mint(s, 0, 'trash', 'drawer')
    mint(s, 0, 'deck', 'drawer')

    const before = structuredClone(s)
    fire(db, s, src)
    expect(s).toEqual(before)
  })
})

describe('EffectNode: discardRandomRival', () => {
  it('trashes a random card from the rival hand', () => {
    const db = makeDb([
      def('mugger', 'program', { effects: [onPlay({ kind: 'discardRandomRival', count: 2 })] }),
    ])
    const s = scenario()
    const src = mint(s, 0, 'trash', 'mugger')
    mint(s, 1, 'hand', 'mugger')
    mint(s, 1, 'hand', 'mugger')
    mint(s, 1, 'hand', 'mugger')

    const next = fire(db, s, src)
    expect(next.players[1].hand).toHaveLength(1)
    expect(next.players[1].trash).toHaveLength(2)
    expect(next.events.filter((e) => e.type === 'cardTrashed')).toHaveLength(2)
  })

  it('fizzles harmlessly on an empty rival hand', () => {
    const db = makeDb([
      def('mugger', 'program', { effects: [onPlay({ kind: 'discardRandomRival', count: 1 })] }),
    ])
    const s = scenario()
    const src = mint(s, 0, 'trash', 'mugger')
    const next = fire(db, s, src)
    expect(next.players[1].trash).toEqual([])
  })
})

describe('EffectNode: buffPower', () => {
  it("duration 'turn' writes tempPower; 'permanent' writes permPower", () => {
    const db = makeDb([
      def('temp', 'program', {
        effects: [onPlay({ kind: 'buffPower', amount: 3, target: 'friendlyUnit', duration: 'turn' })],
      }),
      def('perm', 'program', {
        effects: [
          onPlay({ kind: 'buffPower', amount: 2, target: 'friendlyUnit', duration: 'permanent' }),
        ],
      }),
      def('grunt', 'unit', { power: 1 }),
    ])
    const s = scenario()
    const tempSrc = mint(s, 0, 'trash', 'temp')
    const permSrc = mint(s, 0, 'trash', 'perm')
    const unit = mint(s, 0, 'field', 'grunt')

    const buffed = fire(db, s, tempSrc, [unit])
    expect(buffed.cards[unit].tempPower).toBe(3)
    expect(effectivePower(db, buffed, unit)).toBe(4)

    const permed = fire(db, buffed, permSrc, [unit])
    expect(permed.cards[unit].permPower).toBe(2)
    expect(effectivePower(db, permed, unit)).toBe(6)
  })
})

describe('EffectNode: staticPower', () => {
  it('a static effect on the unit itself raises effectivePower while it is fielded', () => {
    const db = makeDb([
      def('tough', 'unit', {
        power: 2,
        effects: [{ trigger: 'static', effect: { kind: 'staticPower', amount: 3 } }],
      }),
    ])
    const s = scenario()
    const unit = mint(s, 0, 'field', 'tough')
    expect(effectivePower(db, s, unit)).toBe(5)
  })

  it('attached gear contributes its printed power and its staticPower nodes', () => {
    const db = makeDb([
      def('grunt', 'unit', { power: 2 }),
      def('scope', 'gear', {
        power: 1,
        effects: [{ trigger: 'static', effect: { kind: 'staticPower', amount: 2 } }],
      }),
    ])
    const s = scenario()
    const unit = mint(s, 0, 'field', 'grunt')
    expect(effectivePower(db, s, unit)).toBe(2)
    mintGear(s, 0, 'scope', unit)
    expect(effectivePower(db, s, unit)).toBe(5) // 2 + printed 1 + static 2
  })

  it('gear staticPower changes a fight outcome', () => {
    const db = makeDb([
      def('attacker', 'unit', { power: 3 }),
      def('defender', 'unit', { power: 4 }),
      def('blade', 'gear', {
        power: 0,
        effects: [{ trigger: 'static', effect: { kind: 'staticPower', amount: 2 } }],
      }),
    ])
    const s = scenario()
    const attacker = mint(s, 0, 'field', 'attacker')
    const target = mint(s, 1, 'field', 'defender', { ready: false })
    mintGear(s, 0, 'blade', attacker)

    let next = applyAction(db, s, { type: 'attack', attacker, target })
    next = applyAction(db, next, { type: 'react', reaction: pass })
    // 3+2 = 5 beats 4: the defender dies and the buffed attacker survives.
    expect(next.players[1].trash).toContain(target)
    expect(next.players[0].field).toContain(attacker)
  })

  it("a static effect's streetCred condition gates the bonus", () => {
    const db = makeDb([
      def('proud', 'unit', {
        power: 2,
        effects: [
          {
            trigger: 'static',
            condition: { streetCredAtLeast: 10 },
            effect: { kind: 'staticPower', amount: 5 },
          },
        ],
      }),
    ])
    const s = scenario()
    const unit = mint(s, 0, 'field', 'proud')
    expect(effectivePower(db, s, unit)).toBe(2)
    gigs(s, 0, [6, 6])
    expect(streetCred(s, 0)).toBe(12)
    expect(effectivePower(db, s, unit)).toBe(7)
  })
})

describe('EffectNode: cantAttack', () => {
  it('a unit with the static restriction is never offered as an attacker', () => {
    const db = makeDb([
      def('pacifist', 'unit', {
        power: 3,
        effects: [{ trigger: 'static', effect: { kind: 'cantAttack' } }],
      }),
      def('grunt', 'unit', { power: 1 }),
    ])
    const s = scenario()
    const pacifist = mint(s, 0, 'field', 'pacifist')
    const grunt = mint(s, 0, 'field', 'grunt')
    mint(s, 1, 'field', 'grunt', { ready: false })

    const attackers = legalActions(db, s).flatMap((a) => (a.type === 'attack' ? [a.attacker] : []))
    expect(attackers).toContain(grunt)
    expect(attackers).not.toContain(pacifist)
  })
})

describe('EffectNode: defeat / bounce / bottomDeck', () => {
  it('defeat sends the target and its gear to the trash', () => {
    const db = makeDb([
      def('hit', 'program', { effects: [onPlay({ kind: 'defeat', target: 'rivalUnit' })] }),
      def('grunt', 'unit'),
      def('scope', 'gear', { power: 1 }),
    ])
    const s = scenario()
    const src = mint(s, 0, 'trash', 'hit')
    const victim = mint(s, 1, 'field', 'grunt')
    const gear = mintGear(s, 1, 'scope', victim)

    const next = fire(db, s, src, [victim])
    expect(next.players[1].field).toEqual([])
    expect(next.players[1].trash).toContain(victim)
    expect(next.players[1].trash).toContain(gear)
    expect(next.events.some((e) => e.type === 'unitDefeated' && e.uid === victim)).toBe(true)
  })

  it('bounce returns the target to its owner hand and drops its gear', () => {
    const db = makeDb([
      def('shoo', 'program', { effects: [onPlay({ kind: 'bounce', target: 'rivalUnit' })] }),
      def('grunt', 'unit'),
      def('scope', 'gear', { power: 1 }),
    ])
    const s = scenario()
    const src = mint(s, 0, 'trash', 'shoo')
    const victim = mint(s, 1, 'field', 'grunt', { tempPower: 4 })
    const gear = mintGear(s, 1, 'scope', victim)

    const next = fire(db, s, src, [victim])
    expect(next.players[1].field).toEqual([])
    expect(next.players[1].hand).toEqual([victim])
    expect(next.players[1].trash).toEqual([gear])
    expect(next.cards[victim].tempPower).toBe(0) // buffs die with the field exit
    expect(next.events.some((e) => e.type === 'unitDefeated')).toBe(false)
  })

  it('bottomDeck puts the target under its owner deck', () => {
    const db = makeDb([
      def('sink', 'program', { effects: [onPlay({ kind: 'bottomDeck', target: 'rivalUnit' })] }),
      def('grunt', 'unit'),
    ])
    const s = scenario()
    const src = mint(s, 0, 'trash', 'sink')
    const bottom = mint(s, 1, 'deck', 'grunt')
    const victim = mint(s, 1, 'field', 'grunt')

    const next = fire(db, s, src, [victim])
    expect(next.players[1].deck).toEqual([bottom, victim])
    expect(next.events.some((e) => e.type === 'cardBottomDecked' && e.uid === victim)).toBe(true)
  })
})

describe('EffectNode: readyCard / spendCard', () => {
  it('readies and spends the chosen card', () => {
    const db = makeDb([
      def('wake', 'program', { effects: [onPlay({ kind: 'readyCard', target: 'friendlyUnit' })] }),
      def('tap', 'program', { effects: [onPlay({ kind: 'spendCard', target: 'rivalUnit' })] }),
      def('grunt', 'unit'),
    ])
    const s = scenario()
    const wake = mint(s, 0, 'trash', 'wake')
    const tap = mint(s, 0, 'trash', 'tap')
    const mine = mint(s, 0, 'field', 'grunt', { ready: false })
    const theirs = mint(s, 1, 'field', 'grunt', { ready: true })

    const readied = fire(db, s, wake, [mine])
    expect(readied.cards[mine].ready).toBe(true)
    const spent = fire(db, readied, tap, [theirs])
    expect(spent.cards[theirs].ready).toBe(false)
  })
})

describe('EffectNode: gig manipulation', () => {
  it('stealGig moves rival dice into the friendly gig area', () => {
    const db = makeDb([
      def('thief', 'program', { effects: [onPlay({ kind: 'stealGig', count: 2 })] }),
    ])
    const s = scenario()
    const src = mint(s, 0, 'trash', 'thief')
    gigs(s, 1, [3, 4, 5])

    const next = fire(db, s, src)
    expect(next.players[0].gigArea).toHaveLength(2)
    expect(next.players[1].gigArea).toHaveLength(1)
    expect(next.events.filter((e) => e.type === 'gigStolen')).toHaveLength(2)
  })

  it('returnGig sends a friendly gig die back to the fixer, unrolled', () => {
    const db = makeDb([
      def('giveback', 'program', { effects: [onPlay({ kind: 'returnGig', count: 1 })] }),
    ])
    const s = scenario()
    const src = mint(s, 0, 'trash', 'giveback')
    gigs(s, 0, [5])

    const next = fire(db, s, src)
    expect(next.players[0].gigArea).toEqual([])
    expect(next.players[0].fixer).toEqual([{ size: 6, value: 0 }])
  })

  it('rerollGig rerolls one die of the chosen player and logs dieRolled', () => {
    const db = makeDb([
      def('reroll', 'program', { effects: [onPlay({ kind: 'rerollGig', whose: 'rival' })] }),
    ])
    const s = scenario()
    const src = mint(s, 0, 'trash', 'reroll')
    gigs(s, 1, [1])

    const next = fire(db, s, src)
    expect(next.players[1].gigArea).toHaveLength(1)
    const value = next.players[1].gigArea[0].value
    expect(value).toBeGreaterThanOrEqual(1)
    expect(value).toBeLessThanOrEqual(6)
    expect(next.events.some((e) => e.type === 'dieRolled' && e.player === 1)).toBe(true)
  })
})

describe('EffectNode: trashFromDeck / gainEddieFromTopDeck', () => {
  it('trashFromDeck moves cards from the top of the chosen deck to the trash', () => {
    const db = makeDb([
      def('mill', 'program', {
        effects: [onPlay({ kind: 'trashFromDeck', whose: 'rival', count: 2 })],
      }),
      def('grunt', 'unit'),
    ])
    const s = scenario()
    const src = mint(s, 0, 'trash', 'mill')
    const a = mint(s, 1, 'deck', 'grunt')
    const b = mint(s, 1, 'deck', 'grunt')
    const c = mint(s, 1, 'deck', 'grunt')

    const next = fire(db, s, src)
    expect(next.players[1].deck).toEqual([c])
    expect(next.players[1].trash).toEqual([a, b])
    expect(next.events.filter((e) => e.type === 'cardTrashed')).toHaveLength(2)
  })

  it('gainEddieFromTopDeck banks the top card face-down and ready', () => {
    const db = makeDb([
      def('bank', 'program', { effects: [onPlay({ kind: 'gainEddieFromTopDeck', count: 1 })] }),
      def('grunt', 'unit'),
    ])
    const s = scenario()
    const src = mint(s, 0, 'trash', 'bank')
    const top = mint(s, 0, 'deck', 'grunt')

    const next = fire(db, s, src)
    expect(next.players[0].eddies).toEqual([top])
    expect(next.cards[top].faceUp).toBe(false)
    expect(next.cards[top].ready).toBe(true)
  })
})

describe('EffectNode: sequence and scripted', () => {
  it('sequence resolves its children in order, consuming one target each', () => {
    const db = makeDb([
      def('combo', 'program', {
        effects: [
          onPlay({
            kind: 'sequence',
            effects: [
              { kind: 'defeat', target: 'rivalUnit' },
              { kind: 'draw', count: 1 },
            ],
          }),
        ],
      }),
      def('grunt', 'unit'),
    ])
    const s = scenario()
    const src = mint(s, 0, 'trash', 'combo')
    const drawn = mint(s, 0, 'deck', 'grunt')
    const victim = mint(s, 1, 'field', 'grunt')

    const next = fire(db, s, src, [victim])
    expect(next.players[1].trash).toContain(victim)
    expect(next.players[0].hand).toEqual([drawn])
  })

  it('scripted dispatches to the registry by name', () => {
    scriptedCards['test-marker'] = (_db, state, ctx) => ({
      ...state,
      events: [...state.events, { type: 'effectResolved', sourceUid: ctx.sourceUid, description: 'scripted!' }],
    })
    const db = makeDb([
      def('script', 'program', { effects: [onPlay({ kind: 'scripted', name: 'test-marker' })] }),
    ])
    const s = scenario()
    const src = mint(s, 0, 'trash', 'script')

    const next = fire(db, s, src)
    expect(
      next.events.some((e) => e.type === 'effectResolved' && e.description === 'scripted!')
    ).toBe(true)
    delete scriptedCards['test-marker']
  })

  it('throws on an unknown scripted name (a data bug must be loud)', () => {
    const db = makeDb([
      def('script', 'program', { effects: [onPlay({ kind: 'scripted', name: 'nope' })] }),
    ])
    const s = scenario()
    const src = mint(s, 0, 'trash', 'script')
    expect(() => fire(db, s, src)).toThrow(/nope/)
  })
})

// ---------------------------------------------------------------------------
// Target enumeration
// ---------------------------------------------------------------------------

describe('effectTargetChoices', () => {
  const db = makeDb([
    def('grunt', 'unit'),
    def('src', 'program'),
    def('boss', 'legend', { power: 5, keywords: ['go-solo'], cost: 1 }),
  ])

  function stage(): { s: GameState; src: number; mine: number[]; theirs: number[]; legend: number } {
    const s = scenario()
    const src = mint(s, 0, 'trash', 'src')
    const mineReady = mint(s, 0, 'field', 'grunt')
    const mineSpent = mint(s, 0, 'field', 'grunt', { ready: false })
    const theirsReady = mint(s, 1, 'field', 'grunt')
    const theirsSpent = mint(s, 1, 'field', 'grunt', { ready: false })
    const legend = mint(s, 0, 'legends', 'boss')
    return { s, src, mine: [mineReady, mineSpent], theirs: [theirsReady, theirsSpent], legend }
  }

  it('enumerates one tuple per candidate for each TargetSpec', () => {
    const { s, src, mine, theirs, legend } = stage()
    const flat = (spec: 'self' | 'friendlyUnit' | 'rivalUnit' | 'rivalSpentUnit' | 'anyUnit' | 'friendlyUnitOrLegend') =>
      effectTargetChoices(db, s, src, onPlay({ kind: 'defeat', target: spec })).map((t) => t[0])

    expect(effectTargetChoices(db, s, src, onPlay({ kind: 'defeat', target: 'self' }))).toEqual([[]])
    expect(flat('friendlyUnit').sort()).toEqual([...mine].sort())
    expect(flat('rivalUnit').sort()).toEqual([...theirs].sort())
    expect(flat('rivalSpentUnit')).toEqual([theirs[1]])
    expect(flat('anyUnit').sort()).toEqual([...mine, ...theirs].sort())
    expect(flat('friendlyUnitOrLegend').sort()).toEqual([...mine, legend].sort())
  })

  it('omits a face-down legend from friendlyUnitOrLegend', () => {
    const { s, src, mine, legend } = stage()
    s.cards[legend].faceUp = false
    const choices = effectTargetChoices(
      db,
      s,
      src,
      onPlay({ kind: 'defeat', target: 'friendlyUnitOrLegend' })
    ).map((t) => t[0])
    expect(choices.sort()).toEqual([...mine].sort())
  })

  it('enumerates the cartesian product for a multi-target sequence', () => {
    const { s, src, mine, theirs } = stage()
    const tuples = effectTargetChoices(
      db,
      s,
      src,
      onPlay({
        kind: 'sequence',
        effects: [
          { kind: 'spendCard', target: 'friendlyUnit' },
          { kind: 'defeat', target: 'rivalUnit' },
        ],
      })
    )
    expect(tuples).toHaveLength(mine.length * theirs.length)
    for (const [a, b] of tuples) {
      expect(mine).toContain(a)
      expect(theirs).toContain(b)
    }
  })

  it('yields the empty tuple (and the def fizzles) when no candidate exists', () => {
    const s = scenario()
    const src = mint(s, 0, 'trash', 'src')
    const d = onPlay({ kind: 'defeat', target: 'rivalUnit' })
    expect(effectTargetChoices(db, s, src, d)).toEqual([[]])
    // Fizzles instead of throwing when it actually resolves.
    expect(fireTrigger(db, s, 'onPlay', src, [])).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

describe('trigger: onPlay', () => {
  it('fires exactly once when the card resolves, and only for the matching trigger', () => {
    const db = makeDb([
      def('drawer', 'program', {
        cost: 0,
        effects: [
          onPlay({ kind: 'draw', count: 1 }),
          { trigger: 'onDefeat', effect: { kind: 'draw', count: 1 } },
        ],
      }),
      def('grunt', 'unit'),
    ])
    const s = scenario()
    const card = mint(s, 0, 'hand', 'drawer')
    mint(s, 0, 'deck', 'grunt')
    mint(s, 0, 'deck', 'grunt')

    const next = applyAction(db, s, { type: 'playCard', card, payment: [], targets: [] })
    expect(next.players[0].hand).toHaveLength(1) // the drawn card only
    expect(next.events.filter((e) => e.type === 'cardDrawn')).toHaveLength(1)
    expect(next.players[0].trash).toContain(card)
  })

  it('a unit resolves its onPlay effect after it reaches the field', () => {
    const db = makeDb([
      def('leader', 'unit', {
        power: 1,
        effects: [onPlay({ kind: 'buffPower', amount: 2, target: 'self', duration: 'turn' })],
      }),
    ])
    const s = scenario()
    const card = mint(s, 0, 'hand', 'leader')

    const next = applyAction(db, s, { type: 'playCard', card, payment: [], targets: [] })
    expect(next.players[0].field).toContain(card)
    expect(next.cards[card].tempPower).toBe(2)
  })

  it('a gear onPlay effect takes its targets after the equip target', () => {
    const db = makeDb([
      def('grunt', 'unit'),
      def('smartgun', 'gear', {
        power: 0,
        effects: [onPlay({ kind: 'defeat', target: 'rivalUnit' })],
      }),
    ])
    const s = scenario()
    const gear = mint(s, 0, 'hand', 'smartgun')
    const host = mint(s, 0, 'field', 'grunt')
    const victim = mint(s, 1, 'field', 'grunt')

    const action = playActions(db, s).find((a) => a.card === gear)
    expect(action).toBeDefined()
    expect(action!.targets).toEqual([host, victim])

    const next = applyAction(db, s, action!)
    expect(next.cards[host].attachedGear).toEqual([gear])
    expect(next.players[1].trash).toContain(victim)
  })
})

describe('trigger: onCall', () => {
  it('fires when a legend flips face-up via Call a Legend', () => {
    const db = makeDb([
      def('caller', 'legend', {
        power: null,
        effects: [{ trigger: 'onCall', effect: { kind: 'draw', count: 1 } }],
      }),
      def('grunt', 'unit'),
    ])
    const s = scenario()
    const legend = mint(s, 0, 'legends', 'caller', { faceUp: false })
    const eddie = mint(s, 0, 'eddies', 'grunt', { faceUp: false })
    mint(s, 0, 'deck', 'grunt')

    const next = applyAction(db, s, { type: 'callLegend', payment: [eddie] })
    expect(next.cards[legend].faceUp).toBe(true)
    expect(next.players[0].hand).toHaveLength(1)
    expect(next.events.filter((e) => e.type === 'cardDrawn')).toHaveLength(1)
  })
})

describe('trigger: onAttack', () => {
  it('resolves before the react window, so a unit it defeats can never block', () => {
    const db = makeDb([
      def('sniper', 'unit', {
        power: 3,
        effects: [{ trigger: 'onAttack', effect: { kind: 'defeat', target: 'rivalUnit' } }],
      }),
      def('wall', 'unit', { power: 9, keywords: ['blocker'] }),
    ])
    const s = scenario()
    const attacker = mint(s, 0, 'field', 'sniper')
    const wall = mint(s, 1, 'field', 'wall')
    gigs(s, 1, [4])

    const declared = applyAction(db, s, { type: 'attack', attacker, target: 'gigArea' })
    expect(declared.phase).toBe('react')
    expect(declared.players[1].trash).toContain(wall)
    expect(reactions(db, declared).some((r) => r.type === 'block')).toBe(false)

    let resolved = applyAction(db, declared, { type: 'react', reaction: pass })
    expect(resolved.phase).toBe('chooseGig') // the un-blocked steal goes through
    resolved = applyAction(db, resolved, { type: 'chooseGig', dieIndex: 0 })
    expect(resolved.players[0].gigArea).toHaveLength(1)
  })
})

describe('trigger: onDefeat', () => {
  it('fires when the unit loses a fight', () => {
    const db = makeDb([
      def('bomber', 'unit', {
        power: 1,
        effects: [{ trigger: 'onDefeat', effect: { kind: 'draw', count: 1 } }],
      }),
      def('brute', 'unit', { power: 5 }),
      def('grunt', 'unit'),
    ])
    const s = scenario()
    const attacker = mint(s, 0, 'field', 'brute')
    const victim = mint(s, 1, 'field', 'bomber', { ready: false })
    mint(s, 1, 'deck', 'grunt')

    let next = applyAction(db, s, { type: 'attack', attacker, target: victim })
    next = applyAction(db, next, { type: 'react', reaction: pass })
    expect(next.players[1].trash).toContain(victim)
    expect(next.players[1].hand).toHaveLength(1) // the defeated unit's controller drew
  })

  it('fires when an effect defeats the unit', () => {
    const db = makeDb([
      def('hit', 'program', { effects: [onPlay({ kind: 'defeat', target: 'rivalUnit' })] }),
      def('bomber', 'unit', {
        power: 1,
        effects: [{ trigger: 'onDefeat', effect: { kind: 'discardRandomRival', count: 1 } }],
      }),
      def('grunt', 'unit'),
    ])
    const s = scenario()
    const src = mint(s, 0, 'trash', 'hit')
    const victim = mint(s, 1, 'field', 'bomber')
    mint(s, 0, 'hand', 'grunt') // the bomber's controller discards from player 0

    const next = fire(db, s, src, [victim])
    expect(next.players[1].trash).toContain(victim)
    expect(next.players[0].hand).toEqual([])
  })
})

describe('auto-targeting (docs/rulings.md §32)', () => {
  it('picks uniformly through state.rng, so the same state always resolves the same way', () => {
    const db = makeDb([
      def('sniper', 'unit', {
        power: 3,
        effects: [{ trigger: 'onAttack', effect: { kind: 'defeat', target: 'rivalUnit' } }],
      }),
      def('grunt', 'unit', { power: 1 }),
    ])
    const s = scenario()
    const attacker = mint(s, 0, 'field', 'sniper')
    const a = mint(s, 1, 'field', 'grunt')
    const b = mint(s, 1, 'field', 'grunt')
    gigs(s, 1, [4])

    const first = applyAction(db, s, { type: 'attack', attacker, target: 'gigArea' })
    const again = applyAction(db, s, { type: 'attack', attacker, target: 'gigArea' })
    expect(again.players[1].trash).toEqual(first.players[1].trash)
    expect(first.players[1].trash).toHaveLength(1)
    expect([a, b]).toContain(first.players[1].trash[0])
    // The pick came off the rng, so the rng advanced.
    expect(first.rng).not.toEqual(s.rng)
  })
})

describe('static effects while not in play', () => {
  it('a face-down legend contributes no statics', () => {
    const db = makeDb([
      def('proud', 'legend', {
        power: 4,
        effects: [{ trigger: 'static', effect: { kind: 'staticPower', amount: 3 } }],
      }),
    ])
    const s = scenario()
    const legend = mint(s, 0, 'legends', 'proud', { faceUp: false })
    expect(effectivePower(db, s, legend)).toBe(4)
    s.cards[legend].faceUp = true
    expect(effectivePower(db, s, legend)).toBe(7)
  })
})

describe('condition: streetCredAtLeast', () => {
  it('skips a trigger whose street cred requirement is not met', () => {
    const db = makeDb([
      def('proud', 'program', {
        effects: [onPlay({ kind: 'draw', count: 1 }, { condition: { streetCredAtLeast: 8 } })],
      }),
      def('grunt', 'unit'),
    ])
    const s = scenario()
    const src = mint(s, 0, 'trash', 'proud')
    mint(s, 0, 'deck', 'grunt')

    expect(fire(db, s, src).players[0].hand).toEqual([])

    const rich = structuredClone(s)
    gigs(rich, 0, [4, 4])
    expect(fire(db, rich, src).players[0].hand).toHaveLength(1)
  })

  it('hides an activated ability whose street cred requirement is not met', () => {
    const db = makeDb([
      def('vet', 'unit', {
        power: 1,
        effects: [
          {
            trigger: 'activated',
            cost: { selfSpend: true },
            condition: { streetCredAtLeast: 5 },
            effect: { kind: 'draw', count: 1 },
          },
        ],
      }),
      def('grunt', 'unit'),
    ])
    const s = scenario()
    mint(s, 0, 'field', 'vet')
    mint(s, 0, 'deck', 'grunt')
    expect(abilityActions(db, s)).toEqual([])

    gigs(s, 0, [5])
    expect(abilityActions(db, s)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Activated abilities
// ---------------------------------------------------------------------------

describe('activated abilities', () => {
  const db = makeDb([
    def('vet', 'unit', {
      power: 1,
      effects: [
        { trigger: 'activated', cost: { selfSpend: true }, effect: { kind: 'draw', count: 1 } },
      ],
    }),
    def('broker', 'unit', {
      power: 1,
      effects: [
        { trigger: 'activated', cost: { eddies: 1 }, effect: { kind: 'draw', count: 1 } },
      ],
    }),
    def('grunt', 'unit'),
  ])

  it('a selfSpend ability spends its source and resolves', () => {
    const s = scenario()
    const vet = mint(s, 0, 'field', 'vet')
    mint(s, 0, 'deck', 'grunt')

    const action = abilityActions(db, s)[0]
    expect(action).toEqual({ type: 'activateAbility', card: vet, abilityIndex: 0, targets: [] })

    const next = applyAction(db, s, action)
    expect(next.cards[vet].ready).toBe(false)
    expect(next.players[0].hand).toHaveLength(1)
    expect(abilityActions(db, next)).toEqual([]) // spent: not available twice
  })

  it('lag blocks a selfSpend ability', () => {
    const s = scenario()
    mint(s, 0, 'field', 'vet', { lag: true })
    mint(s, 0, 'deck', 'grunt')
    expect(abilityActions(db, s)).toEqual([])
  })

  it('an eddies cost is paid from the canonical payment and does not spend the source', () => {
    const s = scenario()
    const broker = mint(s, 0, 'field', 'broker')
    const eddie = mint(s, 0, 'eddies', 'grunt', { faceUp: false })
    mint(s, 0, 'deck', 'grunt')

    expect(abilityActions(db, s)).toHaveLength(1)
    const next = applyAction(db, s, {
      type: 'activateAbility',
      card: broker,
      abilityIndex: 0,
      targets: [],
    })
    expect(next.cards[eddie].ready).toBe(false)
    expect(next.cards[broker].ready).toBe(true)
    expect(next.players[0].hand).toHaveLength(1)
  })

  it('an unaffordable eddies cost hides the ability', () => {
    const s = scenario()
    mint(s, 0, 'field', 'broker')
    mint(s, 0, 'deck', 'grunt')
    expect(abilityActions(db, s)).toEqual([])
  })

  it('enumerates one entry per legal target and is illegal with a bogus target', () => {
    const targeted = makeDb([
      def('sniper', 'unit', {
        power: 1,
        effects: [
          {
            trigger: 'activated',
            cost: { selfSpend: true },
            effect: { kind: 'defeat', target: 'rivalUnit' },
          },
        ],
      }),
      def('grunt', 'unit'),
    ])
    const s = scenario()
    const sniper = mint(s, 0, 'field', 'sniper')
    const a = mint(s, 1, 'field', 'grunt')
    const b = mint(s, 1, 'field', 'grunt')

    const actions = abilityActions(targeted, s)
    expect(actions.map((x) => x.targets[0]).sort()).toEqual([a, b].sort())

    const next = applyAction(targeted, s, {
      type: 'activateAbility',
      card: sniper,
      abilityIndex: 0,
      targets: [b],
    })
    expect(next.players[1].trash).toEqual([b])
    expect(next.cards[sniper].ready).toBe(false)
  })

  it('is not offered when its only target spec has no candidate', () => {
    const targeted = makeDb([
      def('sniper', 'unit', {
        power: 1,
        effects: [
          {
            trigger: 'activated',
            cost: { selfSpend: true },
            effect: { kind: 'defeat', target: 'rivalUnit' },
          },
        ],
      }),
    ])
    const s = scenario()
    mint(s, 0, 'field', 'sniper')
    expect(abilityActions(targeted, s)).toEqual([])
  })

  it('an ability on attached gear spends its host, not the gear', () => {
    const geared = makeDb([
      def('grunt', 'unit'),
      def('smartgun', 'gear', {
        power: 0,
        effects: [
          { trigger: 'activated', cost: { selfSpend: true }, effect: { kind: 'draw', count: 1 } },
        ],
      }),
    ])
    const s = scenario()
    const host = mint(s, 0, 'field', 'grunt')
    const gear = mintGear(s, 0, 'smartgun', host)
    mint(s, 0, 'deck', 'grunt')

    const action = abilityActions(geared, s)[0]
    expect(action.card).toBe(gear)
    const next = applyAction(geared, s, action)
    expect(next.cards[host].ready).toBe(false)
    expect(next.players[0].hand).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Quick: react-window plays and abilities
// ---------------------------------------------------------------------------

describe('quick', () => {
  const db = makeDb([
    def('grunt', 'unit', { power: 3 }),
    def('wall', 'unit', { power: 2 }),
    def('flashbang', 'program', {
      cost: 1,
      keywords: ['quick'],
      effects: [onPlay({ kind: 'buffPower', amount: 2, target: 'friendlyUnit', duration: 'turn' }, { quick: true })],
    }),
    def('hitman', 'unit', {
      power: 1,
      effects: [
        {
          trigger: 'activated',
          quick: true,
          cost: { selfSpend: true },
          effect: { kind: 'defeat', target: 'rivalUnit' },
        },
      ],
    }),
  ])

  it('a quick program is offered as a reaction only while a rival attacks', () => {
    const s = scenario()
    const attacker = mint(s, 0, 'field', 'grunt')
    const defender = mint(s, 1, 'field', 'wall', { ready: false })
    const quick = mint(s, 1, 'hand', 'flashbang')
    mint(s, 1, 'eddies', 'grunt', { faceUp: false })

    // Player 0's main phase: player 1 has no actions at all, quick included.
    expect(legalActions(db, s).some((a) => a.type === 'react')).toBe(false)

    const declared = applyAction(db, s, { type: 'attack', attacker, target: defender })
    const quickReactions = reactions(db, declared).filter((r) => r.type === 'quick')
    expect(quickReactions).toHaveLength(1)
    expect(quickReactions[0]).toMatchObject({ type: 'quick', card: quick, targets: [defender] })
  })

  it('a react-window buff wins the current fight and is gone next turn', () => {
    const s = scenario()
    const attacker = mint(s, 0, 'field', 'grunt') // power 3
    const defender = mint(s, 1, 'field', 'wall', { ready: false }) // power 2
    const quick = mint(s, 1, 'hand', 'flashbang')
    const eddie = mint(s, 1, 'eddies', 'grunt', { faceUp: false })

    let next = applyAction(db, s, { type: 'attack', attacker, target: defender })
    next = applyAction(db, next, {
      type: 'react',
      reaction: { type: 'quick', card: quick, payment: [eddie], targets: [defender] },
    })
    expect(next.phase).toBe('react') // the window stays open
    expect(next.cards[defender].tempPower).toBe(2)
    expect(next.cards[eddie].ready).toBe(false)
    expect(next.players[1].trash).toContain(quick)

    next = applyAction(db, next, { type: 'react', reaction: pass })
    // 2+2 = 4 beats 3: the attacker dies, the defender survives.
    expect(next.players[0].trash).toContain(attacker)
    expect(next.players[1].field).toContain(defender)

    const nextTurn = applyAction(db, next, { type: 'endTurn' })
    expect(nextTurn.cards[defender].tempPower).toBe(0)
  })

  it('a quick activated ability is offered in the react window and in the main phase', () => {
    const s = scenario()
    const attacker = mint(s, 0, 'field', 'grunt')
    mint(s, 1, 'field', 'hitman')
    gigs(s, 1, [4])

    // Main phase belongs to player 0, whose field has no quick ability.
    expect(abilityActions(db, s)).toEqual([])

    const declared = applyAction(db, s, { type: 'attack', attacker, target: 'gigArea' })
    const quickAbilities = reactions(db, declared).filter((r) => r.type === 'quickAbility')
    expect(quickAbilities).toHaveLength(1)

    const next = applyAction(db, declared, { type: 'react', reaction: quickAbilities[0] })
    expect(next.players[0].trash).toContain(attacker)
    // The attacker vanished: the attack fizzles with no steal.
    const resolved = applyAction(db, next, { type: 'react', reaction: pass })
    expect(resolved.phase).toBe('main')
    expect(resolved.players[1].gigArea).toHaveLength(1)
  })

  it('a quick ability is still a normal main-phase ability (docs/rulings.md §33)', () => {
    const s = scenario()
    const hitman = mint(s, 0, 'field', 'hitman') // player 0's own turn
    const victim = mint(s, 1, 'field', 'grunt')

    const actions = abilityActions(db, s)
    expect(actions).toEqual([
      { type: 'activateAbility', card: hitman, abilityIndex: 0, targets: [victim] },
    ])
    const next = applyAction(db, s, actions[0])
    expect(next.players[1].trash).toContain(victim)
  })

  it('a non-quick program is never offered as a reaction', () => {
    const slow = makeDb([
      def('grunt', 'unit', { power: 3 }),
      def('wall', 'unit', { power: 2 }),
      def('slowspell', 'program', {
        cost: 1,
        effects: [onPlay({ kind: 'draw', count: 1 })],
      }),
    ])
    const s = scenario()
    const attacker = mint(s, 0, 'field', 'grunt')
    const defender = mint(s, 1, 'field', 'wall', { ready: false })
    mint(s, 1, 'hand', 'slowspell')
    mint(s, 1, 'eddies', 'grunt', { faceUp: false })

    const declared = applyAction(slow, s, { type: 'attack', attacker, target: defender })
    expect(reactions(slow, declared).some((r) => r.type === 'quick')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// tempPower lifetime (docs/rulings.md §20)
// ---------------------------------------------------------------------------

describe('tempPower lifetime', () => {
  it('endTurn clears turn buffs on both players cards', () => {
    const db = makeDb([def('grunt', 'unit')])
    const s = scenario()
    const mine = mint(s, 0, 'field', 'grunt', { tempPower: 3 })
    const theirs = mint(s, 1, 'field', 'grunt', { tempPower: 4 })

    const next = applyAction(db, s, { type: 'endTurn' })
    expect(next.cards[mine].tempPower).toBe(0)
    expect(next.cards[theirs].tempPower).toBe(0)
  })

  it('permanent buffs survive endTurn', () => {
    const db = makeDb([
      def('grunt', 'unit'),
      def('perm', 'program', {
        effects: [
          onPlay({ kind: 'buffPower', amount: 2, target: 'friendlyUnit', duration: 'permanent' }),
        ],
      }),
    ])
    const s = scenario()
    const src = mint(s, 0, 'trash', 'perm')
    const unit = mint(s, 0, 'field', 'grunt')
    const buffed = fire(db, s, src, [unit])

    const next = applyAction(db, buffed, { type: 'endTurn' })
    expect(next.cards[unit].permPower).toBe(2)
    expect(effectivePower(db, next, unit)).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// go-solo
// ---------------------------------------------------------------------------

describe('go-solo', () => {
  const db = makeDb([
    def('solo', 'legend', { cost: 1, power: 6, keywords: ['go-solo'] }),
    def('homebody', 'legend', { cost: 1, power: 6 }),
    def('grunt', 'unit', { power: 2 }),
  ])

  function stage(): { s: GameState; legend: number; eddie: number } {
    const s = scenario()
    const legend = mint(s, 0, 'legends', 'solo')
    const eddie = mint(s, 0, 'eddies', 'grunt', { faceUp: false })
    return { s, legend, eddie }
  }

  it('is offered from the legends zone and fields the legend ready without lag', () => {
    const { s, legend, eddie } = stage()
    const action = playActions(db, s).find((a) => a.card === legend)
    expect(action).toBeDefined()

    const next = applyAction(db, s, action!)
    expect(next.players[0].legends).not.toContain(legend)
    expect(next.players[0].field).toContain(legend)
    expect(next.cards[legend].ready).toBe(true)
    expect(next.cards[legend].lag).toBe(false)
    expect(next.cards[eddie].ready).toBe(false)
  })

  it('can attack the turn it is played', () => {
    const { s, legend } = stage()
    const victim = mint(s, 1, 'field', 'grunt', { ready: false })
    let next = applyAction(db, s, playActions(db, s).find((a) => a.card === legend)!)
    const attackers = legalActions(db, next).flatMap((a) => (a.type === 'attack' ? [a.attacker] : []))
    expect(attackers).toContain(legend)

    next = applyAction(db, next, { type: 'attack', attacker: legend, target: victim })
    next = applyAction(db, next, { type: 'react', reaction: pass })
    expect(next.players[1].trash).toContain(victim)
  })

  it('is removed from the game — not trashed — when it leaves the field', () => {
    const { s, legend } = stage()
    const killer = mint(s, 1, 'field', 'grunt', { ready: false })
    s.cards[killer].tempPower = 10 // power 12 beats the legend's 6

    let next = applyAction(db, s, playActions(db, s).find((a) => a.card === legend)!)
    next = applyAction(db, next, { type: 'attack', attacker: legend, target: killer })
    next = applyAction(db, next, { type: 'react', reaction: pass })

    expect(next.players[0].field).not.toContain(legend)
    expect(next.players[0].trash).not.toContain(legend)
    expect(next.players[0].legends).not.toContain(legend)
    expect(next.players[0].removed).toContain(legend)
    expect(next.events.some((e) => e.type === 'cardRemoved' && e.uid === legend)).toBe(true)
  })

  it('is removed from the game by a bounce too, not just a defeat', () => {
    const bouncer: CardDb = {
      ...db,
      shoo: def('shoo', 'program', {
        effects: [onPlay({ kind: 'bounce', target: 'rivalUnit' })],
      }),
    }
    const { s, legend } = stage()
    const src = mint(s, 1, 'trash', 'shoo')
    const fielded = applyAction(bouncer, s, playActions(bouncer, s).find((a) => a.card === legend)!)

    const next = fireTrigger(bouncer, fielded, 'onPlay', src, [legend])
    expect(next.players[0].hand).not.toContain(legend)
    expect(next.players[0].removed).toContain(legend)
  })

  it('is not offered without the keyword, while face-down, or while spent', () => {
    const plain = scenario()
    mint(plain, 0, 'legends', 'homebody')
    mint(plain, 0, 'eddies', 'grunt', { faceUp: false })
    expect(playActions(db, plain)).toEqual([])

    const hidden = scenario()
    mint(hidden, 0, 'legends', 'solo', { faceUp: false })
    mint(hidden, 0, 'eddies', 'grunt', { faceUp: false })
    expect(playActions(db, hidden)).toEqual([])

    const spent = scenario()
    mint(spent, 0, 'legends', 'solo', { ready: false })
    mint(spent, 0, 'eddies', 'grunt', { faceUp: false })
    expect(playActions(db, spent)).toEqual([])
  })

  it('cannot pay for itself', () => {
    const s = scenario()
    const legend = mint(s, 0, 'legends', 'solo')
    // The legend is the only ready payment source: cost 1 is unaffordable.
    expect(playActions(db, s)).toEqual([])
    expect(() =>
      applyAction(db, s, { type: 'playCard', card: legend, payment: [legend], targets: [] })
    ).toThrow()
  })
})

// ---------------------------------------------------------------------------
// Data-coupled rulings: gear keyword grants and the kiroshi-optics exception
// ---------------------------------------------------------------------------

describe('gear keyword grants (real cards)', () => {
  const real = loadCardDb()

  it('a unit with riot-shield attached can block', () => {
    const s = scenario()
    const attacker = mint(s, 0, 'field', 'psycho-squad')
    const host = mint(s, 1, 'field', 'delamain-cab')
    gigs(s, 1, [4])
    expect(effectiveKeywords(real, s, host)).not.toContain('blocker')

    const gear = mintGear(s, 1, 'riot-shield', host)
    expect(effectiveKeywords(real, s, host)).toContain('blocker')

    const declared = applyAction(real, s, { type: 'attack', attacker, target: 'gigArea' })
    const blocks = reactions(real, declared).filter((r) => r.type === 'block')
    expect(blocks).toEqual([{ type: 'block', blocker: host }])
    void gear
  })

  it('gear grants adrenaline, letting a lagged host attack', () => {
    const s = scenario()
    const host = mint(s, 0, 'field', 'delamain-cab', { lag: true })
    mint(s, 1, 'field', 'psycho-squad', { ready: false })
    expect(legalActions(real, s).some((a) => a.type === 'attack')).toBe(false)

    mintGear(s, 0, 'adrenaline-converter', host)
    expect(legalActions(real, s).some((a) => a.type === 'attack' && a.attacker === host)).toBe(true)
  })

  it('does not let gear grant go-solo to a legend in the legends zone', () => {
    const s = scenario()
    const legend = mint(s, 0, 'legends', 'yorinobu-arasaka-embracing-destruction')
    mintGear(s, 0, 'riot-shield', legend) // riot-shield's keywords include 'go-solo'
    mint(s, 0, 'eddies', 'mantis-blades', { faceUp: false })
    expect(playActions(real, s).some((a) => a.card === legend)).toBe(false)
  })
})

describe('kiroshi-optics equip exception (docs/rulings.md §8)', () => {
  const real = loadCardDb()

  it('may equip to any unit, friendly or rival, plus friendly face-up legends', () => {
    const s = scenario()
    const mine = mint(s, 0, 'field', 'delamain-cab')
    const theirs = mint(s, 1, 'field', 'psycho-squad')
    const legend = mint(s, 0, 'legends', 'yorinobu-arasaka-embracing-destruction')
    const rivalLegend = mint(s, 1, 'legends', 'saburo-arasaka-stubborn-patriarch')
    const gear = mint(s, 0, 'hand', 'kiroshi-optics')
    mint(s, 0, 'eddies', 'mantis-blades', { faceUp: false })

    const targets = gearEquipTargets(real, s, gear).sort()
    expect(targets).toEqual([mine, theirs, legend].sort())
    expect(targets).not.toContain(rivalLegend)
  })

  it('the default gear rule stays friendly-unit-or-friendly-face-up-legend', () => {
    const s = scenario()
    const mine = mint(s, 0, 'field', 'delamain-cab')
    mint(s, 1, 'field', 'psycho-squad')
    const legend = mint(s, 0, 'legends', 'yorinobu-arasaka-embracing-destruction')
    const gear = mint(s, 0, 'hand', 'mantis-blades')

    expect(gearEquipTargets(real, s, gear).sort()).toEqual([mine, legend].sort())
  })

  it('gear equipped to a rival unit still goes to its own owner trash', () => {
    const s = scenario()
    const attacker = mint(s, 0, 'field', 'psycho-squad') // power 6
    const victim = mint(s, 1, 'field', 'japantown-jonin', { ready: false }) // power 0
    const gear = mintGear(s, 0, 'kiroshi-optics', victim) // player 0's gear on a rival unit

    let next = applyAction(real, s, { type: 'attack', attacker, target: victim })
    next = applyAction(real, next, { type: 'react', reaction: pass })
    expect(next.players[1].trash).toContain(victim)
    expect(next.players[0].trash).toContain(gear)
    expect(next.players[1].trash).not.toContain(gear)
    void attacker
  })
})
