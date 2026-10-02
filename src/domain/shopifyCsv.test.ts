import { describe, expect, it } from 'vitest'
import { NotShopifyCsvError, packSize, parseCsv, parseShopifyOrders } from './shopifyCsv'

// Synthetic fixture shaped like a real Shopify export — fake people, no real data.
const HEADER =
  'Name,Email,Financial Status,Fulfillment Status,Created at,Lineitem quantity,Lineitem name,Lineitem price,Billing Name,Shipping Address1,Shipping Phone,Note Attributes,Cancelled at,Tags'
const CSV = [
  '﻿' + HEADER,
  '#test1001,a@example.com,pending,fulfilled,2026-08-04 05:24:22 +0500,2,Spiderman Comic Style Oversized T-shirt - Medium,2000.00,Test Person,"House 1, Street 2",03000000000,"courier: PostEx\ntracking: 123\nurl: https://example.com",,"tag1, tag2"',
  '#test1002,b@example.com,pending,fulfilled,2026-08-12 16:24:51 +0500,1,Pain is Strength Oversized Hoodie - Medium,2600.00,Test Two,Addr,0300,"x: y",,',
  '#test1002,b@example.com,,,2026-08-12 16:24:51 +0500,1,Italia Racer Oversized Hoodie - Medium(Oversized),2750.00,,,,,,',
  '#test1003,c@example.com,pending,unfulfilled,2026-08-16 13:43:52 +0500,1,Basic Oversized T-shirt (PACK OF TWO) - M / Maroon / Steel grey,2750.00,Test Three,Addr,0300,,,',
  '#test1004,d@example.com,refunded,unfulfilled,2026-08-17 10:00:00 +0500,1,Racing Baggy Trouser - Large,2750.00,Test Four,Addr,0300,,2026-08-18 10:00:00 +0500,',
  '#test1004,d@example.com,,,2026-08-17 10:00:00 +0500,1,Baggy Piping Trouser - Small,2400.00,,,,,,',
  '#test1005,e@example.com,pending,unfulfilled,2026-08-18 23:27:43 +0500,1,"Product with ""quotes"", and comma",2000.00,Test Five,Addr,0300,,,',
  '',
].join('\r\n')

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, embedded newlines, CRLF and BOM', () => {
    const rows = parseCsv(CSV)
    expect(rows).toHaveLength(8)
    expect(rows[0]![0]).toBe('Name')
    expect(rows[1]![11]).toBe('courier: PostEx\ntracking: 123\nurl: https://example.com')
    expect(rows[1]![13]).toBe('tag1, tag2')
    expect(rows[7]![6]).toBe('Product with "quotes", and comma')
  })
  it('handles a file without a trailing newline', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']])
  })
})

describe('packSize', () => {
  it.each([
    ['Basic Oversized T-shirt (PACK OF TWO) - M', 2],
    ['Basic Tee Pack of 3', 3],
    ['Socks 2-Pack', 2],
    ['Plain Tee 3 pack', 3],
    ['Backpack Hoodie', 1],
    ['Spiderman Oversized T-shirt - Medium', 1],
  ])('%s → %i', (name, n) => expect(packSize(name)).toBe(n))
})

describe('parseShopifyOrders', () => {
  const p = parseShopifyOrders(CSV)

  it('extracts one line per line item, including continuation rows', () => {
    expect(p.lines.map((l) => [l.order, l.name, l.qty])).toEqual([
      ['#test1001', 'Spiderman Comic Style Oversized T-shirt - Medium', 2],
      ['#test1002', 'Pain is Strength Oversized Hoodie - Medium', 1],
      ['#test1002', 'Italia Racer Oversized Hoodie - Medium(Oversized)', 1],
      ['#test1003', 'Basic Oversized T-shirt (PACK OF TWO) - M / Maroon / Steel grey', 2],
      ['#test1005', 'Product with "quotes", and comma', 1],
    ])
  })

  it('multiplies pack products into pieces', () => {
    expect(p.lines[3]).toMatchObject({ units: 1, pack: 2, qty: 2 })
  })

  it('skips every line of cancelled orders', () => {
    expect(p.skippedCancelled).toEqual(['#test1004'])
    expect(p.lines.some((l) => l.order === '#test1004')).toBe(false)
  })

  it('never returns customer data', () => {
    const json = JSON.stringify(p)
    for (const pii of ['example.com', 'Test Person', 'House 1', '0300', 'PostEx']) expect(json).not.toContain(pii)
  })

  it('lists orders in file order', () => expect(p.orders).toEqual(['#test1001', '#test1002', '#test1003', '#test1005']))

  it('rejects files that are not a Shopify orders export', () => {
    expect(() => parseShopifyOrders('Product,Qty\nTee,2')).toThrow(NotShopifyCsvError)
  })

  it('warns on a bad quantity and uses 1', () => {
    const r = parseShopifyOrders('Name,Lineitem quantity,Lineitem name\n#1,abc,Tee')
    expect(r.lines[0]!.qty).toBe(1)
    expect(r.warnings[0]).toMatch(/not valid/)
  })
})
