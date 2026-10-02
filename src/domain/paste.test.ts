import { describe, expect, it } from 'vitest'
import { MAX_PASTE_LINES, parsePaste, parsePasteLine } from './paste'

describe('parsePasteLine', () => {
  it.each([
    ['Oversized Tee - Black / L', 'Oversized Tee - Black / L', 1],
    ['Oversized Tee - Black / L × 2', 'Oversized Tee - Black / L', 2],
    ['Oversized Tee x3', 'Oversized Tee', 3],
    ['Oversized Tee X 4', 'Oversized Tee', 4],
    ['Hoodie * 5', 'Hoodie', 5],
    ['Hoodie (×2)', 'Hoodie', 2],
    ['Hoodie (3)', 'Hoodie', 3],
    ['2 × Cargo Trouser', 'Cargo Trouser', 2],
    ['Graphic Tee\t3', 'Graphic Tee', 3],
    ['Graphic Tee\tBlack\t2', 'Graphic Tee Black', 2],
    ['- Graphic Tee', 'Graphic Tee', 1],
    ['• Graphic Tee', 'Graphic Tee', 1],
    ['12. Graphic Tee', 'Graphic Tee', 1],
  ])('%j → %j × %i', (input, name, qty) => {
    expect(parsePasteLine(input)).toEqual({ name, qty })
  })

  it('does not treat sizes like 2XL or 3X as quantities', () => {
    expect(parsePasteLine('Oversized Hoodie / 2XL')).toEqual({ name: 'Oversized Hoodie / 2XL', qty: 1 })
    expect(parsePasteLine('Box Tee - 3X')).toEqual({ name: 'Box Tee - 3X', qty: 1 })
  })

  it('a line that is only a quantity marker is kept as text', () => {
    expect(parsePasteLine('x2')).toEqual({ name: 'x2', qty: 1 })
  })

  it('collapses whitespace and strips control characters', () => {
    expect(parsePasteLine('  Oversized\u0007   Tee  ')).toEqual({ name: 'Oversized Tee', qty: 1 })
  })

  it('keeps HTML as plain text (never interpreted)', () => {
    expect(parsePasteLine('<img src=x onerror=alert(1)> Tee')?.name).toBe('<img src=x onerror=alert(1)> Tee')
  })

  it('returns null for blank lines', () => {
    expect(parsePasteLine('   ')).toBeNull()
    expect(parsePasteLine('\t\t')).toBeNull()
  })

  it('clamps qty to at least 1', () => {
    expect(parsePasteLine('Tee x0')).toEqual({ name: 'Tee', qty: 1 })
  })
})

describe('parsePaste', () => {
  it('handles CRLF, blank lines and keeps original line numbers', () => {
    const out = parsePaste('Tee\r\n\r\nHoodie × 2\n')
    expect(out).toEqual([
      { lineNo: 1, name: 'Tee', qty: 1 },
      { lineNo: 3, name: 'Hoodie', qty: 2 },
    ])
  })

  it('caps the number of lines', () => {
    const text = Array.from({ length: MAX_PASTE_LINES + 50 }, (_, i) => `Tee ${i}`).join('\n')
    expect(parsePaste(text)).toHaveLength(MAX_PASTE_LINES)
  })

  it('empty input → empty list', () => {
    expect(parsePaste('')).toEqual([])
  })
})
