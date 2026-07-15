/**
 * SQLite connection bootstrap (better-sqlite3 + drizzle).
 * Electron-free so vitest can exercise the full DB stack.
 */
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { runMigrations } from './migrations'

export interface DbHandle {
  sqlite: Database.Database
  db: BetterSQLite3Database
  close(): void
  /** Flush the WAL into the main database file (for backups). */
  checkpoint(): void
}

export function openDatabase(databaseFile: string): DbHandle {
  fs.mkdirSync(path.dirname(databaseFile), { recursive: true })
  const sqlite = new Database(databaseFile)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  sqlite.pragma('synchronous = NORMAL')
  runMigrations(sqlite)
  const db = drizzle(sqlite)
  return {
    sqlite,
    db,
    close: () => sqlite.close(),
    checkpoint: () => {
      sqlite.pragma('wal_checkpoint(TRUNCATE)')
    }
  }
}
