import { useState } from 'react'
import { z } from 'zod'
import type { Printing } from './printings'
import type { DeckList } from '../engine/deck'
import { getCollection,replaceCollection,useCollection } from './collection'
import { collectionChanges,readCollectionJournal,restoreJournalChange,importCollectionJournal } from './collectionJournal'
import { sessionCounts,starterEntry } from './sessionCounts'
import arasaka from '../../data/decks/arasaka-embracing-power.json'
import mercs from '../../data/decks/mercs-the-heist.json'
const DRAFT_KEY='ctcg:collectionSession:v1'
const draftSchema=z.object({text:z.string(),date:z.string(),source:z.string(),cost:z.string(),kind:z.string()})
type Draft=z.infer<typeof draftSchema>
function readDraft():Draft {try{const result=draftSchema.safeParse(JSON.parse(localStorage.getItem(DRAFT_KEY)??'null'));if(result.success)return result.data}catch{}return {text:'',date:new Date().toISOString().slice(0,10),source:'',cost:'',kind:'Acquisition'}}
function download(text:string){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type:'application/json'}));a.href=url;a.download='collection-history.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),0)}
export function CollectionSessions({printings,known}:{printings:Printing[];known:boolean}) {
  const collection=useCollection(),[draft,setDraft]=useState(readDraft),[error,setError]=useState(''),[revision,setRevision]=useState(0),[historyText,setHistoryText]=useState('')
  const [preview,setPreview]=useState<{before:Record<string,number>;after:Record<string,number>}|null>(null)
  const journal=readCollectionJournal()
  function update(patch:Partial<Draft>){const next={...draft,...patch};setDraft(next);setPreview(null);try{localStorage.setItem(DRAFT_KEY,JSON.stringify(next));setError('')}catch{setError('Session draft is held in memory. Copy its text before closing this tab.')}}
  return <details className="panel" data-testid="collection-sessions"><summary>Acquisition / trade sessions and history</summary>
    <p>Stage signed changes (+ acquired, − traded away), then review and apply together. Drafts and history save in this browser; inventory also saves to the collection file. Export history to back up session metadata.</p>
    <label>Session type<select value={draft.kind} onChange={e=>update({kind:e.target.value})}><option>Acquisition</option><option>Trade</option><option>Correction</option></select></label>
    <label>Date<input type="date" data-testid="session-date" value={draft.date} onChange={e=>update({date:e.target.value})} /></label>
    <label>Source / notes<input data-testid="session-source" value={draft.source} onChange={e=>update({source:e.target.value})} /></label>
    <label>Total cost (optional, include currency)<input data-testid="session-cost" value={draft.cost} placeholder="e.g. 200 SEK" onChange={e=>update({cost:e.target.value})} /></label>
    <textarea data-testid="session-input" value={draft.text} placeholder="arasakademodeck/006,+3" onChange={e=>update({text:e.target.value})} />
    <div>{([[arasaka,'arasakademodeck'],[mercs,'mercdemodeck']] as const).map(([deck,set])=><button key={set} onClick={()=>{try{update({text:[draft.text,starterEntry(deck as unknown as DeckList,set,printings)].filter(Boolean).join('\n'),source:draft.source||deck.name})}catch(e){setError(String(e))}}}>Add bundled demo starter: {deck.name}</button>)}</div>
    <small>These are the bundled demo lists, not an assumed Beta or retail box manifest. Review the quantities against what you acquired.</small>
    <button disabled={!known || !draft.text.trim()} data-testid="session-preview" onClick={()=>{try{const before={...getCollection().counts};setPreview({before,after:sessionCounts(draft.text,printings,before)});setError('')}catch(e){setError(String(e))}}}>Preview session</button>
    {preview && <div data-testid="session-changes">{Object.entries(collectionChanges(preview.before,preview.after)).map(([key,c])=><p key={key}>{key}: {c.before} → {c.after}</p>)}<button disabled={!known} data-testid="session-apply" onClick={()=>{try{if(JSON.stringify(getCollection().counts)!==JSON.stringify(preview.before))throw new Error('Inventory changed; preview the session again.');replaceCollection({counts:preview.after},{kind:draft.kind,date:draft.date,source:draft.source,cost:draft.cost});update({text:''});setPreview(null)}catch(e){setError(String(e))}}}>Apply reviewed session</button></div>}
    {error && <p role="alert" data-testid="session-error">{error}</p>}
    {journal.warning && <p role="alert">{journal.warning}</p>}
    <details data-testid="collection-history"><summary>Change history ({journal.entries.length})</summary>
      <button onClick={()=>download(JSON.stringify({version:1,counts:collection.counts,entries:journal.entries},null,2))}>Export inventory and history JSON</button>
      <label>Restore history metadata<textarea value={historyText} onChange={e=>setHistoryText(e.target.value)} /></label><button disabled={!historyText.trim()} onClick={()=>{try{importCollectionJournal(historyText);setHistoryText('');setRevision(revision+1)}catch(e){setError(String(e))}}}>Import history entries</button><p>Restoring history does not change inventory. Use the collection import preview to restore the backup’s counts.</p>
      {journal.entries.slice(0,100).map(entry=><details key={entry.id} data-testid="collection-history-entry"><summary>{entry.kind} · {entry.date||entry.createdAt} · {entry.source} · {Object.keys(entry.changes).length} printing rows</summary><p>{entry.cost && 'Total cost: '+entry.cost}</p>{Object.entries(entry.changes).map(([key,c])=><p key={key}>{key}: {c.before} → {c.after}</p>)}{(['undo','reapply'] as const).map(direction=><button key={direction} data-testid={'history-'+direction} disabled={!known} onClick={()=>{try{const counts=restoreJournalChange(getCollection().counts,entry,direction);replaceCollection({counts},{kind:direction==='undo'?'Undo':'Reapply',relatedId:entry.id,source:entry.source});setError('')}catch(e){setError(String(e))}}}>{direction==='undo'?'Undo this change':'Reapply this change'}</button>)}</details>)}
      {journal.entries.length>100 && <p>Showing the latest 100 entries; the export includes all history.</p>}
    </details>
  </details>
}

