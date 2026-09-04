// Stats strip + buy-list copy + backup (export/import) for the Collection
// tab. Exports download as files; import accepts pasted JSON or text (format
// sniffed by first non-whitespace character) with an explicit replace/merge
// choice. Import errors are shown but never write partial data — the Task 6
// import functions already guarantee all-or-nothing.

import { useMemo, useState, type ReactElement } from 'react'
import type { CardDb } from '../engine/types'
import type { Printing } from './printings'
import {
  useCollection,
  completionStats,
  buildBuyList,
  exportCollectionJson,
  exportCollectionText,
  importCollectionJson,
  importCollectionText,
} from './collection'

/**
 * This is the player's ONLY backup path for what can be hours of manual
 * entry, so the two easy ways to lose the file are both closed here:
 * the anchor is appended to the document before `.click()` (a detached
 * anchor's click is ignored outright by Firefox and by some Safari
 * versions), and the Blob URL is revoked on a later tick rather than
 * synchronously — revoking it in the same task can invalidate the URL
 * before the browser has finished starting the download.
 */
function download(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function CollectionHeader({ db, printings }: { db: CardDb; printings: Printing[] }): ReactElement {
  const collection = useCollection()
  const stats = useMemo(
    () => completionStats(db, printings, collection),
    [db, printings, collection]
  )
  const [importText, setImportText] = useState('')
  const [mode, setMode] = useState<'replace' | 'merge'>('replace')
  const [error, setError] = useState('')
  const [copyError, setCopyError] = useState('')

  function runImport(): void {
    try {
      if (importText.trimStart().startsWith('{')) importCollectionJson(importText, mode)
      else importCollectionText(importText, mode)
      setImportText('')
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="collection-header">
      <span data-testid="collection-stats">
        Playset {stats.playsetPct}% · Arts {stats.artsPct}% · {stats.totalOwned} cards owned
      </span>
      <button
        type="button"
        data-testid="copy-buylist"
        onClick={() =>
          navigator.clipboard
            .writeText(buildBuyList(db, printings, collection, { playset: true, arts: true }))
            .then(() => setCopyError(''))
            .catch((err: unknown) =>
              setCopyError(`Could not copy to clipboard: ${err instanceof Error ? err.message : String(err)}`)
            )
        }
      >
        Copy buy-list
      </button>
      {copyError !== '' && (
        <div data-testid="copy-error" className="collection-header__error">
          {copyError}
        </div>
      )}
      <button
        type="button"
        data-testid="export-json"
        onClick={() => download('collection.json', exportCollectionJson(collection))}
      >
        Export JSON
      </button>
      <button
        type="button"
        data-testid="export-text"
        onClick={() => download('collection.txt', exportCollectionText(db, printings, collection))}
      >
        Export text
      </button>
      <details className="collection-header__import" data-testid="import-panel">
        <summary>Import</summary>
        <textarea
          data-testid="import-input"
          value={importText}
          placeholder="Paste a collection JSON or text export…"
          onChange={(event) => setImportText(event.target.value)}
        />
        <label>
          <input
            type="radio"
            name="import-mode"
            data-testid="import-mode-replace"
            checked={mode === 'replace'}
            onChange={() => setMode('replace')}
          />
          Replace
        </label>
        <label>
          <input
            type="radio"
            name="import-mode"
            data-testid="import-mode-merge"
            checked={mode === 'merge'}
            onChange={() => setMode('merge')}
          />
          Merge (add counts)
        </label>
        <button
          type="button"
          data-testid="import-submit"
          disabled={importText.trim() === ''}
          onClick={runImport}
        >
          Import
        </button>
        {error !== '' && (
          <div data-testid="import-error" className="collection-header__error">
            {error}
          </div>
        )}
      </details>
    </div>
  )
}
