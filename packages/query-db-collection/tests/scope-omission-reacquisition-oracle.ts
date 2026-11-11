/**
 * Scope-local omission ends a direct row's lifetime. A distinct retained Query
 * remains usable under Infinity stale/gc rules. Acquiring that retained Query
 * projects its own result after A removed the direct row.
 * Authority: Query guide Direct Writes and Query Sync, paragraphs on complete
 * scope omission and released-row reacquisition.
 * Primary owner: ownership-lifecycle oracle. This receiving extension reuses its
 * direct/fetch overlay judgment and adds retained-scope next-use observations.
 *
 * Two overlapping exact predicates, one ownerless insert/upsert, a later
 * complete A response, and optional sibling y. No transport failures, stale
 * refetch, window/cursor, cache edits, concurrent writer or arbitrary schedules.
 */
import fc from 'fast-check'
import { QueryClient } from '@tanstack/query-core'
import { IR, createCollection, eq } from '@tanstack/db'
import { untilStartup } from '../../db-adapter-conformance/tests/persisted-startup-driver'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { queryCollectionOptions } from '../src/query'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { mergeDirectWritesOverFetch } from './direct-write-precedence-oracle'
import type { SyncPersistenceCapabilityV1 } from '@tanstack/db'
import type { PersistedCollectionPersistence } from '../../db-sqlite-persistence-core/src'
import type {
  ConstructedHistory,
  Observation,
  OraclePropertyOptions,
} from '../../db/tests/oracle-property'

type Row = { id: string; value: number; category: string }
type Response = Array<Row> | { edges: Array<{ node: Row }> }
export type History = {
  shape: 'raw' | 'derived'
  operation: 'insert' | 'upsert'
  cacheOrder: 'before-write' | 'after-write'
  includesDirect: boolean
  sibling: boolean
  bValue: number
  directValue: number
  sourceValue: number
  siblingValue: number
}
export const arbitrary = fc.record({
  shape: fc.constantFrom('raw' as const, 'derived' as const),
  operation: fc.constantFrom('insert' as const, 'upsert' as const),
  cacheOrder: fc.constantFrom('before-write' as const, 'after-write' as const),
  includesDirect: fc.boolean(),
  sibling: fc.boolean(),
  bValue: fc.integer({ min: -10, max: 10 }),
  directValue: fc.integer({ min: -10, max: 10 }),
  sourceValue: fc.integer({ min: -10, max: 10 }),
  siblingValue: fc.integer({ min: -10, max: 10 }),
})
export const states = [
  'raw',
  'derived',
  'insert',
  'upsert',
  'old-cache-after-omission',
  'new-cache-after-omission',
  'returned-direct-key',
  'nonempty-omission',
] as const
export const obligations = new WeakMap<History, ReadonlyArray<string>>()
export const constructed: Array<ConstructedHistory<History>> = states.map(
  (state) => ({
    name: state,
    enters: [state],
    build(h) {
      const n = { ...h }
      if (state === 'raw' || state === 'derived') n.shape = state
      if (state === 'insert' || state === 'upsert') n.operation = state
      if (
        state === 'old-cache-after-omission' ||
        state === 'new-cache-after-omission'
      ) {
        n.includesDirect = false
        n.cacheOrder =
          state === 'old-cache-after-omission' ? 'before-write' : 'after-write'
      }
      if (state === 'returned-direct-key') n.includesDirect = true
      if (state === 'nonempty-omission') {
        n.includesDirect = false
        n.sibling = true
      }
      obligations.set(n, [state])
      return n
    },
  }),
)
const sourceRows = (h: History): Array<Row> => [
  ...(h.includesDirect
    ? [{ id: 'x', value: h.sourceValue, category: 'shared' }]
    : []),
  ...(h.sibling
    ? [{ id: 'y', value: h.siblingValue, category: 'shared' }]
    : []),
]
/** A later complete A response retires the direct row when absent. B then
 * starts a new lifetime from its retained result. If A returns x, A already
 * owns its newer value when B acquires, so B cannot revert that value. */
