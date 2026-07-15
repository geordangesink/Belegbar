/**
 * Data-directory layout + safe path resolution.
 *
 * Every path handed to fs operations MUST be produced by resolveInside()
 * so that no combination of user-controlled filename components can escape
 * the application data directory.
 */
import path from 'node:path'
import fs from 'node:fs'
import type { DocumentDirection } from '../../shared/domain'

export class PathTraversalError extends Error {
  constructor(attempted: string) {
    super('path_traversal_rejected')
    this.name = 'PathTraversalError'
    // do not include the attempted path in the message (it may be logged);
    // keep it on a field for debugging in-process only
    Object.defineProperty(this, 'attempted', { value: attempted, enumerable: false })
  }
}

/**
 * Join segments onto a base directory and guarantee the result stays inside.
 * Rejects absolute segments, `..` traversal and NUL bytes.
 */
export function resolveInside(baseDir: string, ...segments: string[]): string {
  const base = path.resolve(baseDir)
  for (const segment of segments) {
    if (segment.includes('\0')) throw new PathTraversalError(segment)
    if (path.isAbsolute(segment)) throw new PathTraversalError(segment)
  }
  const resolved = path.resolve(base, ...segments)
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new PathTraversalError(segments.join('/'))
  }
  return resolved
}

/** True when `candidate` lies inside (or equals) `baseDir`. */
export function isInside(baseDir: string, candidate: string): boolean {
  const base = path.resolve(baseDir)
  const resolved = path.resolve(candidate)
  return resolved === base || resolved.startsWith(base + path.sep)
}

export interface DataPaths {
  root: string
  database: string
  databaseFile: string
  documents: string
  documentsTmp: string
  documentsTrash: string
  thumbnails: string
  exports: string
  backups: string
  logs: string
}

export function dataPaths(dataDir: string): DataPaths {
  const root = path.resolve(dataDir)
  return {
    root,
    database: path.join(root, 'database'),
    databaseFile: path.join(root, 'database', 'steuerfach.sqlite3'),
    documents: path.join(root, 'documents'),
    documentsTmp: path.join(root, 'documents', '.tmp'),
    documentsTrash: path.join(root, 'documents', '.trash'),
    thumbnails: path.join(root, 'thumbnails'),
    exports: path.join(root, 'exports'),
    backups: path.join(root, 'backups'),
    logs: path.join(root, 'logs')
  }
}

/**
 * Relative (to data dir) storage folder for a document:
 * documents/YYYY/Qn/{income,expense} or documents/unassigned/{income,expense}.
 */
export function documentRelativeDir(
  year: number | null,
  quarter: 1 | 2 | 3 | 4 | null,
  direction: DocumentDirection
): string {
  if (year !== null && quarter !== null) {
    return path.join('documents', String(year), `Q${quarter}`, direction)
  }
  return path.join('documents', 'unassigned', direction)
}

/** Create the full on-disk directory skeleton (idempotent). */
export function ensureDataDirs(dataDir: string): DataPaths {
  const p = dataPaths(dataDir)
  const dirs = [
    p.root,
    p.database,
    p.documents,
    p.documentsTmp,
    p.documentsTrash,
    path.join(p.documents, 'unassigned', 'income'),
    path.join(p.documents, 'unassigned', 'expense'),
    p.thumbnails,
    p.exports,
    p.backups,
    p.logs
  ]
  for (const dir of dirs) fs.mkdirSync(dir, { recursive: true })
  return p
}
