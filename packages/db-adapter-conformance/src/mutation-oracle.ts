/**
 * # Does a sync adapter persist an application's mutations faithfully?
 *
 * An application writes to a Collection with `insert`, `update`, and
 * `delete`. Each write is an optimistic transaction: core overlays its
 * optimistic state on the applied synced rows at once, and the adapter's
 * mutation function persists it to the provider. This oracle checks the laws
 * that every adapter which persists its own writes owes, whatever its
 * provider:
 *
 * - **MUT-1.** While a mutation function runs, the public rows show its
 *   optimistic state. When it fulfills, no publication shows the earlier
 *   synced value: the optimistic row drops in the same publication that
 *   applies the sync transaction carrying the provider's copy of the write.
 *   While another mutation is persisting, that sync transaction is held and
 *   the write's optimistic row stays as a held optimistic row until it
 *   applies (glossary). A one-row write publishes exactly one change of row
 *   values, and one more when its provider copy differs from the authored
 *   row, as a JSON provider's does for a removed field. Core also
 *   publishes an update when only a virtual row field changes, such as
 *   `$hasPendingWrites` when the write is confirmed; the check compares row
 *   values only, so such a publication counts as no change here, and the
 *   virtual-row-field owner (`packages/db/tests/query/virtual-row-fields-oracle.test.ts`)
 *   judges it.
 * - **MUT-2.** When the provider rejects a write, `when('settled')` rejects
 *   with the provider's error (or, under `matchesFailure`, the value the driver's
 *   relation names), the optimistic state drops in one publication that is
 *   exactly its inverse, and other pending mutations stay.
 * - **MUT-13, MUT-3, MUT-8.** Each write reaches the provider as exactly one
 *   request of its type for its key, carrying the authored row (an update
 *   sends the complete authored row) in the provider's value domain (FID-1):
 *   a JSON provider has no `undefined`, so a field the update removes is
 *   absent from its request and its copy, though the optimistic row holds it
 *   as an own `undefined`. A driver declares this with `undefinedField`.
 * - **MUT-10.** Writes are ordered per Collection: a write submitted while an
 *   earlier one is pending reaches the provider only after the earlier one
 *   is decided, accepted or rejected by the provider's answer. A write does
 *   not wait for an earlier one's confirmation through sync: core does not
 *   chain independent transactions, and an application that needs that
 *   chains them itself (maintainer decision 2026-11-03).
 * - **FID-5.** At a quiescent cut the public rows, the exposed authoritative
 *   base (`collection.base`), and the provider's rows are identical, and all
 *   three equal the model: the provider's starting rows with every accepted
 *   write's copy folded in author order, plus commits from other clients. A
 *   rejected write leaves no effect in the provider's rows. A provider may
 *   store a row that differs from the authored one (`server-rewrites`: a
 *   server default, trigger, or normalization); its copy is then the row's
 *   value, and the optimistic row gives way to it when the copy applies.
 * - **MUT-11.** A commit by another client while mutations are pending does
 *   not settle them and does not show under them: core holds its sync
 *   transaction until every mutation settles, and a pending write's own
 *   copy, not the other client's, confirms it. The declared exception is
 *   `counted-echoes` (TrailBase, whose events carry no write identity),
 *   where the model counts copies per key (maintainer decision 2026-11-04).
 * - **Reload.** A reload neither settles nor fails a pending write
 *   wrongly: a write whose copy the retired feed owed settles at the new
 *   run's listing, a write that keeps its feed settles at its copy, and
 *   every reload has fulfilled by the next quiescent cut (core's reload
 *   contract in `packages/db/src/collection/sync.ts`).
 * - **HEALTH-5.** No history causes an unhandled rejection or an undeclared
 *   error- or warning-level console diagnostic.
 *
 * Authority: the adapter conformance law set (issue #2118), section 9 and
 * FID-5; the optimistic state, held optimistic row, and accepted sync
 * transaction terms in `docs/contributing/glossary.md`. Core owns joining a
 * transaction (MUT-4) and holding synced commits behind pending optimistic
 * state (MUT-5) in `packages/db/tests/optimistic-history-oracle.ts`.
 *
 * Model terms. A **quiescent cut** is model-only: no mutation function is
 * pending, the provider has delivered every change, and every committed sync
 * transaction has applied. A **write request** is one call the adapter makes
 * to the provider for one mutation. A **plan** is the provider's answer to the
 * next write request, which the check hands the provider before the write: it
 * accepts or rejects, at once or after a `release`.
 *
 * Boundary. The oracle checks auto-transaction writes of one row
 * (`collection.insert`, `update`, `delete`) on a ready Collection whose
 * adapter persists them itself or, with `application-handlers`, confirms the
 * writes the application's handlers persist. A write may follow a pending
 * one on the same key. With `held-echoes` it checks confirmation through
 * sync (MUT-7). Commits from other clients arrive at any point, also over a
 * pending write on their key, as long as the provider can still take every
 * request it has not answered; an insert conflict or an update of a key
 * another client deleted is the law set's per-adapter `unknownKeyUpdate`,
 * which no driver declares. With `reloads` a history reloads the Collection.
 * A transaction of two or three mutations of one type goes through the
 * writer's `batch`: under `atomic-transactions` it persists all or none,
 * and otherwise its requests go out in mutation order and the first
 * rejection ends it (maintainer decision 2026-11-04). It does not check
 * manual transactions that mix types or Collections, schema validation, or
 * `awaitMatch`.
 */
import fc from 'fast-check'
import { ConformanceViolation } from './eager-live-source-oracle'
import type {
  ConformanceRow,
  ObservedCollection,
  ProviderChange,
} from './eager-live-source-oracle'

// ---------------------------------------------------------------------------
// Driver contract
// ---------------------------------------------------------------------------

/** Optional capabilities a driver declares; the grammar uses only these. */
export type MutationCapability =
  /** The provider can reject a write request (MUT-2). */
  | `write-rejection`
  /** The provider can hold a write request until `release` (MUT-1, MUT-10). */
  | `held-writes`
  /** The provider can commit a change made by another client. */
  | `foreign-commits`
  /**
   * The provider can store an accepted write's row with its own changes, as
   * server defaults, triggers, and normalization do (`ServerRewrite`).
   */
  | `server-rewrites`
  /**
   * Updates send only the changed fields, and the provider merges them into
   * its row (the law set's `field-updates`, MUT-8).
   */
  | `field-updates`
  /**
   * The provider can answer an accepted write before its change feed
   * delivers the copy, which it then delivers at `deliver`. Declare it only
   * for an adapter that confirms writes through sync (MUT-7), and only when
   * the provider can withhold each write's copy on its own: later writes
   * proceed while a copy is withheld, and `deliver` delivers the oldest.
   */
  | `held-echoes`
  /**
   * The provider's change feed delivers copies in commit order, as a log
   * does: a withheld copy also holds back every later commit's copy, and
   * `deliver` releases it with the copies queued behind it.
   */
  | `log-ordered-echoes`
  /**
   * The application's own handlers persist each write; the adapter supplies
   * only confirmation utilities. The adapter cannot order the handlers, so
   * each write's request goes out when it is made: MUT-10 is the
   * application's, since core does not chain independent transactions
   * (maintainer decision 2026-11-03).
   */
  | `application-handlers`
  /**
   * The provider answers requests in the order they arrive, as a server
   * that runs one client's mutations in order does: a request behind a held
   * one waits for it. Meaningful with `application-handlers`, whose requests
   * go out at once.
   */
  | `ordered-answers`
  /**
   * An update writes the fields its authored row names into the provider's
   * row and keeps the others, as RxDB's `incrementalPatch` does; a removed
   * field is named, so it is cleared. Its write, as the provider stores it,
   * is that merge (maintainer decision 2026-11-03, revising the law set's
   * complete-row MUT-8 clause for RxDB).
   */
  | `merged-updates`
  /**
   * The adapter confirms an answered write by counting change events, as
   * TrailBase does, whose events carry no write identity: the n-th answered
   * write on a key settles once n copies on that key have arrived, counting
   * copies of commits by other clients. Copies count from the first
   * admitted write until no write is admitted and every answered write's
   * copy has arrived; then the counts start over. So a copy from another
   * client can settle a write before its own copy arrives, and the public
   * rows then show that copy until the own copy applies (maintainer
   * decision 2026-11-04, the declared TrailBase rule for MUT-11).
   */
  | `counted-echoes`
  /**
   * The driver can reload the Collection (`collection.reload()`, through
   * the fixture's `reload`): core retires the sync run, and the new run
   * lists the provider's rows and subscribes to a new change feed. Copies
   * the retired run's feed had not delivered never arrive; the listing
   * carries their commits, so it confirms every write answered before it.
   * Under `counted-echoes` the new run subscribes in the adapter's write
   * queue, once every write admitted before the reload is answered, since
   * a request in flight across the subscription could commit on either
   * side of it; copies sent while no run is subscribed are lost, and the
   * listing then credits every answered write's number.
   */
  | `reloads`
  /**
   * With `reloads`: the new run reads the same change feed as the retired
   * one, as a Convex client's queries share its one transition stream.
   * Copies not delivered yet still arrive, and the new run's listing comes
   * behind them. Its listing is the rows the feed has delivered, so it
   * confirms nothing; it changes nothing the model tracks unless it is a
   * snapshot (`snapshot-reloads`), which applies them at once.
   */
  | `reload-keeps-feed`
  /**
   * With `reloads`: the new run's listing is a snapshot, which core applies
   * at once, with every committed sync transaction before it, even while a
   * mutation persists (core's truncate rule), so the listing's rows show
   * under the pending mutations as soon as it applies.
   */
  | `snapshot-reloads`
  /**
   * A transaction of several mutations is all-or-nothing: its requests go
   * out together and the provider answers them with one plan, committing
   * all or none, and their copies arrive as one commit. Without it, the
   * requests go out one at a time, each answered by its own plan, and the
   * first rejection ends the transaction: its later requests are not sent,
   * and the earlier accepted ones stay committed. Either way the
   * transaction rejects with that error and its whole optimistic state
   * rolls back (maintainer decision 2026-11-04: atomic where the provider
   * can be).
   */
  | `atomic-transactions`

/** The optimistic transaction a write call returns. */
export interface MutationReceipt {
  readonly state: string
  /** Settles when the mutation function settles, with its outcome. */
  when: (state: `settled`) => Promise<unknown>
}

/** The driver's writes, through the adapter's Collection. */
export interface MutationWriter {
  insert: (row: ConformanceRow) => MutationReceipt
  /**
   * Replace the held row's fields with `row`'s: a complete authored row. A
   * `row` without `note` removes a note value the held row holds; a held
   * row without one is left as it is.
   */
  update: (row: ConformanceRow) => MutationReceipt
  delete: (id: number) => MutationReceipt
  /**
   * One transaction of one mutation per row, in row order:
   * `collection.insert(rows)`, an update of the rows' keys that replaces
   * each held row's fields as `update` does, or `collection.delete(ids)`.
   */
  batch: (
    type: `insert` | `update` | `delete`,
    rows: ReadonlyArray<ConformanceRow>,
  ) => MutationReceipt
}

