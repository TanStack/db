import { Suspense } from 'react'
import { DbClient } from '@tanstack/db'
import { DbHydration } from './db-hydration'
import { streamedTodoQuery } from './ssr-fixture'
import { StreamedTodos } from './streamed-todos'

export const dynamic = `force-dynamic`

export default function Page() {
  const dbClient = new DbClient({ runtime: `server` })
  void dbClient.preloadLiveQuery(streamedTodoQuery)
  const state = dbClient.dehydrate({
    shouldDehydrateCollection: () => false,
    shouldDehydrateLiveQuery: () => true,
  })

  return (
    <main>
      <h1>TanStack DB Next.js SSR</h1>
      <DbHydration state={state}>
        <Suspense fallback={<p data-testid="stream-fallback">Loading todos</p>}>
          <StreamedTodos />
        </Suspense>
      </DbHydration>
    </main>
  )
}
