import { useEffect,useState } from 'react'
import { useDecks } from './storage'
import { matchSchema,newMatch,matchScore,matchWinner,finalGameWinner,readMatches,saveMatch,type MatchRecord } from './matchRecords'

export function MatchTracker(){
  const decks=useDecks(),[history,setHistory]=useState(readMatches),[match,setMatch]=useState<MatchRecord|null>(()=>history[0]??null)
  const [a,setA]=useState(decks[0]?.name??''),[b,setB]=useState(decks[1]?.name??''),[notes,setNotes]=useState(''),[error,setError]=useState(''),[importText,setImportText]=useState('')
  const [now,setNow]=useState(Date.now),[gigsA,setGigsA]=useState('0'),[gigsB,setGigsB]=useState('0')
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[])
  function update(next:MatchRecord){setMatch(next);setError(saveMatch(next));setHistory(old=>[next,...old.filter(m=>m.id!==next.id)])}
  function record(winner:0|1|null){if(!match||matchWinner(match)!==null)return;const next={...match,games:[...match.games,{winner,notes,recordedAt:new Date().toISOString()}]};if(matchWinner(next)!==null || match.phase!=='playing' || now>=match.deadline)next.phase='ended';update(next);setNotes('')}
  const score=match?matchScore(match):[0,0],winner=match?matchWinner(match):null
  const remaining=match?Math.max(0,Math.ceil(((match.phase==='extra-turns'?match.finalDeadline??now:match.deadline)-now)/1000)):0
  return <details className="panel" data-testid="match-tracker"><summary>Best-of-three / manual match tracker</summary>
    <p>Record tabletop or practice game results separately from AI benchmarks. Decks are snapshotted at match creation. The timer survives navigation and reload.</p>
    <label>Deck A<select data-testid="match-deck-a" value={a} onChange={e=>setA(e.target.value)}>{decks.map(d=><option key={d.name}>{d.name}</option>)}</select></label>
    <label>Deck B<select value={b} onChange={e=>setB(e.target.value)}>{decks.map(d=><option key={d.name}>{d.name}</option>)}</select></label>
    <button data-testid="match-new" disabled={!decks.some(d=>d.name===a)||!decks.some(d=>d.name===b)} onClick={()=>update(newMatch(decks.find(d=>d.name===a)!,decks.find(d=>d.name===b)!))}>Start new 50-minute match</button>
    {error&&<p role="alert">{error}</p>}
    {match&&<div data-testid="match-current"><p>{match.deckA.name} vs {match.deckB.name} · created {match.createdAt}</p><p data-testid="match-score">A {score[0]} – {score[1]} B · {match.games.filter(g=>g.winner===null).length} drawn games{winner!==null?' · Match: '+(winner==='draw'?'draw':winner===0?'A wins':'B wins'):''}</p>
      <p data-testid="match-clock">{match.phase==='ended'?'Match finished':`${match.phase==='extra-turns'?'Final-turn time':'Round time'}: ${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}`}</p>
      <label>Game notes<input data-testid="match-game-notes" value={notes} onChange={e=>setNotes(e.target.value)} /></label>
      {([0,1,null] as const).map(w=><button key={String(w)} data-testid={w===null?'match-game-draw':'match-game-'+w} disabled={winner!==null} onClick={()=>record(w)}>{w===null?'Record game draw':w===0?'Record A game win':'Record B game win'}</button>)}
      <button disabled={!match.games.length} onClick={()=>update({...match,games:match.games.slice(0,-1),phase:'playing',finalTurns:0,finalDeadline:undefined})}>Undo last game result</button>
      <label>Match notes<textarea value={match.notes} onChange={e=>update({...match,notes:e.target.value})} /></label>
      {winner===null&&<div><button disabled={match.phase!=="playing"} data-testid="match-call-time" onClick={()=>update({...match,phase:'finish-turn'})}>Call round time now (practice)</button>
        {(match.phase==='finish-turn'||(match.phase==='playing'&&now>=match.deadline))&&<div><p>Finish the current turn. Then each player gets one full turn within five minutes.</p><button data-testid="match-final-turns" onClick={()=>update({...match,phase:'extra-turns',finalDeadline:Date.now()+5*60_000,finalTurns:0})}>Current turn finished · begin final turns</button></div>}
        {match.phase==='extra-turns'&&<div><p>{match.finalTurns}/2 final turns completed. {remaining===0?'Five minutes expired; complete the end procedure with your event judge.':''}</p><button data-testid="match-turn-done" disabled={match.finalTurns>=2} onClick={()=>update({...match,finalTurns:Math.min(2,match.finalTurns+1)})}>Mark next full turn complete</button>
          <label>A Gigs<input data-testid="match-gigs-a" type="number" min={0} value={gigsA} onChange={e=>setGigsA(e.target.value)} /></label><label>B Gigs<input type="number" min={0} value={gigsB} onChange={e=>setGigsB(e.target.value)} /></label>
          <button data-testid="match-finish-round" disabled={match.finalTurns<2 || ![gigsA,gigsB].every(v=>v.trim()&&Number.isSafeInteger(Number(v))&&Number(v)>=0)} onClick={()=>update({...match,phase:'ended',games:[...match.games,{winner:finalGameWinner(Number(gigsA),Number(gigsB)),notes:'Round-end procedure: A '+gigsA+' Gigs / B '+gigsB+' Gigs',recordedAt:new Date().toISOString()}]})}>Record final game and finish match</button>
        </div>}</div>}
      <ol>{match.games.map((g,i)=><li key={i}>{g.winner===null?'Draw':g.winner===0?'A win':'B win'} · {g.notes}</li>)}</ol>
      <details><summary>Match JSON / exact deck snapshots</summary><textarea readOnly data-testid="match-export" value={JSON.stringify(match,null,2)} /></details>
    </div>}
    <details><summary>Match history ({history.length})</summary>{history.map(m=><button key={m.id} onClick={()=>setMatch(m)}>{m.createdAt} · {m.deckA.name} / {m.deckB.name}</button>)}</details>
    <label>Import match JSON<textarea value={importText} onChange={e=>setImportText(e.target.value)} /></label><button disabled={!importText.trim()} onClick={()=>{try{const parsed=matchSchema.parse(JSON.parse(importText));update({...parsed,id:crypto.randomUUID()});setImportText('')}catch(e){setError(String(e))}}}>Import match</button>
    <p>First to two game wins wins the match. At round end, seven Gigs wins the final game; otherwise it is drawn. Most game wins then decides the match; equal wins is a draw. <a href="https://cyberpunktcg.com/beta-event-guide" target="_blank" rel="noreferrer">Official Beta event procedure</a></p>
  </details>
}
