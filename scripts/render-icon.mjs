/**
 * Renders build/icon.svg (the editable source of truth) to build/icon.png,
 * which electron-builder converts into the platform icon formats.
 *
 *   npm run icon
 */
import { Resvg } from '@resvg/resvg-js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const svgPath = path.join(ROOT, 'build', 'icon.svg')
const pngPath = path.join(ROOT, 'build', 'icon.png')

const svg = fs.readFileSync(svgPath, 'utf8')
const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1024 } })
fs.writeFileSync(pngPath, resvg.render().asPng())
console.log(`rendered ${path.relative(ROOT, svgPath)} → ${path.relative(ROOT, pngPath)} (1024×1024)`)
