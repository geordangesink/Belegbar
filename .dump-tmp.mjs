/**
 * Dump production-identical extraction text for every example PDF by driving
 * the app's real extraction worker (pdfjs + OCR path) via worker_threads.
 */
import { Worker } from 'node:worker_threads'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = '/Users/geordangesink/Documents/Projects/Belegbar'
const OUT = '/private/tmp/claude-501/-Users-geordangesink-Documents-Projects-Belegbar/67cef649-d2c5-4e8c-b3ef-a66df06041ff/scratchpad/fixture-texts-pdfjs'
fs.mkdirSync(OUT, { recursive: true })

const workerPath = path.join(ROOT, 'out', 'main', 'extraction-worker.js')

function runJob(worker, job) {
  return new Promise((resolve, reject) => {
    const onMessage = (msg) => {
      if (msg.type === 'progress') return
      worker.off('message', onMessage)
      if (msg.type === 'error') reject(new Error(msg.error ?? 'worker error'))
      else resolve(msg)
    }
    worker.on('message', onMessage)
    worker.postMessage(job)
  })
}

const worker = new Worker(workerPath, {
  workerData: { tessdataDir: path.join(ROOT, 'resources', 'tessdata') }
})
worker.on('error', (e) => {
  console.error('worker crashed:', e)
  process.exit(1)
})
await new Promise((r) => setTimeout(r, 300))

let jobId = 0
let dumped = 0
for (const sub of ['income', 'expense']) {
  const dir = path.join(ROOT, 'example', sub)
  for (const fn of fs.readdirSync(dir).sort()) {
    if (!fn.toLowerCase().endsWith('.pdf')) continue
    const buf = fs.readFileSync(path.join(dir, fn))
    try {
      const res = await runJob(worker, {
        id: ++jobId,
        type: 'validate_text',
        pdf: buf
      })
      const pages = res.pages ?? res.pageTexts ?? []
      let texts = pages.map((p) => (typeof p === 'string' ? p : (p.text ?? '')))
      // OCR pages with too little native text, exactly like the pipeline
      const needsOcr = texts
        .map((t, i) => ({ t, i }))
        .filter(({ t }) => t.trim().length < 30)
        .map(({ i }) => i)
      if (needsOcr.length > 0) {
        const ocr = await runJob(worker, {
          id: ++jobId,
          type: 'ocr',
          pdf: buf,
          pages: needsOcr
        })
        const ocrPages = ocr.pages ?? []
        for (const p of ocrPages) {
          const idx = p.page ?? p.index
          if (typeof idx === 'number') texts[idx] = p.text ?? texts[idx]
        }
      }
      const full = texts.join('\n\n=== PAGE BREAK ===\n\n')
      if (full.trim().length < 30) {
        console.log('SKIP (no text):', sub, fn)
        continue
      }
      fs.writeFileSync(path.join(OUT, `${sub}__${fn.replace(/\.pdf$/i, '')}.txt`), full)
      dumped++
    } catch (e) {
      console.log('ERROR:', sub, fn, String(e).slice(0, 120))
    }
  }
}
console.log('dumped', dumped, 'files to', OUT)
await worker.terminate()
