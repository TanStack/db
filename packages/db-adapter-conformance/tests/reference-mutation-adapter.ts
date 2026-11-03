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
 *   sync run has applied that write's copy (MUT-7). The next write starts
 *   when the provider answers, without waiting for that confirmation
 *   (MUT-10).
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
  /**
   * MUT-10 (SQL): a write waits for the earlier one's confirmation through
   * sync, not only for the provider's answer, so it reaches the provider
   * late.
   */
  | `chains-on-confirmation`
  /**
   * MUT-7 (SQL): a write counts as confirmed once any later commit's copy
   * has applied, so a withheld copy is skipped.
   */
  | `confirms-by-high-water`

export interface ReferenceMutationOptions {
  /** A JSON provider. */
  json?: boolean
  /** A SQL provider, with field updates and confirmation through sync. */
  sql?: boolean
  /**
   * The provider can answer before its change feed delivers the copy, so
   * the adapter confirms each write through sync (`held-echoes`); a SQL
   * provider implies it.
   */
  confirms?: boolean
  /** The change feed is a log: a withheld copy holds back later ones. */
  log?: boolean
  /** The application's handlers persist writes: the adapter orders none. */
  application?: boolean
  /** The provider answers requests in arrival order. */
  inOrder?: boolean
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
  /** Copies not yet fed, in commit order; `own` marks a plan's withholding. */
  private readonly withheld: Array<{
    feed: () => void
    own: boolean
    id: number
  }> = []
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
      // In order, an answer waits behind every earlier unanswered request.
      const entry = { answer, held: plan.held }
      this.unanswered.push(entry)
      if (plan.held) this.held.push(() => this.answerEntry(entry))
      else if (!this.options.inOrder || this.unanswered[0] === entry)
        this.answerEntry(entry)
    })
  }

  /** Requests not yet answered, in arrival order. */
  private readonly unanswered: Array<{ answer: () => void; held: boolean }> = []

  private answerEntry(entry: { answer: () => void; held: boolean }): void {
    this.unanswered.splice(this.unanswered.indexOf(entry), 1)
    entry.answer()
    // In order, the requests behind it that are not held follow.
    while (
      this.options.inOrder &&
      this.unanswered[0] &&
      !this.unanswered[0].held
    )
      this.answerEntry(this.unanswered[0])
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
    // A copy waits behind a withheld one: any, from a log, or one for its
    // key, since a provider keeps one key's copies in commit order.
    const id = change.type === `delete` ? change.id : change.row.id
    if (
      withhold ||
      this.withheld.some((entry) => this.options.log || entry.id === id)
    )
      this.withheld.push({ feed, own: withhold, id })
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
    this.withheld.shift()?.feed()
    for (;;) {
      const index = this.withheld.findIndex(
        (entry, at) =>
          !entry.own &&
          this.withheld
            .slice(0, at)
            .every((earlier) => !this.options.log && earlier.id !== entry.id),
      )
      if (index < 0) return
      this.withheld.splice(index, 1)[0]!.feed()
    }
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
  {
    sql = false,
    confirms = sql,
    application = false,
  }: ReferenceMutationOptions,
) {
  // MUT-10: each write waits for the earlier one to be decided, by the
  // provider's answer. A write's turn covers sending it; its confirmation
  // (SQL) follows after the turn.
  let turn: Promise<unknown> = Promise.resolve()
  const persist = async (
    sendAll: () => Promise<Array<number>>,
  ): Promise<void> => {
    if (mutant === `writes-concurrently` || application) {
      await confirmAll(await sendAll())
      return
    }
    const sent = turn.then(sendAll)
    const chained =
      mutant === `chains-on-confirmation` ? sent.then(confirmAll) : sent
    turn = chained.catch(() => undefined)
    await confirmAll(await sent)
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
  // Copies can arrive out of commit order, since a withheld one trails later
  // ones, so each write waits for its own commit, not for the highest seen.
  const applied = new Set<number>()
  let highest = 0
  const confirmations = new Map<number, () => void>()
  const isApplied = (commit: number) =>
    mutant === `confirms-by-high-water`
      ? highest >= commit
      : applied.has(commit)
  const confirmed = (commit: number): Promise<void> => {
    if (!confirms || mutant === `settles-on-answer` || isApplied(commit))
      return Promise.resolve()
    return new Promise((resolve) => confirmations.set(commit, resolve))
  }
  const confirmAll = (commits: Array<number>) =>
    Promise.all(commits.map(confirmed)).then(() => undefined)
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
          applied.add(commitSequence)
          highest = Math.max(highest, commitSequence)
          for (const [commit, resolve] of confirmations)
            if (isApplied(commit)) {
              confirmations.delete(commit)
              resolve()
            }
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
          const commits: Array<number> = []
          for (const mutation of transaction.mutations) {
            const request = {
              type: `insert` as const,
              id: mutation.key,
              // A SQL row has every column: an absent field is `NULL`.
              row: sql
                ? { note: null as unknown as undefined, ...mutation.modified }
                : structuredClone(mutation.modified),
            }
            commits.push(await provider.write(request))
            if (mutant === `writes-insert-twice`)
              commits.push(await provider.write(request))
            writeBack(mutation.modified)
          }
          return commits
        }),
      ),
    onUpdate: ({ transaction }) =>
      answer(
        persist(async () => {
          const commits: Array<number> = []
          for (const mutation of transaction.mutations) {
            commits.push(
              await provider.write({
                type: `update`,
                id: mutation.key,
                row: updateRow(mutation),
              }),
            )
            writeBack(mutation.modified)
          }
          return commits
        }),
      ),
    onDelete: ({ transaction }) =>
      answer(
        persist(async () => {
          if (mutant === `skips-delete`) return []
          const commits: Array<number> = []
          for (const mutation of transaction.mutations) {
            commits.push(
              await provider.write({ type: `delete`, id: mutation.key }),
            )
          }
          return commits
        }),
      ),
  })
  return collection
}