/** One write request the adapter made to the provider. */
export interface WriteRequest {
  readonly type: `insert` | `update` | `delete`
  readonly id: number
  /**
   * The row the request carries; absent for a delete. Under
   * `field-updates`, an update carries only its changed fields.
   */
  readonly row?: Readonly<Partial<ConformanceRow>>
}

/**
 * A change the provider makes to an accepted insert's or update's row before
 * it stores it. Its copy, not the authored row, is then the row's value:
 *
 * - `none`: the provider stores the row as sent;
 * - `retitle`: it normalizes the title to upper case;
 * - `drop-note`: it does not store `note`;
 * - `set-note`: it sets `note` to `server`, as a server default does.
 */
export type ServerRewrite = `none` | `retitle` | `drop-note` | `set-note`

/** The row a provider stores for `row` under `rewrite`. */
export function rewriteRow(
  row: ConformanceRow,
  rewrite: ServerRewrite,
): ConformanceRow {
  switch (rewrite) {
    case `none`:
      return row
    case `retitle`:
      return { ...row, title: row.title.toUpperCase() }
    case `drop-note`: {
      const { note: _dropped, ...rest } = row
      return rest
    }
    case `set-note`:
      return { ...row, note: `server` }
  }
}

/** The provider's answer to the next write request. */
/** The plan for a request the check did not plan: accept it at once. */
export const acceptAtOnce: WritePlan = {
  outcome: `accept`,
  held: false,
  echoHeld: false,
  rewrite: `none`,
  error: new Error(`unplanned write`),
}

export interface WritePlan {
  readonly outcome: `accept` | `reject`
  /**
   * What an accepted insert or update stores (`server-rewrites`); `none`
   * otherwise. The request still carries the authored row.
   */
  readonly rewrite: ServerRewrite
  /** Answer only at `release`, so the write stays pending until then. */
  readonly held: boolean
  /**
   * After accepting, deliver the copy through the change feed only at
   * `deliver` (`held-echoes`).
   */
  readonly echoHeld: boolean
  /**
   * How the provider rejects, one of the driver's `rejectionKinds`; absent
   * when the driver declares none.
   */
  readonly rejectionKind?: string
  /** The error a rejection answers with. */
  readonly error: Error
}

/**
 * The provider a driver controls. It answers write requests by plan, in the
 * order they arrive, and delivers every accepted write and every commit from
 * another client through the adapter's sync subscription, as a provider's
 * change feed does. It records every request; it must not merge, reorder, or
 * drop them.
 */
export interface MutationProvider {
  /** Queue the answer to the next write request that arrives. */
  plan: (plan: WritePlan) => void
  /** Answer the oldest held request by its plan (`held-writes`). */
  release?: () => void | Promise<void>
  /** Deliver the oldest withheld copy through the change feed (`held-echoes`). */
  deliver?: () => void | Promise<void>
  /** Commit a change made by another client (`foreign-commits`). */
  foreignCommit?: (change: ProviderChange) => void | Promise<void>
  /** The provider's committed rows. */
  rows: () =>
    ReadonlyArray<ConformanceRow> | Promise<ReadonlyArray<ConformanceRow>>
  /** Every write request so far, in arrival order. */
  requests: () => ReadonlyArray<WriteRequest>
}

/** What the check tells a fixture's propagation step. */
export interface SettleCut {
  /**
   * How many writes' `when('settled')` receipts, and reloads' promises, have
   * not settled yet.
   */
  unsettled: () => number
}

export interface MutationFixture {
  /** The adapter's Collection, read as conformance rows. */
  collection: ObservedCollection
  /** The exposed authoritative base (`collection.base`) as conformance rows. */
  base: () => Iterable<ConformanceRow>
  writer: MutationWriter
  provider: MutationProvider
  /**
   * Starts teardown: answers every held request and delivers every withheld
   * copy, and from then on answers each request at once and withholds no
   * copy, also for a write that reaches the provider only later from the
   * adapter's queue. The check calls it before cleanup, also after a
   * violation, so no write outlives the history waiting on the provider.
   */
  drain?: () => void | Promise<void>
  /** The adapter's propagation step, awaited before every comparison. */
  settle?: (cut: SettleCut) => Promise<void>
  /** `collection.reload()` (`reloads`). */
  reload?: () => Promise<void>
  dispose?: () => void | Promise<void>
}

export interface MutationDriver {
  readonly adapter: string
  readonly capabilities: ReadonlySet<MutationCapability>
  /**
   * When the adapter reports its own error for a provider rejection, the
   * relation that names the value owed (MUT-2's named error). Without it,
   * `when('settled')` must reject with the provider's error by identity.
   */
  readonly matchesFailure?: (reported: unknown, failure: Error) => boolean
  /**
   * The ways the provider can reject a write request, such as an error in
   * its response and a thrown exception (`write-rejection`). The grammar
   * picks one for each rejection, and each must be reached; MUT-2 owes the
   * same outcome for every kind.
   */
  readonly rejectionKinds?: ReadonlyArray<string>
  /**
   * How the provider stores an authored field whose value is `undefined`,
   * as an update that removes a field authors it. FID-1 parameterizes row
   * values by the adapter's value domain: `own` keeps the field as an own
   * `undefined`, as a structured clone does; `absent` drops it, as a JSON
   * document must, since JSON has no `undefined`; `null` sends it as `null`
   * and stores `NULL`, which the provider's rows report as an absent field,
   * as a SQL row does. Default `own`.
   */
  readonly undefinedField?: `own` | `absent` | `null`
  /** Console diagnostics the adapter declares (HEALTH-5). */
  readonly declaredDiagnostic?: (
    level: `error` | `warn`,
    args: ReadonlyArray<unknown>,
  ) => boolean
  /** A ready-to-preload fixture whose provider starts with `seed`. */
  create: (
    seed: ReadonlyArray<ConformanceRow>,
  ) => MutationFixture | Promise<MutationFixture>
}

// ---------------------------------------------------------------------------
// History grammar
// ---------------------------------------------------------------------------

/**
 * A history starts with the provider's seed rows, preloads the Collection,
 * and applies these steps. The model decides which steps are legal now; an
 * illegal step is skipped and counted, so a list stays meaningful after
 * shrinking.
 *
 * - `write`: an insert of a key the public rows lack, or an update or delete
 *   of a key they hold, also while earlier mutations on that key are
 *   pending, as long as their plans accept them; an arm generates two writes
 *   on one key in a row. An update
 *   that changes no field is not generated. An update without `note` of a
 *   row that holds one removes the field. Its plan rejects only with
 *   `write-rejection`, in one of the driver's `rejectionKinds` when it
 *   declares several, is held only with `held-writes`, and rewrites an
 *   accepted insert's or update's row only with `server-rewrites`.
 * - `release`: the provider answers the oldest held request (`held-writes`).
 * - `deliver`: the provider delivers the oldest copy it answered but
 *   withheld from its change feed (`held-echoes`).
 * - `transaction`: one transaction of two or three mutations of one type on
 *   distinct keys that no pending write holds, through the writer's
 *   `batch`. Under `atomic-transactions` its one plan decides every
 *   mutation; otherwise each mutation has its own, and a rejection at
 *   `rejectAt` ends it.
 * - `reload`: the application reloads the Collection (`reloads`), unless
 *   an earlier reload is still in flight, which returns its promise. An arm
 *   generates a write whose copy is withheld, a reload, and another write
 *   on its key.
 * - `foreign`: another client commits an upsert or a delete
 *   (`foreign-commits`), also while mutations are pending (MUT-11), as long
 *   as the provider can still take every request it has not answered. An
 *   arm generates a held write, or one whose copy is withheld, and then a
 *   commit by another client on its key.
 *
 * After the last step the check releases every held request, reaching a
 * quiescent cut. Keys range over 1..4 and titles over three values, so writes
 * revisit keys; a row carries `note` half the time, so an update can add or
 * remove a field, and a separate arm generates updates without `note` so
 * that removals are common. With `server-rewrites`, half of the plans
 * rewrite an accepted row.
 */
export type MutationStep =
  | {
      readonly kind: `write`
      readonly type: `insert` | `update` | `delete`
      readonly id: number
      readonly title: string
      readonly note?: string
      readonly outcome: `accept` | `reject`
      readonly held: boolean
      readonly echoHeld: boolean
      readonly rewrite: ServerRewrite
      /** One of the driver's `rejectionKinds`, for a rejection. */
      readonly rejectionKind?: string
    }
  | { readonly kind: `release` }
  | { readonly kind: `deliver` }
  | { readonly kind: `foreign`; readonly change: ProviderChange }
  | { readonly kind: `reload` }
  | {
      readonly kind: `transaction`
      readonly type: `insert` | `update` | `delete`
      /** One row per mutation, on distinct keys, in mutation order. */
      readonly rows: ReadonlyArray<{
        readonly id: number
        readonly title: string
        readonly note?: string
      }>
      readonly outcome: `accept` | `reject`
      readonly held: boolean
      readonly echoHeld: boolean
      readonly rewrite: ServerRewrite
      readonly rejectionKind?: string
      /** Without `atomic-transactions`: the mutation whose request rejects. */
      readonly rejectAt: number
    }

/** A write step. */
export type WriteStep = Extract<MutationStep, { kind: `write` }>

/** A transaction step. */
export type TransactionStep = Extract<MutationStep, { kind: `transaction` }>

export interface MutationHistory {
  readonly seed: ReadonlyArray<ConformanceRow>
  readonly steps: ReadonlyArray<MutationStep>
}

const rowArb: fc.Arbitrary<ConformanceRow> = fc.record(
  {
    id: fc.integer({ min: 1, max: 4 }),
    title: fc.constantFrom(`a`, `b`, `c`),
    note: fc.constantFrom(`x`, `y`),
  },
  { requiredKeys: [`id`, `title`] },
)

