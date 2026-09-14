import {
  DbClient,
  collectionOptions,
  type Transaction,
  type Collection,
} from '@tanstack/db'
import {
  queryCollectionOptions,
  type QueryCollectionUtils,
} from '@tanstack/query-db-collection'
import { QueryClient } from '@tanstack/query-core'
import { z } from 'zod'
import { invalidInputResponse, InvalidInputError } from './mutation-errors'
import {
  compileMembership,
  instantiateQueryModel,
  type QueryModel,
} from './coherence'
import {
  queryInstance,
  type QueryParams,
  type QueryInstance,
} from './query-instance'
export { InvalidInputError } from './mutation-errors'
export type { InputValidationIssue } from './mutation-errors'
export type Todo = {
  [column: string]: unknown
  id: string
  text: string
  completed: boolean
  createdAt: Date
}
type Scope = string
export type EndpointRow = { [column: string]: unknown; id: string }
export type EndpointCollection<O extends EndpointRow> = Collection<
  O,
  string,
  QueryCollectionUtils<O, string>
>
type SortField = 'createdAt' | 'id'
type Rpc<I, O> = (args: {
  data: { scope: Scope; input: I; reads?: ReadonlyArray<QueryInstance> }
}) => Promise<O>
type Query<I, O extends EndpointRow> = {
  kind: 'query'
  id: string
  rpc: Rpc<I, O[]>
}
type Mutation<I, O> = {
  inline?: boolean
  kind: 'mutation'
  id: string
  rpc: Rpc<I, O>
  onMutate: (context: { dbClient: EndpointRuntime; input: I }) => void
}
export function query<I, O extends EndpointRow>(config: {
  input: z.ZodType<I>
  handler(
    req: { body: I; scope: Scope },
    res: { json<T>(value: T): T },
  ): Promise<O[]>
}): Query<I, O> {
  throw Error('Compiler required')
}
export function mutation<I, O>(config: {
  input: z.ZodType<I>
  handler(
    req: { body: I; scope: Scope },
    res: { json<T>(value: T): T },
  ): Promise<O>
  onMutate(context: { dbClient: EndpointRuntime; input: I }): void
}): Mutation<I, O> {
  throw Error('Compiler required')
}
export function makeQuery<I, O extends EndpointRow>(
  id: string,
  rpc: Rpc<I, O[]>,
): Query<I, O> {
  return { kind: 'query', id, rpc }
}
export function makeMutation<I, O>(
  id: string,
  rpc: Rpc<I, O>,
  onMutate: Mutation<I, O>['onMutate'],
): Mutation<I, O> {
  return { kind: 'mutation', id, rpc, onMutate }
}
// PostgreSQL C ordering compares UTF-8 bytes. Valid Unicode code points have
// the same order; JavaScript's raw comparison instead compares UTF-16 units.
function compareText(left: string, right: string): number {
  let i = 0,
    j = 0
  while (i < left.length && j < right.length) {
    const a = left.codePointAt(i)!,
      b = right.codePointAt(j)!
    if (a !== b) return a < b ? -1 : 1
    i += a > 0xffff ? 2 : 1
    j += b > 0xffff ? 2 : 1
  }
  return i < left.length ? 1 : j < right.length ? -1 : 0
}
function options(
  endpoint: Query<Record<string, never>, EndpointRow>,
  scope: Scope,
  queryClient: QueryClient,
  order: ReadonlyArray<SortField> = [],
  read: () => Promise<EndpointRow[]>,
  getSyncSignal: () => AbortSignal,
) {
  return collectionOptions(
    queryCollectionOptions({
      id: `${endpoint.id}:${scope}`,
      queryKey: [endpoint.id, scope],
      queryClient,
      queryFn: read,
      getSyncSignal,
      startSync: true,
      // The coordinator owns the three retries; do not multiply them here.
      retry: false,
      getKey: (row: EndpointRow) => row.id,
      ...(order.length
        ? {
            compare: (a: EndpointRow, b: EndpointRow) => {
              for (const field of order) {
                const result =
                  field === 'createdAt'
                    ? (a.createdAt as Date).getTime() -
                      (b.createdAt as Date).getTime()
                    : compareText(a.id, b.id)
                if (result !== 0) return result
              }
              return 0
            },
          }
        : {}),
      staleTime: Infinity,
      gcTime: Infinity,
    }),
  )
}
type BoundMutation<I, O> = {
  rpc: Rpc<I, O>
  onMutate: Mutation<I, O>['onMutate']
  invoke: (input: I) => Transaction
}
const handlerOutcome = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('success'), result: z.unknown() }),
  z.object({ kind: z.literal('error'), message: z.string() }),
])
const todoRowSchema = z
  .object({
    id: z.string(),
    text: z.string(),
    completed: z.boolean(),
    createdAt: z.date(),
  })
  .passthrough()
