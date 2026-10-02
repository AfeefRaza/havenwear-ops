#!/usr/bin/env node
/**
 * Fails (exit 1) if anything resembling a Supabase service_role key, secret API key,
 * or JWT signing secret is found in tracked files or in the build output.
 *
 *   node scripts/check-secrets.mjs          # scan git-tracked files
 *   node scripts/check-secrets.mjs dist     # scan a directory (e.g. the build output)
 *
 * The anon / publishable key is public by design and is allowed in the build output.
 */
import { execSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const target = process.argv[2]

function listFiles() {
  if (!target) {
    try {
      return execSync('git ls-files -co --exclude-standard', { encoding: 'utf8' })
        .split('\n')
        .filter(Boolean)
    } catch {
      return walk('.')
    }
  }
  return walk(target)
}

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue
    const p = join(dir, name)
    const s = statSync(p)
    if (s.isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|xlsx|pdf|zip)$/i

// Long, random-looking value: rules out placeholders such as "your-anon-key".
const looksReal = (v) => v.length >= 32 && !/your|example|placeholder|xxxx|<|\$\{/i.test(v)

const checks = [
  {
    name: 'Supabase secret API key (sb_secret_…)',
    re: /sb_secret_[A-Za-z0-9_-]{16,}/g,
    test: () => true,
  },
  {
    name: 'service_role / JWT secret assigned to a variable',
    re: /(SERVICE_ROLE(?:_KEY)?|JWT_SECRET|SUPABASE_SECRET(?:_KEY)?)["']?\s*[:=]\s*["']?([A-Za-z0-9._\-+/=]+)/gi,
    test: (m) => looksReal(m[2] ?? ''),
  },
  {
    name: 'JWT whose payload grants a privileged role',
    re: /eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{16,}/g,
    test: (m) => {
      try {
        const json = Buffer.from(m[1], 'base64url').toString('utf8')
        const payload = JSON.parse(json)
        return payload.role !== 'anon' && payload.role !== 'authenticated'
      } catch {
        return false
      }
    },
  },
]

const findings = []
for (const file of listFiles()) {
  if (BINARY.test(file)) continue
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  for (const c of checks) {
    for (const m of text.matchAll(c.re)) {
      if (c.test(m)) {
        const line = text.slice(0, m.index).split('\n').length
        findings.push(`${file}:${line}  ${c.name}`)
      }
    }
  }
}

if (findings.length) {
  console.error('✖ Possible secrets found — the build is blocked:\n')
  for (const f of findings) console.error('  ' + f)
  console.error('\nRemove the value, rotate the key in Supabase, and use GitHub Actions secrets instead.')
  process.exit(1)
}
console.log(`✔ No service_role keys or JWT secrets found (${target ?? 'tracked files'}).`)