/** Generates histories whose steps use only the driver's capabilities. */
export function mutationHistoryArb(
  domain: Pick<MutationDriver, `capabilities` | `rejectionKinds`>,
): fc.Arbitrary<MutationHistory> {
  const { capabilities } = domain
  const kinds = domain.rejectionKinds ?? []
  const write = fc
    .record({
      type: fc.constantFrom(
        `insert` as const,
        `update` as const,
        `delete` as const,
      ),
      row: rowArb,
      outcome: capabilities.has(`write-rejection`)
        ? fc.constantFrom(
            `accept` as const,
            `accept` as const,
            `reject` as const,
          )
        : fc.constant(`accept` as const),
      held: capabilities.has(`held-writes`) ? fc.boolean() : fc.constant(false),
      echoHeld: capabilities.has(`held-echoes`)
        ? fc.boolean()
        : fc.constant(false),
      rewrite: capabilities.has(`server-rewrites`)
        ? fc.constantFrom<ServerRewrite>(
            `none`,
            `none`,
            `none`,
            `retitle`,
            `drop-note`,
            `set-note`,
          )
        : fc.constant<ServerRewrite>(`none`),
      rejectionKind:
        kinds.length > 0
          ? fc.constantFrom(...kinds)
          : fc.constant<string | undefined>(undefined),
    })
    .map(
      ({
        type,
        row,
        outcome,
        held,
        echoHeld,
        rewrite,
        rejectionKind,
      }): WriteStep => ({
        kind: `write`,
        type,
        id: row.id,
        title: row.title,
        ...(row.note === undefined ? {} : { note: row.note }),
        outcome,
        held,
        echoHeld: outcome === `accept` && echoHeld,
        rewrite: type === `delete` ? `none` : rewrite,
        ...(outcome === `reject` && rejectionKind !== undefined
          ? { rejectionKind }
          : {}),
      }),
    )
  const steps: Array<{
    weight: number
    arbitrary: fc.Arbitrary<MutationStep>
  }> = [
    { weight: 6, arbitrary: write },
    // An update without `note`: it removes the field when the row holds one.
    {
      weight: 2,
      arbitrary: write.map(({ note: _note, ...step }): WriteStep => ({
        ...step,
        type: `update`,
      })),
    },
  ]
  if (capabilities.has(`held-writes`)) {
    steps.push({
      weight: 3,
      arbitrary: fc.constant({ kind: `release` as const }),
    })
  }
  if (capabilities.has(`held-echoes`)) {
    steps.push({
      weight: 3,
      arbitrary: fc.constant({ kind: `deliver` as const }),
    })
  }
  steps.push({
    weight: 3,
    arbitrary: fc
      .record({
        type: fc.constantFrom(
          `insert` as const,
          `update` as const,
          `delete` as const,
        ),
        rows: fc.uniqueArray(rowArb, {
          selector: (row) => row.id,
          minLength: 2,
          maxLength: 3,
        }),
        plan: write,
        // Half reject, since a transaction's keys are rarely all legal.
        rejects: capabilities.has(`write-rejection`)
          ? fc.boolean()
          : fc.constant(false),
        rejectAt: fc.integer({ min: 0, max: 2 }),
      })
      .map(({ type, rows, plan, rejects, rejectAt }): MutationStep => ({
        kind: `transaction`,
        type,
        rows,
        outcome: rejects ? `reject` : `accept`,
        held: plan.held,
        echoHeld: !rejects && plan.echoHeld,
        rewrite: type === `delete` ? `none` : plan.rewrite,
        ...(plan.rejectionKind === undefined
          ? {}
          : { rejectionKind: plan.rejectionKind }),
        rejectAt,
      })),
  })
  if (capabilities.has(`reloads`)) {
    steps.push({
      weight: 1,
      arbitrary: fc.constant({ kind: `reload` as const }),
    })
  }
  if (capabilities.has(`foreign-commits`)) {
    steps.push({
      weight: 2,
      arbitrary: fc.oneof(
        rowArb.map((row): MutationStep => ({
          kind: `foreign`,
          change: { type: `upsert`, row },
        })),
        fc.integer({ min: 1, max: 4 }).map((id): MutationStep => ({
          kind: `foreign`,
          change: { type: `delete`, id },
        })),
      ),
    })
  }
  // Two writes on one key in a row, so a write often follows a pending one
  // on its key.
  const sameKeyPair = fc
    .tuple(write, write)
    .map(([first, second]): Array<MutationStep> => [
      first,
      { ...second, id: first.id },
    ])
  // A held write the provider stores with a field the client has not seen,
  // then an update of that key that does not name it: a merged update keeps
  // the field, a complete-row one drops it.
  const unseenFieldPair =
    capabilities.has(`server-rewrites`) && capabilities.has(`held-writes`)
      ? [
          {
            weight: 3,
            arbitrary: fc
              .tuple(write, write)
              .map(([first, second]): Array<MutationStep> => {
                const { note: _note, ...update } = second
                return [
                  {
                    ...first,
                    type: first.type === `delete` ? `insert` : first.type,
                    outcome: `accept`,
                    held: true,
                    rewrite: `set-note`,
                  },
                  {
                    ...update,
                    type: `update`,
                    id: first.id,
                    outcome: `accept`,
                  },
                ]
              }),
          },
        ]
      : []
  // A write the provider holds, or answers with its copy withheld, then a
  // commit by another client on its key (MUT-11): the other client's copy
  // arrives before the write is answered, or queues behind its copy.
  const foreignOverPending = (held: boolean) =>
    fc.tuple(write, rowArb).map(([first, row]): Array<MutationStep> => [
      {
        ...first,
        type: first.type === `delete` ? `update` : first.type,
        outcome: `accept`,
        held,
        echoHeld: !held,
      },
      {
        kind: `foreign`,
        change: { type: `upsert`, row: { ...row, id: first.id } },
      },
    ])
  const foreignPairs = capabilities.has(`foreign-commits`)
    ? [
        ...(capabilities.has(`held-writes`)
          ? [{ weight: 1, arbitrary: foreignOverPending(true) }]
          : []),
        ...(capabilities.has(`held-echoes`)
          ? [{ weight: 1, arbitrary: foreignOverPending(false) }]
          : []),
      ]
    : []
  // A write whose copy is withheld or whose answer is held, a reload, and
  // another write on its key: the retired feed owed the first write's copy.
  const reloadPairs = capabilities.has(`reloads`)
    ? [
        {
          weight: 1,
          arbitrary: fc
            .tuple(write, write, fc.boolean())
            .map(([first, second, held]): Array<MutationStep> => [
              {
                ...first,
                outcome: `accept`,
                held: held && capabilities.has(`held-writes`),
                echoHeld: !held && capabilities.has(`held-echoes`),
              },
              { kind: `reload` },
              { ...second, type: `update`, id: first.id },
            ]),
        },
      ]
    : []
  return fc.record({
    seed: fc.uniqueArray(rowArb, { selector: (row) => row.id, maxLength: 3 }),
    steps: fc
      .array(
        fc.oneof(
          ...steps.map(({ weight, arbitrary }) => ({
            weight,
            arbitrary: arbitrary.map((step) => [step]),
          })),
          { weight: 2, arbitrary: sameKeyPair },
          ...unseenFieldPair,
          ...foreignPairs,
          ...reloadPairs,
        ),
        { minLength: 1, maxLength: 10 },
      )
      .map((groups) => groups.flat()),
  })
}

// ---------------------------------------------------------------------------
// Independent model
// ---------------------------------------------------------------------------

/**
 * A row as the model compares it: its title, and its note or the note's
 * absence. Fields compare by own property, so an own `undefined` note differs
 * from an absent one (FID-1).
 */
function rowValue(row: ConformanceRow): string {
  return JSON.stringify([
    row.title,
    Object.hasOwn(row, `note`) ? [row.note ?? null] : [],
  ])
}

type RowState = ReadonlyArray<[number, string]>

function rowState(rows: ReadonlyMap<number, string>): RowState {
  return [...rows].sort(([a], [b]) => a - b)
}

function rowsOf(rows: Iterable<ConformanceRow>): RowState {
  return rowState(new Map([...rows].map((row) => [row.id, rowValue(row)])))
}

function sameRows(a: RowState, b: RowState): boolean {
  return (
    a.length === b.length &&
    a.every(
      ([id, value], index) => b[index]![0] === id && b[index]![1] === value,
    )
  )
}

/**
 * A request's row as the model compares it: each field it carries other than
 * the key, in name order, with `undefined` as `null`, since a request is
 * compared by the fields it sends.
 */
function requestValue(fields: Readonly<Partial<ConformanceRow>>): string {
  return JSON.stringify(
    Object.keys(fields)
      .filter((field) => field !== `id`)
      .sort()
      .map((field) => [field, fields[field as keyof ConformanceRow] ?? null]),
  )
}

/** A model row value back as a row. */
function rowOf(id: number, value: string): ConformanceRow {
  const [title, note] = JSON.parse(value) as [string, Array<string | null>]
  return {
    id,
    title,
    ...(note.length === 0 ? {} : { note: note[0] ?? undefined }),
  }
}

/** A mutation whose plan has not decided it yet. */
interface PendingWrite {
  /** Its position among every write's mutations. */
  readonly index: number
  /** Its transaction's receipt, which `settlements` is indexed by. */
  readonly receipt: number
  /** Its transaction's mutations, in mutation order; itself alone mostly. */
  readonly group: ReadonlyArray<PendingWrite>
  readonly type: `insert` | `update` | `delete`
  readonly id: number
  /** The authored row's model value; absent for a delete. */
  readonly value?: string
  /**
   * The fields its request carries, in the provider's value domain: the
   * authored row, or under `field-updates` an update's changed fields.
   * Absent for a delete.
   */
  readonly sent?: Readonly<Partial<ConformanceRow>>
  readonly plan: WritePlan
  requested: boolean
  /** Accepted, with its copy not yet delivered by the change feed. */
  answered: boolean
  /** Under `counted-echoes`: the number its answer took on its key. */
  ticket?: number
  /** Its copy arrived; its transaction settles once every mutation's has. */
  confirmed: boolean
}

/**
 * A commit's copy in the provider's change feed: an accepted write's, an
 * atomic transaction's, or a commit by another client's. It carries each
 * row as that commit stored it.
 */
interface Copy {
  /** Each row the commit changed, absent `value` for a delete. */
  readonly changes: ReadonlyArray<{
    readonly id: number
    readonly value?: string
  }>
  /** The accepted mutations it copies; none for another client's commit. */
  readonly writes: ReadonlyArray<PendingWrite>
  /** The write's plan withholds it until `deliver`. */
  readonly withheld: boolean
}

type ExpectedSettlement = `pending` | `fulfilled` | { rejected: Error }

/**
 * The model holds only what a legal next step can observe:
 *
 * - `provider` is the provider's committed rows: the seed, every accepted
 *   write's copy, and every commit from another client, in commit order. A
 *   write's copy is the row it sends (an update under `field-updates`
 *   merges its fields into the provider's row as it is when the write is
 *   accepted), stored under the driver's `undefinedField` rule and then the
 *   plan's `ServerRewrite`: after a rewrite the provider's copy, not the
 *   authored row, is the row's value (FID-5).
 * - `rewritten` counts accepted writes whose plan's rewrite made their copy
 *   differ from their authored row, for reach. A copy can also differ by
 *   the value domain alone, as a removed field does under `null`.
 * - `pending` lists the mutations not yet settled, in author order. MUT-10
 *   orders their requests: the first is requested at once, and each later
 *   one only after every earlier one is decided. A write is decided when
 *   the provider answers it. An accepted write whose copy the provider
 *   withholds is `answered`: it is decided, so the next write is
 *   requested, but it stays pending until its copy arrives (MUT-7).
 * - `requests` is every write request MUT-8 and MUT-10 allow so far.
 * - `settlements` is each write's `when('settled')` settlement.
 * - `delivered` is the provider's rows as its change feed has delivered
 *   them: a copy arrives at once, or after a withheld one ahead of it.
 * - `applied` is the synced rows core has applied. Each delivered copy
 *   reaches core as an accepted sync transaction, which is held while any
 *   optimistic transaction is persisting, so `applied` takes `delivered`
 *   only when no mutation is pending. A commit by another client while a
 *   mutation is pending therefore shows only once every mutation settles,
 *   and it does not settle a write (MUT-11), except under the declared
 *   `counted-echoes` rule.
 * - `heldRows` lists the settled writes that keep a held optimistic row, in
 *   author order: a committed sync transaction that has not applied touches
 *   the write's key (`unapplied`), and the row stays until it applies
 *   (glossary: accepted sync transaction, held optimistic row).
 *
 * The public rows are `applied` with `heldRows` and then `pending` folded on
 * in author order: core shows a mutation's optimistic state until its
 * mutation function settles, and a fulfilled write's provider copy replaces
 * its held optimistic row in the publication that applies it. With a
 * structured-clone provider the copy equals the authored row, so only a
 * provider whose copy differs, such as a JSON one, shows the hold.
 */