const authorityRow = z
  .object({
    id: z.string(),
  })
  .passthrough()
const confirmation = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('confirmed'),
    unaffected: z.array(z.object({ id: z.string() })).optional(),
    certificates: z
      .array(z.object({ id: z.string(), certificate: z.string() }))
      .optional(),
    unchanged: z
      .array(z.object({ id: z.string(), certificate: z.string() }))
      .optional(),
    handler: handlerOutcome,
    snapshots: z.array(
      z.object({
        id: z.string(),
        rows: z.array(authorityRow),
      }),
    ),
  }),
  z
    .object({
      kind: z.literal('confirmed-shared'),
      unaffected: z.array(z.object({ id: z.string() })).optional(),
      certificates: z
        .array(z.object({ id: z.string(), certificate: z.string() }))
        .optional(),
      unchanged: z
        .array(z.object({ id: z.string(), certificate: z.string() }))
        .optional(),
      handler: handlerOutcome,
      pool: z.array(authorityRow),
      snapshots: z.array(
        z.object({
          id: z.string(),
          indexes: z.array(z.number().int().nonnegative()),
        }),
      ),
    })
    .refine((value) =>
      value.snapshots.every((snapshot) =>
        snapshot.indexes.every((index) => index < value.pool.length),
      ),
    ),
  z.object({
    kind: z.literal('read-error'),
    handler: handlerOutcome,
    message: z.string(),
  }),
])
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
type Operation = {
  transaction: Transaction
  epoch: number
  alone: boolean
  state: 'running' | 'closed' | 'unknown'
  error?: Error
  done: ReturnType<typeof deferred>
}
class EndpointRuntime {
  readonly queryClient = new QueryClient({
    defaultOptions: { queries: { retry: 3 } },
  })
  lastTransaction: Transaction | undefined
  readonly readErrors = new Map<string, string>()
  private collections = new Map<
    string,
    ReturnType<typeof this.createCollection>
  >()
  private models = new Map<string, QueryModel>()
  private rowSchemas = new Map<string, z.ZodType<EndpointRow>>()
  private projections = new Map<string, string>()
  private instances = new Map<string, QueryInstance>()
  private confirmed = new Map<string, Map<string, EndpointRow>>()
  private certificates = new Map<string, string>()
  private mutations = new Map<string, unknown>()
  private operations = new Map<Transaction, Operation>()
  private endpoints = new Map<
    string,
    Query<Record<string, never>, EndpointRow>
  >()
  private epoch = 0
  private topology = 0
  private permit = new AbortController()
  private changed = deferred()
  private refreshing: Promise<void> | undefined
  constructor(
    readonly core: DbClient,
    readonly scope: Scope,
  ) {}
  private createCollection(
    endpoint: Query<Record<string, never>, EndpointRow>,
    order: ReadonlyArray<SortField> = [],
  ) {
    const collection = this.core.collection(
      options(
        endpoint,
        this.scope,
        this.queryClient,
        order,
        async () => {
          // Registration precedes asynchronous demand, including eager startup.
          await Promise.resolve()
          await this.refresh()
          return [...(this.confirmed.get(endpoint.id)?.values() ?? [])]
        },
        () => this.permit.signal,
      ),
    )
    collection.on('status:change', ({ status, previousStatus }) => {
      if (status === 'cleaned-up' || previousStatus === 'cleaned-up') {
        this.topology++
        this.invalidateReads()
        this.confirmed.delete(endpoint.id)
        this.certificates.delete(endpoint.id)
        if (status === 'cleaned-up')
          this.queryClient.removeQueries({
            queryKey: [endpoint.id, this.scope],
            exact: true,
          })
        this.wake()
      }
    })
    return collection
  }
  collection(
    endpoint: Query<Record<string, never>, EndpointRow>,
    order: ReadonlyArray<SortField> = [],
  ) {
    this.endpoints.set(endpoint.id, endpoint)
    let collection = this.collections.get(endpoint.id)
    if (!collection) {
      this.topology++
      collection = this.createCollection(endpoint, order)
      this.collections.set(endpoint.id, collection)
      this.wake()
    }
    return collection
  }

