import { createCanvas, loadImage } from '@napi-rs/canvas'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = path.join(ROOT, 'build', 'icon.png')
const outputPath = path.join(ROOT, 'build', 'icon-dock.png')
const canvasSize = 1024
const iconSize = 824
const inset = (canvasSize - iconSize) / 2

const source = await loadImage(sourcePath)
const canvas = createCanvas(canvasSize, canvasSize)
const context = canvas.getContext('2d')
context.imageSmoothingEnabled = true
context.drawImage(source, inset, inset, iconSize, iconSize)

fs.writeFileSync(outputPath, canvas.toBuffer('image/png'))
console.log(`rendered ${path.relative(ROOT, outputPath)} (${canvasSize}×${canvasSize}, ${inset}px inset)`)