interface MutationModel {
  /** The driver's `undefinedField` declaration. */
  readonly undefinedField: `own` | `absent` | `null`
  /** The driver declares `field-updates`. */
  readonly fieldUpdates: boolean
  /** The adapter orders writes (MUT-10): no `application-handlers`. */
  readonly ordered: boolean
  /** The driver declares `log-ordered-echoes`. */
  readonly logOrdered: boolean
  /** The driver declares `ordered-answers`. */
  readonly answersInOrder: boolean
  /** The driver declares `merged-updates`. */
  readonly mergedUpdates: boolean
  /** The driver declares `counted-echoes`. */
  readonly counted: boolean
  provider: Map<number, string>
  delivered: Map<number, string>
  applied: Map<number, string>
  heldRows: Array<PendingWrite>
  /**
   * Keys that committed sync transactions touch which have not applied: a
   * copy that arrived while a mutation persists, or a held listing's rows.
   * A settled write keeps its held optimistic row only while its key is
   * here (glossary: held optimistic row).
   */
  unapplied: Set<number>
  pending: Array<PendingWrite>
  /** Copies not delivered yet, in commit order. */
  echoes: Array<Copy>
  /** Under `counted-echoes`: answered writes and arrived copies per key. */
  answeredCount: Map<number, number>
  arrivedCount: Map<number, number>
  /**
   * In the current step, the delivered rows each time core could apply them:
   * when no mutation is pending and a copy arrives or the last one settles.
   * Core applies every committed sync transaction when the last mutation
   * settles, so copies that arrive in one step may publish one by one or
   * together.
   */
  trail: Array<Map<number, string>>
  /**
   * Under `reloads`: a reload's new run has not listed yet. Under
   * `counted-echoes` it waits for the writes admitted before it, up to
   * this write index, to be answered; meanwhile no run is subscribed.
   */
  listingAfter: number | undefined
  /** The driver declares `reloads`. */
  readonly reloads: boolean
  /** The driver declares `reload-keeps-feed`. */
  readonly keepsFeed: boolean
  /** The driver declares `snapshot-reloads`. */
  readonly snapshotReloads: boolean
  /** The driver declares `atomic-transactions`. */
  readonly atomic: boolean
  /** Every write, by index. */
  writes: Array<PendingWrite>
  rewritten: number
  /** Merged updates whose stored row kept a field they did not name. */
  mergeKept: number
  requests: Array<{ type: WriteRequest[`type`]; id: number; value?: string }>
  settlements: Array<ExpectedSettlement>
}

function initialModel(
  seed: ReadonlyArray<ConformanceRow>,
  domain: Pick<MutationDriver, `capabilities` | `undefinedField`>,
): MutationModel {
  // A changed-fields request cannot carry a removal a JSON provider drops:
  // the provider would keep the field. The model does not define that
  // provider, so a driver must say how it sends a removal.
  if (
    domain.capabilities.has(`field-updates`) &&
    domain.undefinedField === `absent`
  )
    throw new Error(
      `field-updates with undefinedField 'absent' cannot send a removed ` +
        `field; declare undefinedField 'null' or 'own'`,
    )
  const provider = new Map(seed.map((row) => [row.id, rowValue(row)]))
  return {
    undefinedField: domain.undefinedField ?? `own`,
    fieldUpdates: domain.capabilities.has(`field-updates`),
    ordered: !domain.capabilities.has(`application-handlers`),
    logOrdered: domain.capabilities.has(`log-ordered-echoes`),
    answersInOrder: domain.capabilities.has(`ordered-answers`),
    mergedUpdates: domain.capabilities.has(`merged-updates`),
    counted: domain.capabilities.has(`counted-echoes`),
    provider,
    delivered: new Map(provider),
    applied: new Map(provider),
    heldRows: [],
    unapplied: new Set(),
    pending: [],
    echoes: [],
    answeredCount: new Map(),
    arrivedCount: new Map(),
    trail: [],
    listingAfter: undefined,
    reloads: domain.capabilities.has(`reloads`),
    keepsFeed: domain.capabilities.has(`reload-keeps-feed`),
    snapshotReloads: domain.capabilities.has(`snapshot-reloads`),
    atomic: domain.capabilities.has(`atomic-transactions`),
    writes: [],
    rewritten: 0,
    mergeKept: 0,
    requests: [],
    settlements: [],
  }
}

/**
 * The row a write authors. An update that drops `note` from a row holding one
 * removes the field, which the update API represents as an own `undefined`
 * field (the documented rule in packages/db/tests/proxy-detachment-contract-oracle.test.ts;
 * maintainer decision 2026-11-03).
 */
function authoredRow(
  step: WriteStep,
  over: string | undefined,
): ConformanceRow {
  // The row's `note` stays an own `undefined`: removed when it held a
  // value, kept when it already was one.
  const removesNote =
    step.type === `update` &&
    step.note === undefined &&
    over !== undefined &&
    (JSON.parse(over) as [string, Array<unknown>])[1].length > 0
  return {
    id: step.id,
    title: step.title,
    ...(step.note === undefined
      ? removesNote
        ? { note: undefined }
        : {}
      : { note: step.note }),
  }
}

/**
 * The fields a request sends for `fields` under the `undefinedField` rule:
 * `own` keeps an own `undefined`, `absent` drops it, and `null` sends it as
 * `null`. Under `null` a complete row is a SQL row, so it sends every
 * column, an absent `note` as `null`; changed fields send only themselves.
 */
function sentFields(
  fields: Readonly<Partial<ConformanceRow>>,
  undefinedField: MutationModel[`undefinedField`],
  complete: boolean,
): Partial<ConformanceRow> {
  if (undefinedField === `own`) return { ...fields }
  if (fields.note !== undefined) return { ...fields }
  if (!complete && !Object.hasOwn(fields, `note`)) return { ...fields }
  const { note: _removed, ...rest } = fields
  return undefinedField === `null`
    ? { ...rest, note: null as unknown as undefined }
    : rest
}

/**
 * The fields an update changes, as core's `changes` holds them: each authored
 * field that differs from the row it was authored over, a removed field as
 * an own `undefined`.
 */
function changedFields(
  authored: ConformanceRow,
  over: ConformanceRow,
): Partial<ConformanceRow> {
  return {
    id: authored.id,
    ...(authored.title === over.title ? {} : { title: authored.title }),
    ...(Object.hasOwn(authored, `note`) &&
    (authored.note !== over.note || !Object.hasOwn(over, `note`))
      ? { note: authored.note }
      : {}),
  }
}

/** The provider's copy of an accepted insert or update. */
function copyOf(state: MutationModel, write: PendingWrite): ConformanceRow {
  return rewriteRow(storedFields(state, write), write.plan.rewrite)
}

/**
 * The row an accepted insert or update stores before the provider's own
 * rewrite. An update under `field-updates` merges the fields it sends, and
 * under `merged-updates` the fields its authored row names, into the
 * provider's row; otherwise the sent row replaces it.
 */
function storedFields(
  state: MutationModel,
  write: PendingWrite,
): ConformanceRow {
  const merges =
    write.type === `update` && (state.fieldUpdates || state.mergedUpdates)
  const base = merges
    ? rowOf(write.id, state.provider.get(write.id)!)
    : { id: write.id }
  const named = state.mergedUpdates
    ? rowOf(write.id, write.value!)
    : write.sent!
  const merged = { ...base, ...named } as ConformanceRow
  const { note, ...rest } = merged
  // A stored `undefined` or `NULL` is an absent field, except to a
  // structured-clone provider, which keeps an own `undefined`.
  const kept =
    (note ?? undefined) !== undefined ||
    (state.undefinedField === `own` && Object.hasOwn(merged, `note`))
  return kept ? merged : rest
}

function fold(
  rows: ReadonlyMap<number, string>,
  writes: ReadonlyArray<PendingWrite>,
): Map<number, string> {
  const folded = new Map(rows)
  for (const write of writes) {
    if (write.type === `delete`) folded.delete(write.id)
    else folded.set(write.id, write.value!)
  }
  return folded
}

/** The public rows the model predicts. */
function visible(state: MutationModel): RowState {
  return rowState(fold(fold(state.applied, state.heldRows), state.pending))
}

/**
 * Decide a write by its plan. An accepted one enters the provider's rows; it
 * settles at once unless the provider withholds its copy, and then stays
 * pending, answered, until `confirm` (MUT-7). A rejected one settles.
 */
function decide(state: MutationModel, write: PendingWrite): void {
  // The first rejection ends the transaction: it rejects, and its whole
  // optimistic state rolls back; accepted earlier requests stay committed.
  if (write.plan.outcome === `reject`) {
    state.settlements[write.receipt] = { rejected: write.plan.error }
    for (const member of write.group)
      if (state.pending.includes(member)) retire(state, member)
    listIfAnswered(state)
    return
  }
  // An atomic transaction commits every mutation by its one plan, and its
  // copies arrive as one commit.
  const members = state.atomic ? write.group : [write]
  const changes: Array<{ id: number; value?: string }> = []
  for (const member of members) {
    if (member.type === `delete`) state.provider.delete(member.id)
    else {
      // A merged update keeps a stored field it does not name: the
      // provider's row held `note` before this write, and the authored row
      // has none.
      const stored = state.provider.get(member.id)
      if (
        state.mergedUpdates &&
        member.type === `update` &&
        stored !== undefined &&
        Object.hasOwn(rowOf(member.id, stored), `note`) &&
        !Object.hasOwn(rowOf(member.id, member.value!), `note`)
      )
        state.mergeKept++
      const copy = rowValue(copyOf(state, member))
      state.provider.set(member.id, copy)
      if (member.plan.rewrite !== `none` && copy !== member.value)
        state.rewritten++
    }
    member.answered = true
    if (state.counted) {
      member.ticket = (state.answeredCount.get(member.id) ?? 0) + 1
      state.answeredCount.set(member.id, member.ticket)
    }
    changes.push({
      id: member.id,
      ...(member.type === `delete`
        ? {}
        : { value: state.provider.get(member.id)! }),
    })
  }
  feed(state, { changes, writes: members, withheld: write.plan.echoHeld })
  for (const member of members) settleCounted(state, member.id)
  listIfAnswered(state)
}

/**
 * A reload's new run lists the provider's rows once every write admitted
 * before it is answered: the retired feed's undelivered copies are gone,
 * the listing delivers every commit, and it confirms every answered write,
 * under `counted-echoes` by crediting every answered number.
 */
function listIfAnswered(state: MutationModel): void {
  const after = state.listingAfter
  if (after === undefined) return
  if (state.pending.some((write) => write.index <= after && !write.answered))
    return
  state.listingAfter = undefined
  state.echoes = []
  // The listing writes every row it lists and deletes every kept row it
  // lacks.
  for (const id of [...state.delivered.keys(), ...state.provider.keys()])
    state.unapplied.add(id)
  state.delivered = new Map(state.provider)
  for (const [id, answered] of state.answeredCount)
    state.arrivedCount.set(
      id,
      Math.max(state.arrivedCount.get(id) ?? 0, answered),
    )
  for (const write of [...state.pending])
    if (write.answered) confirm(state, write)
  // A snapshot applies at once with every sync transaction before it, so no
  // held optimistic row waits for its copy any more.
  if (state.pending.length === 0 || state.snapshotReloads) {
    applyDelivered(state)
    state.heldRows = []
  }
  forgetCounts(state)
}