  bindQuery<
    I extends QueryParams = Record<string, never>,
    O extends EndpointRow = EndpointRow,
  >(
    id: string,
    rpc: Rpc<I, O[]>,
    model: QueryModel,
    params: I = {} as I,
    version = 'fixture',
    rowSchema: z.ZodType<O> = todoRowSchema as unknown as z.ZodType<O>,
  ): EndpointCollection<O> {
    const instance = queryInstance(id, version, params)
    const previous = this.instances.get(instance.id)
    if (previous && previous.version !== version)
      throw Error('Query definition changed; reload the client')
    if (model.fields) {
      const projection = [...model.fields].sort().join(',')
      const existing = this.projections.get(model.relation)
      if (existing !== undefined && existing !== projection)
        throw Error('Incompatible cross-module row projection')
      this.projections.set(model.relation, projection)
    }
    this.rowSchemas.set(instance.id, rowSchema)
    this.instances.set(instance.id, instance)
    this.models.set(instance.id, instantiateQueryModel(model, instance.params))
    return this.collection(
      makeQuery(instance.id, async ({ data }) =>
        rpc({ data: { ...data, input: instance.params as I } }),
      ),
      model.order,
    ) as unknown as EndpointCollection<O>
  }
  bindMutation<I, O>(
    id: string,
    rpc: Rpc<I, O>,
    onMutate: Mutation<I, O>['onMutate'],
  ): (input: I) => Transaction {
    let entry = this.mutations.get(id) as BoundMutation<I, O> | undefined
    if (!entry) {
      const bound: BoundMutation<I, O> = {
        rpc,
        onMutate,
        invoke: (input) =>
          this.run(
            {
              inline: true,
              kind: 'mutation',
              id,
              rpc: bound.rpc,
              onMutate: bound.onMutate,
            },
            input,
          ),
      }
      entry = bound
      this.mutations.set(id, entry)
    }
    entry.rpc = rpc
    entry.onMutate = onMutate
    return entry.invoke
  }
  private retained() {
    // Subscriber count is deliberately irrelevant. Cleanup is the retention exit.
    return [...this.collections].filter(
      ([, collection]) => collection.status !== 'cleaned-up',
    )
  }
  private readRequests(
    targets: ReturnType<EndpointRuntime['retained']>,
    transaction: Transaction,
  ): QueryInstance[] {
    const optimistic = new Set(
      transaction.mutations.map(({ collection }) => collection.id),
    )
    return targets.map(([id]) => ({
      ...(this.instances.get(id) ?? {
        id,
        definition: id,
        version: 'fixture',
        params: {},
      }),
      ...(this.certificates.has(id)
        ? { certificate: this.certificates.get(id)! }
        : {}),
      hasBaseline: this.confirmed.has(id),
      optimistic: optimistic.has(this.collections.get(id)!.id),
    }))
  }
  private propagate(transaction: Transaction) {
    // Freeze authored effects before adding recipients to the same transaction.
    const effects = [...transaction.mutations]
    const recipients = this.retained().flatMap(([id, collection]) => {
      const model = this.models.get(id)
      return model
        ? [{ model, collection, matches: compileMembership(model) }]
        : []
    })
    const authored = new Set(
      effects.map((effect) => effect.collection.id + '\0' + String(effect.key)),
    )
    for (const effect of effects) {
      const sourceModel = recipients.find(
        ({ collection }) => collection.id === effect.collection.id,
      )?.model
      if (!sourceModel || !effect.optimistic) continue
      for (const { model, collection, matches: accepts } of recipients) {
        if (
          model.relation !== sourceModel.relation ||
          (collection.id !== effect.collection.id &&
            authored.has(collection.id + '\0' + String(effect.key)))
        )
          continue
        const row = effect.modified as EndpointRow
        const matches = effect.type !== 'delete' && accepts(row)
        const key = String(effect.key)
        if (matches) {
          if (collection.id === effect.collection.id) continue
          if (collection.has(key))
            collection.update(key, (draft) => {
              Object.assign(draft, row)
            })
          else collection.insert(row)
        } else if (collection.has(key)) collection.delete(key)
      }
    }
  }
  private install(id: string, rows: EndpointRow[]) {
    const collection = this.collections.get(id)!
    const baseline = this.confirmed.get(id) ?? new Map<string, EndpointRow>()
    const next = new Map(rows.map((row) => [row.id, row]))
    if (next.size !== rows.length)
      throw Error('Duplicate authoritative result key')
    collection.utils.writeBatch(() => {
      for (const key of baseline.keys())
        if (!next.has(key)) collection.utils.writeDelete(key)
      for (const row of rows) collection.utils.writeUpsert(row)
    })
    // An empty-to-empty write batch has no operations and does not seed Query.
    // Its successful empty result must still establish initial readiness.
    if (baseline.size === 0 && next.size === 0)
      this.queryClient.setQueryData([id, this.scope], rows)
    this.confirmed.set(id, next)
    this.readErrors.delete(id)
  }
  private wake() {
    const previous = this.changed
    this.changed = deferred()
    previous.resolve()
  }
  private invalidateReads() {
    this.permit.abort()
    this.permit = new AbortController()
    // Cancellation is synchronous even when a transport ignores AbortSignal.
    for (const [id] of this.collections)
      void this.queryClient.cancelQueries({
        queryKey: [id, this.scope],
        exact: true,
      })
  }
  private async quiet() {
    while (
      [...this.operations.values()].some(
        (operation) => operation.state === 'running',
      )
    )
      await this.changed.promise
    if (
      [...this.operations.values()].some(
        (operation) => operation.state === 'unknown',
      )
    )
      throw Error(
        'Mutation outcome is unknown; authoritative reconciliation requires server closure evidence',
      )
  }
  private async readRows(endpoint: Query<Record<string, never>, EndpointRow>) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await endpoint.rpc({ data: { scope: this.scope, input: {} } })
      } catch (error) {
        if (attempt === 3) throw error
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt))
      }
    }
  }
  private validateSnapshots(
    value: unknown,
    targets: ReturnType<EndpointRuntime['retained']>,
  ) {
    const parsed = confirmation.safeParse({
      kind: 'confirmed',
      handler: { kind: 'success', result: null },
      snapshots: value,
    })
    if (!parsed.success || parsed.data.kind !== 'confirmed')
      this.rejectAuthority(targets)
    const snapshots = parsed.data.snapshots
    if (
      snapshots.length !== targets.length ||
      new Set(snapshots.map((snapshot) => snapshot.id)).size !==
        targets.length ||
      targets.some(
        ([id]) => !snapshots.some((snapshot) => snapshot.id === id),
      ) ||
      snapshots.some(
        (snapshot) =>
          new Set(snapshot.rows.map((row) => row.id)).size !==
          snapshot.rows.length,
      )
    )
      this.rejectAuthority(targets)
    for (const snapshot of snapshots) {
      const schema = this.rowSchemas.get(snapshot.id) ?? todoRowSchema
      if (snapshot.rows.some((row) => !schema.safeParse(row).success))
        this.rejectAuthority(targets)
      const fields = this.models.get(snapshot.id)?.fields
      if (!fields) continue
      const selected = new Set(fields)
      if (
        snapshot.rows.some(
          (row) =>
            fields.some(
              (field) => !Object.hasOwn(row, field) || row[field] === undefined,
            ) || Object.keys(row).some((field) => !selected.has(field)),
        )
      )
        this.rejectAuthority(targets)
    }
    return snapshots
  }
  private settle(operations: Operation[], error?: Error) {
    for (const operation of operations) {
      operation.transaction._settle(error ?? operation.error)
      operation.done.resolve()
    }
  }
  private publish(
    snapshots: Array<{ id: string; rows: EndpointRow[] }>,
    operations: Operation[],
    certificates: Readonly<Record<string, string>> = {},
  ) {
    this.core._batch(() => {
      this.invalidateReads()
      for (const snapshot of snapshots) {
        this.install(snapshot.id, snapshot.rows)
        const certificate = certificates[snapshot.id]
        if (certificate === undefined) this.certificates.delete(snapshot.id)
        else this.certificates.set(snapshot.id, certificate)
      }
      // Remove the selected cohort before callbacks may submit another action.
      for (const operation of operations)
        this.operations.delete(operation.transaction)
      this.settle(operations)
    })
    this.wake()
  }
  private fail(operations: Operation[], error: Error) {
    for (const [id] of this.retained()) this.readErrors.set(id, error.message)
    this.core._batch(() => this.settle(operations, error))
    this.wake()
  }
  private refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing
    const work = this.refreshUntilCurrent()
    this.refreshing = work
    void work
      .finally(() => {
        if (this.refreshing === work) this.refreshing = undefined
      })
      .catch(() => {})
    return work
  }
  private async refreshUntilCurrent() {
    // Coalesce registrations and never capture the retained set during construction.
    await Promise.resolve()
    for (;;) {
      await this.quiet()
      const epoch = this.epoch,
        topology = this.topology
      const targets = this.retained()
      let snapshots
      try {
        snapshots = await Promise.race([
          Promise.all(
            targets.map(async ([id]) => ({
              id,
              rows: await this.readRows(this.endpoints.get(id)!),
            })),
          ),
          // A retired lifetime cannot hold its replacement hostage to a
          // transport that ignores cancellation or never returns.
          this.changed.promise.then(() => undefined),
        ])
      } catch (error) {
        if (epoch !== this.epoch || topology !== this.topology) continue
        const failure = error instanceof Error ? error : Error(String(error))
        this.fail(
          [...this.operations.values()].filter(
            (operation) => operation.state === 'closed',
          ),
          failure,
        )
        throw failure
      }
      if (!snapshots) continue
      if (epoch !== this.epoch || topology !== this.topology) continue
      const validated = this.validateSnapshots(snapshots, targets)
      this.publish(
        validated,
        [...this.operations.values()].filter(
          (operation) => operation.state === 'closed',
        ),
      )
      if (epoch !== this.epoch || topology !== this.topology) continue
      return
    }
  }
  private async persist<I, O>(
    endpoint: Mutation<I, O>,
    input: I,
    transaction: Transaction,
    retained: ReturnType<EndpointRuntime['retained']>,
  ) {
    const operation = this.operations.get(transaction)!
    if (!endpoint.inline) {
      try {
        await endpoint.rpc({ data: { scope: this.scope, input } })
        operation.state = 'closed'
        this.wake()
        await this.refresh()
      } catch (error) {
        if (operation.state === 'running') operation.state = 'unknown'
        this.fail(
          [operation],
          error instanceof Error ? error : Error(String(error)),
        )
      }
      return operation.done.promise
    }
    const targets = retained
    const topology = this.topology
    const requests = this.readRequests(targets, transaction)
    let value: unknown
    try {
      value = await endpoint.rpc({
        data: {
          scope: this.scope,
          input,
          reads: requests,
        },
      })
    } catch (error) {
      operation.state = 'unknown'
      this.fail(
        [operation],
        error instanceof Error ? error : Error(String(error)),
      )
      return operation.done.promise
    }
    const invalidInput = invalidInputResponse.safeParse(value)
    if (invalidInput.success) {
      const { message, issues } = invalidInput.data
      // There was no handler execution. Drop only this overlay and obligation;
      // keep confirmed rows, read errors, and any overlapping actions intact.
      this.core._batch(() => {
        this.operations.delete(transaction)
        this.settle([operation], new InvalidInputError(message, issues))
      })
      this.wake()
      return operation.done.promise
    }
    const notStarted = z
      .object({ kind: z.literal('not-started'), message: z.string() })
      .strict()
      .safeParse(value)
    if (notStarted.success) {
      operation.state = 'closed'
      this.fail([operation], Error(notStarted.data.message))
      return operation.done.promise
    }
    const parsed = confirmation.safeParse(value)
    if (!parsed.success) {
      // A valid closure envelope is distinct from a valid authoritative row set.
      const envelope = z.object({ handler: handlerOutcome }).safeParse(value)
      operation.state = envelope.success ? 'closed' : 'unknown'
      this.fail(
        [operation],
        Error('Invalid or incomplete authoritative endpoint response'),
      )
      return operation.done.promise
    }
    const response = parsed.data
    operation.state = 'closed'
    operation.error =
      response.handler.kind === 'error'
        ? Error(response.handler.message)
        : undefined
    this.wake()
    if (response.kind === 'read-error') {
      const error = operation.error
        ? new AggregateError(
            [operation.error, Error(response.message)],
            operation.error.message + '; ' + response.message,
          )
        : Error(response.message)
      this.fail([operation], error)
      return operation.done.promise
    }
    let snapshots
    const certificates = Object.fromEntries(
      (response.certificates ?? []).map(({ id, certificate }) => [
        id,
        certificate,
      ]),
    )
    try {
      if (
        (response.certificates?.length ?? 0) !==
          Object.keys(certificates).length ||
        Object.keys(certificates).some(
          (id) => !response.snapshots.some((snapshot) => snapshot.id === id),
        )
      )
        this.rejectAuthority(targets)
      const reused = (response.unchanged ?? []).map(({ id, certificate }) => {
        if (
          requests.find((request) => request.id === id)?.certificate !==
            certificate ||
          !this.confirmed.has(id)
        )
          this.rejectAuthority(targets)
        certificates[id] = certificate
        return { id, rows: [...this.confirmed.get(id)!.values()] }
      })
      const unaffected = (response.unaffected ?? []).map(({ id }) => {
        const request = requests.find((request) => request.id === id)
        if (
          !request?.hasBaseline ||
          request.optimistic ||
          !this.confirmed.has(id)
        )
          this.rejectAuthority(targets)
        return { id, rows: [...this.confirmed.get(id)!.values()] }
      })
      snapshots = this.validateSnapshots(
        [
          ...(response.kind === 'confirmed-shared'
            ? response.snapshots.map((snapshot) => ({
                id: snapshot.id,
                rows: snapshot.indexes.map((index) => response.pool[index]!),
              }))
            : response.snapshots),
          ...reused,
          ...unaffected,
        ],
        targets,
      )
    } catch (error) {
      this.fail(
        [operation],
        error instanceof Error ? error : Error(String(error)),
      )
      return operation.done.promise
    }
    if (
      operation.alone &&
      operation.epoch === this.epoch &&
      topology === this.topology
    ) {
      const unaffected = new Set(
        (response.unaffected ?? []).map(({ id }) => id),
      )
      this.publish(
        snapshots.filter(({ id }) => !unaffected.has(id)),
        [operation],
        certificates,
      )
    } else {
      try {
        await this.refresh()
      } catch (error) {
        this.fail(
          [operation],
          error instanceof Error ? error : Error(String(error)),
        )
      }
    }
    return operation.done.promise
  }
  private rejectAuthority(
    targets: ReturnType<EndpointRuntime['retained']>,
  ): never {
    const message = 'Invalid or incomplete authoritative endpoint response'
    for (const [id] of targets) this.readErrors.set(id, message)
    throw Error(message)
  }
  run<I, O>(endpoint: Mutation<I, O>, input: I): Transaction {
    const retained = this.retained()
    const transaction = this.core.createTransaction({
      autoCommit: false,
      mutationFn: async ({ transaction }) => {
        await this.persist(endpoint, input, transaction, retained)
      },
    })
    const operation: Operation = {
      transaction,
      epoch: ++this.epoch,
      alone: this.operations.size === 0,
      state: 'running',
      done: deferred(),
    }
    this.operations.set(transaction, operation)
    this.lastTransaction = transaction
    this.core._batch(() => {
      this.invalidateReads()
      this.wake()
      try {
        transaction.mutate(() => {
          endpoint.onMutate({ dbClient: this, input })
          if (endpoint.inline) this.propagate(transaction)
        })
      } catch (error) {
        // No RPC started: remove only this unsent obligation, retaining the epoch.
        this.operations.delete(transaction)
        transaction.rollback()
        void transaction.isPersisted.promise.catch(() => {})
        this.wake()
        throw error
      }
      // Enter persisting before publication callbacks can submit sibling actions.
      if (transaction.mutations.length === 0) {
        // DB skips persistence for empty transactions. An endpoint handler must
        // still execute when its optimistic guess makes no local row changes.
        transaction.setState('persisting')
        void this.persist(endpoint, input, transaction, retained).catch(
          (error) =>
            this.fail(
              [operation],
              error instanceof Error ? error : Error(String(error)),
            ),
        )
      } else void transaction.commit().catch(() => {})
    })
    return transaction
  }
}
const runtimes = new WeakMap<DbClient, EndpointRuntime>()
export function endpointRuntime(client: DbClient) {
  let runtime = runtimes.get(client)
  if (!runtime) {
    const scope = client.requireDependency<unknown>('endpointScope')
    if (typeof scope !== 'string' || scope.length === 0)
      throw Error('Invalid endpoint scope')
    runtime = new EndpointRuntime(client, scope)
    runtimes.set(client, runtime)
  }
  return runtime
}

