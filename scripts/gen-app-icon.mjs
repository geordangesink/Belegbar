// The Belegbar app icon — the triangle sandwich from build/icon.svg, lit
// per-pixel at render time (the SVG itself stays flat and clean; edit it
// freely and re-run this script).
//
// Lighting model (in the spirit of ../bonk/ember-branding):
//   - one directional fade across the whole mark, light leaning in from the
//     top-left at LIGHT.angle degrees off vertical
//   - strong catch-lights on every edge that faces the light
//   - matching shade on every edge that turns away
//   - the field settles darker toward the corners, with a whisper of the
//     mark's warmth cast into it
//   - deterministic per-pixel dither keeps the fades band-free
//
// Rendered with no dependencies (Node zlib only):
//
//   npm run icon      (→ node scripts/gen-app-icon.mjs)
//
// Emits:
//   build/icon.png    1024² — electron-builder derives all platform formats
import fs from 'node:fs'
import zlib from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ---------------------------------------------------------------- tuning
const SIZE = 1024
const SS = 3 // supersampling (3 → 9 samples per pixel)

const BG_CENTER = [0x12, 0x18, 0x15]
const BG_CORNER = [0x0a, 0x0e, 0x0c]
const BASE = [0xd3, 0xcc, 0xbb] // the bread — low enough for hairlines to read
const HEART = [0xff, 0xff, 0xff] // catch-light tint

const LIGHT = {
  angle: 45, // degrees off vertical, leaning toward the LEFT (light from the top-left corner)
  amp: 0.34, // whole-mark fade: lit toward the light, sinking away from it
  glint: 1.0, // hard catch-light strength on light-facing edges
  glintWidth: 14, // hard core, px at 1024
  glintSoft: 0.7, // soft bloom around the same edges
  glintSoftWidth: 70, // px at 1024
  shade: 0.55, // shade strength on edges turned away
  shadeWidth: 20, // px at 1024
  facing: 0.18, // how squarely an edge must face the light to catch it
  ambientAlpha: 0.07, // warmth the mark casts into the field
  ambientReach: 0.55 // fraction of the frame the warmth reaches
}

// ------------------------------------------------------- svg geometry in
const svg = fs.readFileSync(path.join(ROOT, 'build', 'icon.svg'), 'utf8')

/** class name → fill from the <style> block */
const fills = {}
for (const m of svg.matchAll(/\.([\w-]+)\s*\{[^}]*fill:\s*(#[0-9a-fA-F]{3,8})/g)) {
  fills[m[1]] = m[2]
}
const darkClasses = new Set(
  Object.entries(fills)
    .filter(([, hex]) => {
      const v = parseInt(hex.slice(1, 7), 16)
      return ((v >> 16) & 255) + ((v >> 8) & 255) + (v & 255) < 3 * 128
    })
    .map(([cls]) => cls)
)

/** every light polygon/rect of the mark, in document order */
const polys = []
const shapeRe =
  /<(polygon|rect)\s+([^>]*?)\/?>(?:<\/\1>)?/g
for (const m of svg.matchAll(shapeRe)) {
  const attrs = {}
  for (const a of m[2].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]] = a[2]
  const cls = attrs['class'] ?? ''
  if (darkClasses.has(cls)) continue // background container — drawn ourselves
  if (m[1] === 'rect') {
    const x = +attrs['x'] || 0
    const y = +attrs['y'] || 0
    const w = +attrs['width']
    const h = +attrs['height']
    if (!w || !h) continue
    polys.push([
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h]
    ])
  } else {
    const nums = (attrs['points'] ?? '').trim().split(/[\s,]+/).map(Number)
    const pts = []
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]])
    // drop a duplicated closing point
    if (pts.length > 2) {
      const [f, l] = [pts[0], pts[pts.length - 1]]
      if (f[0] === l[0] && f[1] === l[1]) pts.pop()
    }
    if (pts.length > 2) polys.push(pts)
  }
}
if (polys.length === 0) {
  console.error('no light shapes found in build/icon.svg')
  process.exit(1)
}

