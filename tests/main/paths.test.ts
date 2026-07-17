import { describe, expect, it } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import {
  PathTraversalError,
  dataPaths,
  documentRelativeDir,
  ensureDataDirs,
  isInside,
  resolveInside
} from '../../src/main/storage/paths'

// resolve so the expected values carry the drive letter on Windows,
// matching what resolveInside/isInside produce via path.resolve
const base = path.resolve('/tmp/belegbar-data')

describe('resolveInside', () => {
  it('joins normal segments inside the base dir', () => {
    expect(resolveInside(base, 'documents', '2026', 'Q1', 'income', 'a.pdf')).toBe(
      path.join(base, 'documents', '2026', 'Q1', 'income', 'a.pdf')
    )
  })

  it('returns the base itself for zero segments', () => {
    expect(resolveInside(base)).toBe(path.resolve(base))
  })

  it('rejects .. traversal', () => {
    expect(() => resolveInside(base, '..', 'etc', 'passwd')).toThrow(PathTraversalError)
    expect(() => resolveInside(base, 'documents', '..', '..', 'x')).toThrow(
      PathTraversalError
    )
  })

  it('rejects traversal hidden inside a single segment', () => {
    expect(() => resolveInside(base, 'documents/../../outside.pdf')).toThrow(
      PathTraversalError
    )
  })

  it('rejects absolute segments', () => {
    expect(() => resolveInside(base, '/etc/passwd')).toThrow(PathTraversalError)
  })

  it('rejects NUL bytes', () => {
    expect(() => resolveInside(base, 'a\0b.pdf')).toThrow(PathTraversalError)
  })

  it('rejects sibling directories with a shared prefix', () => {
    // /tmp/belegbar-data-evil must not pass a startsWith check
    expect(() => resolveInside(base, '..', 'belegbar-data-evil', 'f.pdf')).toThrow(
      PathTraversalError
    )
  })

  it('uses a stable non-leaking error message', () => {
    try {
      resolveInside(base, '../secret')
      expect.unreachable()
    } catch (err) {
      expect((err as Error).message).toBe('path_traversal_rejected')
      expect((err as Error).message).not.toContain('secret')
    }
  })
})

describe('isInside', () => {
  it('accepts paths inside and the base itself', () => {
    expect(isInside(base, path.join(base, 'x'))).toBe(true)
    expect(isInside(base, base)).toBe(true)
  })
  it('rejects outside paths and prefix-sharing siblings', () => {
    expect(isInside(base, '/tmp/other')).toBe(false)
    expect(isInside(base, `${base}-evil/file`)).toBe(false)
  })
})

describe('documentRelativeDir', () => {
  it('uses year/quarter folders when known', () => {
    expect(documentRelativeDir(2026, 2, 'income')).toBe(
      path.join('documents', '2026', 'Q2', 'income')
    )
  })
  it('falls back to unassigned when the period is unknown', () => {
    expect(documentRelativeDir(null, null, 'expense')).toBe(
      path.join('documents', 'unassigned', 'expense')
    )
    expect(documentRelativeDir(2026, null, 'expense')).toBe(
      path.join('documents', 'unassigned', 'expense')
    )
  })
})

describe('ensureDataDirs', () => {
  it('creates the full skeleton', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'belegbar-test-'))
    try {
      const p = ensureDataDirs(dir)
      for (const sub of [
        p.database,
        p.documentsTmp,
        p.documentsTrash,
        p.thumbnails,
        p.exports,
        p.backups,
        p.logs,
        path.join(p.documents, 'unassigned', 'income'),
        path.join(p.documents, 'unassigned', 'expense')
      ]) {
        expect(fs.existsSync(sub)).toBe(true)
      }
      expect(dataPaths(dir).databaseFile.endsWith('belegbar.sqlite3')).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