// Authored signatures; the compiler replaces declarations with bind calls.
function boundQuery<I, O extends EndpointRow>(
  _config: Parameters<typeof query<I, O>>[0] & {
    params?: I
    schema?: z.ZodType<O>
  },
): EndpointCollection<O> {
  throw Error('Compiler required')
}
function boundMutation<I, O>(_config: {
  input: z.ZodType<I>
  handler(
    req: { body: I; scope: Scope },
    res: { json<T>(value: T): T },
  ): Promise<O>
  onMutate(context: { input: I }): void
}): (input: I) => Transaction {
  throw Error('Compiler required')
}
const boundDefinitions = { query: boundQuery, mutation: boundMutation }
export function endpoints(_client: DbClient) {
  return boundDefinitions
}
export function bindQuery<
  I extends QueryParams = Record<string, never>,
  O extends EndpointRow = EndpointRow,
>(
  client: DbClient,
  id: string,
  rpc: Rpc<I, O[]>,
  model: QueryModel,
  params: I = {} as I,
  version = 'fixture',
  schema?: z.ZodType<O>,
) {
  return endpointRuntime(client).bindQuery(
    id,
    rpc,
    model,
    params,
    version,
    schema,
  )
}
export function bindMutation<I, O>(
  client: DbClient,
  id: string,
  rpc: Rpc<I, O>,
  onMutate: Mutation<I, O>['onMutate'],
) {
  return endpointRuntime(client).bindMutation(id, rpc, onMutate)
}
