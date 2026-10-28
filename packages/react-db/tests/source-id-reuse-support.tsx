import { Component } from 'react'
import { createCollection } from '@tanstack/db'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import type { ReactNode } from 'react'

// Shared fixtures for the React source ID reuse tests. The reuse law is owned by
// source-id-reuse-oracle.test.tsx; ordinary pinned tests live in source-id-reuse.test.tsx.
export type Row = { id: string; value: string; rank: number }

export class TestErrorBoundary extends Component<
  { children: ReactNode },
  { error?: Error }
> {
  state: { error?: Error } = {}

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    return this.state.error ? <div>Rejected</div> : this.props.children
  }
}

export function source(id: string, value: string) {
  return createCollection(
    mockSyncCollectionOptions<Row>({
      id,
      getKey: (row) => row.id,
      initialData: [{ id: `one`, value, rank: 1 }],
    }),
  )
}
