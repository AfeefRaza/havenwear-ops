/**
 * Optional 4-digit app-lock PIN — a CONVENIENCE lock, not real security.
 * Only a salted PBKDF2 hash is stored, on this device only. Anyone with access to the
 * device's storage could brute-force 10,000 combinations; real protection is your
 * Supabase login + RLS.
 */
const KEY = 'hw-pin'
const ITERATIONS = 150_000

interface StoredPin {
  salt: string
  hash: string
  iterations: number
}

const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    256,
  )
  return b64(bits)
}

function read(): StoredPin | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as StoredPin
    return v && typeof v.hash === 'string' && typeof v.salt === 'string' ? v : null
  } catch {
    return null
  }
}

export const isValidPin = (pin: string) => /^\d{4}$/.test(pin)

export function hasPin(): boolean {
  return read() !== null
}

export async function setPin(pin: string): Promise<void> {
  if (!isValidPin(pin)) throw new Error('PIN must be exactly 4 digits')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derive(pin, salt, ITERATIONS)
  localStorage.setItem(KEY, JSON.stringify({ salt: b64(salt), hash, iterations: ITERATIONS }))
}

export async function verifyPin(pin: string): Promise<boolean> {
  const stored = read()
  if (!stored) return true
  if (!isValidPin(pin)) return false
  const hash = await derive(pin, unb64(stored.salt), stored.iterations)
  // constant-time-ish comparison
  let diff = hash.length ^ stored.hash.length
  for (let i = 0; i < Math.min(hash.length, stored.hash.length); i++) diff |= hash.charCodeAt(i) ^ stored.hash.charCodeAt(i)
  return diff === 0
}

export function clearPin(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
