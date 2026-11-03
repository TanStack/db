/**
 * A reference adapter that persists its own writes, written to conform to the
 * mutation laws, and its production driver. It calibrates the check: the
 * adapter must pass, and each hostile mutant must be rejected with the law it
 * breaks (ORC-006).
 *
 * The adapter's sync run loads the provider's rows, marks ready, and applies
 * the provider's change feed. Its mutation functions send each mutation to
 * the provider one write at a time per Collection (MUT-10) and return once
 * the provider has answered. An accepted write reaches the change feed before
 * the provider answers, so its sync transaction is committed before the
 * mutation function settles, and core drops the optimistic row in the same
 * publication that applies it (MUT-1).
 */
import { createCollection } from '@tanstack/db'
import { observedView } from '../src'
import type {
  ConformanceRow,
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

const acceptAtOnce: WritePlan = {
  outcome: `accept`,
  held: false,
  error: new Error(`unplanned write`),
}

/**
 * A provider that answers writes by plan and feeds every commit back. A JSON
 * provider stores and feeds each row as JSON, so a field whose value is
 * `undefined` is absent; otherwise rows are structured clones.
 */
export class ControlledMutationProvider implements MutationProvider {
  private readonly committed = new Map<number, ConformanceRow>()
  private readonly plans: Array<WritePlan> = []
  private readonly held: Array<() => void> = []
  private readonly log: Array<WriteRequest> = []
  private listener: ((change: ProviderChange) => void) | undefined

  constructor(
    seed: ReadonlyArray<ConformanceRow>,
    private readonly json = false,
    private readonly echoesAuthored = false,
  ) {
    for (const row of seed) this.committed.set(row.id, this.stored(row))
  }

  private stored<T>(value: T): T {
    return this.json
      ? (JSON.parse(JSON.stringify(value)) as T)
      : structuredClone(value)
  }

  // The adapter's side: its change feed, initial read, and writes.

  subscribe(listener: (change: ProviderChange) => void): () => void {
    this.listener = listener
    return () => {
      if (this.listener === listener) this.listener = undefined
    }
  }

  snapshot(): Array<ConformanceRow> {
    return [...this.committed.values()].map((row) => structuredClone(row))
  }

  write(request: WriteRequest): Promise<void> {
    this.log.push(this.stored(request))
    const plan = this.plans.shift() ?? acceptAtOnce
    return new Promise<void>((resolve, reject) => {
      const answer = () => {
        if (plan.outcome === `reject`) {
          reject(plan.error)
          return
        }
        this.commit(
          request.type === `delete`
            ? { type: `delete`, id: request.id }
            : { type: `upsert`, row: request.row! },
        )
        resolve()
      }
      if (plan.held) this.held.push(answer)
      else answer()
    })
  }

  /** A write replaces the whole row, as a complete-row API does. */
  private commit(change: ProviderChange): void {
    if (change.type === `delete`) this.committed.delete(change.id)
    else this.committed.set(change.row.id, this.stored(change.row))
    this.listener?.(
      this.echoesAuthored ? structuredClone(change) : this.stored(change),
    )
  }

  // The oracle's side.

  plan(plan: WritePlan): void {
    this.plans.push(plan)
  }

  release(): void {
    this.held.shift()?.()
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
        return provider.subscribe((change) => {
          if (mutant === `applies-copy-late`) setTimeout(() => apply(change), 0)
          else apply(change)
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
              row: structuredClone(mutation.modified),
            }
            await provider.write(request)
            if (mutant === `writes-insert-twice`) await provider.write(request)
          }
        }),
      ),
    onUpdate: ({ transaction }) =>
      answer(
        persist(async () => {
          for (const mutation of transaction.mutations) {
            await provider.write({
              type: `update`,
              id: mutation.key,
              row:
                mutant === `sends-changes-only`
                  ? ({
                      id: mutation.key,
                      ...mutation.changes,
                    } as ConformanceRow)
                  : structuredClone(mutation.modified),
            })
          }
        }),
      ),
    onDelete: ({ transaction }) =>
      answer(
        persist(async () => {
          if (mutant === `skips-delete`) return
          for (const mutation of transaction.mutations) {
            await provider.write({ type: `delete`, id: mutation.key })
          }
        }),
      ),
  })
  return collection
}

/** A production driver for the reference adapter, optionally mutated. */
export function referenceMutationDriver(
  mutant?: ReferenceMutationMutant,
  { json = mutant === `echoes-authored-row` }: { json?: boolean } = {},
): MutationDriver {
  return {
    adapter: `reference mutations${json ? ` (JSON provider)` : ``}${mutant ? ` (${mutant})` : ``}`,
    ...(json && { undefinedField: `absent` as const }),
    capabilities: new Set([
      `write-rejection`,
      `held-writes`,
      `foreign-commits`,
    ]),
    create(seed): MutationFixture {
      const provider = new ControlledMutationProvider(
        seed,
        json,
        mutant === `echoes-authored-row`,
      )
      const collection = referenceCollection(provider, mutant)
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
