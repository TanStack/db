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
import { acceptAtOnce, observedView, rewriteRow } from '../src'
import type {
  ConformanceRow,
  MutationCapability,
  MutationDriver,
  MutationFixture,
  MutationProvider,
  ObservedCollection,
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
  /**
   * MUT-1, MUT-2: once one step settles a second write, no publication
   * reaches subscribers until the next turn, so a rollback never shows.
   */
  | `drops-joint-settlement`
  /**
   * MUT-1, MUT-2: once one step settles a second write, each row a
   * publication updates returns to its earlier value, then shows the new
   * one again.
   */
  | `replays-joint-settlement`
  /**
   * MUT-7 (counted): a write is confirmed by any copy on its key that
   * arrives while a write is admitted, as TrailBase did before it numbered
   * its writes, so an earlier write's late copy confirms a later one.
   */
  | `confirms-on-any-copy`
  /**
   * MUT-7 (reload): the new run's listing does not confirm the writes it
   * covers, so a write whose copy the retired feed owed never settles.
   */
  | `reload-skips-confirmation`
  /**
   * MUT-7 (reload, counted): the counts survive a reload without crediting
   * the listing, so a later copy is taken for an earlier write's.
   */
  | `reload-keeps-counts`
  /**
   * MUT-8 (transactions): after a rejection, a transaction that is not
   * atomic still sends its later requests, as RxDB's `bulkUpsert` did.
   */
  | `continues-after-rejection`

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
  /**
   * The adapter confirms writes by counting copies per key, as TrailBase
   * does (`counted-echoes`); with a SQL provider.
   */
  counted?: boolean
  /**
   * A transaction is one call the provider answers all-or-nothing
   * (`atomic-transactions`); otherwise its requests go out one at a time and
   * the first rejection ends it.
   */
  atomic?: boolean
}

