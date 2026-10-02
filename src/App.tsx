import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { Component, lazy, Suspense, type ReactNode } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell, UpdatePrompt } from './components/AppShell'
import { ConfigErrorScreen, LoginScreen, NoWorkspaceScreen, PinLock, Splash } from './components/Gates'
import { ToastProvider } from './components/Toast'
import { Button, ErrorNote } from './components/ui'
import { AuthProvider, useAuth } from './lib/auth'
import { CACHE_MAX_AGE, persister, queryClient } from './lib/queryClient'
import { configError } from './lib/supabase'
import { useWorkspaceQuery, WorkspaceProvider } from './lib/workspace'

const Home = lazy(() => import('./screens/Home'))
const Batches = lazy(() => import('./screens/Batches'))
const BatchDetail = lazy(() => import('./screens/BatchDetail'))
const Pending = lazy(() => import('./screens/Pending'))
const Returns = lazy(() => import('./screens/Returns'))
const More = lazy(() => import('./screens/More'))
const RulesScreen = lazy(() => import('./screens/Rules'))
const StockScreen = lazy(() => import('./screens/Stock'))
const DataScreen = lazy(() => import('./screens/DataIO'))
const AccountScreen = lazy(() => import('./screens/Account'))
const SettingsScreen = lazy(() => import('./screens/Settings'))

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  override render() {
    if (this.state.error) {
      return (
        <div className="mx-auto flex max-w-md flex-col gap-3 p-6">
          <ErrorNote error={this.state.error} />
          <Button onClick={() => location.reload()}>Reload app</Button>
        </div>
      )
    }
    return this.props.children
  }
}

function Gate() {
  const { session, loading } = useAuth()
  const ws = useWorkspaceQuery()
  if (configError) return <ConfigErrorScreen />
  if (loading) return <Splash />
  if (!session) return <LoginScreen />
  if (ws.isPending) return <Splash />
  if (ws.error && !ws.data) {
    return (
      <div className="mx-auto max-w-md p-6">
        <ErrorNote error={ws.error} onRetry={() => void ws.refetch()} />
      </div>
    )
  }
  if (!ws.data) return <NoWorkspaceScreen />

  return (
    <WorkspaceProvider value={ws.data}>
      <PinLock>
        <AppShell>
          <Suspense fallback={<div className="pt-20"><Splash /></div>}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/batches" element={<Batches />} />
              <Route path="/batches/:id" element={<BatchDetail />} />
              <Route path="/pending" element={<Pending />} />
              <Route path="/returns" element={<Returns />} />
              <Route path="/more" element={<More />} />
              <Route path="/more/rules" element={<RulesScreen />} />
              <Route path="/more/stock" element={<StockScreen />} />
              <Route path="/more/data" element={<DataScreen />} />
              <Route path="/more/account" element={<AccountScreen />} />
              <Route path="/more/settings" element={<SettingsScreen />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </AppShell>
      </PinLock>
    </WorkspaceProvider>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: CACHE_MAX_AGE, buster: 'v1' }}>
        <ToastProvider>
          <AuthProvider>
            <HashRouter>
              <Gate />
              <UpdatePrompt />
            </HashRouter>
          </AuthProvider>
        </ToastProvider>
      </PersistQueryClientProvider>
    </ErrorBoundary>
  )
}
