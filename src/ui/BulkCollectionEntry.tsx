import { useState } from 'react'
import type { Printing } from './printings'
import { getCollection, replaceCollection } from './collection'
import { parseBulkCounts } from './collectionEntry'
export function BulkCollectionEntry({printings,known}:{printings:Printing[];known:boolean}) {
  const [text,setText]=useState(''),[error,setError]=useState(''),[preview,setPreview]=useState<{before:Record<string,number>;after:Record<string,number>;updates:Record<string,number>}|null>(null)
  return <details className="tool-panel"><summary>Bulk printing counts</summary>
    <div className="tool-panel__body">
      <p className="tool-note">One printing-key,count per line. Counts replace only those printing rows; other inventory stays intact. Example: <code>arasakademodeck/006,3</code></p>
      <label className="field field--wide"><span className="field__label">Printing counts</span><textarea data-testid="bulk-count-input" placeholder="arasakademodeck/006,3" value={text} onChange={e=>{setText(e.target.value);setPreview(null)}} /></label>
      <div className="tool-actions"><button type="button" disabled={!known || !text.trim()} data-testid="bulk-count-preview" onClick={()=>{try{const updates=parseBulkCounts(text,printings),before={...getCollection().counts};setPreview({before,after:{...before,...updates},updates});setError('')}catch(e){setPreview(null);setError(String(e))}}}>Preview count changes</button></div>
      {preview && <div className="tool-preview" data-testid="bulk-count-changes">
        <div className="change-list">{Object.entries(preview.updates).map(([key,n])=><p key={key}><span>{key}</span><span>{preview.before[key]??0} → {n}</span></p>)}</div>
        <div className="tool-actions"><button type="button" className="btn--primary" disabled={!known} data-testid="bulk-count-apply" onClick={()=>{try{if(JSON.stringify(getCollection().counts)!==JSON.stringify(preview.before))throw new Error('Inventory changed; preview again before applying.');replaceCollection({counts:preview.after},{kind:'Bulk counts'});setPreview(null);setText('');setError('')}catch(e){setError(String(e))}}}>Apply these counts</button></div>
      </div>}
      {error && <p className="tool-error" role="alert">{error}</p>}
    </div>
  </details>
}
