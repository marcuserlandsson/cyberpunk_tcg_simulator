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
import { gearEquipTargets, gearTargetOverrides } from '../../src/cards/targets'
import { loadCardDb } from '../../src/engine/cardDb'
import { createRng } from '../../src/engine/rng'
import { legalActions } from '../../src/engine/legal'
import { actingPlayer, effectiveKeywords, effectivePower, streetCred } from '../../src/engine/query'
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
    oncePerTurnUsed: [],
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
    tempKeywords: [],
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
    tempKeywords: [],
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

function gigChoices(db: CardDb, state: GameState): number[] {
  return legalActions(db, state).flatMap((a) => (a.type === 'chooseGig' ? [a.dieIndex] : []))
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

  it('drawing from an empty deck loses the game (docs/rulings.md §36)', () => {
    const db = makeDb([def('drawer', 'program', { effects: [onPlay({ kind: 'draw', count: 2 })] })])
    const s = scenario()
    const src = mint(s, 0, 'trash', 'drawer')
    mint(s, 0, 'deck', 'drawer')

    const next = fire(db, s, src)
    expect(next.winner).toBe(1)
    expect(next.events.some((e) => e.type === 'gameEnded' && e.reason === 'deckout')).toBe(true)
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
  it('stealGig hands the die choice to the effect controller (docs/rulings.md §32)', () => {
    const db = makeDb([
      def('thief', 'program', { effects: [onPlay({ kind: 'stealGig', count: 2 })] }),
    ])
    const s = scenario()
    const src = mint(s, 0, 'trash', 'thief')
    gigs(s, 1, [3, 4, 5])

    let next = fire(db, s, src)
    expect(next.phase).toBe('chooseGig')
    expect(next.pendingSteal).toEqual({
      attacker: src,
      remaining: 2,
      thief: 0,
      resumePhase: 'main',
    })
    expect(actingPlayer(next)).toBe(0)
    expect(next.players[0].gigArea).toEqual([]) // nothing moves until it is chosen

    // The controller picks each die, exactly like an attack steal.
    expect(gigChoices(db, next)).toEqual([0, 1, 2])
    next = applyAction(db, next, { type: 'chooseGig', dieIndex: 2 }) // the 5
    next = applyAction(db, next, { type: 'chooseGig', dieIndex: 0 }) // the 3
    expect(next.phase).toBe('main')
    expect(next.pendingSteal).toBeNull()
    expect(next.players[0].gigArea.map((d) => d.value)).toEqual([5, 3])
    expect(next.players[1].gigArea.map((d) => d.value)).toEqual([4])
    expect(next.events.filter((e) => e.type === 'gigStolen')).toHaveLength(2)
  })

  it('stealGig fizzles with no rival gig dice at all', () => {
    const db = makeDb([
      def('thief', 'program', { effects: [onPlay({ kind: 'stealGig', count: 1 })] }),
    ])
    const s = scenario()
    const src = mint(s, 0, 'trash', 'thief')
    const next = fire(db, s, src)
    expect(next.phase).toBe('main')
    expect(next.pendingSteal).toBeNull()
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

describe('onPlay targets are enumerated against the post-entry state', () => {
  it('a unit can target itself with its own onPlay buff', () => {
    const db = makeDb([
      def('leader', 'unit', {
        power: 1,
        effects: [
          onPlay({ kind: 'buffPower', amount: 2, target: 'friendlyUnit', duration: 'turn' }),
        ],
      }),
    ])
    const s = scenario()
    const card = mint(s, 0, 'hand', 'leader')

    // The friendly field is empty *before* the play; the unit itself is the
    // only candidate once it enters, and must be offered.
    const actions = playActions(db, s).filter((a) => a.card === card)
    expect(actions.map((a) => a.targets)).toEqual([[card]])

    const next = applyAction(db, s, actions[0])
    expect(next.cards[card].tempPower).toBe(2)
  })

  it('honours the picked target when an earlier slot only fills after entry', () => {
    const db = makeDb([
      def('leader', 'unit', {
        power: 1,
        effects: [
          onPlay({
            kind: 'sequence',
            effects: [
              { kind: 'buffPower', amount: 2, target: 'friendlyUnit', duration: 'turn' },
              { kind: 'defeat', target: 'rivalUnit' },
            ],
          }),
        ],
      }),
      def('grunt', 'unit'),
    ])
    const s = scenario()
    const card = mint(s, 0, 'hand', 'leader')
    const a = mint(s, 1, 'field', 'grunt')
    const b = mint(s, 1, 'field', 'grunt')

    const actions = playActions(db, s).filter((x) => x.card === card)
    expect(actions.map((x) => x.targets)).toEqual([
      [card, a],
      [card, b],
    ])

    const next = applyAction(db, s, actions[1])
    expect(next.cards[card].tempPower).toBe(2)
    expect(next.players[1].trash).toEqual([b]) // the *picked* rival, not a random one
    expect(next.players[1].field).toEqual([a])
  })
})

describe('a gear card own onPlay belongs to the player who played it', () => {
  const db = makeDb([
    def('grunt', 'unit', { power: 2 }),
    def('spycam', 'gear', {
      power: 0,
      effects: [
        onPlay({ kind: 'buffPower', amount: 3, target: 'friendlyUnit', duration: 'turn' }),
      ],
    }),
  ])

  it('enumerates and resolves against the *player* friendlies, not the host controller', () => {
    // A synthetic cross-owner-equippable gear, registered the same way
    // kiroshi-optics is (docs/rulings.md §34).
    gearTargetOverrides['spycam'] = (_db, state, gearUid) => [
      ...state.players[0].field,
      ...state.players[1].field,
    ]
    try {
      const s = scenario()
      const gear = mint(s, 0, 'hand', 'spycam')
      const mine = mint(s, 0, 'field', 'grunt')
      const theirs = mint(s, 1, 'field', 'grunt')

      // Two equip targets (own unit, rival unit); the buff slot only ever
      // offers player 0's own unit, whichever host is chosen.
      const actions = playActions(db, s).filter((a) => a.card === gear)
      expect(actions.map((a) => a.targets)).toEqual([
        [mine, mine],
        [theirs, mine],
      ])

      // Equip to the RIVAL's unit: the buff still belongs to the player who
      // paid for and played the gear.
      const next = applyAction(db, s, actions[1])
      expect(next.cards[theirs].attachedGear).toEqual([gear])
      expect(next.cards[mine].tempPower).toBe(3)
      expect(next.cards[theirs].tempPower).toBe(0)
    } finally {
      delete gearTargetOverrides['spycam']
    }
  })
})

describe('attached gear triggers', () => {
  it("a gear onAttack effect fires when its host attacks", () => {
    const db = makeDb([
      def('grunt', 'unit', { power: 2 }),
      def('smartgun', 'gear', {
        power: 0,
        effects: [{ trigger: 'onAttack', effect: { kind: 'draw', count: 1 } }],
      }),
    ])
    const s = scenario()
    const attacker = mint(s, 0, 'field', 'grunt')
    mint(s, 1, 'field', 'grunt', { ready: false })
    mint(s, 0, 'deck', 'grunt')

    const bare = applyAction(db, s, { type: 'attack', attacker, target: s.players[1].field[0] })
    expect(bare.players[0].hand).toEqual([])

    const geared = structuredClone(s)
    mintGear(geared, 0, 'smartgun', attacker)
    const next = applyAction(db, geared, {
      type: 'attack',
      attacker,
      target: geared.players[1].field[0],
    })
    expect(next.players[0].hand).toHaveLength(1)
  })

  it('a gear onDefeat effect fires when its host is defeated', () => {
    const db = makeDb([
      def('brute', 'unit', { power: 5 }),
      def('grunt', 'unit', { power: 1 }),
      def('blackbox', 'gear', {
        power: 0,
        effects: [{ trigger: 'onDefeat', effect: { kind: 'draw', count: 1 } }],
      }),
    ])
    const s = scenario()
    const attacker = mint(s, 0, 'field', 'brute')
    const victim = mint(s, 1, 'field', 'grunt', { ready: false })
    const gear = mintGear(s, 1, 'blackbox', victim)
    mint(s, 1, 'deck', 'grunt')

    let next = applyAction(db, s, { type: 'attack', attacker, target: victim })
    next = applyAction(db, next, { type: 'react', reaction: pass })
    expect(next.players[1].trash).toContain(gear)
    expect(next.players[1].hand).toHaveLength(1) // the gear's controller drew
  })

  it("a gear activated ability belongs to the host's controller (docs/rulings.md §33)", () => {
    const db = makeDb([
      def('grunt', 'unit'),
      def('spyware', 'gear', {
        power: 0,
        effects: [
          { trigger: 'activated', cost: { selfSpend: true }, effect: { kind: 'draw', count: 1 } },
        ],
      }),
    ])
    const s = scenario()
    const host = mint(s, 1, 'field', 'grunt') // player 1's unit ...
    const gear = mintGear(s, 0, 'spyware', host) // ... wearing player 0's gear
    mint(s, 0, 'deck', 'grunt')
    mint(s, 1, 'deck', 'grunt')

    // Player 0 owns the gear but does not control the host: no ability for them.
    expect(abilityActions(db, s)).toEqual([])

    const rivalTurn = structuredClone(s)
    rivalTurn.activePlayer = 1
    const actions = abilityActions(db, rivalTurn)
    expect(actions).toEqual([{ type: 'activateAbility', card: gear, abilityIndex: 0, targets: [] }])

    const next = applyAction(db, rivalTurn, actions[0])
    expect(next.cards[host].ready).toBe(false) // the host paid
    expect(next.players[1].hand).toHaveLength(1) // and the host's controller drew
    expect(next.players[0].hand).toEqual([])
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

describe('trigger: onAttack — game-ending and steal effects', () => {
  it('an onAttack effect that ends the game leaves no half-open attack', () => {
    const db = makeDb([
      def('doomed', 'unit', {
        power: 3,
        effects: [{ trigger: 'onAttack', effect: { kind: 'draw', count: 1 } }],
      }),
      def('grunt', 'unit'),
    ])
    const s = scenario()
    const attacker = mint(s, 0, 'field', 'doomed') // deck is empty: the draw kills
    const victim = mint(s, 1, 'field', 'grunt', { ready: false })

    const next = applyAction(db, s, { type: 'attack', attacker, target: victim })
    expect(next.winner).toBe(1)
    expect(next.phase).toBe('gameOver')
    expect(next.pendingAttack).toBeNull()
    expect(legalActions(db, next)).toEqual([])
  })

  it('an onAttack steal is chosen by the attacker before the rival reacts', () => {
    const db = makeDb([
      def('raider', 'unit', {
        power: 3,
        effects: [{ trigger: 'onAttack', effect: { kind: 'stealGig', count: 1 } }],
      }),
      def('grunt', 'unit'),
    ])
    const s = scenario()
    const attacker = mint(s, 0, 'field', 'raider')
    const victim = mint(s, 1, 'field', 'grunt', { ready: false })
    gigs(s, 1, [2, 6])

    let next = applyAction(db, s, { type: 'attack', attacker, target: victim })
    expect(next.phase).toBe('chooseGig')
    expect(actingPlayer(next)).toBe(0)
    next = applyAction(db, next, { type: 'chooseGig', dieIndex: 1 }) // take the 6
    // The steal resolved; only now does the react window open.
    expect(next.phase).toBe('react')
    expect(next.pendingAttack).toEqual({ attacker, target: victim })
    expect(next.players[0].gigArea.map((d) => d.value)).toEqual([6])
    expect(reactions(db, next).some((r) => r.type === 'pass')).toBe(true)
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

  it('an on-defeat steal survives the attack that caused it', () => {
    const db = makeDb([
      def('brute', 'unit', { power: 5 }),
      def('martyr', 'unit', {
        power: 1,
        effects: [{ trigger: 'onDefeat', effect: { kind: 'stealGig', count: 1 } }],
      }),
    ])
    const s = scenario()
    const attacker = mint(s, 0, 'field', 'brute')
    const victim = mint(s, 1, 'field', 'martyr', { ready: false })
    gigs(s, 0, [4])

    let next = applyAction(db, s, { type: 'attack', attacker, target: victim })
    next = applyAction(db, next, { type: 'react', reaction: pass })
    expect(next.players[1].trash).toContain(victim)
    // The defeated unit's controller owes a die choice; the attack is over.
    expect(next.phase).toBe('chooseGig')
    expect(next.pendingAttack).toBeNull()
    expect(actingPlayer(next)).toBe(1)

    next = applyAction(db, next, { type: 'chooseGig', dieIndex: 0 })
    expect(next.players[1].gigArea).toHaveLength(1)
    expect(next.players[0].gigArea).toEqual([])
    expect(next.phase).toBe('main')
    expect(next.activePlayer).toBe(0) // the attacker's turn carries on
  })

  it('queues both steals when a tied fight kills two stealing units', () => {
    const db = makeDb([
      def('martyr', 'unit', {
        power: 3,
        effects: [{ trigger: 'onDefeat', effect: { kind: 'stealGig', count: 1 } }],
      }),
    ])
    const s = scenario()
    const attacker = mint(s, 0, 'field', 'martyr')
    const victim = mint(s, 1, 'field', 'martyr', { ready: false })
    gigs(s, 0, [1, 2])
    gigs(s, 1, [5, 6])

    let next = applyAction(db, s, { type: 'attack', attacker, target: victim })
    next = applyAction(db, next, { type: 'react', reaction: pass })
    // A tie defeats both; each casualty owes its own controller a die choice,
    // resolved in the order the triggers fired (the defender's first).
    expect(next.players[0].trash).toContain(attacker)
    expect(next.players[1].trash).toContain(victim)
    expect(next.phase).toBe('chooseGig')
    expect(actingPlayer(next)).toBe(1)

    next = applyAction(db, next, { type: 'chooseGig', dieIndex: 0 }) // p1 takes p0's 1
    // The second steal is still owed, now to player 0.
    expect(next.phase).toBe('chooseGig')
    expect(actingPlayer(next)).toBe(0)
    // Player 1's area is now 5, 6 and the die they just took.
    expect(gigChoices(db, next)).toEqual([0, 1, 2])

    next = applyAction(db, next, { type: 'chooseGig', dieIndex: 1 }) // p0 takes p1's 6
    expect(next.phase).toBe('main')
    expect(next.pendingSteal).toBeNull()
    expect(next.pendingAttack).toBeNull()
    expect(next.players[0].gigArea.map((d) => d.value).sort()).toEqual([2, 6])
    expect(next.players[1].gigArea.map((d) => d.value).sort()).toEqual([1, 5])
    expect(next.events.filter((e) => e.type === 'gigStolen')).toHaveLength(2)
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

  it('a quick steal is chosen by the defender, and the react window then resumes', () => {
    const stealer = makeDb([
      def('grunt', 'unit', { power: 3 }),
      def('wall', 'unit', { power: 2 }),
      def('snatch', 'program', {
        cost: 1,
        keywords: ['quick'],
        effects: [onPlay({ kind: 'stealGig', count: 1 }, { quick: true })],
      }),
    ])
    const s = scenario()
    const attacker = mint(s, 0, 'field', 'grunt')
    const defender = mint(s, 1, 'field', 'wall', { ready: false })
    const quick = mint(s, 1, 'hand', 'snatch')
    const eddie = mint(s, 1, 'eddies', 'grunt', { faceUp: false })
    gigs(s, 0, [3, 5])

    let next = applyAction(stealer, s, { type: 'attack', attacker, target: defender })
    next = applyAction(stealer, next, {
      type: 'react',
      reaction: { type: 'quick', card: quick, payment: [eddie], targets: [] },
    })
    expect(next.phase).toBe('chooseGig')
    expect(actingPlayer(next)).toBe(1) // the *defender* picks their own steal
    expect(gigChoices(stealer, next)).toEqual([0, 1])

    next = applyAction(stealer, next, { type: 'chooseGig', dieIndex: 1 })
    expect(next.players[1].gigArea.map((d) => d.value)).toEqual([5])
    expect(next.players[0].gigArea.map((d) => d.value)).toEqual([3])
    // Back into the react window, with the attack still pending.
    expect(next.phase).toBe('react')
    expect(next.pendingAttack).toEqual({ attacker, target: defender })
    expect(actingPlayer(next)).toBe(1)
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

  it('never grants go-solo, even though riot-shield prints the keyword', () => {
    const s = scenario()
    const legend = mint(s, 0, 'legends', 'yorinobu-arasaka-embracing-destruction')
    mintGear(s, 0, 'riot-shield', legend) // riot-shield's keywords include 'go-solo'
    mint(s, 0, 'eddies', 'mantis-blades', { faceUp: false })

    expect(real['riot-shield'].keywords).toContain('go-solo') // the data trap itself
    expect(effectiveKeywords(real, s, legend)).toContain('blocker') // other keywords pass
    expect(effectiveKeywords(real, s, legend)).not.toContain('go-solo')
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

// ---------------------------------------------------------------------------
// Task 8 vocabulary extensions (synthetic cards; the real cards that use them
// are driven end-to-end in tests/cards/*.test.ts)
// ---------------------------------------------------------------------------

describe('EffectNode: changeGig (docs/rulings.md §39)', () => {
  it('takes the full "up to" amount, clamped to the faces the die has', () => {
    const db = makeDb([
      def('boost', 'program', {
        effects: [onPlay({ kind: 'changeGig', amount: 4, target: 'friendlyGigDie' })],
      }),
    ])
    const s = scenario()
    const src = mint(s, 0, 'trash', 'boost')
    gigs(s, 0, [1, 5])

    const first = fire(db, s, src, [0])
    expect(first.players[0].gigArea.map((d) => d.value)).toEqual([5, 5])
    // 5 + 4 on a d6 stops at 6, never 9.
    const second = fire(db, s, src, [1])
    expect(second.players[0].gigArea.map((d) => d.value)).toEqual([1, 6])
  })

  it('a negative amount decreases a rival gig, never below 1', () => {
    const db = makeDb([
      def('drain', 'program', {
        effects: [onPlay({ kind: 'changeGig', amount: -2, target: 'rivalGigDie' })],
      }),
    ])
    const s = scenario()
    const src = mint(s, 0, 'trash', 'drain')
    gigs(s, 1, [6, 2])

    expect(fire(db, s, src, [0]).players[1].gigArea.map((d) => d.value)).toEqual([4, 2])
    expect(fire(db, s, src, [1]).players[1].gigArea.map((d) => d.value)).toEqual([6, 1])
  })

  it('enumerates one playCard entry per gig die (the die is a real choice)', () => {
    const db = makeDb([
      def('boost', 'program', {
        cost: 0,
        effects: [onPlay({ kind: 'changeGig', amount: 2, target: 'friendlyGigDie' })],
      }),
    ])
    const s = scenario()
    const card = mint(s, 0, 'hand', 'boost')
    gigs(s, 0, [1, 2, 3])

    const actions = playActions(db, s).filter((a) => a.card === card)
    expect(actions.map((a) => a.targets)).toEqual([[0], [1], [2]])

    const next = applyAction(db, s, actions[2])
    expect(next.players[0].gigArea.map((d) => d.value)).toEqual([1, 2, 5])
  })

  it('fizzles with an empty gig area', () => {
    const db = makeDb([
      def('boost', 'program', {
        effects: [onPlay({ kind: 'changeGig', amount: 2, target: 'friendlyGigDie' })],
      }),
    ])
    const s = scenario()
    const src = mint(s, 0, 'trash', 'boost')
    expect(fire(db, s, src).players[0].gigArea).toEqual([])
  })
})

describe('TargetFilter', () => {
  const db = makeDb([
    def('hit', 'program', {
      effects: [onPlay({ kind: 'defeat', target: 'rivalUnit', filter: { maxPower: 4 } })],
    }),
    def('corpokiller', 'program', {
      effects: [onPlay({ kind: 'defeat', target: 'rivalUnit', filter: { keyword: 'corpo' } })],
    }),
    def('buffer', 'unit', {
      power: 1,
      effects: [
        onPlay({
          kind: 'buffPower',
          amount: 1,
          target: 'friendlyUnit',
          filter: { excludeSelf: true },
          duration: 'turn',
        }),
      ],
    }),
    def('picky', 'program', {
      effects: [
        onPlay({
          kind: 'defeat',
          target: 'rivalUnit',
          filter: { weakerThanAFriendlyUnit: true },
        }),
      ],
    }),
    def('weak', 'unit', { power: 3 }),
    def('strong', 'unit', { power: 7 }),
    def('suit', 'unit', { power: 3, keywords: ['corpo'] }),
  ])

  it('maxPower excludes candidates above the printed ceiling', () => {
    const s = scenario()
    const src = mint(s, 0, 'trash', 'hit')
    const weak = mint(s, 1, 'field', 'weak')
    mint(s, 1, 'field', 'strong')

    const choices = effectTargetChoices(
      db,
      s,
      src,
      onPlay({ kind: 'defeat', target: 'rivalUnit', filter: { maxPower: 4 } })
    )
    expect(choices).toEqual([[weak]])
  })

  it('maxPower is judged on effectivePower, so a buff can save a unit', () => {
    const s = scenario()
    const src = mint(s, 0, 'trash', 'hit')
    const weak = mint(s, 1, 'field', 'weak', { tempPower: 2 }) // 3 + 2 = 5
    expect(fire(db, s, src, [weak]).players[1].field).toEqual([weak])
  })

  it('keyword narrows to the printed classification', () => {
    const s = scenario()
    const src = mint(s, 0, 'trash', 'corpokiller')
    mint(s, 1, 'field', 'weak')
    const suit = mint(s, 1, 'field', 'suit')
    expect(fire(db, s, src).players[1].trash).toEqual([suit])
  })

  it('excludeSelf implements "another friendly Unit"', () => {
    const s = scenario()
    const card = mint(s, 0, 'hand', 'buffer')
    const mate = mint(s, 0, 'field', 'weak')
    const actions = playActions(db, s).filter((a) => a.card === card)
    expect(actions.map((a) => a.targets)).toEqual([[mate]])
  })

  it('weakerThanAFriendlyUnit compares against the best friendly power', () => {
    const s = scenario()
    const src = mint(s, 0, 'trash', 'picky')
    mint(s, 0, 'field', 'weak') // friendly best = 3
    const equal = mint(s, 1, 'field', 'weak') // 3 is not *less* than 3
    expect(fire(db, s, src, [equal]).players[1].field).toEqual([equal])

    const stronger = structuredClone(s)
    mint(stronger, 0, 'field', 'strong') // friendly best = 7
    expect(fire(db, stronger, src, [equal]).players[1].trash).toEqual([equal])
  })
})

describe('EffectNode: grantKeyword (docs/rulings.md §43)', () => {
  it('grants {adrenaline} for the turn, letting a lagged unit attack', () => {
    const db = makeDb([
      def('rally', 'program', {
        cost: 0,
        effects: [
          onPlay({
            kind: 'grantKeyword',
            keyword: 'adrenaline',
            target: 'friendlyUnit',
            duration: 'turn',
          }),
        ],
      }),
      def('grunt', 'unit', { power: 2 }),
    ])
    const s = scenario()
    const card = mint(s, 0, 'hand', 'rally')
    const lagged = mint(s, 0, 'field', 'grunt', { lag: true })
    mint(s, 1, 'field', 'grunt', { ready: false })

    expect(legalActions(db, s).some((a) => a.type === 'attack')).toBe(false)
    const next = applyAction(db, s, { type: 'playCard', card, payment: [], targets: [lagged] })
    expect(effectiveKeywords(db, next, lagged)).toContain('adrenaline')
    expect(legalActions(db, next).some((a) => a.type === 'attack' && a.attacker === lagged)).toBe(
      true
    )

    // The grant dies with the game turn, exactly like a power buff.
    const later = applyAction(db, next, { type: 'endTurn' })
    expect(later.cards[lagged].tempKeywords).toEqual([])
  })

  it("grants the attack-ready permission, widening that attacker's targets", () => {
    const db = makeDb([
      def('plan', 'program', {
        cost: 0,
        effects: [
          onPlay({
            kind: 'grantKeyword',
            keyword: 'attack-ready',
            target: 'friendlyUnit',
            duration: 'turn',
          }),
        ],
      }),
      def('grunt', 'unit', { power: 2 }),
    ])
    const s = scenario()
    const card = mint(s, 0, 'hand', 'plan')
    const mine = mint(s, 0, 'field', 'grunt')
    const readyRival = mint(s, 1, 'field', 'grunt', { ready: true })

    expect(legalActions(db, s).some((a) => a.type === 'attack')).toBe(false)
    const next = applyAction(db, s, { type: 'playCard', card, payment: [], targets: [mine] })
    const attacks = legalActions(db, next).flatMap((a) =>
      a.type === 'attack' ? [[a.attacker, a.target]] : []
    )
    expect(attacks).toEqual([[mine, readyRival]])
  })
})

describe('EffectNode: chooseOne (docs/rulings.md §45)', () => {
  const db = makeDb([
    def('modal', 'program', {
      cost: 0,
      effects: [
        onPlay({
          kind: 'chooseOne',
          modes: [
            { kind: 'buffPower', amount: 2, target: 'friendlyUnit', duration: 'turn' },
            { kind: 'draw', count: 1 },
          ],
        }),
      ],
    }),
    def('forced', 'program', {
      cost: 0,
      effects: [
        onPlay({
          kind: 'chooseOne',
          chooser: 'rivalIfBehindStreetCred',
          modes: [
            { kind: 'buffPower', amount: 2, target: 'friendlyUnit', duration: 'turn' },
            { kind: 'draw', count: 1 },
          ],
        }),
      ],
    }),
    def('grunt', 'unit', { power: 1 }),
  ])

  it('enumerates the mode as a slot, with each mode own targets after it', () => {
    const s = scenario()
    const card = mint(s, 0, 'hand', 'modal')
    const unit = mint(s, 0, 'field', 'grunt')
    mint(s, 0, 'deck', 'grunt')

    const actions = playActions(db, s).filter((a) => a.card === card)
    // slots: [mode, mode-0's friendlyUnit]; mode 1 reserves none.
    expect(actions.map((a) => a.targets)).toEqual([
      [0, unit],
      [1, unit],
    ])

    const buffed = applyAction(db, s, actions[0])
    expect(buffed.cards[unit].tempPower).toBe(2)
    expect(buffed.players[0].hand).toEqual([])

    const drawn = applyAction(db, s, actions[1])
    expect(drawn.cards[unit].tempPower).toBe(0)
    expect(drawn.players[0].hand).toHaveLength(1)
  })

  it('offers no mode choice while the rival chooses, and still resolves one', () => {
    const s = scenario()
    const card = mint(s, 0, 'hand', 'forced')
    const unit = mint(s, 0, 'field', 'grunt')
    mint(s, 0, 'deck', 'grunt')
    gigs(s, 1, [6]) // player 0 has 0 street cred, player 1 has 6

    const actions = playActions(db, s).filter((a) => a.card === card)
    expect(actions.map((a) => a.targets)).toEqual([[unit]]) // no mode entry

    const next = applyAction(db, s, actions[0])
    const buffed = next.cards[unit].tempPower === 2
    const drew = next.players[0].hand.length === 1
    expect(buffed !== drew).toBe(true) // exactly one mode resolved
    expect(next.rng).not.toEqual(s.rng) // ... chosen off the seeded rng
  })

  it('lets the controller choose while they are not behind on street cred', () => {
    const s = scenario()
    const card = mint(s, 0, 'hand', 'forced')
    const unit = mint(s, 0, 'field', 'grunt')
    mint(s, 0, 'deck', 'grunt')
    gigs(s, 0, [6])

    const actions = playActions(db, s).filter((a) => a.card === card)
    expect(actions.map((a) => a.targets)).toEqual([
      [0, unit],
      [1, unit],
    ])
  })
})

describe('trigger: onBlock (docs/rulings.md §41)', () => {
  it('fires for the blocking unit before the fight', () => {
    const db = makeDb([
      def('wall', 'unit', {
        power: 3,
        keywords: ['blocker'],
        effects: [
          { trigger: 'onBlock', effect: { kind: 'changeGig', amount: 3, target: 'friendlyGigDie' } },
        ],
      }),
      def('grunt', 'unit', { power: 2 }),
    ])
    const s = scenario()
    const attacker = mint(s, 0, 'field', 'grunt')
    const wall = mint(s, 1, 'field', 'wall')
    gigs(s, 1, [1])

    let next = applyAction(db, s, { type: 'attack', attacker, target: 'gigArea' })
    next = applyAction(db, next, { type: 'react', reaction: { type: 'block', blocker: wall } })
    expect(next.players[1].gigArea.map((d) => d.value)).toEqual([4])
    expect(next.players[0].trash).toContain(attacker) // 2 vs 3: the blocker won
  })
})

describe('trigger: onWinFight + oncePerTurn (docs/rulings.md §40, §41)', () => {
  const db = makeDb([
    def('duelist', 'unit', {
      power: 5,
      effects: [
        {
          trigger: 'onWinFight',
          oncePerTurn: true,
          effect: { kind: 'readyCard', target: 'self' },
        },
      ],
    }),
    def('grunt', 'unit', { power: 1 }),
  ])

  it('readies the winner once, then not again in the same turn', () => {
    const s = scenario()
    const duelist = mint(s, 0, 'field', 'duelist')
    const a = mint(s, 1, 'field', 'grunt', { ready: false })
    const b = mint(s, 1, 'field', 'grunt', { ready: false })

    let next = applyAction(db, s, { type: 'attack', attacker: duelist, target: a })
    next = applyAction(db, next, { type: 'react', reaction: pass })
    expect(next.cards[duelist].ready).toBe(true) // spent by attacking, readied by winning
    expect(next.oncePerTurnUsed).toEqual([duelist + ':0'])

    next = applyAction(db, next, { type: 'attack', attacker: duelist, target: b })
    next = applyAction(db, next, { type: 'react', reaction: pass })
    expect(next.cards[duelist].ready).toBe(false) // the once-per-turn ready is used up
  })

  it('does not fire on a tie, and the allowance refreshes next turn', () => {
    const s = scenario()
    const duelist = mint(s, 0, 'field', 'duelist')
    const equal = mint(s, 1, 'field', 'duelist', { ready: false })

    let next = applyAction(db, s, { type: 'attack', attacker: duelist, target: equal })
    next = applyAction(db, next, { type: 'react', reaction: pass })
    expect(next.players[0].trash).toContain(duelist)
    expect(next.oncePerTurnUsed).toEqual([])

    const ended = applyAction(db, next, { type: 'endTurn' })
    expect(ended.oncePerTurnUsed).toEqual([])
  })
})

describe('EffectDef.onceKey: a shared once-per-turn allowance across several defs (docs/rulings.md §67)', () => {
  // Mirrors yorinobu-arasaka-embracing-destruction's shape: one wide
  // "eligibility" def (draw) and one narrower sibling sharing the same gate
  // plus an extra Street-Cred condition (discard) — "The first time X, draw
  // 1. Then, if <condition>, discard 1." must be ONE event, not two
  // independently-gated ones.
  const db = makeDb([
    def('watcher', 'unit', {
      power: 1,
      effects: [
        {
          trigger: 'onFriendlyAttack',
          oncePerTurn: true,
          onceKey: 'grp',
          condition: { attackerKeyword: 'flagged' },
          effect: { kind: 'buffPower', amount: 1, target: 'self', duration: 'permanent' },
        },
        {
          trigger: 'onFriendlyAttack',
          oncePerTurn: true,
          onceKey: 'grp',
          condition: { attackerKeyword: 'flagged', streetCredBelow: 20 },
          effect: { kind: 'buffPower', amount: 100, target: 'self', duration: 'permanent' },
        },
      ],
    }),
    def('flagged', 'unit', { power: 1, keywords: ['flagged'] }),
  ])

  it('spends the whole group at the first qualifying event, even when the narrower sibling does not fire', () => {
    const s = scenario()
    const watcher = mint(s, 0, 'field', 'watcher')
    const a = mint(s, 0, 'field', 'flagged')
    const b = mint(s, 0, 'field', 'flagged')
    const v1 = mint(s, 1, 'field', 'flagged', { ready: false })
    const v2 = mint(s, 1, 'field', 'flagged', { ready: false })
    gigs(s, 0, [20]) // Street Cred 20: the narrower sibling's own condition fails

    let next = applyAction(db, s, { type: 'attack', attacker: a, target: v1 })
    next = applyAction(db, next, { type: 'react', reaction: pass })
    expect(next.cards[watcher].permPower).toBe(1) // only the wide (eligibility) def fired
    expect(next.oncePerTurnUsed.sort()).toEqual([`${watcher}:0`, `${watcher}:1`].sort())

    // Street Cred drops below 20 before a second qualifying attack this turn.
    gigs(next, 0, [5])
    next = applyAction(db, next, { type: 'attack', attacker: b, target: v2 })
    next = applyAction(db, next, { type: 'react', reaction: pass })
    // Without the fix, the narrower sibling — never marked used the first
    // time, since its own condition failed then — would fire now that its
    // condition finally holds. The shared onceKey means the group already
    // decided: neither def re-fires this turn.
    expect(next.cards[watcher].permPower).toBe(1)
  })

  it('fires every def in the group together, once, when the narrower condition already holds', () => {
    const s = scenario()
    const watcher = mint(s, 0, 'field', 'watcher')
    const a = mint(s, 0, 'field', 'flagged')
    const b = mint(s, 0, 'field', 'flagged')
    const v1 = mint(s, 1, 'field', 'flagged', { ready: false })
    const v2 = mint(s, 1, 'field', 'flagged', { ready: false })
    gigs(s, 0, [5]) // Street Cred 5 < 20 already

    let next = applyAction(db, s, { type: 'attack', attacker: a, target: v1 })
    next = applyAction(db, next, { type: 'react', reaction: pass })
    expect(next.cards[watcher].permPower).toBe(101) // both defs fired together

    next = applyAction(db, next, { type: 'attack', attacker: b, target: v2 })
    next = applyAction(db, next, { type: 'react', reaction: pass })
    expect(next.cards[watcher].permPower).toBe(101) // not fired again
  })
})

describe('EffectNode: defeatShield (docs/rulings.md §46)', () => {
  it('the gear is trashed instead of the unit, once', () => {
    const db = makeDb([
      def('brute', 'unit', { power: 9 }),
      def('grunt', 'unit', { power: 1 }),
      def('transmitter', 'gear', {
        power: 0,
        effects: [{ trigger: 'static', effect: { kind: 'defeatShield' } }],
      }),
    ])
    const s = scenario()
    const attacker = mint(s, 0, 'field', 'brute')
    const victim = mint(s, 1, 'field', 'grunt', { ready: false })
    const shield = mintGear(s, 1, 'transmitter', victim)

    let next = applyAction(db, s, { type: 'attack', attacker, target: victim })
    next = applyAction(db, next, { type: 'react', reaction: pass })
    expect(next.players[1].field).toEqual([victim]) // survived
    expect(next.players[1].trash).toEqual([shield])
    expect(next.cards[victim].attachedGear).toEqual([])
    expect(next.events.some((e) => e.type === 'unitDefeated')).toBe(false)

    // The shield is gone: the next hit lands.
    next.cards[attacker].ready = true
    let again = applyAction(db, next, { type: 'attack', attacker, target: victim })
    again = applyAction(db, again, { type: 'react', reaction: pass })
    expect(again.players[1].trash).toContain(victim)
  })
})

describe('EffectNode: winsFightVsKeyword (docs/rulings.md §41)', () => {
  it('beats a matching unit whatever the power says', () => {
    const db = makeDb([
      def('nemesis', 'unit', {
        power: 1,
        effects: [{ trigger: 'static', effect: { kind: 'winsFightVsKeyword', keyword: 'corpo' } }],
      }),
      def('suit', 'unit', { power: 9, keywords: ['corpo'] }),
      def('punk', 'unit', { power: 9 }),
    ])
    const s = scenario()
    const nemesis = mint(s, 0, 'field', 'nemesis')
    const suit = mint(s, 1, 'field', 'suit', { ready: false })
    const punk = mint(s, 1, 'field', 'punk', { ready: false })

    let next = applyAction(db, s, { type: 'attack', attacker: nemesis, target: suit })
    next = applyAction(db, next, { type: 'react', reaction: pass })
    expect(next.players[1].trash).toEqual([suit])
    expect(next.players[0].field).toEqual([nemesis]) // and it survived

    // A non-CORPO unit of the same power still crushes it.
    let other = applyAction(db, s, { type: 'attack', attacker: nemesis, target: punk })
    other = applyAction(db, other, { type: 'react', reaction: pass })
    expect(other.players[0].trash).toEqual([nemesis])
  })
})

describe('cost reduction (docs/rulings.md §44)', () => {
  it('reduces a card play cost per matching gig, never below the minimum', () => {
    const db = makeDb([
      def('bigplay', 'program', {
        cost: 6,
        effects: [
          {
            trigger: 'static',
            effect: {
              kind: 'costReduction',
              reduction: { per: 'friendlyGigValueAtLeast', value: 8, amount: 1, minimum: 1 },
            },
          },
        ],
      }),
      def('grunt', 'unit'),
    ])
    const s = scenario()
    const card = mint(s, 0, 'hand', 'bigplay')
    for (let i = 0; i < 6; i++) mint(s, 0, 'eddies', 'grunt', { faceUp: false })
    s.players[0].gigArea = [
      { size: 10, value: 9 },
      { size: 10, value: 8 },
      { size: 10, value: 3 },
    ]

    const action = playActions(db, s).find((a) => a.card === card)
    expect(action!.payment).toHaveLength(4) // 6 - 2 matching gigs

    const cheap = structuredClone(s)
    cheap.players[0].gigArea = Array.from({ length: 9 }, () => ({ size: 10 as const, value: 10 }))
    expect(playActions(db, cheap).find((a) => a.card === card)!.payment).toHaveLength(1) // floor
  })

  it('reduces an activated ability eddie cost', () => {
    const db = makeDb([
      def('boss', 'unit', {
        power: 1,
        effects: [
          {
            trigger: 'activated',
            cost: {
              eddies: 2,
              reduction: { per: 'friendlyGigValueAtLeast', value: 8, amount: 1, minimum: 0 },
            },
            effect: { kind: 'draw', count: 1 },
          },
        ],
      }),
      def('grunt', 'unit'),
    ])
    const s = scenario()
    const boss = mint(s, 0, 'field', 'boss')
    const eddie = mint(s, 0, 'eddies', 'grunt', { faceUp: false })
    mint(s, 0, 'deck', 'grunt')
    s.players[0].gigArea = [{ size: 10, value: 9 }]

    // 2 €$ reduced to 1 by the single 9-value gig: affordable with one eddie.
    expect(abilityActions(db, s)).toHaveLength(1)
    const next = applyAction(db, s, {
      type: 'activateAbility',
      card: boss,
      abilityIndex: 0,
      targets: [],
    })
    expect(next.cards[eddie].ready).toBe(false)
    expect(next.players[0].hand).toHaveLength(1)
  })
})

describe('buffPower with a dynamic amount', () => {
  it("'friendlyMaxGig' reads the controller best gig value", () => {
    const db = makeDb([
      def('pump', 'program', {
        effects: [
          onPlay({
            kind: 'buffPower',
            amount: 'friendlyMaxGig',
            target: 'friendlyUnit',
            duration: 'turn',
          }),
        ],
      }),
      def('grunt', 'unit', { power: 2 }),
    ])
    const s = scenario()
    const src = mint(s, 0, 'trash', 'pump')
    const unit = mint(s, 0, 'field', 'grunt')
    gigs(s, 0, [3, 6, 2])

    const next = fire(db, s, src, [unit])
    expect(effectivePower(db, next, unit)).toBe(8)
  })
})

describe('an optional cost on a triggered effect (docs/rulings.md §49)', () => {
  const db = makeDb([
    def('mercenary', 'unit', {
      power: 4,
      effects: [
        {
          trigger: 'onAttack',
          cost: { eddies: 2 },
          effect: { kind: 'buffPower', amount: 3, target: 'self', duration: 'turn' },
        },
      ],
    }),
    def('grunt', 'unit', { power: 1 }),
  ])

  it('is offered as a pay/decline pair of attack actions', () => {
    const s = scenario()
    const attacker = mint(s, 0, 'field', 'mercenary')
    const victim = mint(s, 1, 'field', 'grunt', { ready: false })
    mint(s, 0, 'eddies', 'grunt', { faceUp: false })
    mint(s, 0, 'eddies', 'grunt', { faceUp: false })

    const attacks = legalActions(db, s).filter((a) => a.type === 'attack')
    expect(attacks).toEqual([
      { type: 'attack', attacker, target: victim },
      { type: 'attack', attacker, target: victim, payOptionalCosts: true },
    ])
  })

  it('resolves the effect and spends the €$ only when the player pays', () => {
    const s = scenario()
    const attacker = mint(s, 0, 'field', 'mercenary')
    const victim = mint(s, 1, 'field', 'grunt', { ready: false })
    const a = mint(s, 0, 'eddies', 'grunt', { faceUp: false })
    const b = mint(s, 0, 'eddies', 'grunt', { faceUp: false })

    const paid = applyAction(db, s, {
      type: 'attack',
      attacker,
      target: victim,
      payOptionalCosts: true,
    })
    expect(paid.cards[attacker].tempPower).toBe(3)
    expect(paid.cards[a].ready).toBe(false)
    expect(paid.cards[b].ready).toBe(false)

    const declined = applyAction(db, s, { type: 'attack', attacker, target: victim })
    expect(declined.cards[attacker].tempPower).toBe(0)
    expect(declined.cards[a].ready).toBe(true)
    expect(declined.cards[b].ready).toBe(true)
  })

  it('is skipped entirely when it cannot be paid', () => {
    const s = scenario()
    const attacker = mint(s, 0, 'field', 'mercenary')
    const victim = mint(s, 1, 'field', 'grunt', { ready: false })
    mint(s, 0, 'eddies', 'grunt', { faceUp: false }) // only 1 €$

    // No pay variant is offered at all, and the declining one changes nothing.
    expect(legalActions(db, s).filter((a) => a.type === 'attack')).toEqual([
      { type: 'attack', attacker, target: victim },
    ])
    const next = applyAction(db, s, { type: 'attack', attacker, target: victim })
    expect(next.cards[attacker].tempPower).toBe(0)
    expect(next.players[0].eddies.every((uid) => next.cards[uid].ready)).toBe(true)
  })
})

describe('trigger: onSpend (docs/rulings.md §47)', () => {
  const db = makeDb([
    def('informant', 'unit', {
      power: 2,
      effects: [{ trigger: 'onSpend', effect: { kind: 'draw', count: 1 } }],
    }),
    def('grunt', 'unit', { power: 1 }),
  ])

  it('fires when the unit is spent by attacking', () => {
    const s = scenario()
    const attacker = mint(s, 0, 'field', 'informant')
    const victim = mint(s, 1, 'field', 'grunt', { ready: false })
    mint(s, 0, 'deck', 'grunt')

    const next = applyAction(db, s, { type: 'attack', attacker, target: victim })
    expect(next.players[0].hand).toHaveLength(1)
  })

  it('fires when a face-up legend is spent to pay a cost, but never from the eddies area', () => {
    const legendDb = makeDb([
      def('patron', 'legend', {
        power: null,
        effects: [{ trigger: 'onSpend', effect: { kind: 'draw', count: 1 } }],
      }),
      def('grunt', 'unit', { cost: 1, power: 1 }),
      def('spy', 'unit', {
        cost: 1,
        power: 1,
        effects: [{ trigger: 'onSpend', effect: { kind: 'draw', count: 1 } }],
      }),
    ])
    const s = scenario()
    const legend = mint(s, 0, 'legends', 'patron')
    const card = mint(s, 0, 'hand', 'grunt')
    mint(s, 0, 'deck', 'grunt')

    const next = applyAction(legendDb, s, { type: 'playCard', card, payment: [legend], targets: [] })
    expect(next.cards[legend].ready).toBe(false)
    expect(next.players[0].hand).toHaveLength(1) // the drawn card

    // A card sitting face-down in the eddies area is not in play: no trigger.
    const eddieState = scenario()
    const eddie = mint(eddieState, 0, 'eddies', 'spy', { faceUp: false })
    const play = mint(eddieState, 0, 'hand', 'grunt')
    mint(eddieState, 0, 'deck', 'grunt')
    const after = applyAction(legendDb, eddieState, {
      type: 'playCard',
      card: play,
      payment: [eddie],
      targets: [],
    })
    expect(after.players[0].hand).toEqual([])
  })
})

describe('watcher trigger: onFriendlyStealDie (docs/rulings.md §42)', () => {
  const db = makeDb([
    def('recruits', 'unit', {
      power: 6,
      effects: [
        {
          trigger: 'onFriendlyStealDie',
          condition: { stolenDieSize: 6 },
          effect: { kind: 'changeGig', amount: 6, target: 'friendlyGigDie' },
        },
      ],
    }),
    def('grunt', 'unit', { power: 3 }),
  ])

  it('fires on a matching die stolen by *another* friendly unit', () => {
    const s = scenario()
    mint(s, 0, 'field', 'recruits', { ready: false })
    const thiefUnit = mint(s, 0, 'field', 'grunt')
    s.players[1].gigArea = [{ size: 6, value: 2 }]
    s.players[0].gigArea = [{ size: 12, value: 1 }]

    let next = applyAction(db, s, { type: 'attack', attacker: thiefUnit, target: 'gigArea' })
    next = applyAction(db, next, { type: 'react', reaction: pass })
    next = applyAction(db, next, { type: 'chooseGig', dieIndex: 0 })
    // The d12 the watcher increased, plus the stolen d6.
    expect(next.players[0].gigArea.map((d) => 'd' + d.size + '=' + d.value).sort()).toEqual([
      'd12=7',
      'd6=2',
    ])
  })

  it('does not fire for a die of another size', () => {
    const s = scenario()
    mint(s, 0, 'field', 'recruits', { ready: false })
    const thiefUnit = mint(s, 0, 'field', 'grunt')
    s.players[1].gigArea = [{ size: 8, value: 2 }]
    s.players[0].gigArea = [{ size: 12, value: 1 }]

    let next = applyAction(db, s, { type: 'attack', attacker: thiefUnit, target: 'gigArea' })
    next = applyAction(db, next, { type: 'react', reaction: pass })
    next = applyAction(db, next, { type: 'chooseGig', dieIndex: 0 })
    expect(next.players[0].gigArea.map((d) => d.value).sort()).toEqual([1, 2])
  })
})

describe('scripted nodes may declare target slots (docs/rulings.md §48)', () => {
  it('binds them like any other slot and hands them to the script', () => {
    scriptedCards['test-slots'] = (_db, state, ctx) => {
      const target = ctx.targets[0]
      if (target === undefined) return state
      state.cards[target].tempPower += 7
      return state
    }
    try {
      const db = makeDb([
        def('script', 'program', {
          cost: 0,
          effects: [onPlay({ kind: 'scripted', name: 'test-slots', targets: ['rivalUnit'] })],
        }),
        def('grunt', 'unit', { power: 1 }),
      ])
      const s = scenario()
      const card = mint(s, 0, 'hand', 'script')
      const a = mint(s, 1, 'field', 'grunt')
      const b = mint(s, 1, 'field', 'grunt')

      const actions = playActions(db, s).filter((x) => x.card === card)
      expect(actions.map((x) => x.targets)).toEqual([[a], [b]])

      const next = applyAction(db, s, actions[1])
      expect(next.cards[b].tempPower).toBe(7)
      expect(next.cards[a].tempPower).toBe(0)
    } finally {
      delete scriptedCards['test-slots']
    }
  })
})

describe('conditions added in Task 8', () => {
  it('friendlyGigValueAtLeast gates on the best friendly gig value', () => {
    const db = makeDb([
      def('rocker', 'unit', {
        power: 5,
        effects: [
          {
            trigger: 'activated',
            cost: { selfSpend: true },
            condition: { friendlyGigValueAtLeast: 8 },
            effect: { kind: 'draw', count: 2 },
          },
        ],
      }),
      def('grunt', 'unit'),
    ])
    const s = scenario()
    mint(s, 0, 'field', 'rocker')
    mint(s, 0, 'deck', 'grunt')
    mint(s, 0, 'deck', 'grunt')
    s.players[0].gigArea = [{ size: 10, value: 7 }]
    expect(abilityActions(db, s)).toEqual([])

    s.players[0].gigArea = [{ size: 10, value: 8 }]
    expect(abilityActions(db, s)).toHaveLength(1)
  })

  it('rivalGigLeadAtLeast gates on the rival gig-count lead', () => {
    const db = makeDb([
      def('desperate', 'program', {
        effects: [onPlay({ kind: 'draw', count: 1 }, { condition: { rivalGigLeadAtLeast: 2 } })],
      }),
      def('grunt', 'unit'),
    ])
    const s = scenario()
    const src = mint(s, 0, 'trash', 'desperate')
    mint(s, 0, 'deck', 'grunt')
    gigs(s, 0, [1])
    gigs(s, 1, [1, 2]) // lead of 1
    expect(fire(db, s, src).players[0].hand).toEqual([])

    gigs(s, 1, [1, 2, 3]) // lead of 2
    expect(fire(db, s, src).players[0].hand).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Task 8 fix round 1 — Gig-die scopes, adjustable amounts, shared targets and
// the all-modes chooser (docs/rulings.md §39, §45, §53)
// ---------------------------------------------------------------------------

describe('changeGig scopes: friendly / rival / any (docs/rulings.md §39)', () => {
  const db = makeDb([
    def('bare', 'program', {
      cost: 0,
      effects: [onPlay({ kind: 'changeGig', amount: 2, target: 'anyGigDie' })],
    }),
    def('mine', 'program', {
      cost: 0,
      effects: [onPlay({ kind: 'changeGig', amount: 2, target: 'friendlyGigDie' })],
    }),
    def('theirs', 'program', {
      cost: 0,
      effects: [onPlay({ kind: 'changeGig', amount: 2, target: 'rivalGigDie' })],
    }),
  ])

  it('anyGigDie enumerates both areas, controller first', () => {
    const s = scenario()
    const card = mint(s, 0, 'hand', 'bare')
    gigs(s, 0, [1, 2])
    gigs(s, 1, [3])

    const actions = playActions(db, s).filter((a) => a.card === card)
    expect(actions.map((a) => a.targets)).toEqual([[0], [1], [2]])

    // Index 1 is the controller's second die ...
    const own = applyAction(db, s, actions[1])
    expect(own.players[0].gigArea.map((d) => d.value)).toEqual([1, 4])
    expect(own.players[1].gigArea.map((d) => d.value)).toEqual([3])

    // ... and index 2 continues into the rival's area.
    const rival = applyAction(db, s, actions[2])
    expect(rival.players[0].gigArea.map((d) => d.value)).toEqual([1, 2])
    expect(rival.players[1].gigArea.map((d) => d.value)).toEqual([5])
  })

  it('friendlyGigDie and rivalGigDie stay scoped to one area', () => {
    const s = scenario()
    const friendly = mint(s, 0, 'hand', 'mine')
    const hostile = mint(s, 0, 'hand', 'theirs')
    gigs(s, 0, [1])
    gigs(s, 1, [3])

    // One candidate each: index 0 of *their own* area, never the other's.
    const ownPlays = playActions(db, s).filter((a) => a.card === friendly)
    const rivalPlays = playActions(db, s).filter((a) => a.card === hostile)
    expect(ownPlays.map((a) => a.targets)).toEqual([[0]])
    expect(rivalPlays.map((a) => a.targets)).toEqual([[0]])

    const own = applyAction(db, s, ownPlays[0])
    expect(own.players[0].gigArea.map((d) => d.value)).toEqual([3])
    expect(own.players[1].gigArea.map((d) => d.value)).toEqual([3])

    const rival = applyAction(db, s, rivalPlays[0])
    expect(rival.players[0].gigArea.map((d) => d.value)).toEqual([1])
    expect(rival.players[1].gigArea.map((d) => d.value)).toEqual([5])
  })
})

describe('changeGig with adjust: sign and magnitude are the player choice', () => {
  const db = makeDb([
    def('tweak', 'program', {
      cost: 0,
      effects: [onPlay({ kind: 'changeGig', amount: 2, target: 'anyGigDie', adjust: true })],
    }),
    def('nudge', 'program', {
      cost: 0,
      effects: [onPlay({ kind: 'changeGig', amount: 1, target: 'anyGigDie', adjust: true })],
    }),
  ])

  it('enumerates -N..-1 and 1..N for every candidate die, never 0', () => {
    const s = scenario()
    const card = mint(s, 0, 'hand', 'tweak')
    gigs(s, 0, [4])

    // slots: [die, amount]; amounts are indexes into [-2, -1, 1, 2].
    const actions = playActions(db, s).filter((a) => a.card === card)
    expect(actions.map((a) => a.targets)).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
    ])

    expect(applyAction(db, s, actions[0]).players[0].gigArea[0].value).toBe(2) // -2
    expect(applyAction(db, s, actions[1]).players[0].gigArea[0].value).toBe(3) // -1
    expect(applyAction(db, s, actions[2]).players[0].gigArea[0].value).toBe(5) // +1
    expect(applyAction(db, s, actions[3]).players[0].gigArea[0].value).toBe(6) // +2
  })

  it('offers exactly the two directions for "by up to 1"', () => {
    const s = scenario()
    const card = mint(s, 0, 'hand', 'nudge')
    gigs(s, 0, [3])
    const actions = playActions(db, s).filter((a) => a.card === card)
    expect(actions.map((a) => a.targets)).toEqual([
      [0, 0],
      [0, 1],
    ])
    expect(applyAction(db, s, actions[0]).players[0].gigArea[0].value).toBe(2)
    expect(applyAction(db, s, actions[1]).players[0].gigArea[0].value).toBe(4)
  })

  it('picks an amount off the rng when a trigger supplies none, and clamps it', () => {
    const triggered = makeDb([
      def('adjuster', 'unit', {
        power: 2,
        effects: [
          {
            trigger: 'onAttack',
            effect: { kind: 'changeGig', amount: 1, target: 'friendlyGigDie', adjust: true },
          },
        ],
      }),
      def('grunt', 'unit', { power: 1 }),
    ])
    const s = scenario()
    const attacker = mint(s, 0, 'field', 'adjuster')
    const victim = mint(s, 1, 'field', 'grunt', { ready: false })
    gigs(s, 0, [1]) // a d6 showing 1: -1 clamps to 1, +1 gives 2

    const next = applyAction(triggered, s, { type: 'attack', attacker, target: victim })
    expect([1, 2]).toContain(next.players[0].gigArea[0].value)
  })

  it('keeps the slots of later nodes aligned when the die slot is empty', () => {
    const combo = makeDb([
      def('combo', 'program', {
        cost: 0,
        effects: [
          onPlay({
            kind: 'sequence',
            effects: [
              { kind: 'changeGig', amount: 1, target: 'friendlyGigDie', adjust: true },
              { kind: 'defeat', target: 'rivalUnit' },
            ],
          }),
        ],
      }),
      def('grunt', 'unit', { power: 1 }),
    ])
    const s = scenario()
    const card = mint(s, 0, 'hand', 'combo')
    const a = mint(s, 1, 'field', 'grunt')
    const b = mint(s, 1, 'field', 'grunt')
    // No friendly gig dice: the die *and* amount slots are both unfillable, so
    // the only slot left is the defeat target.
    const actions = playActions(combo, s).filter((x) => x.card === card)
    expect(actions.map((x) => x.targets)).toEqual([[a], [b]])

    const next = applyAction(combo, s, actions[1])
    expect(next.players[1].trash).toEqual([b]) // the *picked* rival
  })
})

describe('EffectNode: sameTarget (docs/rulings.md §53)', () => {
  const db = makeDb([
    def('orders', 'program', {
      cost: 0,
      effects: [
        onPlay({
          kind: 'sameTarget',
          target: 'friendlyUnit',
          effects: [
            { kind: 'buffPower', amount: 3, target: 'chosen', duration: 'turn' },
            { kind: 'grantKeyword', keyword: 'blocker', target: 'chosen', duration: 'turn' },
          ],
        }),
      ],
    }),
    def('grunt', 'unit', { power: 1 }),
  ])

  it('binds ONE slot and applies every child to it', () => {
    const s = scenario()
    const card = mint(s, 0, 'hand', 'orders')
    const a = mint(s, 0, 'field', 'grunt')
    const b = mint(s, 0, 'field', 'grunt')

    // One decision, not one per child.
    const actions = playActions(db, s).filter((x) => x.card === card)
    expect(actions.map((x) => x.targets)).toEqual([[a], [b]])

    const next = applyAction(db, s, actions[0])
    expect(next.cards[a].tempPower).toBe(3)
    expect(effectiveKeywords(db, next, a)).toContain('blocker')
    expect(next.cards[b].tempPower).toBe(0)
    expect(next.cards[b].tempKeywords).toEqual([])
  })

  it('respects a filter on the shared slot', () => {
    const filtered = makeDb([
      def('orders', 'program', {
        cost: 0,
        effects: [
          onPlay({
            kind: 'sameTarget',
            target: 'friendlyUnit',
            filter: { keyword: 'rocker' },
            effects: [{ kind: 'buffPower', amount: 1, target: 'chosen', duration: 'turn' }],
          }),
        ],
      }),
      def('grunt', 'unit', { power: 1 }),
      def('star', 'unit', { power: 1, keywords: ['rocker'] }),
    ])
    const s = scenario()
    const card = mint(s, 0, 'hand', 'orders')
    mint(s, 0, 'field', 'grunt')
    const star = mint(s, 0, 'field', 'star')
    expect(playActions(filtered, s).filter((x) => x.card === card).map((x) => x.targets)).toEqual([
      [star],
    ])
  })

  it('fizzles as a whole with no legal shared target, leaving later slots aligned', () => {
    const combo = makeDb([
      def('combo', 'program', {
        cost: 0,
        effects: [
          onPlay({
            kind: 'sequence',
            effects: [
              {
                kind: 'sameTarget',
                target: 'friendlyUnit',
                effects: [{ kind: 'buffPower', amount: 3, target: 'chosen', duration: 'turn' }],
              },
              { kind: 'defeat', target: 'rivalUnit' },
            ],
          }),
        ],
      }),
      def('grunt', 'unit', { power: 1 }),
    ])
    const s = scenario()
    const card = mint(s, 0, 'hand', 'combo')
    const a = mint(s, 1, 'field', 'grunt')
    const b = mint(s, 1, 'field', 'grunt')

    const actions = playActions(combo, s).filter((x) => x.card === card)
    expect(actions.map((x) => x.targets)).toEqual([[a], [b]])
    const next = applyAction(combo, s, actions[1])
    expect(next.players[1].trash).toEqual([b])
  })
})

describe("chooseOne chooser 'allUnlessBehindStreetCred' (docs/rulings.md §45)", () => {
  const db = makeDb([
    def('orders', 'program', {
      cost: 0,
      effects: [
        onPlay({
          kind: 'sameTarget',
          target: 'friendlyUnit',
          effects: [
            {
              kind: 'chooseOne',
              chooser: 'allUnlessBehindStreetCred',
              modes: [
                { kind: 'buffPower', amount: 3, target: 'chosen', duration: 'turn' },
                { kind: 'grantKeyword', keyword: 'blocker', target: 'chosen', duration: 'turn' },
              ],
            },
          ],
        }),
      ],
    }),
    def('grunt', 'unit', { power: 1 }),
  ])

  it('resolves every mode while the controller is not behind, with no mode slot', () => {
    const s = scenario()
    const card = mint(s, 0, 'hand', 'orders')
    const unit = mint(s, 0, 'field', 'grunt')
    gigs(s, 0, [5])

    const actions = playActions(db, s).filter((a) => a.card === card)
    expect(actions.map((a) => a.targets)).toEqual([[unit]]) // only the shared target

    const next = applyAction(db, s, actions[0])
    expect(next.cards[unit].tempPower).toBe(3)
    expect(effectiveKeywords(db, next, unit)).toContain('blocker')
  })

  it('cuts to exactly one rival-chosen mode while the controller is behind', () => {
    const s = scenario()
    const card = mint(s, 0, 'hand', 'orders')
    const unit = mint(s, 0, 'field', 'grunt')
    gigs(s, 0, [1])
    gigs(s, 1, [6])

    const actions = playActions(db, s).filter((a) => a.card === card)
    expect(actions.map((a) => a.targets)).toEqual([[unit]])

    const next = applyAction(db, s, actions[0])
    const buffed = next.cards[unit].tempPower === 3
    const blocker = next.cards[unit].tempKeywords.includes('blocker')
    expect(buffed !== blocker).toBe(true)
  })
})