/**
 * A commit's copy enters the change feed. It is withheld by its own plan or
 * waits behind an undelivered one: any earlier one from a log, an earlier
 * one for its key otherwise, since every provider keeps one key's copies in
 * commit order. Otherwise it arrives at once.
 */
function feed(state: MutationModel, copy: Copy): void {
  // No run is subscribed: the copy is lost, and the listing carries it.
  if (state.listingAfter !== undefined) return
  if (
    copy.withheld ||
    state.echoes.some((earlier) => blocks(state, earlier, copy))
  )
    state.echoes.push(copy)
  else arrive(state, copy)
}

/**
 * A copy arrives: it enters the delivered rows, which core applies once no
 * mutation is pending. A write's own copy settles it, except under
 * `counted-echoes`, where every copy on a key counts toward the answered
 * writes on it.
 */
function arrive(state: MutationModel, copy: Copy): void {
  const counting = state.pending.length > 0 || state.answeredCount.size > 0
  for (const { id, value } of copy.changes) {
    if (value === undefined) state.delivered.delete(id)
    else state.delivered.set(id, value)
    state.unapplied.add(id)
    if (state.counted && counting)
      state.arrivedCount.set(id, (state.arrivedCount.get(id) ?? 0) + 1)
  }
  if (state.counted) for (const { id } of copy.changes) settleCounted(state, id)
  else for (const write of copy.writes) confirm(state, write)
  if (state.pending.length === 0) applyDelivered(state)
}

/** No mutation is pending: core applies the delivered rows. */
function applyDelivered(state: MutationModel): void {
  state.applied = new Map(state.delivered)
  state.unapplied.clear()
  const last = state.trail.at(-1)
  if (!last || !sameRows(rowState(last), rowState(state.delivered)))
    state.trail.push(new Map(state.delivered))
}

/**
 * Under `counted-echoes`: settle each answered write on `id` whose number
 * the arrived copies reach, then start the counts over once no write is
 * admitted and every answered write's copy has arrived.
 */
function settleCounted(state: MutationModel, id: number): void {
  if (!state.counted) return
  const arrived = state.arrivedCount.get(id) ?? 0
  for (const write of [...state.pending])
    if (
      write.id === id &&
      write.ticket !== undefined &&
      write.ticket <= arrived
    )
      confirm(state, write)
  if (state.pending.length === 0) applyDelivered(state)
  forgetCounts(state)
}

/**
 * Under `counted-echoes`: the counts start over once no write is admitted
 * and every answered write's copy has arrived.
 */
function forgetCounts(state: MutationModel): void {
  if (
    state.pending.length === 0 &&
    [...state.answeredCount].every(
      ([key, answered]) => (state.arrivedCount.get(key) ?? 0) >= answered,
    )
  ) {
    state.answeredCount.clear()
    state.arrivedCount.clear()
  }
}

/**
 * The oldest withheld copy arrives, and from a log every later copy queued
 * behind it, up to the next one its own plan withheld.
 */
function deliverEchoes(state: MutationModel): Array<RowState> {
  arrive(state, state.echoes.shift()!)
  const states = [visible(state)]
  for (;;) {
    const next = state.echoes.find(
      (copy, index) =>
        !copy.withheld &&
        state.echoes
          .slice(0, index)
          .every((earlier) => !blocks(state, earlier, copy)),
    )
    if (!next) return states
    state.echoes.splice(state.echoes.indexOf(next), 1)
    arrive(state, next)
    states.push(visible(state))
  }
}

/** Whether an undelivered copy holds back a later commit's copy. */
function blocks(state: MutationModel, earlier: Copy, later: Copy): boolean {
  return (
    state.logOrdered ||
    earlier.changes.some(({ id }) =>
      later.changes.some((change) => change.id === id),
    )
  )
}

/**
 * An accepted mutation's copy arrives. Its transaction fulfills once every
 * mutation's has, and each keeps a held optimistic row while an unapplied
 * sync transaction touches its key.
 */
function confirm(state: MutationModel, write: PendingWrite): void {
  if (!state.pending.includes(write)) return
  write.confirmed = true
  if (!write.group.every((member) => member.confirmed)) return
  state.settlements[write.receipt] = `fulfilled`
  for (const member of write.group) {
    if (state.unapplied.has(member.id)) state.heldRows.push(member)
    retire(state, member)
  }
  // Held rows layer in author order, also when a later write settles first.
  state.heldRows.sort((a, b) => a.index - b.index)
}

function retire(state: MutationModel, write: PendingWrite): void {
  state.pending.splice(state.pending.indexOf(write), 1)
  // The last persisting transaction settled: every held sync transaction
  // applies in its publication.
  if (state.pending.length === 0) {
    applyDelivered(state)
    state.heldRows = []
  }
  forgetCounts(state)
}

/**
 * MUT-10: request the oldest undecided mutation if it has not been; a request
 * answered at once is decided at once, which admits the next. A write is
 * decided when the provider answers it, also when its copy is withheld
 * (maintainer decision 2026-11-03). Returns the public rows after each
 * decision, for the publication check.
 */
function advance(state: MutationModel): Array<RowState> {
  const states: Array<RowState> = []
  for (;;) {
    // Ordered, the oldest undecided write goes next; with application
    // handlers, every write goes out when it is made, and the provider
    // answers each one not held, in arrival order with `ordered-answers`.
    const next = state.ordered
      ? undecided(state)
      : (state.pending.find((write) => !write.requested) ??
        state.pending.find(
          (write, index) =>
            !write.answered &&
            !write.plan.held &&
            (!state.answersInOrder ||
              state.pending
                .slice(0, index)
                .every((earlier) => earlier.answered)),
        ))
    if (!next) return states
    if (!next.requested) {
      // An atomic transaction's requests go out together, in mutation order.
      for (const member of state.atomic ? next.group : [next]) {
        member.requested = true
        state.requests.push({
          type: member.type,
          id: member.id,
          ...(member.sent === undefined
            ? {}
            : {
                // A merged update's write is the merge, as the provider
                // stores it at its request.
                value: requestValue(
                  state.mergedUpdates && member.type === `update`
                    ? storedFields(state, member)
                    : member.sent,
                ),
              }),
        })
      }
      if (!state.ordered) continue
    }
    if (next.plan.held) return states
    decide(state, next)
    states.push(visible(state))
  }
}

/**
 * Whether the provider can take `first`, then every pending request it has
 * not answered, in author order, each as its type requires: an insert of a
 * key it lacks, an update or delete of one it holds. What a provider does
 * otherwise is the law set's per-adapter `unknownKeyUpdate` or an insert
 * conflict, which no driver here declares, so the grammar leaves such
 * histories out.
 */
function providerTakes(
  state: MutationModel,
  first: ProviderChange | undefined,
  then: ReadonlyArray<{
    type: PendingWrite[`type`]
    id: number
    accepted: boolean
  }> = [],
): boolean {
  const keys = new Set(state.provider.keys())
  if (first?.type === `upsert`) keys.add(first.row.id)
  else if (first) keys.delete(first.id)
  // A request the plan rejects still reaches the provider as its type, so
  // it needs its key as well; only an accepted one changes the keys.
  // A mutation behind a rejected one of its transaction is never sent.
  const requests = state.pending
    .filter((write) => !write.answered && !behindRejection(write))
    .map(({ type, id, plan }) => ({
      type,
      id,
      accepted: plan.outcome === `accept`,
    }))
  return [...requests, ...then].every((request) => {
    const holds = keys.has(request.id)
    if (request.accepted) {
      if (request.type === `delete`) keys.delete(request.id)
      else keys.add(request.id)
    }
    return request.type === `insert` ? !holds : holds
  })
}

/** A mutation whose transaction ends at an earlier mutation's rejection. */
function behindRejection(write: PendingWrite): boolean {
  return write.group.some(
    (member) => member.index < write.index && member.plan.outcome === `reject`,
  )
}

/** The oldest pending write the provider has not answered. */
function undecided(state: MutationModel): PendingWrite | undefined {
  return state.pending.find((write) => !write.answered)
}

/** What a step did, for reach and law names. */
type StepDone =
  | {
      kind: `write`
      type: PendingWrite[`type`]
      outcome: WritePlan[`outcome`]
      held: boolean
      queued: boolean
      /** An earlier mutation on the same key was still pending. */
      sameKeyPending: boolean
      /** An update that removes `note`, authored as an own `undefined`. */
      removesField: boolean
    }
  | { kind: `release`; outcome: WritePlan[`outcome`] }
  | { kind: `deliver` }
  | {
      kind: `transaction`
      outcome: WritePlan[`outcome`]
      /** A mutation was accepted before the one that rejected. */
      partway: boolean
    }
  | {
      kind: `reload`
      /** An answered write's copy was withheld in the retired feed. */
      withheldCopy: boolean
      /** A pending write was not answered yet. */
      unanswered: boolean
    }
  | {
      kind: `foreign`
      /** A mutation of this client was pending. */
      whilePending: boolean
      /** A pending write on its key was not answered yet. */
      overUnanswered: boolean
      /** Its copy queued behind an undelivered copy on its key. */
      behindWithheld: boolean
    }

/**
 * Admits one transaction's mutations, in mutation order, under one receipt.
 * Under `atomic-transactions` they share its one plan; otherwise each has
 * its own, and a mutation without one is never requested.
 */
function admit(
  state: MutationModel,
  mutations: ReadonlyArray<{
    type: PendingWrite[`type`]
    id: number
    row: ConformanceRow | undefined
    over: string | undefined
  }>,
  plans: ReadonlyArray<WritePlan>,
): void {
  const receipt = state.settlements.length
  state.settlements.push(`pending`)
  const group: Array<PendingWrite> = []
  mutations.forEach(({ type, id, row, over }, at) => {
    const fields =
      row && type === `update` && state.fieldUpdates
        ? changedFields(row, rowOf(id, over!))
        : row
    const write: PendingWrite = {
      index: state.writes.length,
      receipt,
      group,
      type,
      id,
      ...(row && {
        value: rowValue(row),
        sent: sentFields(fields!, state.undefinedField, fields === row),
      }),
      plan: (state.atomic ? plans[0] : plans[at]) ?? acceptAtOnce,
      requested: false,
      answered: false,
      confirmed: false,
    }
    group.push(write)
    state.pending.push(write)
    state.writes.push(write)
  })
}

/**
 * Applies one step to the model. Returns undefined when the step is not
 * legal now, without moving the model, and otherwise what it did and the
 * public rows after each change it publishes, in order.
 */
