import { Minus, Plus, type LucideIcon } from 'lucide-react'
import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { cn, haptic } from '../lib/hooks'

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'ok'
const VARIANT: Record<Variant, string> = {
  primary: 'bg-primary text-primary-fg hover:opacity-90',
  secondary: 'bg-surface text-text border border-border hover:bg-surface-2',
  ghost: 'text-text hover:bg-surface-2',
  danger: 'bg-bad-bg text-bad border border-bad/30 hover:brightness-95',
  ok: 'bg-ok-bg text-ok border border-ok/30 hover:brightness-95',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'md' | 'lg' | 'icon'
  icon?: LucideIcon
  loading?: boolean
  block?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, loading, block, className, children, onClick, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      onClick={(e) => {
        haptic('tap')
        onClick?.(e)
      }}
      className={cn(
        'inline-flex select-none items-center justify-center gap-2 rounded-xl font-medium transition active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50',
        size === 'md' && 'min-h-11 px-4 text-sm',
        size === 'lg' && 'min-h-13 px-5 text-base',
        size === 'icon' && 'size-11 shrink-0',
        block && 'w-full',
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
      ) : (
        Icon && <Icon className="size-5 shrink-0" aria-hidden />
      )}
      {children}
    </button>
  )
})

// ---------------------------------------------------------------------------
// Card / Section
// ---------------------------------------------------------------------------
export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-2xl border border-border bg-surface p-4', className)} {...rest}>
      {children}
    </div>
  )
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-center justify-between gap-2 px-1">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{children}</h2>
      {action}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Form fields (every control has a visible label)
// ---------------------------------------------------------------------------
interface FieldWrap {
  label: string
  hint?: string
  error?: string
  className?: string
}

function Field({ id, label, hint, error, className, children }: FieldWrap & { id: string; children: ReactNode }) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-err`} className="text-sm text-bad" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

const control =
  'w-full rounded-xl border border-border bg-surface px-3 text-base text-text placeholder:text-muted/70 focus:border-info focus:outline-none aria-[invalid=true]:border-bad'

export function TextField({ label, hint, error, className, ...props }: FieldWrap & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()
  return (
    <Field id={id} label={label} hint={hint} error={error} className={className}>
      <input
        id={id}
        className={cn(control, 'min-h-11')}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
        {...props}
      />
    </Field>
  )
}

export function TextArea({ label, hint, error, className, ...props }: FieldWrap & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId()
  return (
    <Field id={id} label={label} hint={hint} error={error} className={className}>
      <textarea
        id={id}
        className={cn(control, 'py-2')}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
        {...props}
      />
    </Field>
  )
}

export function SelectField({
  label,
  hint,
  error,
  className,
  children,
  ...props
}: FieldWrap & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId()
  return (
    <Field id={id} label={label} hint={hint} error={error} className={className}>
      <select id={id} className={cn(control, 'min-h-11')} aria-invalid={!!error} {...props}>
        {children}
      </select>
    </Field>
  )
}

export function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="flex min-h-11 items-center justify-between gap-4">
      <label htmlFor={id} className="flex flex-col">
        <span className="text-sm font-medium">{label}</span>
        {description && <span className="text-xs text-muted">{description}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => {
          haptic('tap')
          onChange(!checked)
        }}
        className={cn(
          'relative h-8 w-13 shrink-0 rounded-full border transition disabled:opacity-50',
          checked ? 'border-ok bg-ok' : 'border-border bg-surface-2',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-6.5 rounded-full bg-white shadow transition-all',
            checked ? 'left-[calc(100%-1.75rem)]' : 'left-0.5',
          )}
        />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stepper (large +/- for quantities)
// ---------------------------------------------------------------------------
export function Stepper({
  label,
  value,
  onChange,
  min = 0,
  max = 9999,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
}) {
  const id = useId()
  const set = (v: number) => onChange(Math.max(min, Math.min(max, Number.isFinite(v) ? Math.trunc(v) : min)))
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="text-base font-medium">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <Button size="icon" icon={Minus} aria-label={`Decrease ${label}`} onClick={() => set(value - 1)} disabled={value <= min} />
        <input
          id={id}
          inputMode="numeric"
          pattern="[0-9]*"
          className={cn(control, 'tabular h-11 w-16 text-center text-lg font-semibold')}
          value={String(value)}
          onChange={(e) => set(Number(e.target.value.replace(/\D/g, '') || 0))}
          onFocus={(e) => e.target.select()}
        />
        <Button size="icon" icon={Plus} aria-label={`Increase ${label}`} onClick={() => set(value + 1)} disabled={value >= max} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Status pill — always icon/text, never colour alone
// ---------------------------------------------------------------------------
export type Tone = 'ok' | 'warn' | 'bad' | 'neutral' | 'info'
const TONE: Record<Tone, string> = {
  ok: 'bg-ok-bg text-ok',
  warn: 'bg-warn-bg text-warn',
  bad: 'bg-bad-bg text-bad',
  neutral: 'bg-surface-2 text-muted',
  info: 'bg-surface-2 text-info',
}

export function Pill({ tone = 'neutral', icon: Icon, children, className }: { tone?: Tone; icon?: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold', TONE[tone], className)}>
      {Icon && <Icon className="size-3.5" aria-hidden />}
      {children}
    </span>
  )
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
    >
      <div className={cn('h-full rounded-full transition-all', pct === 100 ? 'bg-ok' : 'bg-primary')} style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden />
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-20" />
      ))}
    </div>
  )
}

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-10 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-surface-2 text-muted">
        <Icon className="size-6" aria-hidden />
      </span>
      <h3 className="text-base font-semibold">{title}</h3>
      {children && <div className="max-w-sm text-sm text-muted">{children}</div>}
      {action}
    </div>
  )
}

export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : 'Could not load data.'
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-xl bg-bad-bg p-3 text-sm text-bad">
      <span>{msg}</span>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  )
}

/** Segmented control (accessible radio group). */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { id: T; label: string; count?: number }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-xl bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => {
            haptic('tap')
            onChange(o.id)
          }}
          className={cn(
            'min-h-10 flex-1 whitespace-nowrap rounded-lg px-2 text-sm font-medium transition',
            value === o.id ? 'bg-surface text-text shadow-sm' : 'text-muted',
          )}
        >
          {o.label}
          {o.count != null && <span className="tabular ml-1 text-xs opacity-70">{o.count}</span>}
        </button>
      ))}
    </div>
  )
}
