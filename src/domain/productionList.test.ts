import { describe, expect, it } from 'vitest'
import { formatProductionList } from './productionList'

const cats = [
  { id: 'tee', name: 'T-shirt', sort_order: 3 },
  { id: 'denim', name: 'Essential Denim', sort_order: 1 },
  { id: 'trouser', name: 'Trouser', sort_order: 2 },
]
const e = (title: string, variant: string | null, categoryId: string | null) => ({ title, variant, categoryId })

describe('formatProductionList', () => {
  it('groups by category in Settings order, blank line between, A–Z inside', () => {
    const text = formatProductionList(
      [
        e('Weekend Oversized T-shirt', 'XL', 'tee'),
        e('Bloom Baggy Denim', 'Small', 'denim'),
        e('Racing Baggy Trouser', 'Large', 'trouser'),
        e('Bloom Baggy Denim', 'Large', 'denim'),
        e('Archive Indigo Essential Denim', 'XL', 'denim'),
        e('2Pac Hood', 'Small', 'tee'),
      ],
      cats,
    )
    expect(text).toBe(
      [
        'Archive Indigo Essential Denim — XL',
        'Bloom Baggy Denim — Large',
        'Bloom Baggy Denim — Small',
        '',
        'Racing Baggy Trouser — Large',
        '',
        '2Pac Hood — Small',
        'Weekend Oversized T-shirt — XL',
      ].join('\n'),
    )
  })

  it('keeps multi-option variants as they are and skips duplicates', () => {
    const text = formatProductionList(
      [e('Basic Oversized T-shirt (PACK OF TWO)', 'M / Navy / Maroon', 'tee'), e('Basic Oversized T-shirt (PACK OF TWO)', 'M / Navy / Maroon', 'tee')],
      cats,
    )
    expect(text).toBe('Basic Oversized T-shirt (PACK OF TWO) — M / Navy / Maroon')
  })

  it('puts items without a category last and omits the dash when there is no variant', () => {
    expect(formatProductionList([e('Mystery Item', null, null), e('Zoro Trouser', 'Large', 'trouser')], cats)).toBe('Zoro Trouser — Large\n\nMystery Item')
  })

  it('is empty when there is nothing', () => {
    expect(formatProductionList([], cats)).toBe('')
  })
})
