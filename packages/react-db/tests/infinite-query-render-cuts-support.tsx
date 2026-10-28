import { Component } from 'react'
import { createCollection } from '@tanstack/db'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import type { ReactNode } from 'react'

// Shared fixtures for the infinite query render-cut tests. The laws are owned by
// infinite-query-render-cuts-oracle.test.tsx, and the ordinary pinned tests live in
// infinite-query-render-cuts.test.tsx.
export type Row = { id: string; label: string; rank: number }

export const cleanups: Array<() => Promise<void> | void> = []
let sequence = 0
export function nextSequence(): number {
  return sequence++
}

export const PAGE_SIZE = 2

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error?: Error }
> {
  state: { error?: Error } = {}
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    return this.state.error ? (
      <div>Rejected: {this.state.error.message}</div>
    ) : (
      this.props.children
    )
  }
}

export function rows(count: number): Array<Row> {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index + 1),
    label: `row-${index + 1}`,
    rank: count - index,
  }))
}

export function makeSyncSource(count: number) {
  const source = createCollection(
    mockSyncCollectionOptions<Row>({
      id: `infinite-render-cuts-${nextSequence()}`,
      getKey: (row) => row.id,
      autoIndex: `eager`,
      initialData: rows(count),
    }),
  )
  cleanups.push(() => source.cleanup())
  return source
}
