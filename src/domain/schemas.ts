import { z } from 'zod'

/**
 * Zod schemas for every row that comes back from the database.
 * Postgres `numeric` arrives as number from PostgREST; we coerce defensively.
 */
const money = z.coerce.number().finite()
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
const ts = z.string()
const uuid = z.string().uuid()

export const PaymentStatus = z.enum(['unpaid', 'partially_paid', 'paid'])
export const ItemStatus = z.enum(['pending', 'received', 'cancelled'])
export const ReceivedFrom = z.enum(['supplier', 'return'])
export const AdjustmentKind = z.enum(['opening', 'adjustment'])

export const WorkspaceRow = z.object({
  id: uuid,
  name: z.string(),
  auto_archive_days: z.number().int().nullable(),
  last_backup_at: ts.nullable(),
  created_at: ts,
  updated_at: ts,
})

export const MemberRow = z.object({
  workspace_id: uuid,
  user_id: uuid,
  role: z.enum(['owner', 'member']),
  created_at: ts,
})

export const CategoryRow = z.object({
  id: uuid,
  workspace_id: uuid,
  name: z.string(),
  default_cost_pkr: money,
  low_stock_level: z.number().int(),
  sort_order: z.number().int(),
  created_at: ts,
  updated_at: ts,
})

export const RuleRow = z.object({
  id: uuid,
  workspace_id: uuid,
  keyword: z.string(),
  category_id: uuid,
  cost_override_pkr: money.nullable(),
  supplier: z.string().nullable(),
  active: z.boolean(),
  notes: z.string().nullable(),
  sort_order: z.number().int(),
  created_seq: z.coerce.number(),
  created_at: ts,
  updated_at: ts,
})

export const BatchRow = z.object({
  id: uuid,
  workspace_id: uuid,
  ref: z.string(),
  batch_date: isoDate,
  supplier: z.string().nullable(),
  invoice_ref: z.string().nullable(),
  actual_bill_pkr: money.nullable(),
  payment_status: PaymentStatus,
  notes: z.string().nullable(),
  archived_at: ts.nullable(),
  created_at: ts,
  updated_at: ts,
})

export const ItemRow = z.object({
  id: uuid,
  workspace_id: uuid,
  batch_id: uuid,
  product_name: z.string(),
  qty: z.number().int().positive(),
  status: ItemStatus,
  received_from: ReceivedFrom.nullable(),
  received_date: isoDate.nullable(),
  category_override_id: uuid.nullable(),
  resolved_category_id: uuid.nullable(),
  matched_rule_id: uuid.nullable(),
  unit_cost_pkr: money,
  notes: z.string().nullable(),
  created_at: ts,
  updated_at: ts,
})

export const ReturnReceiptRow = z.object({
  id: uuid,
  workspace_id: uuid,
  date: isoDate,
  reference: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: ts,
  updated_at: ts,
})

export const ReturnLineRow = z.object({
  id: uuid,
  workspace_id: uuid,
  receipt_id: uuid,
  category_id: uuid,
  qty: z.number().int().positive(),
  created_at: ts,
  updated_at: ts,
})

export const DeliveryRow = z.object({
  id: uuid,
  workspace_id: uuid,
  date: isoDate,
  supplier: z.string().nullable(),
  reference: z.string().nullable(),
  batch_id: uuid.nullable(),
  notes: z.string().nullable(),
  created_at: ts,
  updated_at: ts,
})

export const DeliveryLineRow = z.object({
  id: uuid,
  workspace_id: uuid,
  delivery_id: uuid,
  category_id: uuid,
  qty: z.number().int().positive(),
  created_at: ts,
  updated_at: ts,
})

export const AdjustmentRow = z.object({
  id: uuid,
  workspace_id: uuid,
  date: isoDate,
  category_id: uuid,
  qty: z.number().int(),
  kind: AdjustmentKind,
  notes: z.string().nullable(),
  created_at: ts,
  updated_at: ts,
})

export type Workspace = z.infer<typeof WorkspaceRow>
export type Member = z.infer<typeof MemberRow>
export type Category = z.infer<typeof CategoryRow>
export type Rule = z.infer<typeof RuleRow>
export type Batch = z.infer<typeof BatchRow>
export type Item = z.infer<typeof ItemRow>
export type ReturnReceipt = z.infer<typeof ReturnReceiptRow>
export type ReturnLine = z.infer<typeof ReturnLineRow>
export type Adjustment = z.infer<typeof AdjustmentRow>
export type ItemStatusT = z.infer<typeof ItemStatus>
export type ReceivedFromT = z.infer<typeof ReceivedFrom>
export type PaymentStatusT = z.infer<typeof PaymentStatus>

/** Parse an array of rows, throwing a readable error if the database returned something unexpected. */
export function parseRows<T>(schema: z.ZodType<T>, rows: unknown, what: string): T[] {
  const res = z.array(schema).safeParse(rows ?? [])
  if (!res.success) {
    const issue = res.error.issues[0]
    throw new Error(`Unexpected ${what} data from server (${issue?.path.join('.')}: ${issue?.message})`)
  }
  return res.data
}

// ---------------------------------------------------------------------------
// Form schemas
// ---------------------------------------------------------------------------
const optionalText = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v === '' ? null : v))
  .nullable()

const optionalMoney = z
  .union([z.literal(''), z.coerce.number().finite().min(0, 'Must be 0 or more').max(100_000_000)])
  .transform((v) => (v === '' ? null : v))
  .nullable()

export const BatchForm = z.object({
  ref: z.string().trim().min(1, 'Batch ref is required').max(40),
  batch_date: isoDate,
  supplier: optionalText,
  invoice_ref: optionalText,
  actual_bill_pkr: optionalMoney,
  payment_status: PaymentStatus,
  notes: optionalText,
})
export type BatchFormT = z.input<typeof BatchForm>

export const CategoryForm = z.object({
  name: z.string().trim().min(1, 'Name is required').max(40),
  default_cost_pkr: z.coerce.number().finite().min(0).max(1_000_000),
  low_stock_level: z.coerce.number().int().min(0).max(100_000),
})

export const RuleForm = z.object({
  keyword: z.string().trim().min(1, 'Keyword is required').max(80),
  category_id: uuid,
  cost_override_pkr: optionalMoney,
  supplier: optionalText,
  active: z.boolean(),
  notes: optionalText,
})

export const ItemForm = z.object({
  product_name: z.string().trim().min(1, 'Product name is required').max(300),
  qty: z.coerce.number().int().min(1).max(9999),
  category_override_id: uuid.nullable(),
  notes: optionalText,
})

export const AdjustmentForm = z.object({
  date: isoDate,
  category_id: uuid,
  qty: z.coerce.number().int().refine((n) => n !== 0, 'Quantity cannot be 0'),
  kind: AdjustmentKind,
  notes: optionalText,
})
