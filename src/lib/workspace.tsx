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

const Ctx = createContext<WorkspaceState | null>(null)

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
      const first = members[0]
      if (!first) return null
      const { data: ws, error: e2 } = await supabase.from('workspaces').select('*').eq('id', first.workspace_id)
      if (e2) throw e2
      const [workspace] = parseRows(WorkspaceRow, ws, 'workspace')
      if (!workspace) return null
      return { workspace, role: first.role, userId: userId! } satisfies WorkspaceState
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