const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** A provider that answers writes by plan and feeds every commit back. */
export class ControlledMutationProvider implements MutationProvider {
  private readonly committed = new Map<number, ConformanceRow>()
  private readonly plans: Array<WritePlan> = []
  private readonly held: Array<() => void> = []
  /** Teardown: every request is answered at once, every copy sent. */
  private draining = false
  /** Copies not yet fed, in commit order; `own` marks a plan's withholding. */
  private readonly withheld: Array<{
    feed: () => void
    own: boolean
    ids: ReadonlyArray<number>
  }> = []
  private readonly log: Array<WriteRequest> = []
  private listener:
    | ((changes: ReadonlyArray<ProviderChange>, sequence: number) => void)
    | undefined
  private commits = 0
  /** Called as each of the oracle's steps begins. */
  onStep: () => void = () => {}

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
    listener: (
      changes: ReadonlyArray<ProviderChange>,
      sequence: number,
    ) => void,
  ): () => void {
    this.listener = listener
    // A new feed starts after the retired one: its undelivered copies never
    // arrive, and the new run's listing carries their commits.
    this.withheld.splice(0)
    return () => {
      if (this.listener === listener) this.listener = undefined
    }
  }

  /** The last commit's sequence number; a listing covers every commit. */
  get lastCommit(): number {
    return this.commits
  }

  snapshot(): Array<ConformanceRow> {
    return [...this.committed.values()].map((row) => structuredClone(row))
  }

  /**
   * One call: the requests of one transaction, answered by one plan and
   * committed together, or a single request. Answers with the commit's
   * sequence number, which its change feed carries, so an adapter can
   * confirm the write through sync.
   */
  write(requests: ReadonlyArray<WriteRequest>): Promise<number> {
    const { json, sql } = this.options
    for (const request of requests)
      this.log.push(json || sql ? jsonClone(request) : structuredClone(request))
    const plan = this.plans.shift() ?? acceptAtOnce
    return new Promise<number>((resolve, reject) => {
      const answer = () => {
        if (plan.outcome === `reject`) {
          reject(plan.error)
          return
        }
        const changes = requests.map((request): ProviderChange => {
          if (request.type === `delete`)
            return { type: `delete`, id: request.id }
          // A SQL update merges the fields it sends into the stored row.
          const row =
            request.type === `update` && sql
              ? { ...this.committed.get(request.id), ...jsonClone(request.row) }
              : request.row
          return {
            type: `upsert`,
            row: rewriteRow(row as ConformanceRow, plan.rewrite),
          }
        })
        resolve(this.commit(changes, plan.echoHeld))
      }
      // In order, an answer waits behind every earlier unanswered request.
      const entry = { answer, held: plan.held && !this.draining }
      this.unanswered.push(entry)
      if (entry.held) this.held.push(() => this.answerEntry(entry))
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
   * Commits changes as one commit and feeds them back together, at once or
   * at `deliver`. Without field updates a write replaces the whole row, as a
   * complete-row API does.
   */
  private commit(
    changes: ReadonlyArray<ProviderChange>,
    withhold = false,
  ): number {
    for (const change of changes)
      if (change.type === `delete`) this.committed.delete(change.id)
      else this.committed.set(change.row.id, this.stored(change.row))
    const sequence = ++this.commits
    const fed = changes.map((change) =>
      this.echoesAuthored
        ? structuredClone(change)
        : change.type === `delete`
          ? change
          : { ...change, row: this.stored(change.row) },
    )
    const feed = () => this.listener?.(fed, sequence)
    // A copy waits behind a withheld one: any, from a log, or one for its
    // keys, since a provider keeps one key's copies in commit order.
    const ids = changes.map((change) =>
      change.type === `delete` ? change.id : change.row.id,
    )
    if (
      (withhold && !this.draining) ||
      this.withheld.some(
        (entry) => this.options.log || entry.ids.some((id) => ids.includes(id)),
      )
    )
      this.withheld.push({ feed, own: withhold, ids })
    else feed()
    return sequence
  }

  // The oracle's side.

  plan(plan: WritePlan): void {
    this.onStep()
    this.plans.push(plan)
  }

  release(): void {
    this.onStep()
    this.held.shift()?.()
  }

  deliver(): void {
    this.onStep()
    this.withheld.shift()?.feed()
    for (;;) {
      const index = this.withheld.findIndex(
        (entry, at) =>
          !entry.own &&
          this.withheld
            .slice(0, at)
            .every(
              (earlier) =>
                !this.options.log &&
                earlier.ids.every((id) => !entry.ids.includes(id)),
            ),
      )
      if (index < 0) return
      this.withheld.splice(index, 1)[0]!.feed()
    }
  }

  /**
   * Answers every held request and feeds every withheld copy, and from now
   * on answers each request at once and withholds no copy, also for a
   * request the adapter's queue sends only after these answers.
   */
  drain(): void {
    this.draining = true
    while (this.held.length > 0) this.release()
    while (this.withheld.length > 0) this.deliver()
  }

  foreignCommit(change: ProviderChange): void {
    this.onStep()
    this.commit([change])
  }

  rows(): ReadonlyArray<ConformanceRow> {
    return this.snapshot()
  }

  requests(): ReadonlyArray<WriteRequest> {
    return this.log
  }
}

let sequence = 0

/** A provider's answer to one request, as the adapter confirms it. */
type Answer = { commit: number; id: number; ticket: number }

/** Builds the reference adapter's Collection over `provider`. */
function referenceCollection(
  provider: ControlledMutationProvider,
  mutant: ReferenceMutationMutant | undefined,
  {
    sql = false,
    confirms = sql,
    application = false,
    counted = false,
    atomic = false,
  }: ReferenceMutationOptions,
) {
  // MUT-10: each write waits for the earlier one to be decided, by the
  // provider's answer. A write's turn covers sending it; its confirmation
  // (SQL) follows after the turn.
  let turn: Promise<unknown> = Promise.resolve()
  const persist = async (
    sendAll: () => Promise<Array<Answer>>,
  ): Promise<void> => {
    admitted++
    try {
      if (mutant === `writes-concurrently` || application) {
        await confirmAll(await sendAll())
        return
      }
      const sent = turn.then(sendAll)
      const chained =
        mutant === `chains-on-confirmation` ? sent.then(confirmAll) : sent
      turn = chained.catch(() => undefined)
      await confirmAll(await sent)
    } finally {
      admitted--
      forgetCounts()
    }
  }
  // Mutation functions settled since the oracle's step began; the
  // joint-settlement mutants act once a second one has.
  let settledInStep = 0
  provider.onStep = () => (settledInStep = 0)
  const answer = async (sent: Promise<void>): Promise<void> => {
    try {
      await sent
    } catch (error) {
      if (mutant === `swallows-rejection`) return
      if (mutant === `wraps-rejection`)
        throw new Error(`wrapped`, { cause: error })
      throw error
    } finally {
      settledInStep++
    }
  }
  // MUT-7 (SQL): a write is confirmed when this sync run has applied the
  // commit its answer names.
  // Copies can arrive out of commit order, since a withheld one trails later
  // ones, so each write waits for its own commit, not for the highest seen.
  const applied = new Set<number>()
  let highest = 0
  // Counted (`counted-echoes`), as TrailBase confirms: the adapter numbers
  // its answered writes and the copies per key, counting while a write is
  // admitted or an answered write's copy is still to come, and the n-th
  // answered write on a key is confirmed by the n-th copy there.
  let admitted = 0
  const answeredCount = new Map<number, number>()
  const arrivedCount = new Map<number, number>()
  // Keys with a copy while a write is admitted, for `confirms-on-any-copy`.
  const anyCopy = new Set<number>()
  const forgetCounts = () => {
    if (admitted > 0) return
    anyCopy.clear()
    if (
      [...answeredCount].every(
        ([id, answered]) => (arrivedCount.get(id) ?? 0) >= answered,
      )
    ) {
      answeredCount.clear()
      arrivedCount.clear()
    }
  }
  /**
   * Sends one call; the answers name its commit and each request's number.
   * Atomic, a transaction is one call; otherwise each request is its own,
   * and the first rejection ends the transaction.
   */
  const send = async (
    requests: ReadonlyArray<WriteRequest>,
  ): Promise<Array<Answer>> => {
    const commit = await provider.write(requests)
    return requests.map(({ id }) => {
      const ticket = (answeredCount.get(id) ?? 0) + 1
      if (counted) answeredCount.set(id, ticket)
      return { commit, id, ticket }
    })
  }
  const sendAll = async (
    requests: ReadonlyArray<WriteRequest>,
  ): Promise<Array<Answer>> => {
    if (atomic) return send(requests)
    const answers: Array<Answer> = []
    let failure: { error: unknown } | undefined
    for (const request of requests) {
      try {
        answers.push(...(await send([request])))
      } catch (error) {
        if (mutant !== `continues-after-rejection`) throw error
        failure ??= { error }
      }
    }
    if (failure) throw failure.error
    return answers
  }
  // An answer can have several waiters: the write, and under
  // `chains-on-confirmation` the next write's turn.
  let confirmations: Array<{ answer: Answer; resolve: () => void }> = []
  const isApplied = ({ commit, id, ticket }: Answer) =>
    mutant === `confirms-on-any-copy`
      ? anyCopy.has(id)
      : counted
        ? (arrivedCount.get(id) ?? 0) >= ticket
        : mutant === `confirms-by-high-water`
          ? highest >= commit
          : applied.has(commit) || commit <= listedThrough
  const confirmed = (answer: Answer): Promise<void> => {
    if (!confirms || mutant === `settles-on-answer` || isApplied(answer))
      return Promise.resolve()
    return new Promise((resolve) => confirmations.push({ answer, resolve }))
  }
  const confirmAll = (answers: Array<Answer>) =>
    Promise.all(answers.map(confirmed)).then(() => undefined)
  const resolveConfirmed = () => {
    const ready = confirmations.filter(({ answer }) => isApplied(answer))
    confirmations = confirmations.filter((entry) => !ready.includes(entry))
    for (const { resolve } of ready) resolve()
    forgetCounts()
  }
  // The rows this adapter has written, kept across a reload as core keeps
  // them; the latest listing covers every commit through `listedThrough`.
  const keys = new Set<number>()
  let listedThrough = 0
  let started = false
  // The `writes-back-authored` mutant writes through the sync run's apply.
  let applyChange:
    ((changes: ReadonlyArray<ProviderChange>) => void) | undefined
  const writeBack = (row: ConformanceRow) => {
    if (mutant === `writes-back-authored`)
      applyChange?.([{ type: `upsert`, row: structuredClone(row) }])
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
        // One commit applies as one sync transaction.
        const apply = (changes: ReadonlyArray<ProviderChange>) => {
          begin()
          for (const change of changes)
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
        const receive = (
          changes: ReadonlyArray<ProviderChange>,
          commitSequence: number,
        ) => {
          apply(changes)
          applied.add(commitSequence)
          highest = Math.max(highest, commitSequence)
          const counting = admitted > 0 || answeredCount.size > 0
          for (const change of changes) {
            const id = change.type === `delete` ? change.id : change.row.id
            if (counting) arrivedCount.set(id, (arrivedCount.get(id) ?? 0) + 1)
            if (admitted > 0) anyCopy.add(id)
          }
          resolveConfirmed()
        }
        // The listing: the provider's rows, over the rows a reload keeps, and
        // a delete of each kept row it lacks. It covers every commit so far,
        // so it confirms every answered write; counted, it credits every
        // answered number.
        const list = () => {
          const rows = provider.snapshot()
          begin()
          const listed = new Set(rows.map((row) => row.id))
          for (const row of rows) {
            write({ type: keys.has(row.id) ? `update` : `insert`, value: row })
            keys.add(row.id)
          }
          for (const id of [...keys])
            if (!listed.has(id)) {
              write({ type: `delete`, key: id })
              keys.delete(id)
            }
          void commit()
          markReady()
          if (mutant !== `reload-skips-confirmation`)
            listedThrough = provider.lastCommit
          if (counted && mutant !== `reload-keeps-counts`)
            for (const [id, answered] of answeredCount)
              arrivedCount.set(
                id,
                Math.max(arrivedCount.get(id) ?? 0, answered),
              )
          resolveConfirmed()
        }
        let unsubscribe: (() => void) | undefined
        let retired = false
        const start = () => {
          if (retired) return
          unsubscribe = provider.subscribe((change, commitSequence) => {
            if (mutant === `applies-copy-late`)
              setTimeout(() => receive(change, commitSequence), 0)
            else receive(change, commitSequence)
          })
          applyChange = apply
          list()
        }
        // Counted, a reload's run subscribes in the write queue: a request in
        // flight across the subscription could commit on either side of it.
        if (counted && started) turn = turn.then(start)
        else start()
        started = true
        return () => {
          retired = true
          unsubscribe?.()
        }
      },
    },
    onInsert: ({ transaction }) =>
      answer(
        persist(async () => {
          const requests = transaction.mutations.flatMap((mutation) => {
            const request = {
              type: `insert` as const,
              id: mutation.key,
              // A SQL row has every column: an absent field is `NULL`.
              row: sql
                ? { note: null as unknown as undefined, ...mutation.modified }
                : structuredClone(mutation.modified),
            }
            return mutant === `writes-insert-twice`
              ? [request, request]
              : [request]
          })
          const commits = await sendAll(requests)
          for (const mutation of transaction.mutations)
            writeBack(mutation.modified)
          return commits
        }),
      ),
    onUpdate: ({ transaction }) =>
      answer(
        persist(async () => {
          const commits = await sendAll(
            transaction.mutations.map((mutation) => ({
              type: `update` as const,
              id: mutation.key,
              row: updateRow(mutation),
            })),
          )
          for (const mutation of transaction.mutations)
            writeBack(mutation.modified)
          return commits
        }),
      ),
    onDelete: ({ transaction }) =>
      answer(
        persist(async () => {
          if (mutant === `skips-delete`) return []
          return sendAll(
            transaction.mutations.map((mutation) => ({
              type: `delete` as const,
              id: mutation.key,
            })),
          )
        }),
      ),
  })
  return { collection, jointSettlement: () => settledInStep > 1 }
}

