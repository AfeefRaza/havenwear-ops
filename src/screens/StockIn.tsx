import { lazy, Suspense } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Segmented, Skeleton } from '../components/ui'

const Returns = lazy(() => import('./Returns'))
const Deliveries = lazy(() => import('./Deliveries'))

/** "Stock in" tab: the existing Returns and Supplier deliveries screens, unchanged, behind one switch. */
export default function StockIn() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'supplier' ? 'supplier' : 'returns'
  return (
    <>
      <div className="pt-safe pt-3">
        <Segmented
          label="Stock in"
          value={tab}
          onChange={(t) => setParams({ tab: t }, { replace: true })}
          options={[
            { id: 'returns', label: 'Returns' },
            { id: 'supplier', label: 'Supplier deliveries' },
          ]}
        />
      </div>
      <Suspense fallback={<Skeleton className="mt-4 h-64" />}>{tab === 'returns' ? <Returns /> : <Deliveries />}</Suspense>
    </>
  )
}