function stepModel(
  state: MutationModel,
  step: MutationStep,
  plan: (step: WriteStep) => WritePlan,
): { done: StepDone; published: Array<RowState> } | undefined {
  state.trail = []
  switch (step.kind) {
    case `write`: {
      // The public rows the write is authored over.
      const rows = new Map(visible(state))
      // A write may follow a pending one on the same key: core layers their
      // optimistic states in author order.
      const sameKey = state.pending.filter((write) => write.id === step.id)
      const sameKeyPending = sameKey.length > 0
      // Only behind writes the provider will accept: after a rejected insert
      // or delete, what a provider does with the next write on that key is
      // the law set's per-adapter `unknownKeyUpdate`, which no driver here
      // declares.
      if (sameKey.some((write) => write.plan.outcome === `reject`))
        return undefined
      // Requests that go out at once can reach the provider out of author
      // order, so a write follows one on its key only once that is answered.
      if (
        !state.ordered &&
        !state.answersInOrder &&
        sameKey.some((write) => !write.answered)
      )
        return undefined
      // The public rows decide what the application can write, and the
      // provider must be able to take it once the requests ahead of it are
      // answered: a commit by another client may have changed the key.
      const legal =
        (step.type === `insert` ? !rows.has(step.id) : rows.has(step.id)) &&
        providerTakes(state, undefined, [
          {
            type: step.type,
            id: step.id,
            accepted: step.outcome === `accept`,
          },
        ])
      const over = rows.get(step.id)
      const row = step.type === `delete` ? undefined : authoredRow(step, over)
      const value = row && rowValue(row)
      // An update that changes no field records no mutation in core; no law
      // fixes its persistence, so the grammar leaves it out.
      const noop = step.type === `update` && over === value
      if (!legal || noop) return undefined
      // MUT-10 holds this write back: the adapter orders writes and an earlier
      // one waits for its held answer.
      const queued =
        state.ordered &&
        state.pending.some((write) => !write.answered && write.plan.held)
      admit(state, [{ type: step.type, id: step.id, row, over }], [plan(step)])
      // The optimistic state publishes when the write call returns.
      const published = [visible(state), ...advance(state)]
      return {
        done: {
          kind: `write`,
          type: step.type,
          outcome: step.outcome,
          held: step.held,
          queued,
          sameKeyPending,
          // Only a held note value is removed.
          removesField:
            step.type === `update` &&
            step.note === undefined &&
            over !== undefined &&
            typeof (JSON.parse(over) as [string, Array<unknown>])[1][0] ===
              `string`,
        },
        published,
      }
    }
    case `release`: {
      // The provider answers its oldest held request.
      const next = state.pending.find(
        (write) => !write.answered && write.requested && write.plan.held,
      )
      if (!next) return undefined
      decide(state, next)
      const published = [visible(state), ...advance(state)]
      return {
        done: { kind: `release`, outcome: next.plan.outcome },
        published,
      }
    }
    case `deliver`: {
      if (state.echoes.length === 0) return undefined
      const published = [...deliverEchoes(state), ...advance(state)]
      return { done: { kind: `deliver` }, published }
    }
    case `transaction`: {
      const rows = new Map(visible(state))
      const ids = step.rows.map((row) => row.id)
      // Its keys have no pending write: layering on a pending write is the
      // single writes' arm.
      if (
        new Set(ids).size !== ids.length ||
        state.pending.some((write) => ids.includes(write.id))
      )
        return undefined
      const rejectAt =
        step.outcome === `reject`
          ? Math.min(step.rejectAt, ids.length - 1)
          : ids.length
      const mutations = []
      for (const { id, title, note } of step.rows) {
        const over = rows.get(id)
        if ((step.type === `insert`) !== (over === undefined)) return undefined
        const single: WriteStep = {
          kind: `write`,
          type: step.type,
          id,
          title,
          ...(note === undefined ? {} : { note }),
          outcome: step.outcome,
          held: step.held,
          echoHeld: step.echoHeld,
          rewrite: step.rewrite,
        }
        const row =
          step.type === `delete` ? undefined : authoredRow(single, over)
        // Core records no mutation for an update that changes nothing.
        if (row && step.type === `update` && rowValue(row) === over)
          return undefined
        mutations.push({ type: step.type, id, row, over, single })
      }
      const accepted = (at: number) =>
        state.atomic ? step.outcome === `accept` : at < rejectAt
      if (
        !providerTakes(
          state,
          undefined,
          mutations
            .filter((_, at) => state.atomic || at <= rejectAt)
            .map(({ type, id }, at) => ({ type, id, accepted: accepted(at) })),
        )
      )
        return undefined
      // Atomic, one plan answers the transaction; otherwise each request
      // up to the rejection has its own, and only the first can be held.
      const plans = state.atomic
        ? [plan(mutations[0]!.single)]
        : mutations.slice(0, rejectAt + 1).map(({ single }, at) =>
            plan({
              ...single,
              outcome: at === rejectAt ? `reject` : `accept`,
              held: at === 0 && step.held,
              echoHeld: at !== rejectAt && step.echoHeld,
            }),
          )
      admit(state, mutations, plans)
      const published = [visible(state), ...advance(state)]
      return {
        done: {
          kind: `transaction`,
          outcome: step.outcome,
          partway: !state.atomic && step.outcome === `reject` && rejectAt > 0,
        },
        published,
      }
    }
    case `reload`: {
      // A reload in flight returns its promise; the next one starts after.
      if (!state.reloads || state.listingAfter !== undefined) return undefined
      const done: StepDone = {
        kind: `reload`,
        withheldCopy: state.echoes.some((copy) => copy.writes.length > 0),
        unanswered: state.pending.some((write) => !write.answered),
      }
      if (state.keepsFeed) {
        // The new run lists the rows the feed has delivered; as a snapshot
        // they apply at once, with every sync transaction before them.
        if (state.snapshotReloads) {
          applyDelivered(state)
          state.heldRows = []
        }
        return { done, published: [visible(state)] }
      }
      state.listingAfter = state.counted ? state.writes.length - 1 : -1
      state.echoes = []
      listIfAnswered(state)
      return { done, published: [visible(state)] }
    }
    case `foreign`: {
      // Another client commits, also while this client's mutations are
      // pending (MUT-11), as long as the provider can still take every
      // request it has not answered.
      const { change } = step
      const id = change.type === `upsert` ? change.row.id : change.id
      if (change.type === `delete` && !state.provider.has(id)) return undefined
      if (!providerTakes(state, change)) return undefined
      const done: StepDone = {
        kind: `foreign`,
        whilePending: state.pending.length > 0,
        overUnanswered: state.pending.some(
          (write) => write.id === id && !write.answered,
        ),
        behindWithheld: state.echoes.some((copy) =>
          copy.changes.some((change) => change.id === id),
        ),
      }
      if (change.type === `upsert`) state.provider.set(id, rowValue(change.row))
      else state.provider.delete(id)
      feed(state, {
        changes: [
          {
            id,
            ...(change.type === `upsert`
              ? { value: state.provider.get(id)! }
              : {}),
          },
        ],
        writes: [],
        withheld: false,
      })
      return { done, published: [visible(state)] }
    }
  }
}

/** The model state a step starts from, for the settlement check. */
interface StepStart {
  readonly pending: ReadonlyArray<PendingWrite>
  readonly heldRows: ReadonlyArray<PendingWrite>
  readonly applied: ReadonlyMap<number, string>
  readonly writes: number
}

function stepStart(state: MutationModel): StepStart {
  return {
    pending: [...state.pending],
    heldRows: [...state.heldRows],
    applied: new Map(state.applied),
    writes: state.writes.length,
  }
}

/**
 * How many writes a step settled. Writes that settle at one step settle in an
 * order no law fixes, so the publication check then follows each row on its
 * own (`rowFollowsSettlement`).
 */
function settledAtStep(state: MutationModel, start: StepStart): number {
  return [...start.pending, ...state.writes.slice(start.writes)].filter(
    (write) => state.settlements[write.receipt] !== `pending`,
  ).length
}

/** Every order of `items`. */
function orders<T>(items: ReadonlyArray<T>): Array<Array<T>> {
  if (items.length <= 1) return [[...items]]
  return items.flatMap((item, index) =>
    orders([...items.slice(0, index), ...items.slice(index + 1)]).map(
      (rest) => [item, ...rest],
    ),
  )
}

/**
 * Whether a row's published values follow one order in which the step's
 * writes on that row could settle. For each order of those writes, the row's
 * path is its value before the step, its value with the step's writes
 * pending, its value after each of them settles, its value in the
 * delivered rows each time core could apply them (`trail`), and the
 * model's final value. The published values must be that path with some values skipped,
 * as one publication can carry several settlements, and must end at the
 * final value. A value off every path, a value that returns, or a missing
 * final publication fails.
 */
function rowFollowsSettlement(
  state: MutationModel,
  start: StepStart,
  id: number,
  before: string | null,
  published: ReadonlyArray<string | null>,
): boolean {
  const pending = [...start.pending, ...state.writes.slice(start.writes)]
  const own = pending.filter(
    (write) =>
      write.id === id && state.settlements[write.receipt] !== `pending`,
  )
  const final = new Map(visible(state)).get(id) ?? null
  const valueWith = (done: ReadonlyArray<PendingWrite>) =>
    fold(
      fold(start.applied, [
        ...start.heldRows,
        ...done.filter(
          (write) => state.settlements[write.receipt] === `fulfilled`,
        ),
      ]),
      pending.filter((write) => !done.includes(write)),
    ).get(id) ?? null
  const observed = [before, ...published].filter(
    (value, index, all) => index === 0 || value !== all[index - 1],
  )
  if (observed.at(-1) !== final) return false
  return orders(own).some((order) => {
    const path = [
      before,
      ...order.map((_, settledCount) =>
        valueWith(order.slice(0, settledCount)),
      ),
      valueWith(order),
      ...state.trail.map((rows) => rows.get(id) ?? null),
      final,
    ]
    // The observed values, in order, appear along the path.
    let at = 0
    return observed.every((value) => {
      while (at < path.length && path[at] !== value) at++
      return at < path.length
    })
  })
}

/**
 * The publications a step owes: each change of the public rows, in order. A
 * change that leaves the rows as they were publishes nothing, as an accepted
 * write whose provider copy equals its optimistic state does.
 */
function owedPublications(
  before: RowState,
  states: ReadonlyArray<RowState>,
): Array<RowState> {
  const owed: Array<RowState> = []
  let last = before
  for (const next of states) {
    if (!sameRows(next, last)) owed.push(next)
    last = next
  }
  return owed
}

// ---------------------------------------------------------------------------
// Refinement check
// ---------------------------------------------------------------------------

/** Declared states whose laws need generated histories to reach them. */
export const mutationReachStates = [
  `insert-accepted`,
  `update-accepted`,
  `delete-accepted`,
  `write-rejected`,
  `held-write-pending`,
  `write-queued-behind-held`,
  `held-write-rejected`,
  `foreign-commit`,
  `foreign-commit-while-pending`,
  `foreign-commit-over-unanswered-write`,
  `foreign-commit-behind-withheld-copy`,
  `transaction-accepted`,
  `transaction-rejected`,
  `transaction-rejected-partway`,
  `reload`,
  `reload-with-withheld-copy`,
  `reload-with-unanswered-write`,
  `field-removed`,
  `same-key-pending`,
  `held-optimistic-row`,
  `server-rewrote-copy`,
  `merge-kept-field`,
  `echo-held`,
  `echo-queued-behind-withheld`,
  `quiescent-after-writes`,
] as const

/** A rejection of one of the driver's `rejectionKinds`, per kind. */
export type MutationReachState =
  (typeof mutationReachStates)[number] | `rejected-as-${string}`

/**
 * The capabilities a declared state needs: every one in `all`, at least one
 * in `any`, and none in `none`. A state with no entry needs none.
 */