export function expected(h: History) {
  const direct = { id: 'x', value: h.directValue }
  const afterA = mergeDirectWritesOverFetch(sourceRows(h), [])
  return {
    direct: mergeDirectWritesOverFetch([], [direct]),
    afterA,
    acquired: { ...afterA, ...(!h.includesDirect ? { x: h.bValue } : {}) },
    fetches: 2,
  }
}
export async function observeScope(
  persistence: PersistedCollectionPersistence | undefined,
  h: History,
  id: string,
  observe: (cut: string, value: unknown) => void,
) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
    },
  })
  const encode = (rows: Array<Row>): Response =>
    h.shape === 'raw' ? rows : { edges: rows.map((node) => ({ node })) }
  const decode = (response: Response) =>
    Array.isArray(response)
      ? response
      : response.edges.map(({ node }) => ({ ...node }))
  const bRow = { id: 'x', value: h.bValue, category: 'shared' }
  const direct = { ...bRow, value: h.directValue }
  const b = { where: eq(new IR.PropRef(['id']), 'x') }
  const a = { where: eq(new IR.PropRef(['category']), 'shared') }
  let calls = 0
  let deliveredA: Array<Row> | undefined
  const events: Array<string> = []
  let scan:
    | SyncPersistenceCapabilityV1<string | number>['scanPersistedRows']
    | undefined
  const responses = [encode([bRow]), encode(sourceRows(h))]
  const makeOptions = (suffix: string) =>
    queryCollectionOptions({
      id: id + suffix,
      queryKey: [id],
      queryClient: client,
      queryFn: () => {
        events.push(calls === 0 ? 'fetch-b' : 'fetch-a')
        const response = responses[calls++]
        if (!response) throw new Error('Unexpected source request ' + calls)
        if (calls === 2) deliveredA = decode(response)
        return Promise.resolve(response)
      },
      select: decode,
      getKey: (row: Row) => row.id,
      syncMode: 'on-demand',
      staleTime: Infinity,
      startSync: true,
    })
  const base = makeOptions('')
  const sourceSync = base.sync.sync
  const wrapped = {
    ...base,
    sync: {
      ...base.sync,
      sync: (params: Parameters<typeof sourceSync>[0]) => {
        scan = params.metadata?.persistence?.scanPersistedRows
        return sourceSync(params)
      },
    },
  }
  const main = createCollection(
    persistence
      ? persistedCollectionOptions({ ...wrapped, persistence })
      : wrapped,
  )
  const peerB = createCollection(makeOptions('-peer-b'))
  const values = (collection: { values: () => Iterable<Row> }) =>
    Object.fromEntries(
      Array.from(collection.values(), (row) => [row.id, row.value]).sort(
        ([left], [right]) => String(left).localeCompare(String(right)),
      ),
    )
  const record = async (cut: string) => {
    const snapshot = values(main)
    observe(cut, snapshot)
    if (persistence) {
      if (!scan) throw new Error('Missing durable receiving scan')
      const rows = await scan()
      observe(
        cut + 'Durable',
        Object.fromEntries(
          rows
            .map((row) => {
              const value = row.value as Row
              return [value.id, value.value]
            })
            .sort(([left], [right]) =>
              String(left).localeCompare(String(right)),
            ),
        ),
      )
    }
    return snapshot
  }
  const acquirePeers = async () => {
    await peerB._sync.loadSubset(b)
  }
  await withOracleCleanup(async () => {
    await untilStartup(() => main.status === 'ready')
    if (h.cacheOrder === 'before-write') await acquirePeers()
    if (h.operation === 'insert') await main.utils.writeInsert(direct)
    else await main.utils.writeUpsert(direct)
    events.push('write-accepted')
    const directRows = await record('direct')
    if (h.cacheOrder === 'after-write') await acquirePeers()
    // The physical B entry is retained by a distinct real Collection, not seeded
    // with setQueryData. Derived select has no inverse; raw shared entries also
    // stay unchanged under the on-demand direct-write rule.
    const retainedRows = values(peerB)
    observe('retainedB', retainedRows)
    const cachedResponse = client.getQueryCache().findAll({ queryKey: [id] })[0]
      ?.state.data
    const shape = Array.isArray(cachedResponse)
      ? 'raw'
      : cachedResponse !== null &&
          typeof cachedResponse === 'object' &&
          Array.isArray((cachedResponse as { edges?: unknown }).edges)
        ? 'derived'
        : undefined
    await main._sync.loadSubset(a)
    const afterA = await record('afterA')
    await main._sync.loadSubset(b)
    await record('acquired')
    observe('fetches', calls)
    const sourceReturnedX = deliveredA?.some((row) => row.id === 'x')
    const cacheBeforeWrite =
      events.indexOf('fetch-b') < events.indexOf('write-accepted')
    for (const state of [
      ...(shape ? [shape] : []),
      ...(directRows.x === h.directValue ? [h.operation] : []),
      ...(sourceReturnedX === false && !('x' in afterA) && 'x' in retainedRows
        ? [
            cacheBeforeWrite
              ? 'old-cache-after-omission'
              : 'new-cache-after-omission',
          ]
        : []),
      ...(sourceReturnedX === true && 'x' in afterA
        ? ['returned-direct-key']
        : []),
      ...(sourceReturnedX === false && !('x' in afterA) && 'y' in afterA
        ? ['nonempty-omission']
        : []),
    ])
      observe('reach', state)
    observe('completed', true)
  }, [() => main.cleanup(), () => peerB.cleanup(), () => client.clear()])
}
export function check(h: History, trace: ReadonlyArray<Observation>) {
  const wanted = expected(h)
  for (const o of trace) {
    if (o.checkpoint === 'completed' && o.value !== true)
      return {
        kind: 'violation' as const,
        checkpoint: 'completed',
        law: 'receiving completion',
        difference: 'completion was not established',
      }
    const cut = o.checkpoint.replace(/Durable$/, '')
    const answer =
      cut in wanted
        ? wanted[cut as keyof typeof wanted]
        : o.checkpoint === 'retainedB'
          ? { x: h.bValue }
          : undefined
    if (
      answer !== undefined &&
      JSON.stringify(
        typeof answer === 'number'
          ? o.value
          : Object.entries(o.value as Record<string, unknown>).sort(),
      ) !==
        JSON.stringify(
          typeof answer === 'number'
            ? answer
            : Object.entries(answer as Record<string, unknown>).sort(),
        )
    )
      return {
        kind: 'violation' as const,
        checkpoint: o.checkpoint,
        law: 'scope-local row lifetime',
        difference:
          'expected ' +
          JSON.stringify(answer) +
          ', observed ' +
          JSON.stringify(o.value),
      }
  }
  for (const cut of [
    'direct',
    'directDurable',
    'retainedB',
    'afterA',
    'afterADurable',
    'acquired',
    'acquiredDurable',
    'fetches',
    'completed',
  ])
    if (!trace.some((o) => o.checkpoint === cut))
      return {
        kind: 'violation' as const,
        checkpoint: cut,
        law: 'receiving completion',
        difference: 'missing observation',
      }
  const reached = new Set(
    trace.filter((o) => o.checkpoint === 'reach').map((o) => o.value),
  )
  const missing = (obligations.get(h) ?? []).filter((s) => !reached.has(s))
  if (missing.length)
    return {
      kind: 'violation' as const,
      checkpoint: 'constructed states',
      law: 'constructed reach',
      difference: missing.join(','),
    }
  const errors = trace
    .filter((o) => o.checkpoint === 'browserErrors')
    .flatMap((o) => o.value as Array<string>)
  if (errors.length)
    return {
      kind: 'violation' as const,
      checkpoint: 'browserErrors',
      law: 'browser diagnostics',
      difference: errors.join(';'),
    }
  return { kind: 'pass' as const }
}
export function options(
  receive: (
    h: History,
    id: string,
    observe: (cut: string, value: unknown) => void,
  ) => Promise<void>,
  host: string,
): OraclePropertyOptions<History, ReturnType<typeof expected>> {
  let sequence = 0
  return {
    id:
      host === 'chromium-opfs'
        ? 'query.scope-omission-reacquisition.chromium-opfs'
        : 'query.scope-omission-reacquisition',
    law: {
      statement:
        'A complete scoped omission retires a direct row without invalidating distinct retained Query entries; reacquisition starts a new row lifetime from its retained response.',
      authority:
        'Query guide Direct Writes and Query Sync: scope-local omission, retained-cache reacquisition.',
      limits:
        'Two matching scopes, one same-run insert/upsert, complete A response and retained B success, numeric values and successful I/O; no stale requests, window/cursor or concurrent writer.',
    },
    histories: { arbitrary, runs: 30, fixedSeeds: [1313], states, constructed },
    model: expected,
    driver: (h, observe) =>
      receive(h, 'scope-omission-' + host + '-' + sequence++, observe),
    check: (h, trace) => {
      const product = check(h, trace)
      const result =
        product.kind === 'pass' &&
        host === 'chromium-opfs' &&
        !trace.some(
          (o) => o.checkpoint === 'browserReceiver' && o.value === true,
        )
          ? {
              kind: 'violation' as const,
              checkpoint: 'browserReceiver',
              law: 'receiving completion',
              difference: 'browser receiver marker is missing',
            }
          : product
      const errors = trace
        .filter((o) => o.checkpoint === 'browserErrors')
        .flatMap((o) => o.value as Array<string>)
      return result.kind === 'violation' && errors.length
        ? {
            ...result,
            difference:
              String(result.difference) +
              '; secondary browser diagnostics: ' +
              errors.join('; '),
          }
        : result
    },
    calibrations: [
      {
        name: 'rejects omitted durable observation',
        law: 'receiving completion',
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.filter((o) => o.checkpoint !== 'afterADurable'),
      },
      {
        name: 'keeps product mismatch on truncated capture',
        law: 'scope-local row lifetime',
        corrupt: (trace: ReadonlyArray<Observation>) => {
          const at = trace.findIndex((o) => o.checkpoint === 'afterA')
          return at < 0
            ? undefined
            : trace
                .slice(0, at + 1)
                .map((o) =>
                  o.checkpoint === 'afterA'
                    ? { ...o, value: { wrong: 999 } }
                    : o,
                )
        },
      },
      {
        name: 'keeps product mismatch before false completion',
        law: 'scope-local row lifetime',
        corrupt: (trace: ReadonlyArray<Observation>) => [
          ...trace.map((o) =>
            o.checkpoint === 'afterA' ? { ...o, value: { wrong: 999 } } : o,
          ),
          { checkpoint: 'completed', value: false },
        ],
      },
      {
        name: 'keeps product mismatch before missing browser marker',
        law: 'scope-local row lifetime',
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace
            .filter((o) => o.checkpoint !== 'browserReceiver')
            .map((o) =>
              o.checkpoint === 'afterA' ? { ...o, value: { wrong: 999 } } : o,
            ),
      },
      {
        name: 'reports detached browser error',
        law: 'browser diagnostics',
        corrupt: (trace: ReadonlyArray<Observation>) => [
          ...trace,
          { checkpoint: 'browserErrors', value: ['scope detached fault'] },
        ],
      },

      ...states.map((state) => ({
        name: 'omits state ' + state,
        law: 'constructed reach',
        corrupt: (trace: ReadonlyArray<Observation>, h: History) =>
          obligations.get(h)?.includes(state)
            ? trace.filter((o) => o.checkpoint !== 'reach' || o.value !== state)
            : undefined,
      })),
      {
        name: 'loses retained row after omission',
        law: 'scope-local row lifetime',
        corrupt: (trace: ReadonlyArray<Observation>, h: History) =>
          h.includesDirect
            ? undefined
            : trace.map((o) =>
                o.checkpoint === 'acquired' ? { ...o, value: {} } : o,
              ),
      },
    ],
  }
}
/** The framework's generated construction objects differ from its seeded
 * construction objects. Exercise the same builder, receiving path and check
 * with generated inputs, then remove only its required actual reach fact. */
export async function calibrateGeneratedConstructions(
  receive: (
    h: History,
    observe: (cut: string, value: unknown) => void,
  ) => Promise<void>,
) {
  for (const input of fc.sample(arbitrary, { numRuns: 1, seed: 1313 })) {
    for (const builder of constructed) {
      const h = builder.build(input)
      const trace: Array<Observation> = []
      await receive(h, (checkpoint, value) => trace.push({ checkpoint, value }))
      const clean = check(h, trace)
      if (clean.kind !== 'pass')
        throw new Error('Clean construction failed: ' + JSON.stringify(clean))
      const corrupt = trace.filter(
        (o) =>
          o.checkpoint !== 'reach' ||
          !builder.enters.includes(o.value as string),
      )
      const result = check(h, corrupt)
      if (result.kind !== 'violation' || result.law !== 'constructed reach')
        throw new Error(
          'Generated missing-state control passed for ' + builder.name,
        )
    }
  }
}
declareOracle({
  model: [expected],
  grammar: [arbitrary],
  check: [check, calibrateGeneratedConstructions],
})
