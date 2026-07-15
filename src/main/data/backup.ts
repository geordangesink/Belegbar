/**
 * Backup + restore. A backup zip contains:
 *   database/belegbar.sqlite3  (WAL checkpointed first)
 *   documents/**                 (all stored PDFs incl. trash)
 *   manifest.json                (versions + timestamp)
 * Settings and the audit trail live inside the database file.
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { PARSER_VERSION } from '@core/parsing/parse-invoice'
import { VAT_ENGINE_VERSION } from '@core/vat/classify'
import type { BackupResult } from '@shared/api'
import { openDatabase, type DbHandle } from '../db/connection'
import { CURRENT_SCHEMA_VERSION } from '../db/migrations'
import { createRepositories } from '../db/repository'
import { dataPaths, ensureDataDirs } from '../storage/paths'
import type { Logger } from '../log'

export interface BackupManifest {
  app: 'belegbar'
  appVersion: string
  schemaVersion: number
  taxEngineVersions: { vatEngine: string; parser: string }
  createdAt: string
}

function timestamp(): string {
  const d = new Date()
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(
    d.getMinutes()
  )}${p(d.getSeconds())}`
}

export async function createBackup(deps: {
  dataDir: string
  dbHandle: DbHandle
  appVersion: string
  log: Logger
}): Promise<BackupResult> {
  const paths = dataPaths(deps.dataDir)
  try {
    deps.dbHandle.checkpoint()
    const zip = new AdmZip()
    zip.addLocalFile(paths.databaseFile, 'database')
    if (fs.existsSync(paths.documents)) {
      zip.addLocalFolder(paths.documents, 'documents')
    }
    const manifest: BackupManifest = {
      app: 'belegbar',
      appVersion: deps.appVersion,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      taxEngineVersions: { vatEngine: VAT_ENGINE_VERSION, parser: PARSER_VERSION },
      createdAt: new Date().toISOString()
    }
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'))
    const outPath = path.join(paths.backups, `belegbar-backup-${timestamp()}.zip`)
    await fsp.mkdir(paths.backups, { recursive: true })
    zip.writeZip(outPath)
    deps.log.info('backup_created')
    return { ok: true, path: outPath }
  } catch (err) {
    deps.log.error('backup_failed', {
      code: (err as NodeJS.ErrnoException).code ?? null
    })
    return { ok: false, errorKey: 'backup_failed' }
  }
}

/**
 * Validate + swap in a backup. The current database/documents are moved to
 * backups/pre-restore-<ts>/ first — nothing is destroyed. The caller must
 * close the live DB handle BEFORE calling this and relaunch the app after.
 */
export async function restoreBackup(deps: {
  dataDir: string
  zipPath: string
  log: Logger
}): Promise<BackupResult> {
  const paths = dataPaths(deps.dataDir)
  const extractDir = path.join(paths.backups, `.restore-tmp-${timestamp()}`)
  try {
    const zip = new AdmZip(deps.zipPath)
    zip.extractAllTo(extractDir, true)

    // validate manifest
    const manifestPath = path.join(extractDir, 'manifest.json')
    const manifestRaw = await fsp.readFile(manifestPath, 'utf8').catch(() => null)
    if (!manifestRaw) return { ok: false, errorKey: 'backup_invalid' }
    let manifest: BackupManifest
    try {
      manifest = JSON.parse(manifestRaw) as BackupManifest
    } catch {
      return { ok: false, errorKey: 'backup_invalid' }
    }
    if (manifest.app !== 'belegbar') return { ok: false, errorKey: 'backup_invalid' }
    if (manifest.schemaVersion > CURRENT_SCHEMA_VERSION) {
      return { ok: false, errorKey: 'backup_newer_schema' }
    }

    // validate database opens + passes a quick integrity check
    const restoredDbFile = path.join(extractDir, 'database', 'belegbar.sqlite3')
    if (!fs.existsSync(restoredDbFile)) return { ok: false, errorKey: 'backup_invalid' }
    try {
      const probe = openDatabase(restoredDbFile)
      const check = probe.sqlite.pragma('quick_check', { simple: true })
      probe.close()
      if (check !== 'ok') return { ok: false, errorKey: 'backup_invalid' }
    } catch {
      return { ok: false, errorKey: 'backup_invalid' }
    }

    // validate documents dir (may be legitimately absent for an empty app)
    const restoredDocs = path.join(extractDir, 'documents')
    if (!fs.existsSync(restoredDocs)) {
      await fsp.mkdir(restoredDocs, { recursive: true })
    }

    // move current data aside — never delete
    const preRestoreDir = path.join(paths.backups, `pre-restore-${timestamp()}`)
    await fsp.mkdir(preRestoreDir, { recursive: true })
    for (const dir of [paths.database, paths.documents, paths.thumbnails]) {
      if (fs.existsSync(dir)) {
        await fsp.rename(dir, path.join(preRestoreDir, path.basename(dir)))
      }
    }

    // swap in
    await fsp.rename(path.join(extractDir, 'database'), paths.database)
    await fsp.rename(restoredDocs, paths.documents)
    ensureDataDirs(deps.dataDir)
    await fsp.rm(extractDir, { recursive: true, force: true })

    // audit the restore inside the restored database
    try {
      const restored = openDatabase(paths.databaseFile)
      createRepositories(restored.db).audit.append({
        documentId: null,
        eventType: 'restore',
        nextValue: { backupCreatedAt: manifest.createdAt, appVersion: manifest.appVersion },
        source: 'user'
      })
      restored.close()
    } catch {
      deps.log.warn('restore_audit_failed')
    }

    deps.log.info('backup_restored')
    return { ok: true, path: deps.zipPath }
  } catch (err) {
    deps.log.error('restore_failed', {
      code: (err as NodeJS.ErrnoException).code ?? null
    })
    await fsp.rm(extractDir, { recursive: true, force: true }).catch(() => undefined)
    return { ok: false, errorKey: 'restore_failed' }
  }
}
