import { useState } from 'react'
import type { Printing } from './printings'
import { getCollection, replaceCollection } from './collection'
import { parseBulkCounts } from './collectionEntry'
export function BulkCollectionEntry({printings,known}:{printings:Printing[];known:boolean}) {
  const [text,setText]=useState(''),[error,setError]=useState(''),[preview,setPreview]=useState<{before:Record<string,number>;after:Record<string,number>;updates:Record<string,number>}|null>(null)
  return <details className="panel"><summary>Bulk printing counts</summary><p>One printing-key,count per line. Counts replace only those printing rows; other inventory stays intact. Example: arasakademodeck/006,3</p>
    <textarea data-testid="bulk-count-input" value={text} onChange={e=>{setText(e.target.value);setPreview(null)}} />
    <button disabled={!known || !text.trim()} data-testid="bulk-count-preview" onClick={()=>{try{const updates=parseBulkCounts(text,printings),before={...getCollection().counts};setPreview({before,after:{...before,...updates},updates});setError('')}catch(e){setPreview(null);setError(String(e))}}}>Preview count changes</button>
    {preview && <div data-testid="bulk-count-changes">{Object.entries(preview.updates).map(([key,n])=><p key={key}>{key}: {preview.before[key]??0} → {n}</p>)}<button disabled={!known} data-testid="bulk-count-apply" onClick={()=>{try{if(JSON.stringify(getCollection().counts)!==JSON.stringify(preview.before))throw new Error('Inventory changed; preview again before applying.');replaceCollection({counts:preview.after},{kind:'Bulk counts'});setPreview(null);setText('');setError('')}catch(e){setError(String(e))}}}>Apply these counts</button></div>}
    {error && <p role="alert">{error}</p>}
  </details>
}
