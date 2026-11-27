import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useLiveQuery } from '@tanstack/react-db'
import { ssrTodoCollection } from '../lib/ssr-fixture'

export const Route = createFileRoute(`/disabled-query`)({
  component: DisabledQueryRoute,
})

function DisabledQueryRoute() {
  const [hydrated, setHydrated] = React.useState(false)
  const [id] = React.useState<string | undefined>(undefined)
  const { status } = useLiveQuery({
    query: (q) =>
      id === undefined ? undefined : q.from({ todo: ssrTodoCollection }),
  })
  React.useEffect(() => setHydrated(true), [])
  return (
    <main>
      <span data-testid="hydration-state">{hydrated ? `hydrated` : `ssr`}</span>
      <span data-testid="query-status">{status}</span>
    </main>
  )
}
