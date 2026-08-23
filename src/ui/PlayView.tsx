// The playmat.
//
// LAYOUT follows the official playmat (docs/rules/gameplay-guide-extracted.txt,
// "PLAYMAT AREAS"): the rival's half mirrored across the top, yours along the
// bottom, each half carrying Fixer area, Gig area, Legends, Eddies, Deck,
// Trash, Field and Hand. The centre strip carries the turn/phase indicators and
// both Street Cred totals; the log panel runs down the right.
//
// INTERACTION comes from ONE place: the `legal` list. `playAffordances.ts`
// projects it into glows and clickable targets, so a highlighted thing and a
// legal action are literally the same fact — the view cannot offer a move the
// engine would reject, and cannot hide one it would allow. Payments are never
// asked about: each legal entry already carries the canonical payment, which is
// passed straight back (a documented UI simplification — see docs/rulings.md).
//
// DISAMBIGUATION is progressive. Clicking a card with several legal variants
// (different targets, or an attack with and without an optional cost) opens a
// choice bar and highlights the candidates on the board; each answer narrows
// the variants, and the action fires the moment the survivors are
// indistinguishable. Nothing is chosen for the player except things that are
// not decisions.

import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { Field } from './Field'
import { HandStrip } from './HandStrip'
import { LogPanel } from './LogPanel'
import { ReactionBar } from './ReactionBar'
import { ZonePanels } from './ZonePanels'
import { AI, HUMAN, useGame } from './useGame'
import { deleteGameRecord, listDecks, listGameRecords } from './storage'
import { deckPickerLabel, isDeckPickable } from './deckPicker'
import {
  abilityUids,
  abilityVariants,
  attackerUids,
  attacksBy,
  fixerDieSizes,
  findAction,
  firstDivergentSlot,
  NO_AFFORDANCES,
  NO_TARGET,
  playableCards,
  playVariants,
  reactions as reactionsOf,
  sellableCards,
  sideLabel,
  slotOptions,
  slotValue,
  stealableGigIndexes,
  type BoardAffordances,
  type BoardHandlers,
} from './playAffordances'
import type { GameRecord } from '../engine/replay'
import type { DeckList } from '../engine/deck'
import type { Action, CardDb, DieSize, GameState } from '../engine/types'

export interface PlayViewProps {
  db: CardDb
  useOfficialImages: boolean
  /** Pacing delay between AI actions; 0 in E2E runs (`?aiDelay=0`). */
  aiDelayMs?: number
}

/** An action carrying a target tuple, which is what disambiguation narrows. */
type Targeted = Action & { targets: number[] }

/**
 * A multi-step decision the player is in the middle of. `targets` narrows a
 * target tuple one slot at a time; `attackTarget` is "which unit/Gig area does
 * the selected attacker hit"; `attackVariant` is the {Attack}-trigger optional
 * cost question, which only exists when both variants are legal for the same
 * target (docs/rulings.md §49).
 */
type Pending =
  | { kind: 'targets'; title: string; variants: Targeted[] }
  | { kind: 'attackTarget'; attacker: number }
  | {
      kind: 'attackVariant'
      attacker: number
      variants: Extract<Action, { type: 'attack' }>[]
    }

interface Option {
  key: string
  label: string
  uid?: number
  gigArea?: boolean
  pick: () => void
}

const PHASE_LABELS: Record<string, string> = {
  chooseOrder: 'Choosing play order',
  mulligan: 'Mulligan',
  start: 'Start of turn',
  main: 'Main phase',
  react: 'Reaction window',
  chooseGig: 'Stealing a Gig',
  gigReroll: 'Gig reroll',
  intercept: 'Interception',
  gameOver: 'Game over',
}

function nameOf(db: CardDb, state: GameState, uid: number): string {
  const instance = state.cards[uid]
  if (instance === undefined) return `#${uid}`
  return db[instance.defId]?.name ?? instance.defId
}

/**
 * A target option's label.
 *
 * A slot binds either a card uid or an index into a Gig area (engine/types.ts's
 * TargetSpec), and the action alone does not say which. A value that resolves
 * to a card instance is labelled as that card; anything else is labelled as a
 * Gig die. A Gig index that happens to collide with a live uid therefore reads
 * as a card name — cosmetic only (the action applied is the engine's own), and
 * recorded as such in docs/rulings.md.
 */
