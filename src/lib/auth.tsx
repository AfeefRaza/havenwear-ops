import type { Session } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { clearLocalCache } from './queryClient'
import { clearPin } from './pin'
import { supabase } from './supabase'

interface AuthState {
  session: Session | null
  loading: boolean
  signInWithPassword: (email: string, password: string) => Promise<void>
  sendMagicLink: (email: string) => Promise<void>
  signOutThisDevice: () => Promise<void>
  signOutEverywhere: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let lastUser: string | null = null
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      lastUser = data.session?.user.id ?? null
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      const uid = s?.user.id ?? null
      // A different user on this device must never see the previous user's cached data.
      if (uid !== lastUser) void clearLocalCache()
      lastUser = uid
      setSession(s)
      setLoading(false)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      session,
      loading,
      async signInWithPassword(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message)
      },
      async sendMagicLink(email) {
        const { error } = await supabase.auth.signInWithOtp({
          email: email.trim(),
          options: {
            shouldCreateUser: false, // public sign-ups are disabled
            emailRedirectTo: window.location.origin + import.meta.env.BASE_URL,
          },
        })
        if (error) throw new Error(error.message)
      },
      async signOutThisDevice() {
        await supabase.auth.signOut({ scope: 'local' })
        await clearLocalCache()
        clearPin()
      },
      async signOutEverywhere() {
        await supabase.auth.signOut({ scope: 'global' })
        await clearLocalCache()
        clearPin()
      },
    }),
    [session, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