const stateNeeds: Partial<
  Record<
    MutationReachState,
    {
      all?: ReadonlyArray<MutationCapability>
      any?: ReadonlyArray<MutationCapability>
      none?: ReadonlyArray<MutationCapability>
    }
  >
> = {
  'write-rejected': { all: [`write-rejection`] },
  'held-write-pending': { all: [`held-writes`] },
  // Only an adapter that orders writes holds one back (MUT-10).
  'write-queued-behind-held': {
    all: [`held-writes`],
    none: [`application-handlers`],
  },
  'held-write-rejected': { all: [`held-writes`, `write-rejection`] },
  'foreign-commit': { all: [`foreign-commits`] },
  'foreign-commit-while-pending': {
    all: [`foreign-commits`],
    any: [`held-writes`, `held-echoes`],
  },
  'foreign-commit-over-unanswered-write': {
    all: [`foreign-commits`, `held-writes`],
  },
  'foreign-commit-behind-withheld-copy': {
    all: [`foreign-commits`, `held-echoes`],
  },
  'transaction-rejected': { all: [`write-rejection`] },
  // Only a transaction that is not atomic can commit part of itself.
  'transaction-rejected-partway': {
    all: [`write-rejection`],
    none: [`atomic-transactions`],
  },
  reload: { all: [`reloads`] },
  'reload-with-withheld-copy': { all: [`reloads`, `held-echoes`] },
  'reload-with-unanswered-write': { all: [`reloads`, `held-writes`] },
  'held-optimistic-row': { all: [`held-writes`] },
  'server-rewrote-copy': { all: [`server-rewrites`] },
  'echo-held': { all: [`held-echoes`] },
  'merge-kept-field': { all: [`merged-updates`] },
  'echo-queued-behind-withheld': { all: [`held-echoes`] },
  // A write stays pending past its step only when held or confirmed late.
  'same-key-pending': { any: [`held-writes`, `held-echoes`] },
}

/** The declared states a driver's capabilities let histories reach. */
export function mutationReachStatesFor(
  domain: Pick<MutationDriver, `capabilities` | `rejectionKinds`>,
): Array<MutationReachState> {
  const has = (capability: MutationCapability) =>
    domain.capabilities.has(capability)
  const kinds = has(`write-rejection`)
    ? (domain.rejectionKinds ?? []).map(
        (kind): MutationReachState => `rejected-as-${kind}`,
      )
    : []
  return [
    ...mutationReachStates.filter((state) => {
      const { all = [], any, none = [] } = stateNeeds[state] ?? {}
      return all.every(has) && (any?.some(has) ?? true) && !none.some(has)
    }),
    ...kinds,
  ]
}

type Settlement = `pending` | `fulfilled` | { rejected: unknown }

