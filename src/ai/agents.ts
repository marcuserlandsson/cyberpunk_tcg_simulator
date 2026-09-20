import { createHeuristicAgent, rankHeuristicActions } from './heuristic'
import { createPlanningAgent, type PlannerOptions } from './planner'
import { createRandomAgent, type Agent } from './random'
import { createRng, nextInt } from '../engine/rng'

export const AI_DIFFICULTIES = ['easy', 'medium', 'hard'] as const
export type AiDifficulty = typeof AI_DIFFICULTIES[number]
export const AGENT_KINDS = [...AI_DIFFICULTIES, 'heuristic', 'random'] as const
export type AgentKind = typeof AGENT_KINDS[number]
export const AI_VERSION = 'planning-2026-09-16-v4'

export function canonicalAgent(kind: AgentKind): Exclude<AgentKind, 'heuristic'> {
  return kind === 'heuristic' ? 'medium' : kind
}

export const AI_LABELS: Record<AgentKind, string> = {
  easy: 'Easy', medium: 'Medium', hard: 'Hard', heuristic: 'Medium (legacy Heuristic)', random: 'Random (baseline)',
}

/** All skill levels share the rules and evaluation model. Lower levels reduce
 * search and Easy occasionally selects another plausible move. Legacy saved
 * simulations retain the heuristic identifier, which maps to Medium.
 */
export function createAgent(kind: AgentKind, seed: number, callbacks: Pick<PlannerOptions, 'onProgress'> = {}): Agent {
  switch (canonicalAgent(kind)) {
    case 'random': return createRandomAgent(seed)
    case 'medium': return createHeuristicAgent(seed)
    case 'hard': return createPlanningAgent(seed, callbacks)
    case 'easy': {
      const options = { searchDepth: 0, quiescenceSteps: 0 }
      const policy = createHeuristicAgent(seed, options)
      let rng = createRng(seed)
      return { chooseAction(db, state, actions) {
        if (!actions.length) throw new Error('Easy agent received no legal actions')
        const [chance, after] = nextInt(rng, 100)
        rng = after
        if (chance < 30 && actions.length > 1 && ['main', 'react'].includes(state.phase)) {
          const alternatives = rankHeuristicActions(db, state, actions, options).slice(0, 5)
          const [index, next] = nextInt(rng, alternatives.length)
          rng = next
          return alternatives[index].action
        }
        return policy.chooseAction(db, state, actions)
      } }
    }
  }
}
