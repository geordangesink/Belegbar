/**
 * File primitives used by the import pipeline and document handlers.
 * All operations are conservative: verify after copy, never delete a source
 * unless the destination is proven intact.
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { pipeline } from 'node:stream/promises'

/** Streaming sha256 of a file, lowercase hex. */
export async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256')
  await pipeline(fs.createReadStream(filePath), hash)
  return hash.digest('hex')
}

/**
 * Copy src → dest (dest must not exist), then verify the copy's sha256
 * matches `expectedSha256`. On mismatch the copy is removed and an error
 * with message 'copy_verification_failed' is thrown.
 */
export async function copyAndVerify(
  src: string,
  dest: string,
  expectedSha256: string
): Promise<void> {
  await fsp.mkdir(path.dirname(dest), { recursive: true })
  await fsp.copyFile(src, dest, fs.constants.COPYFILE_EXCL)
  const actual = await sha256File(dest)
  if (actual !== expectedSha256) {
    await fsp.rm(dest, { force: true })
    throw new Error('copy_verification_failed')
  }
}

/**
 * Atomic move within the same volume (rename). Falls back to
 * copy+verify+unlink across devices. The source is only removed after the
 * destination verifiably exists. Fails if dest already exists.
 */
/**
 * Moves src into dest WITHOUT ever clobbering an existing file, atomically
 * even under concurrency. A plain access()+rename() has a TOCTOU window in
 * which two concurrent imports generating the same filename overwrite each
 * other (rename replaces existing files on POSIX) — link()/COPYFILE_EXCL
 * fail with EEXIST instead. Throws Error('destination_exists') on collision.
 */
export async function atomicMove(src: string, dest: string): Promise<void> {
  await fsp.mkdir(path.dirname(dest), { recursive: true })
  try {
    // hardlink is atomic and refuses existing destinations
    await fsp.link(src, dest)
    await fsp.rm(src, { force: true })
    return
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EEXIST') throw new Error('destination_exists')
    // fall through for filesystems without hardlinks / cross-device moves
    if (code !== 'EXDEV' && code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EACCES') {
      throw err
    }
  }
  // exclusive copy: also refuses existing destinations atomically
  try {
    await fsp.copyFile(src, dest, fs.constants.COPYFILE_EXCL)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('destination_exists')
    }
    throw err
  }
  const srcHash = await sha256File(src)
  const destHash = await sha256File(dest)
  if (srcHash !== destHash) {
    await fsp.rm(dest, { force: true })
    throw new Error('copy_verification_failed')
  }
  await fsp.rm(src, { force: true })
}

/**
 * Best-effort free disk space in bytes for the volume containing `dir`.
 * Returns null when the platform call is unavailable.
 */
export async function freeDiskSpace(dir: string): Promise<bigint | null> {
  try {
    const stats = await fsp.statfs(dir, { bigint: true })
    return stats.bavail * stats.bsize
  } catch {
    return null
  }
}

/** True when the volume has room for `bytes` plus a safety margin. */
export async function hasDiskSpaceFor(dir: string, bytes: number): Promise<boolean> {
  const free = await freeDiskSpace(dir)
  if (free === null) return true // best effort: unknown → do not block
  const margin = 50n * 1024n * 1024n // 50 MB
  return free > BigInt(Math.ceil(bytes)) + margin
}

/** Read the first bytes of a file to check the %PDF- magic marker. */
export async function hasPdfMagic(filePath: string): Promise<boolean> {
  const fd = await fsp.open(filePath, 'r')
  try {
    const buf = Buffer.alloc(1024)
    const { bytesRead } = await fd.read(buf, 0, 1024, 0)
    // some generators prepend a BOM/junk; accept %PDF- within first 1KB
    return buf.subarray(0, bytesRead).includes('%PDF-')
  } finally {
    await fd.close()
  }
}

export async function fileSize(filePath: string): Promise<number> {
  const stat = await fsp.stat(filePath)
  return stat.size
}

/** Move a stored document into the trash directory as <id>__<filename>. */
export async function moveToTrash(
  absolutePath: string,
  trashDir: string,
  documentId: string,
  storedFilename: string
): Promise<string> {
  const trashName = `${documentId}__${storedFilename}`
  const dest = path.join(trashDir, trashName)
  await fsp.rm(dest, { force: true })
  await fsp.mkdir(trashDir, { recursive: true })
  await fsp.rename(absolutePath, dest)
  return dest
}
