/**
 * A reference adapter that persists its own writes, written to conform to the
 * mutation laws, and its production driver. It calibrates the check: the
 * adapter must pass, and each hostile mutant must be rejected with the law it
 * breaks (ORC-006).
 *
 * The adapter's sync run loads the provider's rows, marks ready, and applies
 * the provider's change feed. Its mutation functions send each mutation to
 * the provider one write at a time per Collection (MUT-10).
 *
 * The provider has three forms:
 *
 * - by default it stores structured clones and replaces a row on every
 *   write. An accepted write reaches the change feed before the provider
 *   answers, so the mutation function returns once the provider answers:
 *   its sync transaction is committed before the mutation function settles,
 *   and core drops the optimistic row in the same publication that applies
 *   it (MUT-1);
 * - a JSON provider (`json`) stores and feeds JSON, so a field whose value is
 *   `undefined` is absent (`undefinedField: 'absent'`);
 * - a SQL provider (`sql`), like TrailBase's or PowerSync's service, stores
 *   rows with every column and an absent field as `NULL`, which its rows and
 *   change feed report as absent (`undefinedField: 'null'`). An update sends
 *   only its changed fields, a removed one as `null`, and the provider merges
 *   them into its row (`field-updates`). The provider can answer before its
 *   change feed delivers the copy (`held-echoes`), so the adapter confirms
 *   each write through sync: its mutation function returns when its own
 *   sync run has applied that write's copy (MUT-7).
 */
import { createCollection } from '@tanstack/db'
import { observedView, rewriteRow } from '../src'
import type {
  ConformanceRow,
  MutationCapability,
  MutationDriver,
  MutationFixture,
  MutationProvider,
  ProviderChange,
  WritePlan,
  WriteRequest,
} from '../src'

/** Wrong designs the calibration tests inject, one decision each. */
export type ReferenceMutationMutant =
  /** MUT-1: the provider's copy applies after the mutation function settles. */
  | `applies-copy-late`
  /** MUT-2: a rejected write resolves, so its optimistic state stays. */
  | `swallows-rejection`
  /** MUT-2: a rejection reports a different error value. */
  | `wraps-rejection`
  /** MUT-13: an insert reaches the provider twice. */
  | `writes-insert-twice`
  /** MUT-10: a write does not wait for the earlier one to be decided. */
  | `writes-concurrently`
  /** FID-5: a delete never reaches the provider. */
  | `skips-delete`
  /** MUT-8: an update sends only the changed fields. */
  | `sends-changes-only`
  /**
   * FID-5: the change feed carries the authored row instead of the stored
   * copy, so a JSON provider's removed field stays an own `undefined`.
   */
  | `echoes-authored-row`
  /**
   * FID-5: after the provider accepts, the adapter writes the authored row
   * into its synced rows, over the provider's rewritten copy.
   */
  | `writes-back-authored`
  /** MUT-8 (SQL): an update sends the complete row, not its changed fields. */
  | `sends-complete-row`
  /**
   * MUT-8 (SQL): an update sends its changes as JSON as they are, so a
   * removed field, an own `undefined`, never reaches the provider.
   */
  | `drops-removal`
  /**
   * MUT-7 (SQL): the mutation function returns when the provider answers,
   * before its copy arrives through sync.
   */
  | `settles-on-answer`

export interface ReferenceMutationOptions {
  /** A JSON provider. */
  json?: boolean
  /** A SQL provider, with field updates and confirmation through sync. */
  sql?: boolean
}

const acceptAtOnce: WritePlan = {
  outcome: `accept`,
  held: false,
  echoHeld: false,
  rewrite: `none`,
  error: new Error(`unplanned write`),
}

const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** A provider that answers writes by plan and feeds every commit back. */
export class ControlledMutationProvider implements MutationProvider {
  private readonly committed = new Map<number, ConformanceRow>()
  private readonly plans: Array<WritePlan> = []
  private readonly held: Array<() => void> = []
  private readonly withheld: Array<() => void> = []
  private readonly log: Array<WriteRequest> = []
  private listener:
    ((change: ProviderChange, sequence: number) => void) | undefined
  private commits = 0

  constructor(
    seed: ReadonlyArray<ConformanceRow>,
    private readonly options: ReferenceMutationOptions,
    private readonly echoesAuthored = false,
  ) {
    for (const row of seed) this.committed.set(row.id, this.stored(row))
  }

  /** A row as this provider stores it. */
  private stored(row: Partial<ConformanceRow>): ConformanceRow {
    if (!this.options.json && !this.options.sql)
      return structuredClone(row) as ConformanceRow
    const stored = jsonClone(row) as Omit<ConformanceRow, `note`> & {
      note?: string | null
    }
    // A SQL column holds `NULL`, which the provider reports as absent.
    if (stored.note === null) delete stored.note
    return stored as ConformanceRow
  }

