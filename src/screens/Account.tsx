import { useQuery } from '@tanstack/react-query'
import { LogOut, ShieldCheck, Smartphone, Users } from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { useConfirm } from '../components/Confirm'
import { Button, Card, SectionTitle } from '../components/ui'
import { MemberRow, parseRows } from '../domain/schemas'
import { formatDate } from '../domain/format'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../lib/workspace'

export default function Account() {
  const { session, signOutThisDevice, signOutEverywhere } = useAuth()
  const { workspace, role, userId } = useWorkspace()
  const [confirmEl, confirm] = useConfirm()
  const members = useQuery({
    queryKey: ['members', workspace.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('workspace_members').select('*').eq('workspace_id', workspace.id).order('created_at')
      if (error) throw error
      return parseRows(MemberRow, data, 'member')
    },
  })

  return (
    <>
      <PageHeader title="Account & devices" back />
      <Card className="flex flex-col gap-1">
        <div className="text-xs text-muted">Signed in as</div>
        <div className="break-all text-base font-semibold">{session?.user.email}</div>
        <div className="text-xs text-muted">
          {workspace.name} · {role === 'owner' ? 'Owner' : 'Member'}
          {session?.user.last_sign_in_at ? ` · last sign-in ${formatDate(session.user.last_sign_in_at)}` : ''}
        </div>
      </Card>

      <SectionTitle>This device</SectionTitle>
      <Card className="flex flex-col gap-3">
        <p className="flex items-start gap-2 text-sm text-muted">
          <Smartphone className="mt-0.5 size-4 shrink-0" aria-hidden />
          You stay signed in on this device and your session refreshes automatically. Signing out removes the session, the offline data cache and the app PIN from this device.
        </p>
        <Button
          variant="danger"
          size="lg"
          icon={LogOut}
          block
          onClick={async () => {
            if (await confirm({ title: 'Sign out of this device?', confirmLabel: 'Sign out', danger: true })) await signOutThisDevice()
          }}
        >
          Sign out of this device
        </Button>
        <Button
          variant="ghost"
          onClick={async () => {
            if (await confirm({ title: 'Sign out everywhere?', description: 'All your devices will need to sign in again.', confirmLabel: 'Sign out everywhere', danger: true }))
              await signOutEverywhere()
          }}
        >
          Sign out of all devices
        </Button>
      </Card>

      <SectionTitle>Team</SectionTitle>
      <Card className="flex flex-col gap-3">
        <ul className="flex flex-col gap-2 text-sm">
          {(members.data ?? []).map((m) => (
            <li key={m.user_id} className="flex items-center gap-2">
              <Users className="size-4 text-muted" aria-hidden />
              <span className="flex-1 truncate">{m.user_id === userId ? `${session?.user.email} (you)` : `Member ${m.user_id.slice(0, 8)}…`}</span>
              <span className="text-xs text-muted">{m.role}</span>
            </li>
          ))}
        </ul>
        <p className="flex items-start gap-2 text-xs text-muted">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          To add a team member: create their user in the Supabase dashboard (Authentication → Users), then run
          <code className="rounded bg-surface-2 px-1">select private.add_member('{workspace.id}', 'their@email.com');</code>
          in the SQL editor. See the README.
        </p>
      </Card>
      {confirmEl}
    </>
  )
}