function recordSettlement(promise: Promise<unknown>): { current: Settlement } {
  const record: { current: Settlement } = { current: `pending` }
  promise.then(
    () => {
      record.current = `fulfilled`
    },
    (error: unknown) => {
      record.current = { rejected: error }
    },
  )
  return record
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The checkpoint premise: an adapter answers its provider and applies the
 * provider's change within a few event-loop turns, or within the
 * propagation step its fixture declares. A slower adapter shows as a
 * mismatch at this cut, not as a pass.
 */
async function settle(fixture: MutationFixture, cut: SettleCut): Promise<void> {
  for (let turn = 0; turn < 3; turn++) await sleep(0)
  await fixture.settle?.(cut)
}

/**
 * Records the public rows after each change publication (MUT-1, MUT-2). A
 * subscription forwards changes only for keys it has sent, so it starts with
 * the initial state, which is the baseline and not a publication.
 */
function recordPublications(collection: ObservedCollection) {
  const rows = new Map<number, string>()
  let inconsistent = false
  let initial = true
  let publications: Array<RowState> = []
  const subscription = collection.subscribeChanges(
    (changes) => {
      if (initial) {
        initial = false
        for (const change of changes)
          rows.set(change.key, rowValue(change.value))
        return
      }
      if (changes.length === 0) return
      for (const change of changes) {
        if (change.type === `delete`) {
          if (!rows.delete(change.key)) inconsistent = true
        } else {
          if ((change.type === `insert`) === rows.has(change.key))
            inconsistent = true
          rows.set(change.key, rowValue(change.value))
        }
      }
      publications.push(
        inconsistent ? [[-1, `inconsistent change events`]] : rowState(rows),
      )
    },
    { includeInitialState: true },
  )
  // An empty Collection's initial state is no callback at all.
  initial = false
  return {
    take: () => {
      const taken = publications
      publications = []
      return taken
    },
    stop: () => subscription.unsubscribe(),
  }
}

function watchDetachedFailures(driver: MutationDriver) {
  const found: Array<string> = []
  const onRejection = (reason: unknown) => {
    found.push(`unhandled rejection: ${String(reason)}`)
  }
  const hasProcess = typeof process !== `undefined`
  if (hasProcess) process.on(`unhandledRejection`, onRejection)
  const original = { error: console.error, warn: console.warn }
  for (const level of [`error`, `warn`] as const) {
    console[level] = (...args: Array<unknown>) => {
      if (!driver.declaredDiagnostic?.(level, args)) {
        found.push(`console.${level}: ${args.map(String).join(` `)}`)
      }
    }
  }
  return {
    found: () => found,
    stop: () => {
      if (hasProcess) process.off(`unhandledRejection`, onRejection)
      console.error = original.error
      console.warn = original.warn
    },
  }
}

export interface MutationCheckOptions {
  /** Called when the history enters a declared state (ORC-015). */
  reach?: (state: MutationReachState) => void
}

/**
 * Runs one history through a driver and compares every checkpoint with the
 * model. Throws a `ConformanceViolation` naming the first violated law. The
 * fixture is always cleaned up; a cleanup failure after a violation is kept
 * as a secondary error (ORC-010).
 */
export async function checkMutationHistory(
  driver: MutationDriver,
  history: MutationHistory,
  options: MutationCheckOptions = {},
): Promise<{ accepted: number; skipped: number }> {
  const reach = options.reach ?? (() => {})
  const detached = watchDetachedFailures(driver)
  let created: MutationFixture | undefined
  try {
    created = await driver.create(structuredClone(history.seed))
  } catch (error) {
    detached.stop()
    throw error
  }
  const fixture = created
  const { collection, provider, writer } = fixture
  const state = initialModel(history.seed, driver)
  const receipts: Array<{ current: Settlement }> = []
  const reloadReceipts: Array<{ current: Settlement }> = []
  const cut: SettleCut = {
    unsettled: () =>
      [...receipts, ...reloadReceipts].filter(
        (receipt) => receipt.current === `pending`,
      ).length,
  }
  let accepted = 0
  let skipped = 0
  let primary: unknown
  let publications: ReturnType<typeof recordPublications> | undefined

  const steps = history.steps
  const violation = (law: string, step: number, want: unknown, got: unknown) =>
    new ConformanceViolation(law, step, want, got, history)
  const matches = (reported: unknown, failure: Error) =>
    driver.matchesFailure
      ? driver.matchesFailure(reported, failure)
      : reported === failure

  /** MUT-1, MUT-2, MUT-8, MUT-10, MUT-13, FID-5, HEALTH-5 at one cut. */
  const compare = async (stepIndex: number) => {
    await settle(fixture, cut)
    const found = detached.found()
    if (found.length > 0)
      throw violation(`HEALTH-5`, stepIndex, `no detached failure`, found)
    // The provider's request log first: it observes MUT-8, MUT-10, and
    // MUT-13 directly, where the rows show their effect only later.
    const requests = provider.requests().map((request) => ({
      type: request.type,
      id: request.id,
      ...(request.row === undefined
        ? {}
        : { value: requestValue(request.row) }),
    }))
    if (JSON.stringify(requests) !== JSON.stringify(state.requests)) {
      // Timing and content fail differently: a log that holds the owed one
      // in order with more requests, or repeats a request, has an extra or
      // early request, a log
      // the owed one holds that way misses or delays one, and any other
      // difference is a request's content.
      const within = (
        shorter: ReadonlyArray<unknown>,
        longer: ReadonlyArray<unknown>,
      ) => {
        let at = 0
        for (const request of longer)
          if (
            at < shorter.length &&
            JSON.stringify(request) === JSON.stringify(shorter[at])
          )
            at++
        return at === shorter.length
      }
      // A request that repeats the one before it where the logs part is a
      // duplicate, also when it took the next write's plan.
      const parts = requests.findIndex(
        (request, index) =>
          JSON.stringify(request) !== JSON.stringify(state.requests[index]),
      )
      const repeats =
        parts > 0 &&
        JSON.stringify(requests[parts]) === JSON.stringify(requests[parts - 1])
      throw violation(
        repeats ||
          (requests.length > state.requests.length &&
            within(state.requests, requests))
          ? `MUT-10/MUT-13 (extra or early request)`
          : requests.length < state.requests.length &&
              within(requests, state.requests)
            ? `MUT-10/MUT-13 (missing or late request)`
            : `MUT-8 (provider requests)`,
        stepIndex,
        state.requests,
        requests,
      )
    }
    const quiescent = state.pending.length === 0 && state.echoes.length === 0
    const rows = rowsOf(collection.values())
    if (!sameRows(rows, visible(state)))
      throw violation(
        quiescent ? `FID-5 (public rows)` : `MUT-1 (public rows)`,
        stepIndex,
        visible(state),
        rows,
      )
    const answered = new Set(
      state.pending
        .filter((write) => write.answered)
        .map((write) => write.receipt),
    )
    state.settlements.forEach((expected, index) => {
      const got = receipts[index]!.current
      const ok =
        expected === `pending` || expected === `fulfilled`
          ? got === expected
          : typeof got === `object` && matches(got.rejected, expected.rejected)
      if (!ok)
        throw violation(
          // An accepted write settles late, or early once answered (MUT-7);
          // before its answer it settles early (MUT-13).
          typeof expected === `object`
            ? `MUT-2 (settlement)`
            : expected === `fulfilled` || answered.has(index)
              ? `MUT-7 (settlement)`
              : `MUT-13 (settlement)`,
          stepIndex,
          typeof expected === `object` ? expected.rejected.message : expected,
          typeof got === `object` ? String(got.rejected) : got,
        )
    })
    if (!quiescent) return
    // FID-5 at a quiescent cut: public rows, base, and provider are one.
    const base = rowsOf(fixture.base())
    if (!sameRows(base, rowState(state.provider)))
      throw violation(`FID-5 (base)`, stepIndex, rowState(state.provider), base)
    const providerRows = rowsOf(await provider.rows())
    if (!sameRows(providerRows, rowState(state.provider)))
      throw violation(
        `FID-5 (provider rows)`,
        stepIndex,
        rowState(state.provider),
        providerRows,
      )
    // Core's reload contract: a reload completes when its run's rows apply
    // or it marks ready, so by a quiescent cut every reload has fulfilled.
    reloadReceipts.forEach((receipt) => {
      if (receipt.current !== `fulfilled`)
        throw violation(
          `reload (settlement)`,
          stepIndex,
          `fulfilled`,
          typeof receipt.current === `object`
            ? String(receipt.current.rejected)
            : receipt.current,
        )
    })
    if (receipts.length > 0) reach(`quiescent-after-writes`)
  }

  let published = visible(state)
  const checkPublications = (
    stepIndex: number,
    owed: ReadonlyArray<RowState>,
    law: string,
    from: StepStart,
  ) => {
    // Each change of row values, in order; a publication of the same row
    // values (a virtual row field change) is not one.
    const start = published
    const got: Array<RowState> = []
    for (const rows of publications!.take()) {
      if (!sameRows(rows, got.at(-1) ?? published)) got.push(rows)
    }
    published = got.at(-1) ?? published
    // Writes that settle at one step settle in an order no law fixes, and
    // copies that arrive once none is pending may publish one by one or
    // together. Then each row must follow one order of its own writes'
    // settlements, then the delivered rows, and end at the model's final
    // rows; an earlier synced value, a value that returns, or a missing
    // publication still shows.
    const valueIn = (rows: RowState, id: number) =>
      rows.find(([key]) => key === id)?.[1] ?? null
    const ids = new Set(
      [start, ...got, visible(state)].flatMap((rows) => rows.map(([id]) => id)),
    )
    const ok =
      settledAtStep(state, from) > 1 || state.trail.length > 1
        ? [...ids].every((id) =>
            rowFollowsSettlement(
              state,
              from,
              id,
              valueIn(start, id),
              got.map((rows) => valueIn(rows, id)),
            ),
          )
        : got.length === owed.length &&
          got.every((rows, index) => sameRows(rows, owed[index]!))
    if (!ok) throw violation(`${law} (publication)`, stepIndex, owed, got)
  }

  let rewritten = 0
  /** The declared states the model's state shows after a step. */
  const reachModelStates = () => {
    if (state.heldRows.length > 0) reach(`held-optimistic-row`)
    if (state.rewritten > rewritten) reach(`server-rewrote-copy`)
    if (state.mergeKept > 0) reach(`merge-kept-field`)
    if (state.pending.some((write) => write.answered)) reach(`echo-held`)
    if (state.echoes.some((copy) => !copy.withheld))
      reach(`echo-queued-behind-withheld`)
    rewritten = state.rewritten
  }
  // The plans the model decided the step's requests by, in request order;
  // the provider gets them too.
  const planned: Array<WritePlan> = []
  const planFor = (step: WriteStep): WritePlan => {
    // Indexed by write, so a driver's `matchesFailure` can name it; the write
    // records its receipt after its plan.
    const error = new Error(`conformance write rejected ${receipts.length}`)
    const plan: WritePlan = {
      outcome: step.outcome,
      held: step.held,
      echoHeld: step.echoHeld,
      rewrite: step.rewrite,
      ...(step.rejectionKind === undefined
        ? {}
        : { rejectionKind: step.rejectionKind }),
      error,
    }
    planned.push(plan)
    return plan
  }

  try {
    await collection.preload()
    publications = recordPublications(collection)
    await compare(-1)
    for (const [index, step] of steps.entries()) {
      // A reload while one is in flight returns that reload's promise and
      // starts no run (core's reload contract). When a reload completes is
      // the adapter's, at its run's `markReady()`, so such a step is skipped.
      if (
        step.kind === `reload` &&
        reloadReceipts.some((receipt) => receipt.current === `pending`)
      ) {
        skipped++
        continue
      }
      const before = visible(state)
      const from = stepStart(state)
      const result = stepModel(state, step, planFor)
      if (result === undefined) {
        planned.length = 0
        skipped++
        continue
      }
      accepted++
      const { done } = result
      let law = `MUT-1`
      switch (done.kind) {
        case `write`: {
          const write = step as WriteStep
          for (const plan of planned.splice(0)) provider.plan(plan)
          const row: ConformanceRow = {
            id: write.id,
            title: write.title,
            ...(write.note === undefined ? {} : { note: write.note }),
          }
          const receipt =
            write.type === `insert`
              ? writer.insert(row)
              : write.type === `update`
                ? writer.update(row)
                : writer.delete(write.id)
          receipts.push(recordSettlement(receipt.when(`settled`)))
          if (write.held) reach(`held-write-pending`)
          if (done.queued) reach(`write-queued-behind-held`)
          if (write.outcome === `reject`) {
            reach(`write-rejected`)
            if (write.rejectionKind !== undefined)
              reach(`rejected-as-${write.rejectionKind}`)
          } else if (!write.held) reach(`${write.type}-accepted` as const)
          if (done.removesField && write.outcome === `accept`)
            reach(`field-removed`)
          if (done.sameKeyPending) reach(`same-key-pending`)
          if (write.outcome === `reject` && !write.held) law = `MUT-2`
          break
        }
        case `transaction`: {
          const transaction = step as TransactionStep
          for (const plan of planned.splice(0)) provider.plan(plan)
          const receipt = writer.batch(
            transaction.type,
            transaction.rows.map(({ id, title, note }) => ({
              id,
              title,
              ...(note === undefined ? {} : { note }),
            })),
          )
          receipts.push(recordSettlement(receipt.when(`settled`)))
          reach(
            transaction.outcome === `accept`
              ? `transaction-accepted`
              : `transaction-rejected`,
          )
          if (done.partway) reach(`transaction-rejected-partway`)
          if (transaction.outcome === `reject` && !transaction.held)
            law = `MUT-2`
          break
        }
        case `release`:
          await provider.release!()
          if (done.outcome === `reject`) {
            reach(`held-write-rejected`)
            law = `MUT-2`
          }
          break
        case `deliver`:
          await provider.deliver!()
          break
        case `foreign`:
          await provider.foreignCommit!(
            (step as Extract<MutationStep, { kind: `foreign` }>).change,
          )
          reach(`foreign-commit`)
          if (done.whilePending) reach(`foreign-commit-while-pending`)
          if (done.overUnanswered) reach(`foreign-commit-over-unanswered-write`)
          if (done.behindWithheld) reach(`foreign-commit-behind-withheld-copy`)
          break
        case `reload`:
          reloadReceipts.push(recordSettlement(fixture.reload!()))
          reach(`reload`)
          if (done.withheldCopy) reach(`reload-with-withheld-copy`)
          if (done.unanswered) reach(`reload-with-unanswered-write`)
          break
      }
      reachModelStates()
      await compare(index)
      checkPublications(
        index,
        owedPublications(before, result.published),
        law,
        from,
      )
    }
    // Answer every held request and deliver every withheld copy, reaching a
    // quiescent cut (FID-5).
    while (state.pending.length > 0 || state.echoes.length > 0) {
      const before = visible(state)
      const from = stepStart(state)
      const step: MutationStep = undecided(state)
        ? { kind: `release` }
        : { kind: `deliver` }
      const result = stepModel(state, step, planFor)
      if (result === undefined) break
      reachModelStates()
      if (step.kind === `deliver`) await provider.deliver!()
      else await provider.release!()
      await compare(steps.length)
      checkPublications(
        steps.length,
        owedPublications(before, result.published),
        `MUT-1`,
        from,
      )
    }
  } catch (error) {
    primary = error
  }

  const cleanupErrors: Array<unknown> = []
  try {
    publications?.stop()
    await fixture.drain?.()
    // Teardown answers every request, also one the adapter's queue sends
    // only now, so every write settles before cleanup (ORC-010).
    await settle(fixture, cut)
    const outlived = cut.unsettled()
    await collection.cleanup()
    await settle(fixture, cut)
    if (outlived > 0)
      cleanupErrors.push(
        new Error(
          `${outlived} writes or reloads were still pending after drain`,
        ),
      )
    if (primary === undefined && detached.found().length > 0) {
      primary = violation(
        `HEALTH-5`,
        steps.length,
        `no detached failure`,
        detached.found(),
      )
    }
  } catch (error) {
    cleanupErrors.push(error)
  } finally {
    detached.stop()
  }
  try {
    await fixture.dispose?.()
  } catch (error) {
    cleanupErrors.push(error)
  }
  if (primary !== undefined) {
    if (cleanupErrors.length === 0) throw primary
    throw new AggregateError(cleanupErrors, `conformance violation`, {
      cause: primary,
    })
  }
  if (cleanupErrors.length > 0) throw cleanupErrors[0]
  return { accepted, skipped }
}

/** A reach counter, such as the one `createOracleReach` returns. */
export interface MutationReachCounter {
  beginHistory: () => void
  reach: (state: MutationReachState) => void
}

/**
 * The generated property every driver runs. Shrinking keeps the first
 * violated law (ORC-010): a smaller history that fails a different law
 * counts as passing.
 */
export function mutationProperty(
  driver: MutationDriver,
  reach?: MutationReachCounter,
) {
  let target: string | undefined
  return fc.asyncProperty(mutationHistoryArb(driver), async (history) => {
    reach?.beginHistory()
    try {
      await checkMutationHistory(driver, history, { reach: reach?.reach })
    } catch (error) {
      // A violation whose cleanup also failed arrives as its cause; it keeps
      // its law, so shrinking stays on it (ORC-010).
      const violation =
        error instanceof ConformanceViolation
          ? error
          : (error as { cause?: unknown } | undefined)?.cause
      const law =
        violation instanceof ConformanceViolation
          ? violation.law
          : `failure outside the comparison`
      target ??= law
      if (law === target) throw error
    }
  })
}

/**
 * Calibration of the check's cleanup (ORC-010): a violation found while a
 * held write waits in the adapter's queue still reaches the caller. The
 * history holds two inserts; an adapter that orders its writes keeps the
 * second in its queue until the first is answered. The returned driver's
 * request log gains a request no write made once both writes are made, so
 * the next comparison fails, and cleanup must answer the first insert and
 * then the second, which reaches the provider only during teardown. Run the
 * history through `checkMutationHistory`: it must reject with
 * `MUT-10/MUT-13 (extra or early request)`, and a hang is the failure.
 */
export function queuedHeldWritesCalibration(driver: MutationDriver): {
  driver: MutationDriver
  history: MutationHistory
} {
  if (!driver.capabilities.has(`held-writes`))
    throw new Error(`${driver.adapter} declares no held writes`)
  const write = (id: number): WriteStep => ({
    kind: `write`,
    type: `insert`,
    id,
    title: `a`,
    outcome: `accept`,
    held: true,
    echoHeld: false,
    rewrite: `none`,
  })
  return {
    history: { seed: [], steps: [write(1), write(2)] },
    driver: {
      ...driver,
      async create(seed) {
        const fixture = await driver.create(seed)
        let writes = 0
        const count =
          <T extends Array<unknown>, R>(made: (...args: T) => R) =>
          (...args: T): R => {
            writes++
            return made(...args)
          }
        const { provider, writer } = fixture
        return {
          ...fixture,
          writer: {
            insert: count(writer.insert),
            update: count(writer.update),
            delete: count(writer.delete),
            batch: count(writer.batch),
          },
          provider: new Proxy(provider, {
            get(target, key) {
              if (key === `requests`)
                return () => [
                  ...target.requests(),
                  ...(writes >= 2 ? [{ type: `delete`, id: 4 }] : []),
                ]
              const value: unknown = Reflect.get(target, key, target)
              return typeof value === `function` ? value.bind(target) : value
            },
          }),
        }
      },
    },
  }
}

// Exported for calibration tests: the model's prediction for a history.
export const mutationModel = {
  initial: initialModel,
  step: stepModel,
  visible,
  owedPublications,
}
