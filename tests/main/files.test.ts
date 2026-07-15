import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import {
  atomicMove,
  copyAndVerify,
  hasPdfMagic,
  moveToTrash,
  sha256File
} from '../../src/main/storage/files'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'belegbar-files-'))
})

afterEach(() => {
  // restore permissions so cleanup succeeds
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isDirectory()) {
      try {
        fs.chmodSync(path.join(entry.parentPath, entry.name), 0o755)
      } catch {
        // ignore
      }
    }
  }
  fs.rmSync(dir, { recursive: true, force: true })
})

function write(name: string, content: string | Buffer): string {
  const p = path.join(dir, name)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content)
  return p
}

function sha256(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

describe('sha256File', () => {
  it('matches a directly computed hash', async () => {
    const content = 'belegbar test content äöü'
    const p = write('a.txt', content)
    expect(await sha256File(p)).toBe(sha256(content))
  })
})

describe('copyAndVerify', () => {
  it('copies and verifies content', async () => {
    const content = Buffer.from('%PDF-1.4 fake pdf body')
    const src = write('src.pdf', content)
    const dest = path.join(dir, 'sub', 'dest.pdf')
    await copyAndVerify(src, dest, sha256(content))
    expect(fs.readFileSync(dest)).toEqual(content)
    expect(fs.existsSync(src)).toBe(true) // copy never removes the source
  })

  it('fails and removes the copy on hash mismatch', async () => {
    const src = write('src.pdf', 'data')
    const dest = path.join(dir, 'dest.pdf')
    await expect(copyAndVerify(src, dest, 'deadbeef')).rejects.toThrow(
      'copy_verification_failed'
    )
    expect(fs.existsSync(dest)).toBe(false)
    expect(fs.existsSync(src)).toBe(true)
  })

  it('refuses to overwrite an existing destination', async () => {
    const src = write('src.pdf', 'data')
    const dest = write('dest.pdf', 'other')
    await expect(copyAndVerify(src, dest, sha256('data'))).rejects.toThrow()
    expect(fs.readFileSync(dest, 'utf8')).toBe('other')
  })
})

describe('atomicMove', () => {
  it('moves the file; source is gone, content intact', async () => {
    const content = 'move me'
    const src = write('src.pdf', content)
    const dest = path.join(dir, 'deep', 'nested', 'dest.pdf')
    await atomicMove(src, dest)
    expect(fs.existsSync(src)).toBe(false)
    expect(fs.readFileSync(dest, 'utf8')).toBe(content)
  })

  it('refuses to clobber an existing destination and keeps the source', async () => {
    const src = write('src.pdf', 'new')
    const dest = write('dest.pdf', 'existing')
    await expect(atomicMove(src, dest)).rejects.toThrow('destination_exists')
    expect(fs.readFileSync(src, 'utf8')).toBe('new')
    expect(fs.readFileSync(dest, 'utf8')).toBe('existing')
  })

  it('keeps the source when the move fails (read-only destination dir)', async () => {
    const src = write('src.pdf', 'important bytes')
    const destDir = path.join(dir, 'readonly')
    fs.mkdirSync(destDir)
    fs.chmodSync(destDir, 0o555)
    const dest = path.join(destDir, 'dest.pdf')
    if (process.getuid && process.getuid() === 0) return // root ignores modes
    await expect(atomicMove(src, dest)).rejects.toThrow()
    expect(fs.existsSync(src)).toBe(true)
    expect(fs.readFileSync(src, 'utf8')).toBe('important bytes')
    expect(fs.existsSync(dest)).toBe(false)
  })
})

describe('hasPdfMagic', () => {
  it('accepts %PDF- headers and rejects other content', async () => {
    expect(await hasPdfMagic(write('ok.pdf', '%PDF-1.7\nrest'))).toBe(true)
    expect(await hasPdfMagic(write('bom.pdf', '\uFEFF%PDF-1.4'))).toBe(true)
    expect(await hasPdfMagic(write('no.pdf', 'PK\x03\x04 actually a zip'))).toBe(false)
  })
})

describe('moveToTrash', () => {
  it('moves into trash under <id>__<name>', async () => {
    const src = write('2026/Q1/income/doc.pdf', 'trash me')
    const trashDir = path.join(dir, '.trash')
    const dest = await moveToTrash(src, trashDir, 'abc-123', 'doc.pdf')
    expect(dest).toBe(path.join(trashDir, 'abc-123__doc.pdf'))
    expect(fs.existsSync(src)).toBe(false)
    expect(fs.readFileSync(dest, 'utf8')).toBe('trash me')
    await fsp.rm(trashDir, { recursive: true })
  })
})
