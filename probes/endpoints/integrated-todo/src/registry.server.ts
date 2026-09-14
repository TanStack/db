import { refreshAfterMutation } from './refresh.server.ts'
import { randomUUID } from 'node:crypto'
import { intersects, type Dependencies } from './dependencies.server.ts'
export type QueryInstance = {
  id: string
  definition: string
  version: string
  params: unknown
  certificate?: string
  hasBaseline?: boolean
  optimistic?: boolean
}
type ReadContext = { scope: string }
type PreparedRead = (() => Promise<unknown>) & {
  revision?: () => Promise<string | undefined>
}
export type RegisteredQuery = {
  version: string
  relation: string
  dependencies: Dependencies
  prepare: (input: unknown, context: ReadContext) => PreparedRead
}
// This is a bounded optimization cache. Eviction or a server restart costs a
// full read; it never changes correctness. Tokens are bound to server code,
// scope and parameters, not trusted because a client supplied a revision.
const baselines = new Map<
  string,
  { query: RegisteredQuery; key: string; revision: string }
>()
function certify(query: RegisteredQuery, key: string, revision: string) {
  const token = randomUUID()
  baselines.set(token, { query, key, revision })
  if (baselines.size > 1000) baselines.delete(baselines.keys().next().value!)
  return token
}
export function registerQuery<I>(
  version: string,
  relation: string,
  parse: (input: unknown) => I,
  read: (input: I, context: ReadContext) => Promise<unknown>,
  revision?: () => Promise<string | undefined>,
  dependencies: Dependencies = null,
): RegisteredQuery {
  return {
    version,
    relation,
    dependencies,
    prepare(input, context) {
      const parsed = parse(input)
      return Object.assign(() => read(parsed, context), { revision })
    },
  }
}
export async function refreshRegisteredMutation<T>(
  requests: ReadonlyArray<QueryInstance>,
  registry: Readonly<Record<string, RegisteredQuery>>,
  mutate: () => Promise<T>,
  context: ReadContext,
  writeDependencies?: () => Dependencies | Promise<Dependencies>,
) {
  const reads: Record<string, () => Promise<unknown>> = Object.create(null)
  const groups: Record<string, string> = Object.create(null)
  const prepared = new Map<
    string,
    {
      query: RegisteredQuery
      read: PreparedRead
      key: string
      request: QueryInstance
    }
  >()
  const revisions = new Map<string, string>()
  const certificates: Record<string, string> = Object.create(null)
  const captured = new Map<
    NonNullable<PreparedRead['revision']>,
    Promise<string | undefined>
  >()
  // Capture and validate every descriptor before the write. Registration is
  // server-owned; neither SQL, auth scope nor executable code comes from it.
  try {
    if (requests.length > 100) throw Error('Too many retained query instances')
    for (const request of requests) {
      if (
        Object.hasOwn(reads, request.id) ||
        !Object.hasOwn(registry, request.definition)
      )
        throw Error('Unknown or duplicate retained query instance')
      const query = registry[request.definition]!
      if (query.version !== request.version)
        throw Error('Stale query definition; reload the client')
      const read = query.prepare(request.params, context)
      const key = JSON.stringify([
        request.id,
        request.definition,
        request.version,
        context.scope,
        request.params,
      ])
      prepared.set(request.id, { query, read, key, request })
      reads[request.id] = async () => {
        const rows = await read()
        const revision = revisions.get(request.id)
        if (revision !== undefined)
          certificates[request.id] = certify(query, key, revision)
        return rows
      }
      groups[request.id] = query.relation
    }
  } catch (error) {
    return {
      kind: 'not-started' as const,
      message:
        error instanceof Error ? error.message : 'Query admission rejected',
    }
  }
  const result = await refreshAfterMutation(
    requests,
    reads,
    mutate,
    groups,
    async (id) => {
      const entry = prepared.get(id)!
      // Capture before SELECT. A concurrent commit after capture can make this
      // certificate conservative, but cannot attach a newer revision to old rows.
      let revision: string | undefined
      if (entry.read.revision) {
        let capture = captured.get(entry.read.revision)
        if (!capture) {
          capture = Promise.resolve()
            .then(entry.read.revision)
            .catch(() => undefined)
          captured.set(entry.read.revision, capture)
        }
        revision = await capture
      }
      if (revision === undefined) return undefined
      revisions.set(id, revision)
      const token = entry.request.certificate
      const previous = token === undefined ? undefined : baselines.get(token)
      if (
        previous?.query === entry.query &&
        previous.key === entry.key &&
        previous.revision === revision
      )
        return token
      return undefined
    },
    async () => {
      let writes: Dependencies = null
      try {
        writes = (await writeDependencies?.()) ?? null
      } catch {
        // Failure to prove effects costs reads, never correctness or the write.
      }
      const changed = writes === null ? null : new Set(writes)
      return new Set(
        [...prepared]
          .filter(
            ([, { query, request }]) =>
              request.hasBaseline !== true ||
              request.optimistic !== false ||
              intersects(query.dependencies, changed),
          )
          .map(([id]) => id),
      )
    },
  )
  return result.kind === 'read-error' || Object.keys(certificates).length === 0
    ? result
    : {
        ...result,
        certificates: Object.entries(certificates).map(([id, certificate]) => ({
          id,
          certificate,
        })),
      }
}