function targetLabel(db: CardDb, state: GameState, value: number): string {
  if (value === NO_TARGET) return 'No target'
  const instance = state.cards[value]
  if (instance === undefined) return `Gig die #${value}`
  return `${nameOf(db, state, value)} (${sideLabel(instance.owner, HUMAN)})`
}

export function PlayView({ db, useOfficialImages, aiDelayMs }: PlayViewProps): ReactElement {
  const game = useGame(db, aiDelayMs === undefined ? {} : { aiDelayMs })
  const { state, record, legal } = game

  const [pending, setPending] = useState<Pending | null>(null)
  const [setupOpen, setSetupOpen] = useState(true)
  const [saveName, setSaveName] = useState('')
  const [savedNote, setSavedNote] = useState<string | null>(null)
  const [records, setRecords] = useState<{ name: string; record: GameRecord }[]>([])
  // The name of the save slot the most recent "resume" click tried to load,
  // so a failed load (`game.loadError`) knows which slot to offer deleting —
  // `game.load` only ever sees the record, never its name.
  const [resumeAttempt, setResumeAttempt] = useState<string | null>(null)

  const actionCount = record?.actions.length ?? -1
  // Any change to the record (an action, or an undo) invalidates a half-made
  // choice: the variants it was narrowing came from a `legal` list that no
  // longer describes the game.
  useEffect(() => {
    setPending(null)
  }, [actionCount])

  // ---- committing a choice ------------------------------------------------

  /**
   * Narrows a set of target variants and either fires the action or asks about
   * the next divergent slot. `firstDivergentSlot === -1` means the survivors
   * bind identical targets, so there is nothing left to decide.
   */
  function resolveTargets(title: string, variants: Targeted[]): void {
    if (variants.length === 0) return
    if (firstDivergentSlot(variants) === -1) {
      setPending(null)
      game.act(variants[0])
      return
    }
    setPending({ kind: 'targets', title, variants })
  }

  function resolveAttackTarget(attacker: number, target: number | 'gigArea'): void {
    const variants = attacksBy(legal, attacker).filter((action) => action.target === target)
    if (variants.length === 0) return
    if (variants.length === 1) {
      setPending(null)
      game.act(variants[0])
      return
    }
    setPending({ kind: 'attackVariant', attacker, variants })
  }

  // ---- the option list of the pending choice ------------------------------

  const options: Option[] = useMemo(() => {
    if (state === null || pending === null) return []
    switch (pending.kind) {
      case 'targets': {
        const slot = firstDivergentSlot(pending.variants)
        if (slot === -1) return []
        return slotOptions(pending.variants, slot).map((value) => ({
          key: `t${value}`,
          label: targetLabel(db, state, value),
          uid: state.cards[value] === undefined ? undefined : value,
          pick: () =>
            resolveTargets(
              pending.title,
              pending.variants.filter(
                (variant) => slotValue(variant.targets, slot) === value
              )
            ),
        }))
      }
      case 'attackTarget': {
        const seen = new Set<number | 'gigArea'>()
        const out: Option[] = []
        for (const action of attacksBy(legal, pending.attacker)) {
          if (seen.has(action.target)) continue
          seen.add(action.target)
          out.push({
            key: String(action.target),
            label:
              action.target === 'gigArea'
                ? 'Rival Gig area'
                : targetLabel(db, state, action.target),
            uid: action.target === 'gigArea' ? undefined : action.target,
            gigArea: action.target === 'gigArea',
            pick: () => resolveAttackTarget(pending.attacker, action.target),
          })
        }
        return out
      }
      case 'attackVariant':
        return pending.variants.map((action) => ({
          key: action.payOptionalCosts === true ? 'pay' : 'decline',
          label:
            action.payOptionalCosts === true
              ? 'Attack, paying the optional {Attack} cost'
              : 'Attack without paying the optional cost',
          pick: () => {
            setPending(null)
            game.act(action)
          },
        }))
    }
  }, [db, state, pending, legal])

  // ---- affordances --------------------------------------------------------

  const affordances: BoardAffordances = useMemo(() => {
    if (state === null) return NO_AFFORDANCES
    const targets = new Set<number>()
    for (const option of options) if (option.uid !== undefined) targets.add(option.uid)
    const gigAreaTarget = options.some((option) => option.gigArea === true)
    const selected =
      pending !== null && pending.kind !== 'targets' ? pending.attacker : null

    // While a choice is open, only its candidates are live: leaving the
    // ordinary glows on would offer moves that would silently abandon the
    // half-made decision.
    if (pending !== null) {
      return {
        ...NO_AFFORDANCES,
        targets,
        selected,
        gigAreaTarget,
        stealableGigIndexes: stealableGigIndexes(legal),
      }
    }

    return {
      playable: playableCards(legal),
      sellable: sellableCards(legal),
      attackers: attackerUids(legal),
      abilities: abilityUids(legal),
      targets,
      selected,
      fixerSizes: fixerDieSizes(legal),
      stealableGigIndexes: stealableGigIndexes(legal),
      gigAreaTarget,
    }
  }, [state, legal, options, pending])

  // ---- click routing ------------------------------------------------------

  const handlers: BoardHandlers = {
    onCard: (uid) => {
      if (state === null) return
      const option = options.find((candidate) => candidate.uid === uid)
      if (option !== undefined) {
        option.pick()
        return
      }
      if (pending !== null) return
      if (affordances.attackers.has(uid)) {
        setPending({ kind: 'attackTarget', attacker: uid })
        return
      }
      if (affordances.playable.has(uid)) {
        resolveTargets(`Choose a target for ${nameOf(db, state, uid)}`, playVariants(legal, uid))
      }
    },
    onSell: (uid) => {
      const action = legal.find(
        (candidate) => candidate.type === 'sellCard' && candidate.card === uid
      )
      if (action !== undefined) game.act(action)
    },
    onAbility: (uid) => {
      if (state === null) return
      resolveTargets(
        `Choose a target for ${nameOf(db, state, uid)}'s ability`,
        abilityVariants(legal, uid)
      )
    },
    onFixerDie: (size: DieSize) => {
      const action = legal.find(
        (candidate) => candidate.type === 'chooseGigDie' && candidate.size === size
      )
      if (action !== undefined) game.act(action)
    },
    onGigDie: (index) => {
      const action = legal.find(
        (candidate) => candidate.type === 'chooseGig' && candidate.dieIndex === index
      )
      if (action !== undefined) game.act(action)
    },
    onGigArea: () => {
      const option = options.find((candidate) => candidate.gigArea === true)
      if (option !== undefined) option.pick()
    },
  }

  // ---- new game / resume --------------------------------------------------

  const decks = useMemo(() => listDecks(), [])
  // A non-demo deck that fails validateDeck cannot be offered as a seat
  // (docs/rulings.md §153) — default to the first/second PICKABLE deck so
  // the setup screen never opens with an already-illegal selection.
  const pickableDecks = useMemo(() => decks.filter((deck) => isDeckPickable(db, deck)), [db, decks])
  const [humanDeckName, setHumanDeckName] = useState(
    () => pickableDecks[0]?.name ?? decks[0]?.name ?? ''
  )
  const [aiDeckName, setAiDeckName] = useState(
    () => pickableDecks[1]?.name ?? pickableDecks[0]?.name ?? decks[0]?.name ?? ''
  )
  const [seedText, setSeedText] = useState('')

  useEffect(() => {
    if (setupOpen) setRecords(listGameRecords())
  }, [setupOpen])

  function deckByName(name: string): DeckList | undefined {
    return decks.find((deck) => deck.name === name)
  }

  function startGame(): void {
    const human = deckByName(humanDeckName)
    const ai = deckByName(aiDeckName)
    if (human === undefined || ai === undefined) return
    if (!isDeckPickable(db, human) || !isDeckPickable(db, ai)) return
    // A fresh start is not an attempt to resume any particular slot — clears
    // a stale delete-this-save button left over from an earlier failed load.
    setResumeAttempt(null)
    const parsed = Number(seedText)
    game.start(human, ai, seedText.trim() !== '' && Number.isFinite(parsed) ? parsed : undefined)
    setSetupOpen(false)
    setSavedNote(null)
  }

  function doSave(): void {
    const name = saveName.trim() === '' ? `game-${Date.now()}` : saveName.trim()
    game.save(name)
    setRecords(listGameRecords())
    setSavedNote(`Saved as "${name}".`)
  }

  if (state === null || setupOpen) {
    return (
      <section className="play-setup" aria-label="New game" data-testid="play-setup">
        <h2>New game</h2>
        <label className="play-setup__field">
          Your deck
          <select
            data-testid="deck-human"
            value={humanDeckName}
            onChange={(event) => setHumanDeckName(event.target.value)}
          >
            {decks.map((deck) => (
              <option key={deck.name} value={deck.name} disabled={!isDeckPickable(db, deck)}>
                {deckPickerLabel(db, deck)}
              </option>
            ))}
          </select>
        </label>
        <label className="play-setup__field">
          Rival deck
          <select
            data-testid="deck-ai"
            value={aiDeckName}
            onChange={(event) => setAiDeckName(event.target.value)}
          >
            {decks.map((deck) => (
              <option key={deck.name} value={deck.name} disabled={!isDeckPickable(db, deck)}>
                {deckPickerLabel(db, deck)}
              </option>
            ))}
          </select>
        </label>
        <label className="play-setup__field">
          Seed (optional)
          <input
            data-testid="seed-input"
            value={seedText}
            inputMode="numeric"
            placeholder="random"
            onChange={(event) => setSeedText(event.target.value)}
          />
        </label>
        <button type="button" data-testid="start-game" onClick={startGame}>
          Start game
        </button>
        {state !== null && (
          <button type="button" data-testid="cancel-setup" onClick={() => setSetupOpen(false)}>
            Back to game
          </button>
        )}
        <h3>Resume a saved game</h3>
        {records.length === 0 && <p data-testid="no-saves">No saved games.</p>}
        <ul className="play-setup__saves">
          {records.map((entry) => (
            <li key={entry.name}>
              <button
                type="button"
                data-testid="resume-game"
                data-name={entry.name}
                onClick={() => {
                  setResumeAttempt(entry.name)
                  game.load(entry.record)
                  setSetupOpen(false)
                }}
              >
                {entry.name}
              </button>
            </li>
          ))}
        </ul>
        {game.loadError !== null && (
          <div className="play-setup__load-error" role="alert" data-testid="resume-error">
            <p>{game.loadError}</p>
            {resumeAttempt !== null && (
              <button
                type="button"
                data-testid="delete-broken-save"
                data-name={resumeAttempt}
                onClick={() => {
                  deleteGameRecord(resumeAttempt)
                  setRecords(listGameRecords())
                  setResumeAttempt(null)
                  game.clearLoadError()
                }}
              >
                Delete this save
              </button>
            )}
          </div>
        )}
      </section>
    )
  }

  // ---- prompt bars --------------------------------------------------------

  const chooseOrder = state.phase === 'chooseOrder'
  const orderRoll = state.events.find((event) => event.type === 'gameStarted')
  const reactions = reactionsOf(legal)
  const endTurn = findAction(legal, 'endTurn')
  const callLegend = findAction(legal, 'callLegend')
  const yourTurn = state.activePlayer === HUMAN

  return (
    // `data-awaiting` is the machine-readable form of "whose click is the game
    // waiting for" — the single fact any automated driver (the E2E suite, and
    // Task 15's) needs in order to never race the AI's own timer.
    <section
      className="playmat"
      aria-label="Playmat"
      data-testid="playmat"
      data-awaiting={legal.length > 0 ? 'human' : state.phase === 'gameOver' ? 'over' : 'ai'}
      data-turn={state.turnNumber}
      data-phase={state.phase}
    >
      <div className="playmat__bar" data-testid="control-bar">
        <span className="playmat__chip" data-testid="turn-indicator">
          Turn {state.turnNumber}
        </span>
        <span className="playmat__chip" data-testid="phase-indicator">
          {PHASE_LABELS[state.phase] ?? state.phase}
        </span>
        <span className="playmat__chip" data-testid="active-indicator">
          {yourTurn ? 'Your turn' : "Rival's turn"}
        </span>
        {game.aiThinking && (
          <span className="playmat__chip playmat__chip--thinking" data-testid="ai-thinking">
            Rival is thinking…
          </span>
        )}
        <span className="playmat__chip playmat__chip--seed" data-testid="seed-chip">
          seed {record?.config.seed}
        </span>
        <div className="playmat__actions">
          <button
            type="button"
            data-testid="call-legend"
            disabled={callLegend === undefined}
            onClick={() => callLegend !== undefined && game.act(callLegend)}
          >
            Call Legend
          </button>
          <button
            type="button"
            data-testid="end-turn"
            disabled={endTurn === undefined}
            title={
              endTurn === undefined
                ? 'You cannot end your turn right now (a Unit may be forced to attack).'
                : undefined
            }
            onClick={() => endTurn !== undefined && game.act(endTurn)}
          >
            End Turn
          </button>
          <button
            type="button"
            data-testid="undo"
            disabled={!game.canUndo}
            onClick={() => game.undo()}
          >
            Undo
          </button>
          <input
            data-testid="save-name"
            placeholder="save name"
            value={saveName}
            onChange={(event) => setSaveName(event.target.value)}
          />
          <button type="button" data-testid="save-game" onClick={doSave}>
            Save
          </button>
          <button type="button" data-testid="new-game" onClick={() => setSetupOpen(true)}>
            New game
          </button>
        </div>
        {savedNote !== null && (
          <span className="playmat__chip" data-testid="saved-note">
            {savedNote}
          </span>
        )}
      </div>

      <div className="playmat__body">
        <div className="playmat__board">
          <div className="playmat__side playmat__side--rival" data-testid="rival-side">
            <HandStrip
              db={db}
              state={state}
              player={AI}
              hidden
              affordances={affordances}
              handlers={handlers}
              useOfficialImages={useOfficialImages}
            />
            <ZonePanels
              db={db}
              state={state}
              player={AI}
              affordances={affordances}
              handlers={handlers}
              useOfficialImages={useOfficialImages}
              fixerInteractive={false}
              gigStealInteractive={affordances.stealableGigIndexes.size > 0}
              gigAreaTargetable={affordances.gigAreaTarget}
            />
            <Field
              db={db}
              state={state}
              player={AI}
              affordances={affordances}
              handlers={handlers}
              useOfficialImages={useOfficialImages}
            />
          </div>

          <div className="playmat__center" data-testid="center-strip">
            <span data-testid="center-turn">
              Turn {state.turnNumber} · {PHASE_LABELS[state.phase] ?? state.phase}
            </span>
          </div>

          <div className="playmat__side playmat__side--human" data-testid="human-side">
            <Field
              db={db}
              state={state}
              player={HUMAN}
              affordances={affordances}
              handlers={handlers}
              useOfficialImages={useOfficialImages}
            />
            <ZonePanels
              db={db}
              state={state}
              player={HUMAN}
              affordances={affordances}
              handlers={handlers}
              useOfficialImages={useOfficialImages}
              fixerInteractive={affordances.fixerSizes.size > 0}
              gigStealInteractive={false}
              gigAreaTargetable={false}
            />
            <HandStrip
              db={db}
              state={state}
              player={HUMAN}
              hidden={false}
              affordances={affordances}
              handlers={handlers}
              useOfficialImages={useOfficialImages}
            />
          </div>
        </div>

        <LogPanel lines={game.eventsForLog} />
      </div>

      <div className="playmat__prompts">
        {state.phase === 'gameOver' && (
          <div className="prompt-bar prompt-bar--over" data-testid="game-over">
            {state.winner === HUMAN ? 'You win!' : 'Rival wins.'}
          </div>
        )}

        {chooseOrder && legal.length > 0 && (
          <div className="prompt-bar" data-testid="choose-order-bar">
            <span className="prompt-bar__label">
              {orderRoll !== undefined && orderRoll.type === 'gameStarted'
                ? `Order roll — you ${orderRoll.orderRolls[0]}, Rival ${orderRoll.orderRolls[1]}. You won the roll:`
                : 'Choose who goes first:'}
            </span>
            <div className="prompt-bar__options">
              <button
                type="button"
                data-testid="choose-order-first"
                onClick={() => game.act({ type: 'choosePlayOrder', goFirst: true })}
              >
                Go first
              </button>
              <button
                type="button"
                data-testid="choose-order-second"
                onClick={() => game.act({ type: 'choosePlayOrder', goFirst: false })}
              >
                Go second
              </button>
            </div>
          </div>
        )}

        {state.phase === 'mulligan' && legal.length > 0 && (
          <div className="prompt-bar" data-testid="mulligan-bar">
            <span className="prompt-bar__label">Keep this opening hand?</span>
            <div className="prompt-bar__options">
              {findAction(legal, 'mulligan') !== undefined && (
                <button
                  type="button"
                  data-testid="mulligan"
                  onClick={() => game.act({ type: 'mulligan' })}
                >
                  Mulligan
                </button>
              )}
              <button
                type="button"
                data-testid="keep-hand"
                onClick={() => game.act({ type: 'keepHand' })}
              >
                Keep hand
              </button>
            </div>
          </div>
        )}

        {state.phase === 'start' && legal.length > 0 && (
          <div className="prompt-bar" data-testid="choose-gig-die-bar">
            <span className="prompt-bar__label">
              Choose a Gig die from your fixer area to roll.
            </span>
          </div>
        )}

        {state.phase === 'chooseGig' && legal.length > 0 && (
          <div className="prompt-bar" data-testid="choose-gig-bar">
            <span className="prompt-bar__label">
              Choose a rival Gig to steal (the glowing dice above).
            </span>
          </div>
        )}

        {state.phase === 'gigReroll' && legal.length > 0 && (
          <div className="prompt-bar" data-testid="gig-reroll-bar">
            <span className="prompt-bar__label">Ignore this roll and reroll the die once?</span>
            <div className="prompt-bar__options">
              <button
                type="button"
                data-testid="gig-reroll-yes"
                onClick={() => game.act({ type: 'chooseGigReroll', reroll: true })}
              >
                Reroll
              </button>
              <button
                type="button"
                data-testid="gig-reroll-no"
                onClick={() => game.act({ type: 'chooseGigReroll', reroll: false })}
              >
                Keep the roll
              </button>
            </div>
          </div>
        )}

        {state.phase === 'intercept' && legal.length > 0 && state.pendingIntercept !== null && (
          <div className="prompt-bar" data-testid="intercept-bar">
            <span className="prompt-bar__label">
              {state.pendingIntercept.kind === 'defeat'
                ? `${nameOf(db, state, state.pendingIntercept.subject)} would be defeated — intervene with ${nameOf(db, state, state.pendingIntercept.protector)}?`
                : `A Gig would be stolen — prevent it with ${nameOf(db, state, state.pendingIntercept.protector)}?`}
            </span>
            <div className="prompt-bar__options">
              {legal.map((action, index) =>
                action.type !== 'answerIntercept' ? null : (
                  <button
                    type="button"
                    key={index}
                    data-testid={action.answer === -1 ? 'intercept-decline' : 'intercept-option'}
                    onClick={() => game.act(action)}
                  >
                    {action.answer === -1
                      ? 'Decline'
                      : state.pendingIntercept!.kind === 'defeat'
                        ? `Pay and defeat ${nameOf(db, state, action.answer)} instead`
                        : `Discard ${nameOf(db, state, action.answer)} to prevent it`}
                  </button>
                )
              )}
            </div>
          </div>
        )}

        {reactions.length > 0 && (
          <ReactionBar
            db={db}
            state={state}
            reactions={reactions}
            onPick={(action) => game.act(action)}
          />
        )}

        {pending !== null && options.length > 0 && (
          <div className="prompt-bar prompt-bar--choice" data-testid="choice-bar">
            <span className="prompt-bar__label">
              {pending.kind === 'targets'
                ? pending.title
                : pending.kind === 'attackTarget'
                  ? `Choose what ${nameOf(db, state, pending.attacker)} attacks`
                  : 'Pay the optional {Attack} cost?'}
            </span>
            <div className="prompt-bar__options">
              {options.map((option) => (
                <button
                  type="button"
                  key={option.key}
                  className="prompt-bar__option"
                  data-testid="target-option"
                  data-uid={option.uid}
                  onClick={option.pick}
                >
                  {option.label}
                </button>
              ))}
              <button
                type="button"
                className="prompt-bar__option prompt-bar__option--cancel"
                data-testid="choice-cancel"
                onClick={() => setPending(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