  // The adapter's side: its change feed, initial read, and writes.

  subscribe(
    listener: (change: ProviderChange, sequence: number) => void,
  ): () => void {
    this.listener = listener
    return () => {
      if (this.listener === listener) this.listener = undefined
    }
  }

  snapshot(): Array<ConformanceRow> {
    return [...this.committed.values()].map((row) => structuredClone(row))
  }

  /**
   * Answers with the commit's sequence number, which its change feed
   * carries, so an adapter can confirm the write through sync.
   */
  write(request: WriteRequest): Promise<number> {
    const { json, sql } = this.options
    this.log.push(json || sql ? jsonClone(request) : structuredClone(request))
    const plan = this.plans.shift() ?? acceptAtOnce
    return new Promise<number>((resolve, reject) => {
      const answer = () => {
        if (plan.outcome === `reject`) {
          reject(plan.error)
          return
        }
        if (request.type === `delete`) {
          resolve(
            this.commit({ type: `delete`, id: request.id }, plan.echoHeld),
          )
          return
        }
        // A SQL update merges the fields it sends into the stored row.
        const row =
          request.type === `update` && sql
            ? { ...this.committed.get(request.id), ...jsonClone(request.row) }
            : request.row
        resolve(
          this.commit(
            {
              type: `upsert`,
              row: rewriteRow(row as ConformanceRow, plan.rewrite),
            },
            plan.echoHeld,
          ),
        )
      }
      if (plan.held) this.held.push(answer)
      else answer()
    })
  }

  /**
   * Commits a change and feeds it back, at once or at `deliver`. Without
   * field updates a write replaces the whole row, as a complete-row API does.
   */
  private commit(change: ProviderChange, withhold = false): number {
    if (change.type === `delete`) this.committed.delete(change.id)
    else this.committed.set(change.row.id, this.stored(change.row))
    const sequence = ++this.commits
    const fed = this.echoesAuthored
      ? structuredClone(change)
      : change.type === `delete`
        ? change
        : { ...change, row: this.stored(change.row) }
    const feed = () => this.listener?.(fed, sequence)
    if (withhold) this.withheld.push(feed)
    else feed()
    return sequence
  }

  // The oracle's side.

  plan(plan: WritePlan): void {
    this.plans.push(plan)
  }

  release(): void {
    this.held.shift()?.()
  }

  deliver(): void {
    this.withheld.shift()?.()
  }

  foreignCommit(change: ProviderChange): void {
    this.commit(change)
  }

  rows(): ReadonlyArray<ConformanceRow> {
    return this.snapshot()
  }

  requests(): ReadonlyArray<WriteRequest> {
    return this.log
  }
}

let sequence = 0

