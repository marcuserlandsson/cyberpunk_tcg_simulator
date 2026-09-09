import { useState } from 'react'
import type { DeckList } from '../engine/deck'
import type { SimOptions } from '../sim/runner'
import { intervalLabel } from '../sim/statistics'
import type { SimRun } from './simHistory'

export function benchmarkPlan(baseline: DeckList, candidate: DeckList, opponents: DeckList[], settings: Pick<SimOptions, 'games' | 'seed' | 'agentA' | 'agentB'>): SimOptions[] {
  const id = crypto.randomUUID()
  return opponents.flatMap((deckB, opponent) => ([baseline, candidate].map((deckA, index) => structuredClone({
    ...settings, deckA, deckB, benchmark: { id, opponent, role: index === 0 ? 'baseline' as const : 'candidate' as const },
  }))))
}

/** Only compare matched samples, versions, policies and opponent snapshots. */
export function compatibleComparison(a: SimRun, b: SimRun): boolean {
  const signature = (r: SimRun) => JSON.stringify([r.engineVersion, r.rulesVersion, r.cardData, r.options.agentA, r.options.agentB,
    r.options.seed, r.options.games, r.options.deckB.legends, Object.entries(r.options.deckB.cards).sort(), r.options.deckB.demo, r.options.deckB.format, Object.entries(r.options.deckB.sealedPool??{}).sort(),
    r.result.games.map(g => g.seed)])
  return signature(a) === signature(b)
}

export function SimBenchmark({ decks, runs, busy, start }: { decks: DeckList[]; runs: SimRun[]; busy: boolean; start: (baseline: DeckList, candidate: DeckList, opponents: DeckList[]) => void }) {
  const [baseline, setBaseline] = useState(decks[0]?.name ?? '')
  const [candidate, setCandidate] = useState(decks[1]?.name ?? '')
  const [opponents, setOpponents] = useState<string[]>([])
  const selected = opponents.flatMap(name => decks.filter(d => d.name === name))
  const a = decks.find(d => d.name === baseline), b = decks.find(d => d.name === candidate)
  const candidates = runs.filter(r => r.options.benchmark?.role === 'candidate')
  return <details className="panel" data-testid="sim-benchmark"><summary>Compare deck changes against multiple opponents</summary>
    <p>Uses the Games, Seed and Agent settings above for every matchup. Both versions face each opponent with the same seed sequence and alternating seats. Each completed run stays in history if cancelled.</p>
    <label>Baseline<select data-testid="benchmark-baseline" value={baseline} onChange={e => setBaseline(e.target.value)}>{decks.map(d => <option key={d.name}>{d.name}</option>)}</select></label>
    <label>Candidate<select data-testid="benchmark-candidate" value={candidate} onChange={e => setCandidate(e.target.value)}>{decks.map(d => <option key={d.name}>{d.name}</option>)}</select></label>
    <fieldset><legend>Opponents</legend>{decks.map(d => <label key={d.name}><input type="checkbox" checked={opponents.includes(d.name)} onChange={e => setOpponents(old => e.target.checked ? [...old, d.name] : old.filter(n => n !== d.name))} />{d.name}</label>)}</fieldset>
    <button data-testid="benchmark-start" disabled={busy || !a || !b || a.name === b.name || !selected.length} onClick={() => a && b && start(a,b,selected)}>Run comparison ({selected.length * 2} runs)</button>
    <table><caption>Completed comparisons · wins count draws as non-wins</caption><thead><tr><th>Opponent / versions</th><th>Baseline wins (95% interval)</th><th>Candidate wins (95% interval)</th><th>Change</th></tr></thead>
      <tbody>{candidates.map(candidateRun => {
        const tag = candidateRun.options.benchmark!
        const base = runs.find(r => r.options.benchmark?.id === tag.id && r.options.benchmark.opponent === tag.opponent && r.options.benchmark.role === 'baseline')
        if (!base || !compatibleComparison(base,candidateRun)) return <tr key={candidateRun.id}><td colSpan={4}>Incomplete or incompatible comparison: {candidateRun.options.deckB.name}</td></tr>
        const summary = (r: SimRun) => { const n = r.result.games.length, w = r.result.games.filter(g => g.winner === 0).length; return `${w}/${n} · ${(100*w/n).toFixed(1)}% (${intervalLabel(w,n)})` }
        const rate = (r: SimRun) => r.result.games.filter(g => g.winner === 0).length / r.result.games.length
        return <tr key={candidateRun.id} data-testid="benchmark-result"><td>{candidateRun.options.deckB.name}<br />{base.options.deckA.name} → {candidateRun.options.deckA.name}</td><td>{summary(base)}</td><td>{summary(candidateRun)}</td><td>{((rate(candidateRun)-rate(base))*100).toFixed(1)} percentage points</td></tr>
      })}</tbody></table>
    <p>Ranges estimate sampling uncertainty for these policies, not human play or engine accuracy. The change is descriptive; it is not a significance test.</p>
  </details>
}
