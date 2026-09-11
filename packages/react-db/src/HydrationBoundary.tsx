'use client'

import { useRef } from 'react'
import { useDbClient } from './DbProvider'
import type { DehydratedDbState } from '@tanstack/db'
import type { ReactNode } from 'react'

export type HydrationBoundaryProps = {
  state: DehydratedDbState
  children?: ReactNode
}

export function HydrationBoundary({ state, children }: HydrationBoundaryProps) {
  const client = useDbClient()
  const hydrated = useRef<
    { client: typeof client; state: DehydratedDbState } | undefined
  >(undefined)

  if (hydrated.current?.client !== client || hydrated.current.state !== state) {
    client.hydrate(state)
    hydrated.current = { client, state }
  }

  return children
}
