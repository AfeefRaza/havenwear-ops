#!/usr/bin/env node
/**
 * Generates the PWA PNG icons (navy rounded square with a white "H" monogram)
 * without any image tooling, using a minimal PNG encoder.
 */
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const NAVY = [0x1f, 0x2a, 0x44]
const WHITE = [0xff, 0xff, 0xff]
const ACCENT = [0x22, 0xc5, 0x5e]

function crc32(buf) {
  let c, crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function png(size, { rounded, padding }) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  const r = rounded ? size * 0.22 : 0
  const inside = (x, y) => {
    if (!rounded) return true
    const cx = Math.min(Math.max(x, r), size - r)
    const cy = Math.min(Math.max(y, r), size - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
  }
  // Glyph box (content area shrinks for maskable icons' safe zone)
  const g0 = size * padding
  const g = size - 2 * g0
  const bar = g * 0.16
  const isH = (x, y) => {
    const lx = (x - g0) / g, ly = (y - g0) / g
    if (ly < 0.22 || ly > 0.78) return false
    const b = bar / g
    return (lx >= 0.24 && lx <= 0.24 + b) || (lx >= 0.76 - b && lx <= 0.76) || (ly >= 0.44 && ly <= 0.56 && lx >= 0.24 && lx <= 0.76)
  }
  const isDot = (x, y) => {
    const cx = g0 + g * 0.8, cy = g0 + g * 0.2
    return (x - cx) ** 2 + (y - cy) ** 2 <= (g * 0.06) ** 2
  }
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1)
    raw[row] = 0
    for (let x = 0; x < size; x++) {
      const i = row + 1 + x * 4
      const px = x + 0.5, py = y + 0.5
      let c = NAVY, a = 255
      if (!inside(px, py)) a = 0
      else if (isH(px, py)) c = WHITE
      else if (isDot(px, py)) c = ACCENT
      raw[i] = c[0]; raw[i + 1] = c[1]; raw[i + 2] = c[2]; raw[i + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

writeFileSync('public/pwa-192.png', png(192, { rounded: true, padding: 0.06 }))
writeFileSync('public/pwa-512.png', png(512, { rounded: true, padding: 0.06 }))
writeFileSync('public/pwa-maskable-512.png', png(512, { rounded: false, padding: 0.2 }))
writeFileSync('public/apple-touch-icon.png', png(180, { rounded: false, padding: 0.1 }))
writeFileSync(
  'public/favicon.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1F2A44"/><path d="M18 16h8v13h12V16h8v32h-8V36H26v12h-8z" fill="#fff"/><circle cx="50" cy="15" r="4" fill="#22C55E"/></svg>\n`,
)
console.log('Icons written to public/')
