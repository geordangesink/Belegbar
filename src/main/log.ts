/**
 * Minimal rotating file logger for the main process.
 *
 * PRIVACY: never log extracted financial values or personal fields.
 * Callers pass stable codes, ids and stage names only.
 */
import fs from 'node:fs'
import path from 'node:path'

const MAX_LOG_SIZE = 1024 * 1024 // 1 MB
const KEEP_FILES = 3 // main.log + .1 + .2

export type LogMeta = Record<string, string | number | boolean | null | undefined>

export interface Logger {
  info(message: string, meta?: LogMeta): void
  warn(message: string, meta?: LogMeta): void
  error(message: string, meta?: LogMeta): void
}

function formatMeta(meta?: LogMeta): string {
  if (!meta) return ''
  const parts: string[] = []
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined) continue
    parts.push(`${key}=${JSON.stringify(value)}`)
  }
  return parts.length > 0 ? ' ' + parts.join(' ') : ''
}

export function createLogger(logDir: string): Logger {
  const logFile = path.join(logDir, 'main.log')

  function rotateIfNeeded(): void {
    try {
      const stat = fs.statSync(logFile, { throwIfNoEntry: false })
      if (!stat || stat.size < MAX_LOG_SIZE) return
      for (let i = KEEP_FILES - 1; i >= 1; i--) {
        const from = i === 1 ? logFile : `${logFile}.${i - 1}`
        const to = `${logFile}.${i}`
        if (fs.existsSync(to)) fs.rmSync(to, { force: true })
        if (fs.existsSync(from)) fs.renameSync(from, to)
      }
    } catch {
      // logging must never crash the app
    }
  }

  function write(level: string, message: string, meta?: LogMeta): void {
    try {
      fs.mkdirSync(logDir, { recursive: true })
      rotateIfNeeded()
      const line = `${new Date().toISOString()} ${level} ${message}${formatMeta(meta)}\n`
      fs.appendFileSync(logFile, line, 'utf8')
    } catch {
      // swallow — a broken disk must not take down the app
    }
  }

  return {
    info: (m, meta) => write('INFO', m, meta),
    warn: (m, meta) => write('WARN', m, meta),
    error: (m, meta) => write('ERROR', m, meta)
  }
}

/** No-op logger for tests. */
export const nullLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
}