const cornerRadius = (() => {
  const m = svg.match(/<rect[^>]*class="[^"]*"[^>]*rx="(\d+(?:\.\d+)?)"/)
  return m ? +m[1] : 224
})()

// ------------------------------------------------------------- lighting
const rad = (LIGHT.angle * Math.PI) / 180
// incoming ray direction: from top-left, LIGHT.angle off vertical
const ldir = [Math.sin(rad), Math.cos(rad)]

// mark bounds for the whole-form fade
let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9
for (const p of polys)
  for (const [x, y] of p) {
    minX = Math.min(minX, x); minY = Math.min(minY, y)
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
  }
const markCx = (minX + maxX) / 2
const markCy = (minY + maxY) / 2
const markExtent =
  Math.abs((maxX - minX) * ldir[0]) / 2 + Math.abs((maxY - minY) * ldir[1]) / 2

/** edges with outward normals, per polygon (assumes convex-ish rings; works per-edge) */
const edges = polys.map((pts) => {
  // ensure clockwise (positive area in y-down coords) so normals point outward
  let area = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % pts.length]
    area += x1 * y2 - x2 * y1
  }
  const ordered = area < 0 ? [...pts].reverse() : pts
  const out = []
  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i]
    const b = ordered[(i + 1) % ordered.length]
    const ex = b[0] - a[0]
    const ey = b[1] - a[1]
    const len = Math.hypot(ex, ey)
    if (len < 1e-6) continue
    // outward normal for clockwise winding in y-down coordinates
    out.push({ a, b, n: [-ey / len, ex / len], len })
  }
  return out
})

/** light-facing edges with an 'outerness' factor: edges that face another
 * layer across the gap glint softer than the true outer silhouette */
const glintEdges = []
for (let si = 0; si < polys.length; si++) {
  for (const e of edges[si]) {
    const facing = e.n[0] * ldir[0] + e.n[1] * ldir[1]
    if (facing >= -LIGHT.facing) continue
    const mx = (e.a[0] + e.b[0]) / 2 + e.n[0] * 30
    const my = (e.a[1] + e.b[1]) / 2 + e.n[1] * 30
    let interior = false
    for (let sj = 0; sj < polys.length; sj++) {
      if (sj !== si && inPolyPts(polys[sj], mx, my)) { interior = true; break }
    }
    glintEdges.push({ ...e, lit: -facing, factor: interior ? LIGHT.interior : 1 })
  }
}

function inPolyPts(pts, x, y) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function inPoly(pts, x, y) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function segDist(px, py, a, b) {
  const vx = b[0] - a[0]
  const vy = b[1] - a[1]
  const wx = px - a[0]
  const wy = py - a[1]
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)))
  const dx = wx - t * vx
  const dy = wy - t * vy
  return Math.hypot(dx, dy)
}

const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const dither = (x, y) => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return s - Math.floor(s) - 0.5
}

/** color of one sample point, or null when outside every shape */
function sampleMark(x, y) {
  for (let s = 0; s < polys.length; s++) {
    if (!inPoly(polys[s], x, y)) continue
    // whole-form directional fade
    const axis = ((x - markCx) * ldir[0] + (y - markCy) * ldir[1]) / markExtent // -1 lit … +1 away
    let c = mix(BASE, HEART, 0)
    const fade = 1 - LIGHT.amp * axis
    c = [c[0] * fade, c[1] * fade, c[2] * fade]
    // in-shape shading only — the crown glints are painted after compositing
    let shade = 0
    for (const e of edges[s]) {
      const facing = e.n[0] * ldir[0] + e.n[1] * ldir[1] // >0 → turns away
      if (facing > LIGHT.facing) {
        const d = segDist(x, y, e.a, e.b)
        shade = Math.max(shade, (1 - smoothstep(0, LIGHT.shadeWidth, d)) * facing * facing)
      }
    }
    if (shade > 0) c = [c[0] * (1 - LIGHT.shade * shade), c[1] * (1 - LIGHT.shade * shade), c[2] * (1 - LIGHT.shade * shade)]
    return c
  }
  return null
}

