import { Delete, KeyRound, LockKeyhole, Mail, ShieldAlert } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useAuth } from '../lib/auth'
import { hasPin, verifyPin } from '../lib/pin'
import { configError } from '../lib/supabase'
import { Button, Card, TextField } from './ui'

function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="pt-safe pb-safe mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4">
      <div className="flex flex-col items-center gap-3">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="size-14" />
        <h1 className="text-2xl font-semibold">HavenWear Ops</h1>
      </div>
      {children}
    </main>
  )
}

export function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center" role="status" aria-label="Loading">
      <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="size-14 animate-pulse" />
    </div>
  )
}

export function ConfigErrorScreen() {
  return (
    <Centered>
      <Card className="flex gap-3 text-sm">
        <ShieldAlert className="size-5 shrink-0 text-bad" aria-hidden />
        <p>{configError}</p>
      </Card>
    </Centered>
  )
}

export function LoginScreen() {
  const { signInWithPassword, sendMagicLink } = useAuth()
  const [mode, setMode] = useState<'password' | 'magic'>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (mode === 'password') await signInWithPassword(email, password)
      else {
        await sendMagicLink(email)
        setSent(true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Centered>
      <Card>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <h2 className="text-lg font-semibold">Sign in</h2>
          <TextField label="Email" type="email" autoComplete="username" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          {mode === 'password' && (
            <TextField label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          )}
          {error && (
            <p role="alert" className="rounded-xl bg-bad-bg p-3 text-sm text-bad">
              {error}
            </p>
          )}
          {sent && mode === 'magic' && (
            <p role="status" className="rounded-xl bg-ok-bg p-3 text-sm text-ok">
              If that email has an account, a sign-in link is on its way.
            </p>
          )}
          <Button type="submit" variant="primary" size="lg" block loading={busy} icon={mode === 'password' ? KeyRound : Mail} disabled={!email || (mode === 'password' && !password)}>
            {mode === 'password' ? 'Sign in' : 'Email me a sign-in link'}
          </Button>
          <Button variant="ghost" onClick={() => { setMode(mode === 'password' ? 'magic' : 'password'); setError(null); setSent(false) }}>
            {mode === 'password' ? 'Use a magic link instead' : 'Use a password instead'}
          </Button>
        </form>
      </Card>
      <p className="text-center text-xs text-muted">Private app. Accounts are created by the owner only.</p>
    </Centered>
  )
}

export function NoWorkspaceScreen() {
  const { signOutThisDevice, session } = useAuth()
  return (
    <Centered>
      <Card className="flex flex-col gap-3 text-sm">
        <h2 className="text-lg font-semibold">No workspace yet</h2>
        <p>
          You are signed in as <strong>{session?.user.email}</strong>, but this account is not a member of any workspace. Ask the owner to
          add you, or (if you are the owner) run the setup SQL from the README:
        </p>
        <code className="block overflow-x-auto rounded-lg bg-surface-2 p-2 text-xs">
          select private.create_workspace('HavenWear Pakistan', '{session?.user.email}');
        </code>
        <Button onClick={() => void signOutThisDevice()}>Sign out of this device</Button>
      </Card>
    </Centered>
  )
}

const LOCK_AFTER_MS = 60_000

/** Convenience PIN lock — shown on launch and after the app has been in the background for a minute. */
export function PinLock({ children }: { children: ReactNode }) {
  const [locked, setLocked] = useState(() => hasPin())
  const hiddenAt = useRef<number | null>(null)

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') hiddenAt.current = Date.now()
      else if (hiddenAt.current && Date.now() - hiddenAt.current > LOCK_AFTER_MS && hasPin()) setLocked(true)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  if (!locked) return <>{children}</>
  return <PinPad onUnlock={() => setLocked(false)} />
}

function PinPad({ onUnlock }: { onUnlock: () => void }) {
  const { signOutThisDevice } = useAuth()
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)
  const [attempts, setAttempts] = useState(0)

  useEffect(() => {
    if (pin.length !== 4) return
    void verifyPin(pin).then((ok) => {
      if (ok) onUnlock()
      else {
        setError(true)
        setAttempts((a) => a + 1)
        setPin('')
        if ('vibrate' in navigator) navigator.vibrate(60)
      }
    })
  }, [pin, onUnlock])

  const press = (d: string) => {
    setError(false)
    setPin((p) => (p.length < 4 ? p + d : p))
  }

  return (
    <Centered>
      <div className="flex flex-col items-center gap-4">
        <LockKeyhole className="size-6 text-muted" aria-hidden />
        <p className="text-sm text-muted" id="pin-label">
          Enter your app PIN
        </p>
        <div className="flex gap-3" role="img" aria-label={`${pin.length} of 4 digits entered`}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`size-4 rounded-full border-2 ${i < pin.length ? 'border-primary bg-primary' : 'border-border'}`} />
          ))}
        </div>
        <p role="alert" className="h-5 text-sm text-bad">
          {error ? 'Wrong PIN' : ''}
        </p>
        <div className="grid grid-cols-3 gap-3" role="group" aria-labelledby="pin-label">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <Button key={d} size="lg" className="size-18 text-2xl" onClick={() => press(d)}>
              {d}
            </Button>
          ))}
          <span />
          <Button size="lg" className="size-18 text-2xl" onClick={() => press('0')}>
            0
          </Button>
          <Button size="lg" variant="ghost" className="size-18" icon={Delete} aria-label="Delete digit" onClick={() => setPin((p) => p.slice(0, -1))} />
        </div>
        {attempts >= 3 && (
          <Button variant="ghost" onClick={() => void signOutThisDevice()}>
            Forgot PIN? Sign out of this device
          </Button>
        )}
        <p className="max-w-xs text-center text-xs text-muted">Convenience lock only — not a security feature.</p>
      </div>
    </Centered>
  )
}
