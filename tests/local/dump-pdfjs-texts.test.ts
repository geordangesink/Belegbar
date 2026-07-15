/**
 * Dev utility, not a real test: dumps production-identical extraction text
 * (pdfjs + OCR, via the real ExtractionService + worker) for every example
 * PDF, so parser work is tuned on exactly what the app sees at runtime.
 *
 * Opt-in:
 *   BELEGBAR_DUMP_PDFJS_TO=<outDir> BELEGBAR_EXAMPLES=<exampleDir> \
 *     npx vitest run tests/local/dump-pdfjs-texts.test.ts
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { openDatabase } from '../../src/main/db/connection'
import { createRepositories } from '../../src/main/db/repository'
import { ExtractionService } from '../../src/main/extraction/service'

const OUT = process.env['BELEGBAR_DUMP_PDFJS_TO']
const EXAMPLES =
  process.env['BELEGBAR_EXAMPLES'] ?? path.resolve(__dirname, '..', '..', 'example')

describe.skipIf(!OUT || !fs.existsSync(EXAMPLES))('dump pdfjs texts', () => {
  it('dumps extraction text for every example PDF', { timeout: 600_000 }, async () => {
    const root = path.resolve(__dirname, '..', '..')
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'belegbar-dump-'))
    const handle = openDatabase(path.join(tmp, 'dump.sqlite3'))
    const repos = createRepositories(handle.db)
    const service = new ExtractionService({
      workerPath: path.join(root, 'out', 'main', 'extraction-worker.js'),
      tessdataDir: path.join(root, 'resources', 'tessdata'),
      tessCachePath: path.join(tmp, '.tess'),
      ocrCache: repos.ocrCache,
      log: { info: () => {}, warn: () => {}, error: () => {} } as never
    })

    fs.mkdirSync(OUT!, { recursive: true })
    let dumped = 0
    for (const sub of ['income', 'expense']) {
      const dir = path.join(EXAMPLES, sub)
      if (!fs.existsSync(dir)) continue
      for (const fn of fs.readdirSync(dir).sort()) {
        if (!fn.toLowerCase().endsWith('.pdf')) continue
        const abs = path.join(dir, fn)
        const sha = crypto
          .createHash('sha256')
          .update(fs.readFileSync(abs))
          .digest('hex')
        try {
          const res = await service.extractDocumentText(abs, sha)
          if (res.fullText.trim().length < 30) {
            console.log('SKIP (no text):', sub, fn)
            continue
          }
          fs.writeFileSync(
            path.join(OUT!, `${sub}__${fn.replace(/\.pdf$/i, '')}.txt`),
            res.fullText
          )
          dumped++
        } catch (err) {
          console.log('ERROR:', sub, fn, String(err).slice(0, 120))
        }
      }
    }
    console.log(`dumped ${dumped} files to ${OUT}`)
    await service.dispose?.()
    handle.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  })
})