// ------------------------------------------------------------- rendering
const half = SIZE / 2
const rgba = Buffer.alloc(SIZE * SIZE * 4)
const inv = 1 / (SS * SS)
const maxAmbient = Math.hypot(markCx - minX, markCy - minY) + LIGHT.ambientReach * SIZE

for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    let r = 0, g = 0, b = 0, cover = 0
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const x = px + (sx + 0.5) / SS
        const y = py + (sy + 0.5) / SS
        const c = sampleMark(x, y)
        if (c) {
          r += c[0]; g += c[1]; b += c[2]; cover++
        }
      }
    }
    // the field: darker toward the corners + a whisper of the mark's warmth
    const dx = px + 0.5 - half
    const dy = py + 0.5 - half
    const corner = smoothstep(0.35, 1.05, Math.hypot(dx, dy) / half)
    let field = mix(BG_CENTER, BG_CORNER, corner)
    const dm = Math.hypot(px + 0.5 - markCx, py + 0.5 - markCy)
    const warmth = (1 - smoothstep(0, maxAmbient, dm)) * LIGHT.ambientAlpha
    field = mix(field, BASE, warmth)

    const cf = cover * inv
    let outR = field[0] * (1 - cf) + (cover ? r / Math.max(cover, 1) : 0) * cf
    let outG = field[1] * (1 - cf) + (cover ? g / Math.max(cover, 1) : 0) * cf
    let outB = field[2] * (1 - cf) + (cover ? b / Math.max(cover, 1) : 0) * cf

    // crown catch-lights: a solid hairline straddling every light-facing
    // edge (painted over the composite, so half of it halos the silhouette)
    const cx0 = px + 0.5
    const cy0 = py + 0.5
    for (const e of glintEdges) {
      const d0 = segDist(cx0, cy0, e.a, e.b)
      const band = 1 - smoothstep(0, LIGHT.glintWidth, d0)
      if (band > 0.002) {
        const amt = Math.min(1, LIGHT.glint * band * e.lit * e.lit * e.factor)
        outR += (HEART[0] - outR) * amt
        outG += (HEART[1] - outG) * amt
        outB += (HEART[2] - outB) * amt
      }
    }
    const d = dither(px, py) * 1.2
    outR += d
    outG += d
    outB += d

    // container mask: squircle corner radius, antialiased
    const cr = cornerRadius
    const ex = Math.max(0, Math.max(cr - (px + 0.5), px + 0.5 - (SIZE - cr)))
    const ey = Math.max(0, Math.max(cr - (py + 0.5), py + 0.5 - (SIZE - cr)))
    const cornerDist = Math.hypot(ex, ey)
    const alpha = 1 - smoothstep(cr - 1, cr + 0.5, cornerDist)

    const i = (py * SIZE + px) * 4
    rgba[i] = Math.max(0, Math.min(255, Math.round(outR)))
    rgba[i + 1] = Math.max(0, Math.min(255, Math.round(outG)))
    rgba[i + 2] = Math.max(0, Math.min(255, Math.round(outB)))
    rgba[i + 3] = Math.round(alpha * 255)
  }
}

// ------------------------------------------------------------ PNG writing
function crc32(buf) {
  let table = crc32.table
  if (!table) {
    table = []
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c >>> 0
    }
    crc32.table = table
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}
function encodePNG(w, h, data) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const stride = w * 4
  const raw = Buffer.alloc((stride + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const idat = zlib.deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

const out = path.join(ROOT, 'build', 'icon.png')
fs.writeFileSync(out, encodePNG(SIZE, SIZE, rgba))
console.log(`rendered build/icon.svg + lighting → ${path.relative(ROOT, out)} (${SIZE}², ${polys.length} shapes)`)
