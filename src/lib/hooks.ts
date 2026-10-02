import { useEffect, useState, useSyncExternalStore } from 'react'

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true)
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** Tiny "haptic-style" feedback: vibrates briefly where supported (Android). */
export function haptic(kind: 'tap' | 'success' | 'warn' = 'tap'): void {
  try {
    if ('vibrate' in navigator) navigator.vibrate(kind === 'tap' ? 8 : kind === 'success' ? [10, 30, 10] : 25)
  } catch {
    /* ignore */
  }
}

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}
