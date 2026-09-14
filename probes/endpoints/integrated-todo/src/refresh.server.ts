// Only imported inside the generated server handler boundary.
import { encodeSnapshots } from './snapshot-encoding.server.ts'
export type ReadRequest = { id: string }
export async function refreshAfterMutation<T>(
  requests: ReadonlyArray<ReadRequest>,
  reads: Record<string, () => Promise<unknown>>,
  mutate: () => Promise<T>,
  groups?: Readonly<Record<string, string>>,
  reuse?: (id: string) => Promise<string | undefined>,
  select?: () => Promise<ReadonlySet<string>>,
) {
  // Client supplies registered identities, never SQL or handlers. Validate all
  // identities before writing; do not partly commit an invalid request.
  const ids = requests.map((request) => request.id)
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => !Object.hasOwn(reads, id))
  ) {
    throw Error('Unknown or duplicate retained endpoint identity')
  }
  // An opaque handler can commit several statements before throwing. Its
  // outcome says nothing about rollback, so reconcile either way.
  let handler:
    { kind: 'success'; result: T } | { kind: 'error'; message: string }
  try {
    handler = { kind: 'success', result: await mutate() }
  } catch (error) {
    handler = {
      kind: 'error',
      message:
        error instanceof Error ? error.message : 'Mutation handler failed',
    }
  }
  try {
    const selected = await select?.()
    const results = await Promise.all(
      ids.map(async (id) => {
        if (selected && !selected.has(id)) return { id, unaffected: true }
        const certificate = await reuse?.(id)
        if (certificate !== undefined) return { id, certificate }
        for (let attempt = 0; ; attempt++) {
          try {
            return { id, rows: await reads[id]!() }
          } catch (error) {
            if (attempt === 3) throw error
            await new Promise((resolve) =>
              setTimeout(resolve, 1000 * 2 ** attempt),
            )
          }
        }
      }),
    )
    const snapshots = results.filter(
      (result): result is { id: string; rows: unknown } => 'rows' in result,
    )
    const unchanged = results.filter(
      (result): result is { id: string; certificate: string } =>
        'certificate' in result,
    )
    const unaffected = results.filter((result) => 'unaffected' in result)
    return {
      ...encodeSnapshots(snapshots, 'adaptive', groups),
      handler,
      ...(unchanged.length ? { unchanged } : {}),
      ...(unaffected.length
        ? { unaffected: unaffected.map(({ id }) => ({ id })) }
        : {}),
    }
  } catch {
    // Do not turn a committed write into a retryable write failure.
    return {
      kind: 'read-error' as const,
      handler,
      message:
        handler.kind === 'success'
          ? 'Handler completed; authoritative reads exhausted retries'
          : 'Handler failed; writes may have committed; authoritative reads exhausted retries',
    }
  }
}