/** Builds the reference adapter's Collection over `provider`. */
function referenceCollection(
  provider: ControlledMutationProvider,
  mutant: ReferenceMutationMutant | undefined,
  { sql = false }: ReferenceMutationOptions,
) {
  // MUT-10: each write waits for the earlier one to be decided.
  let turn: Promise<unknown> = Promise.resolve()
  const persist = (send: () => Promise<void>): Promise<void> => {
    if (mutant === `writes-concurrently`) return send()
    const run = turn.then(send)
    turn = run.catch(() => undefined)
    return run
  }
  const answer = async (sent: Promise<void>): Promise<void> => {
    try {
      await sent
    } catch (error) {
      if (mutant === `swallows-rejection`) return
      if (mutant === `wraps-rejection`)
        throw new Error(`wrapped`, { cause: error })
      throw error
    }
  }
  // MUT-7 (SQL): a write is confirmed when this sync run has applied the
  // commit its answer names.
  let applied = 0
  const confirmations: Array<{ sequence: number; resolve: () => void }> = []
  const confirmed = (commit: number): Promise<void> => {
    if (!sql || mutant === `settles-on-answer` || applied >= commit)
      return Promise.resolve()
    return new Promise((resolve) =>
      confirmations.push({ sequence: commit, resolve }),
    )
  }
  const send = async (request: WriteRequest) =>
    confirmed(await provider.write(request))
  // The `writes-back-authored` mutant writes through the sync run's apply.
  let applyChange: ((change: ProviderChange) => void) | undefined
  const writeBack = (row: ConformanceRow) => {
    if (mutant === `writes-back-authored`)
      applyChange?.({ type: `upsert`, row: structuredClone(row) })
  }
  /** The row an update request carries. */
  const updateRow = (mutation: {
    key: number
    modified: ConformanceRow
    changes: Partial<ConformanceRow>
  }): Partial<ConformanceRow> => {
    if (sql && mutant !== `sends-complete-row`) {
      const changes: Record<string, unknown> = {
        id: mutation.key,
        ...mutation.changes,
      }
      // A removed field is `NULL` in its column.
      if (mutant !== `drops-removal`)
        for (const [field, value] of Object.entries(changes))
          if (value === undefined) changes[field] = null
      return changes as Partial<ConformanceRow>
    }
    return mutant === `sends-changes-only`
      ? { id: mutation.key, ...mutation.changes }
      : structuredClone(mutation.modified)
  }
  const collection = createCollection<ConformanceRow, number>({
    id: `reference-mutations-${++sequence}`,
    getKey: (row) => row.id,
    sync: {
      rowUpdateMode: `full`,
      sync: ({ begin, write, commit, markReady }) => {
        const keys = new Set<number>()
        const apply = (change: ProviderChange) => {
          begin()
          if (change.type === `delete`) {
            if (keys.delete(change.id))
              write({ type: `delete`, key: change.id })
          } else {
            write({
              type: keys.has(change.row.id) ? `update` : `insert`,
              value: change.row,
            })
            keys.add(change.row.id)
          }
          void commit()
        }
        begin()
        for (const row of provider.snapshot()) {
          write({ type: `insert`, value: row })
          keys.add(row.id)
        }
        void commit()
        markReady()
        applyChange = apply
        const receive = (change: ProviderChange, commitSequence: number) => {
          apply(change)
          applied = commitSequence
          for (const waiting of confirmations.splice(0))
            if (waiting.sequence <= applied) waiting.resolve()
            else confirmations.push(waiting)
        }
        return provider.subscribe((change, commitSequence) => {
          if (mutant === `applies-copy-late`)
            setTimeout(() => receive(change, commitSequence), 0)
          else receive(change, commitSequence)
        })
      },
    },
    onInsert: ({ transaction }) =>
      answer(
        persist(async () => {
          for (const mutation of transaction.mutations) {
            const request = {
              type: `insert` as const,
              id: mutation.key,
              // A SQL row has every column: an absent field is `NULL`.
              row: sql
                ? { note: null as unknown as undefined, ...mutation.modified }
                : structuredClone(mutation.modified),
            }
            await send(request)
            if (mutant === `writes-insert-twice`) await send(request)
            writeBack(mutation.modified)
          }
        }),
      ),
    onUpdate: ({ transaction }) =>
      answer(
        persist(async () => {
          for (const mutation of transaction.mutations) {
            await send({
              type: `update`,
              id: mutation.key,
              row: updateRow(mutation),
            })
            writeBack(mutation.modified)
          }
        }),
      ),
    onDelete: ({ transaction }) =>
      answer(
        persist(async () => {
          if (mutant === `skips-delete`) return
          for (const mutation of transaction.mutations) {
            await send({ type: `delete`, id: mutation.key })
          }
        }),
      ),
  })
  return collection
}

const sqlMutants = new Set<ReferenceMutationMutant | undefined>([
  `sends-complete-row`,
  `drops-removal`,
  `settles-on-answer`,
])

/** A production driver for the reference adapter, optionally mutated. */
export function referenceMutationDriver(
  mutant?: ReferenceMutationMutant,
  {
    json = mutant === `echoes-authored-row`,
    sql = sqlMutants.has(mutant),
  }: ReferenceMutationOptions = {},
): MutationDriver {
  const capabilities: Array<MutationCapability> = [
    `write-rejection`,
    `held-writes`,
    `foreign-commits`,
    `server-rewrites`,
  ]
  if (sql) capabilities.push(`field-updates`, `held-echoes`)
  return {
    adapter: `reference mutations${json ? ` (JSON provider)` : ``}${sql ? ` (SQL provider)` : ``}${mutant ? ` (${mutant})` : ``}`,
    ...(json && { undefinedField: `absent` as const }),
    ...(sql && { undefinedField: `null` as const }),
    capabilities: new Set(capabilities),
    create(seed): MutationFixture {
      const provider = new ControlledMutationProvider(
        seed,
        { json, sql },
        mutant === `echoes-authored-row`,
      )
      const collection = referenceCollection(provider, mutant, { sql })
      return {
        collection: observedView(collection, {
          row: (row) => row,
          key: (key) => key as number,
        }),
        base: () => collection.base.values(),
        writer: {
          insert: (row) => collection.insert(row),
          update: (row) =>
            collection.update(row.id, (draft) => {
              draft.title = row.title
              if (Object.hasOwn(row, `note`)) draft.note = row.note
              else delete draft.note
            }),
          delete: (id) => collection.delete(id),
        },
        provider,
      }
    },
  }
}
