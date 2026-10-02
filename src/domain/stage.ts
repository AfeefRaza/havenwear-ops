import { daysBetween, isoDateOf } from './dates'

export type BatchStage = 'empty' | 'in_progress' | 'complete' | 'archived'

export const STAGE_LABEL: Record<BatchStage, string> = {
  empty: 'No products yet',
  in_progress: 'In progress',
  complete: 'Complete',
  archived: 'Archived',
}

export interface StageItem {
  status: 'pending' | 'received' | 'cancelled'
  updated_at?: string
}

export function batchStage(batch: { archived_at: string | null }, items: readonly StageItem[]): BatchStage {
  if (batch.archived_at) return 'archived'
  if (items.length === 0) return 'empty'
  if (items.some((i) => i.status === 'pending')) return 'in_progress'
  return 'complete'
}

/** Summary counts used when the caller only has aggregates (e.g. from a database view). */
export function stageFromCounts(archived: boolean, lines: number, pendingLines: number): BatchStage {
  if (archived) return 'archived'
  if (lines === 0) return 'empty'
  return pendingLines > 0 ? 'in_progress' : 'complete'
}

/**
 * Should a complete batch be auto-archived? It must have been complete for at least `days`
 * days, measured from its most recent item change.
 */
export function shouldAutoArchive(
  stage: BatchStage,
  lastItemChange: string | null,
  days: number | null,
  today: string,
): boolean {
  if (stage !== 'complete' || !days || days < 1 || !lastItemChange) return false
  return daysBetween(isoDateOf(lastItemChange), today) >= days
}
