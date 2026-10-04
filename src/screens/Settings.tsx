import { KeyRound, LockKeyhole } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/AppShell'
import { useToast } from '../components/Toast'
import { Button, Card, SectionTitle, TextField, Toggle } from '../components/ui'
import { useUpdateWorkspace } from '../data/mutations'
import { formatDate, formatPKR } from '../domain/format'
import { useOnline } from '../lib/hooks'
import { clearPin, hasPin, isValidPin, setPin } from '../lib/pin'
import { useWorkspace } from '../lib/workspace'

export default function Settings() {
  const { workspace, role } = useWorkspace()
  const update = useUpdateWorkspace()
  const toast = useToast()
  const online = useOnline()
  const isOwner = role === 'owner'
  const [days, setDays] = useState(String(workspace.auto_archive_days ?? 14))
  const [rate, setRate] = useState(String(workspace.dtf_cost_per_meter))
  const rateNum = Number(rate.replace(',', '.'))
  const rateValid = rate.trim() !== '' && Number.isFinite(rateNum) && rateNum >= 0 && rateNum <= 100000
  const autoOn = workspace.auto_archive_days != null

  const [pinOn, setPinOn] = useState(hasPin())
  const [pin1, setPin1] = useState('')
  const [pin2, setPin2] = useState('')
  const [pinErr, setPinErr] = useState<string | null>(null)

  const savePin = async () => {
    if (!isValidPin(pin1)) return setPinErr('Enter exactly 4 digits')
    if (pin1 !== pin2) return setPinErr('PINs do not match')
    await setPin(pin1)
    setPinOn(true)
    setPin1('')
    setPin2('')
    setPinErr(null)
    toast({ tone: 'success', message: 'App lock PIN set on this device' })
  }

  return (
    <>
      <PageHeader title="Settings" back />

      <SectionTitle>Batches</SectionTitle>
      <Card className="flex flex-col gap-3">
        <Toggle
          label="Auto-archive complete batches"
          description={isOwner ? 'Archived batches stay in reports and search.' : 'Only the workspace owner can change this.'}
          checked={autoOn}
          disabled={!online || !isOwner}
          onChange={(v) => update.mutate({ auto_archive_days: v ? Math.max(1, Number(days) || 14) : null })}
        />
        {autoOn && (
          <div className="flex items-end gap-2">
            <TextField
              label="Archive after (days)"
              inputMode="numeric"
              className="flex-1"
              value={days}
              onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))}
              disabled={!isOwner}
            />
            <Button
              disabled={!online || !isOwner || !days || Number(days) < 1 || Number(days) > 365}
              loading={update.isPending}
              onClick={() => update.mutate({ auto_archive_days: Number(days) }, { onSuccess: () => toast({ tone: 'success', message: 'Saved' }) })}
            >
              Save
            </Button>
          </div>
        )}
      </Card>

      <SectionTitle>DTF printing cost</SectionTitle>
      <Card className="flex flex-col gap-3">
        <div className="flex items-end gap-2">
          <TextField
            label="DTF cost per meter (PKR)"
            inputMode="decimal"
            className="flex-1"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            disabled={!isOwner}
            error={rate.trim() !== '' && !rateValid ? 'Enter an amount like 100 or 112.50' : undefined}
          />
          <Button
            disabled={!online || !isOwner || !rateValid || rateNum === workspace.dtf_cost_per_meter}
            loading={update.isPending}
            onClick={() =>
              update.mutate(
                { dtf_cost_per_meter: Math.round(rateNum * 100) / 100 },
                { onSuccess: () => toast({ tone: 'success', message: `DTF rate set to ${formatPKR(rateNum)} per meter` }) },
              )
            }
          >
            Save
          </Button>
        </div>
        <p className="text-xs text-muted">
          Used for DTF files marked ready from now on. Files already marked ready keep the rate that applied at that time, so past costs never change.
          {!isOwner && ' Only the workspace owner can change this.'} Suppliers never see this rate.
        </p>
      </Card>

      <SectionTitle>Backup</SectionTitle>
      <Card className="flex items-center justify-between gap-3 text-sm">
        <div>
          <div className="text-xs text-muted">Last backup</div>
          <div className="font-semibold">{workspace.last_backup_at ? formatDate(workspace.last_backup_at) : 'Never'}</div>
        </div>
        <Link to="/more/data" className="inline-flex min-h-11 items-center rounded-xl border border-border px-4 font-medium hover:bg-surface-2">
          Back up now
        </Link>
      </Card>

      <SectionTitle>App lock (this device)</SectionTitle>
      <Card className="flex flex-col gap-3">
        <p className="flex items-start gap-2 text-xs text-muted">
          <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden />
          A 4-digit PIN to stop casual snooping when someone picks up your phone. Convenience lock only — not real security. Only a salted hash is stored, on this device.
        </p>
        {pinOn ? (
          <Button
            variant="danger"
            onClick={() => {
              clearPin()
              setPinOn(false)
              toast({ message: 'App lock removed' })
            }}
          >
            Remove PIN
          </Button>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <TextField label="New PIN" type="password" inputMode="numeric" maxLength={4} autoComplete="new-password" value={pin1} onChange={(e) => setPin1(e.target.value.replace(/\D/g, ''))} />
              <TextField label="Repeat PIN" type="password" inputMode="numeric" maxLength={4} autoComplete="new-password" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} error={pinErr ?? undefined} />
            </div>
            <Button variant="primary" icon={KeyRound} onClick={() => void savePin()} disabled={pin1.length !== 4 || pin2.length !== 4}>
              Set PIN
            </Button>
          </>
        )}
      </Card>
    </>
  )
}
