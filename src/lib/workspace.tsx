import { useQuery } from '@tanstack/react-query'
import { createContext, useContext, type ReactNode } from 'react'
import { MemberRow, WorkspaceRow, parseRows, type Member, type Workspace } from '../domain/schemas'
import { useAuth } from './auth'
import { supabase } from './supabase'

interface WorkspaceState {
  workspace: Workspace
  role: Member['role']
  userId: string
}

export interface SupplierState {
  workspaceId: string
  role: 'tshirt_supplier' | 'dtf_supplier'
  userId: string
}

const Ctx = createContext<WorkspaceState | null>(null)
const SupplierCtx = createContext<SupplierState | null>(null)

export function SupplierProvider({ value, children }: { value: SupplierState; children: ReactNode }) {
  return <SupplierCtx.Provider value={value}>{children}</SupplierCtx.Provider>
}

export function useSupplier(): SupplierState {
  const v = useContext(SupplierCtx)
  if (!v) throw new Error('useSupplier outside SupplierProvider')
  return v
}

/** Workspace id for either an internal user or a supplier (production hooks are shared). */
export function useAnyWorkspaceId(): string {
  const internal = useContext(Ctx)
  const supplier = useContext(SupplierCtx)
  const id = internal?.workspace.id ?? supplier?.workspaceId
  if (!id) throw new Error('No workspace')
  return id
}

export function useWorkspaceQuery() {
  const { session } = useAuth()
  const userId = session?.user.id
  return useQuery({
    queryKey: ['workspace', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data: mem, error: e1 } = await supabase
        .from('workspace_members')
        .select('*')
        .eq('user_id', userId!)
        .order('created_at')
      if (e1) throw e1
      const members = parseRows(MemberRow, mem, 'membership')
      // Internal membership wins if a user somehow has both.
      const first = members.find((m) => m.role === 'owner' || m.role === 'member') ?? members[0]
      if (!first) return null
      if (first.role === 'tshirt_supplier' || first.role === 'dtf_supplier') {
        // Suppliers cannot read the workspaces table (settings are private) — the portal only needs the id.
        return { supplier: { workspaceId: first.workspace_id, role: first.role, userId: userId! } satisfies SupplierState }
      }
      const { data: ws, error: e2 } = await supabase.from('workspaces').select('*').eq('id', first.workspace_id)
      if (e2) throw e2
      const [workspace] = parseRows(WorkspaceRow, ws, 'workspace')
      if (!workspace) return null
      return { internal: { workspace, role: first.role, userId: userId! } satisfies WorkspaceState }
    },
  })
}

export function WorkspaceProvider({ value, children }: { value: WorkspaceState; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useWorkspace(): WorkspaceState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useWorkspace outside WorkspaceProvider')
  return v
}

export function useWorkspaceId(): string {
  return useWorkspace().workspace.id
}
