import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Guards engine purity: nothing under these directories may depend on React
// or the UI layer, so the simulation core stays usable headlessly (CLI sims,
// AI training, tests) without pulling in a DOM/render dependency.
const PURE_DIRS = ['src/engine', 'src/cards', 'src/ai', 'src/sim']
const FORBIDDEN_IMPORT = /from\s+['"](react|react-dom)(\/|['"])|from\s+['"].*\/ui\//

function listFilesRecursively(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(fullPath))
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(fullPath)
    }
  }
  return files
}

describe('engine purity', () => {
  const repoRoot = path.resolve(__dirname, '..', '..')

  for (const dir of PURE_DIRS) {
    const absDir = path.join(repoRoot, dir)
    const files = listFilesRecursively(absDir)

    it(`${dir} has no files importing react/react-dom/ui (${files.length} file(s) checked)`, () => {
      const offenders: string[] = []
      for (const file of files) {
        const contents = fs.readFileSync(file, 'utf-8')
        if (FORBIDDEN_IMPORT.test(contents)) {
          offenders.push(file)
        }
      }
      expect(offenders).toEqual([])
    })
  }

  it('checked at least one directory that currently exists', () => {
    const anyExists = PURE_DIRS.some((dir) => fs.existsSync(path.join(repoRoot, dir)))
    expect(anyExists).toBe(true)
  })
})
