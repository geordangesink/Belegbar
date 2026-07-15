/**
 * Ensures better-sqlite3 is compiled for the requested runtime.
 *
 *   node scripts/ensure-native-abi.mjs node      → host Node (vitest)
 *   node scripts/ensure-native-abi.mjs electron  → Electron (app, e2e)
 *
 * Both `npm rebuild` and `electron-builder install-app-deps` cache
 * aggressively and occasionally skip a needed rebuild, so this script
 * probes the actual binary first and only rebuilds on a real mismatch,
 * then re-probes to guarantee convergence.
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = process.argv[2]
if (target !== 'node' && target !== 'electron') {
  console.error('usage: ensure-native-abi.mjs <node|electron>')
  process.exit(2)
}

const require = createRequire(import.meta.url)
// requiring the package is not enough — the native addon is loaded lazily
// on first instantiation, so the probe must actually open a database
const PROBE =
  "const D = require('better-sqlite3'); const db = new D(':memory:'); db.close(); process.exit(0)"

function probe() {
  if (target === 'node') {
    return spawnSync(process.execPath, ['-e', PROBE], { cwd: ROOT }).status === 0
  }
  const electron = require('electron') // path to the Electron binary
  return (
    spawnSync(electron, ['-e', PROBE], {
      cwd: ROOT,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    }).status === 0
  )
}

function run(cmd, args, cwd = ROOT) {
  console.log(`[abi] ${cmd} ${args.join(' ')}`)
  const res = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
  return res.status === 0
}

if (probe()) {
  console.log(`[abi] better-sqlite3 already built for ${target}`)
  process.exit(0)
}

// NOTE: `npm rebuild` is useless here when ignore-scripts=true (it only
// re-runs lifecycle scripts), so compile via node-gyp directly.
const moduleDir = path.join(ROOT, 'node_modules', 'better-sqlite3')

if (target === 'node') {
  run('npx', ['--yes', 'node-gyp', 'rebuild'], moduleDir)
} else {
  // electron-builder invokes node-gyp itself, so it works despite ignore-scripts
  run('npx', ['electron-builder', 'install-app-deps'])
  if (!probe()) {
    const electronVersion = require('electron/package.json').version
    run(
      'npx',
      [
        '--yes',
        'node-gyp',
        'rebuild',
        '--runtime=electron',
        `--target=${electronVersion}`,
        '--dist-url=https://electronjs.org/headers'
      ],
      moduleDir
    )
  }
}

if (!probe()) {
  console.error(`[abi] better-sqlite3 still not loadable for ${target} after rebuild`)
  process.exit(1)
}
console.log(`[abi] better-sqlite3 ready for ${target}`)
