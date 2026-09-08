import { z } from 'zod'
const PREFIX='ctcg:collectionChange:v1:'
export interface ChangeMetadata { kind?: string; date?: string; source?: string; cost?: string; relatedId?: string }
const count=z.number().int().nonnegative()
const entrySchema=z.object({id:z.string(),createdAt:z.string(),kind:z.string(),date:z.string().optional(),source:z.string().optional(),cost:z.string().optional(),relatedId:z.string().optional(),changes:z.record(z.string(),z.object({before:count,after:count}))})
export type CollectionChange=z.infer<typeof entrySchema>
const memory=new Map<string,CollectionChange>()
export function collectionChanges(before:Record<string,number>,after:Record<string,number>):CollectionChange['changes'] {
  const changes:CollectionChange['changes']={}
  for(const key of new Set([...Object.keys(before),...Object.keys(after)]))if((before[key]??0)!==(after[key]??0))changes[key]={before:before[key]??0,after:after[key]??0}
  return changes
}
/** Save intent before inventory mutation; a failed browser write retains the journal in memory. */
export function recordCollectionChange(before:Record<string,number>,after:Record<string,number>,meta:ChangeMetadata={}):void {
  const changes=collectionChanges(before,after)
  if(!Object.keys(changes).length)return
  const entry:CollectionChange={...meta,kind:meta.kind??'Count edit',id:crypto.randomUUID(),createdAt:new Date().toISOString(),changes}
  memory.set(entry.id,entry)
  flushJournal()
}
function flushJournal():void {
  for(const [id,entry] of memory)try{localStorage.setItem(PREFIX+id,JSON.stringify(entry));memory.delete(id)}catch{break}
}
export function readCollectionJournal():{entries:CollectionChange[];warning:string} {
  const entries=new Map(memory),warnings:string[]=[]
  if(memory.size)warnings.push(`${memory.size} history entries are held only in memory. Export history before closing this tab.`)
  try{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key?.startsWith(PREFIX))continue;try{const entry=entrySchema.parse(JSON.parse(localStorage.getItem(key)!));entries.set(entry.id,entry)}catch{warnings.push('An unreadable history entry was left untouched.')}}}catch{warnings.push('Browser history could not be read.')}
  return {entries:[...entries.values()].reverse().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),warning:[...new Set(warnings)].join(' ')}
}
/** Reverse/reapply affected rows only; never overwrite unrelated later acquisitions. */
export function restoreJournalChange(current:Record<string,number>,entry:CollectionChange,direction:'undo'|'reapply'):Record<string,number> {
  const next={...current},from=direction==='undo'?'after':'before',to=direction==='undo'?'before':'after'
  for(const [key,change] of Object.entries(entry.changes)){
    if((current[key]??0)!==change[from])throw new Error(`${key} changed since this entry. Review its history before undoing or reapplying.`)
    if(change[to]===0)delete next[key];else next[key]=change[to]
  }
  return next
}
export function importCollectionJournal(text:string):number {
  const backup=z.object({version:z.literal(1),entries:z.array(entrySchema)}).parse(JSON.parse(text))
  const existing=new Map(readCollectionJournal().entries.map(e=>[e.id,e]))
  for(const entry of backup.entries){const prior=existing.get(entry.id);if(prior && JSON.stringify(prior)===JSON.stringify(entry))continue;const copy=prior?{...entry,id:crypto.randomUUID()}:entry;memory.set(copy.id,copy)}
  flushJournal();return backup.entries.length
}
export function resetJournalMemoryForTests():void {memory.clear()}
