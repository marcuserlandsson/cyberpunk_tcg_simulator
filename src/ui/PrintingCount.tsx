import { useEffect,useState } from 'react'
import { setCount } from './collection'
export function PrintingCount({printingKey,count,known}:{printingKey:string;count:number;known:boolean}) {
  const [text,setText]=useState(String(count)),[error,setError]=useState('')
  useEffect(()=>setText(String(count)),[count])
  function commit() {
    const n=Number(text)
    if(!text.trim() || !Number.isSafeInteger(n) || n<0){setError('Use a non-negative whole number.');return}
    try { if(n!==count)setCount(printingKey,n);setError('') } catch(e){setError(String(e))}
  }
  return <span><input className="printing-count" aria-label={`Owned ${printingKey}`} data-testid={`printing-count-${printingKey}`} type="number" min={0} step={1} disabled={!known} value={known?text:''} placeholder="?" onChange={e=>setText(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}} />{error && <small role="alert">{error}</small>}</span>
}
