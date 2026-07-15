/**
 * Electron main-process bootstrap.
 * All services are electron-free and receive dataDir/db via injection;
 * only this file, ipc/handlers.ts and dialog/shell call sites touch electron.
 */
import { app, BrowserWindow, session, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { IPC } from '@shared/ipc'
import { createLogger, type Logger } from './log'
import { ensureDataDirs, dataPaths } from './storage/paths'
import { openDatabase, type DbHandle } from './db/connection'
import { createRepositories, type Repositories } from './db/repository'
import { ExtractionService } from './extraction/service'
import { ImportPipeline } from './import/pipeline'
import { DocumentService } from './documents/service'
import { EcbExchangeRateProvider } from './rates/ecb'
import { registerIpcHandlers } from './ipc/handlers'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// single instance
// ---------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null
let dbHandle: DbHandle | null = null
let extraction: ExtractionService | null = null
let log: Logger | null = null

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

// ---------------------------------------------------------------------------
// data dir + services
// ---------------------------------------------------------------------------

function resolveDataDir(): string {
  const override = process.env['STEUERFACH_DATA_DIR']
  if (override && override.trim() !== '') return path.resolve(override)
  return app.getPath('userData')
}

function resolveTessdataDir(): string {
  if (app.isPackaged) {
    // resources/** is asarUnpacked (electron-builder.yml)
    return path
      .join(app.getAppPath(), 'resources', 'tessdata')
      .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
  }
  return path.join(app.getAppPath(), 'resources', 'tessdata')
}

interface Boot {
  dataDir: string
  dbHandle: DbHandle
  repos: Repositories
  extraction: ExtractionService
  pipeline: ImportPipeline
  documents: DocumentService
  log: Logger
}

function bootServices(): Boot {
  const dataDir = resolveDataDir()
  const paths = ensureDataDirs(dataDir)
  const logger = createLogger(paths.logs)
  log = logger
  logger.info('boot', { version: app.getVersion() })

  const handle = openDatabase(paths.databaseFile)
  dbHandle = handle
  const repos = createRepositories(handle.db)

  const extractionService = new ExtractionService({
    workerPath: path.join(__dirname, 'extraction-worker.js'),
    tessdataDir: resolveTessdataDir(),
    tessCachePath: path.join(paths.logs, '.tess'),
    ocrCache: repos.ocrCache,
    log: logger
  })
  extraction = extractionService

  const ratesProvider = new EcbExchangeRateProvider({
    onRateFetched: (rate) => {
      try {
        repos.exchangeRates.save(rate)
      } catch {
        logger.warn('rate_cache_write_failed')
      }
    }
  })

  const pipeline = new ImportPipeline({
    dataDir,
    repos,
    extraction: extractionService,
    ratesProvider,
    emit: (progress) => {
      mainWindow?.webContents.send(IPC.importProgress, progress)
    },
    log: logger
  })

  const documents = new DocumentService({ dataDir, repos, log: logger })

  return {
    dataDir,
    dbHandle: handle,
    repos,
    extraction: extractionService,
    pipeline,
    documents,
    log: logger
  }
}

// ---------------------------------------------------------------------------
// window + web security
// ---------------------------------------------------------------------------

function installWebSecurity(): void {
  const ses = session.defaultSession

  // deny every permission request (camera, geolocation, notifications, …)
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)

  // defense-in-depth CSP (renderer HTML also carries a meta CSP)
  const isDev = !app.isPackaged
  const csp = [
    "default-src 'self'",
    // vite dev server injects inline styles; react needs none in prod but
    // keeping style inline allowed is standard for bundled CSS-in-JS
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data:`,
    `worker-src 'self' blob:`,
    `font-src 'self' data:`,
    isDev
      ? `script-src 'self' 'unsafe-inline'`
      : `script-src 'self'`,
    isDev
      ? `connect-src 'self' blob: data: ws: http://localhost:* http://127.0.0.1:*`
      : `connect-src 'self' blob: data:`,
    "object-src 'none'",
    "base-uri 'self'"
  ].join('; ')

  ses.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    })
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // never navigate away, never open new windows from web content
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && url.startsWith(devUrl)) return
    event.preventDefault()
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // external http(s) links open in the system browser, everything denied
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  try {
    const boot = bootServices()
    installWebSecurity()

    registerIpcHandlers({
      dataDir: boot.dataDir,
      dbHandle: boot.dbHandle,
      repos: boot.repos,
      pipeline: boot.pipeline,
      documents: boot.documents,
      log: boot.log,
      getWindow: () => mainWindow,
      prepareForRestore: async () => {
        await boot.extraction.dispose().catch(() => undefined)
        boot.dbHandle.checkpoint()
        boot.dbHandle.close()
        dbHandle = null
      }
    })

    await boot.pipeline.recoverOnBoot()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  } catch (err) {
    log?.error('boot_failed', {
      name: err instanceof Error ? err.name : typeof err
    })
    app.exit(1)
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void extraction?.dispose().catch(() => undefined)
  try {
    dbHandle?.checkpoint()
    dbHandle?.close()
    dbHandle = null
  } catch {
    // already closed
  }
  log?.info('shutdown')
})