/** The view subscribers see under a joint-settlement mutant. */
function jointSettlementView(
  view: ObservedCollection,
  mutant: `drops-joint-settlement` | `replays-joint-settlement`,
  jointSettlement: () => boolean,
): ObservedCollection {
  return Object.assign(Object.create(view) as ObservedCollection, {
    subscribeChanges: ((callback, options) =>
      view.subscribeChanges((changes) => {
        if (!jointSettlement()) return callback(changes)
        if (mutant === `drops-joint-settlement`) return
        callback(changes)
        const updates = changes.filter(
          (change) => change.type === `update` && change.previousValue,
        )
        if (updates.length === 0) return
        callback(
          updates.map((change) => ({
            ...change,
            value: change.previousValue!,
            previousValue: change.value,
          })),
        )
        callback(updates)
      }, options)) satisfies ObservedCollection[`subscribeChanges`],
  })
}

const sqlMutants = new Set<ReferenceMutationMutant | undefined>([
  `sends-complete-row`,
  `drops-removal`,
  `settles-on-answer`,
  `chains-on-confirmation`,
  `confirms-by-high-water`,
  `confirms-on-any-copy`,
  `reload-skips-confirmation`,
  `reload-keeps-counts`,
])

/** Replaces a held row's fields with `row`'s; only a held note value is removed. */
function edit(
  draft: { title: string; note?: string },
  row: ConformanceRow,
): void {
  draft.title = row.title
  if (Object.hasOwn(row, `note`)) draft.note = row.note
  else if (typeof draft.note === `string`) delete draft.note
}

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
    counted = mutant === `confirms-on-any-copy` ||
      mutant === `reload-keeps-counts`,
    atomic = false,
  }: ReferenceMutationOptions = {},
): MutationDriver {
  const capabilities: Array<MutationCapability> = [
    `write-rejection`,
    `held-writes`,
    `foreign-commits`,
    `server-rewrites`,
    `reloads`,
  ]
  if (sql) capabilities.push(`field-updates`)
  if (confirms) capabilities.push(`held-echoes`)
  if (log) capabilities.push(`log-ordered-echoes`)
  if (application) capabilities.push(`application-handlers`)
  if (inOrder) capabilities.push(`ordered-answers`)
  if (counted) capabilities.push(`counted-echoes`)
  if (atomic) capabilities.push(`atomic-transactions`)
  return {
    adapter: `reference mutations${json ? ` (JSON provider)` : ``}${sql ? ` (SQL provider)` : ``}${log ? ` (log)` : ``}${application ? ` (application handlers)` : ``}${inOrder ? ` (in order)` : ``}${counted ? ` (counted)` : ``}${atomic ? ` (atomic)` : ``}${mutant ? ` (${mutant})` : ``}`,
    ...(json && { undefinedField: `absent` as const }),
    ...(sql && { undefinedField: `null` as const }),
    capabilities: new Set(capabilities),
    create(seed): MutationFixture {
      const provider = new ControlledMutationProvider(
        seed,
        { json, sql, log, inOrder },
        mutant === `echoes-authored-row`,
      )
      const { collection, jointSettlement } = referenceCollection(
        provider,
        mutant,
        { sql, confirms, application, counted, atomic },
      )
      const view = observedView(collection, {
        row: (row) => row,
        key: (key) => key as number,
      })
      return {
        collection:
          mutant === `drops-joint-settlement` ||
          mutant === `replays-joint-settlement`
            ? jointSettlementView(view, mutant, jointSettlement)
            : view,
        base: () => collection.base.values(),
        writer: {
          insert: (row) => collection.insert(row),
          update: (row) =>
            collection.update(row.id, (draft) => edit(draft, row)),
          delete: (id) => collection.delete(id),
          batch: (type, rows) =>
            type === `insert`
              ? collection.insert([...rows])
              : type === `update`
                ? collection.update(
                    rows.map((row) => row.id),
                    (drafts) =>
                      drafts.forEach((draft, at) => edit(draft, rows[at]!)),
                  )
                : collection.delete(rows.map((row) => row.id)),
        },
        provider,
        drain: () => provider.drain(),
        reload: () => collection.reload(),
      }
    },
  }
}
