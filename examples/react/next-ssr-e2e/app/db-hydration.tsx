'use client'

import { useState } from 'react'
import { DbClient } from '@tanstack/db'
import { DbProvider, HydrationBoundary } from '@tanstack/react-db'
import type { DehydratedDbState } from '@tanstack/db'
import type { ReactNode } from 'react'

export function DbHydration({
  state,
  children,
}: {
  state: DehydratedDbState
  children: ReactNode
}) {
  const [client] = useState(() => new DbClient({ runtime: `browser` }))

  return (
    <DbProvider client={client}>
      <HydrationBoundary state={state}>{children}</HydrationBoundary>
    </DbProvider>
  )
}