const sqlMutants = new Set<ReferenceMutationMutant | undefined>([
  `sends-complete-row`,
  `drops-removal`,
  `settles-on-answer`,
  `chains-on-confirmation`,
  `confirms-by-high-water`,
])

/** A production driver for the reference adapter, optionally mutated. */
export function referenceMutationDriver(
  mutant?: ReferenceMutationMutant,
  {
    json = mutant === `echoes-authored-row`,
    sql = sqlMutants.has(mutant),
    log = false,
    application = false,
    inOrder = false,
    confirms = sql,
  }: ReferenceMutationOptions = {},
): MutationDriver {
  const capabilities: Array<MutationCapability> = [
    `write-rejection`,
    `held-writes`,
    `foreign-commits`,
    `server-rewrites`,
  ]
  if (sql) capabilities.push(`field-updates`)
  if (confirms) capabilities.push(`held-echoes`)
  if (log) capabilities.push(`log-ordered-echoes`)
  if (application) capabilities.push(`application-handlers`)
  if (inOrder) capabilities.push(`ordered-answers`)
  return {
    adapter: `reference mutations${json ? ` (JSON provider)` : ``}${sql ? ` (SQL provider)` : ``}${log ? ` (log)` : ``}${application ? ` (application handlers)` : ``}${inOrder ? ` (in order)` : ``}${mutant ? ` (${mutant})` : ``}`,
    ...(json && { undefinedField: `absent` as const }),
    ...(sql && { undefinedField: `null` as const }),
    capabilities: new Set(capabilities),
    create(seed): MutationFixture {
      const provider = new ControlledMutationProvider(
        seed,
        { json, sql, log, inOrder },
        mutant === `echoes-authored-row`,
      )
      const collection = referenceCollection(provider, mutant, {
        sql,
        confirms,
        application,
      })
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
              // Only a held note value is removed.
              else if (typeof draft.note === `string`) delete draft.note
            }),
          delete: (id) => collection.delete(id),
        },
        provider,
      }
    },
  }
}
