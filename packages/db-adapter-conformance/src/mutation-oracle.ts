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
 * sync (MUT-7). It does not check manual or multi-mutation transactions,
 * schema validation, or `awaitMatch`. Commits from other clients arrive only
 * while no mutation is pending, so MUT-11 is not checked; a commit held
 * behind a pending mutation is core's MUT-5.
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
  /** Answer the oldest held request by its plan. */
  release: () => void | Promise<void>
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

export interface MutationFixture {
  /** The adapter's Collection, read as conformance rows. */
  collection: ObservedCollection
  /** The exposed authoritative base (`collection.base`) as conformance rows. */
  base: () => Iterable<ConformanceRow>
  writer: MutationWriter
  provider: MutationProvider
  /**
   * Answers every held request and delivers every withheld copy. The check
   * calls it before cleanup, so no write outlives the history waiting on one.
   */
  drain?: () => void | Promise<void>
  /** The adapter's propagation step, awaited before every comparison. */
  settle?: () => Promise<void>
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
 * - `foreign`: another client commits an upsert or a delete while no
 *   mutation is pending (`foreign-commits`).
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
      }): MutationStep => ({
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
      arbitrary: write.map((step): MutationStep =>
        step.kind === `write`
          ? {
              kind: `write`,
              type: `update`,
              id: step.id,
              title: step.title,
              outcome: step.outcome,
              held: step.held,
              echoHeld: step.echoHeld,
              rewrite: step.rewrite,
              ...(step.rejectionKind === undefined
                ? {}
                : { rejectionKind: step.rejectionKind }),
            }
          : step,
      ),
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
    .map(([first, second]): Array<MutationStep> =>
      first.kind === `write` && second.kind === `write`
        ? [first, { ...second, id: first.id }]
        : [first, second],
    )
  // A held write the provider stores with a field the client has not seen,
  // then an update of that key that does not name it: a merged update keeps
  // the field, a complete-row one drops it.
  const unseenFieldPair =
    capabilities.has(`server-rewrites`) && capabilities.has(`held-writes`)
      ? [
          {
            weight: 2,
            arbitrary: fc
              .tuple(write, write)
              .map(([first, second]): Array<MutationStep> => {
                if (first.kind !== `write` || second.kind !== `write`)
                  return [first, second]
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
  readonly index: number
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
  /** Its own plan withheld its copy (`held-echoes`). */
  withheld: boolean
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
 * - `applied` is the synced rows core has applied. An accepted write's
 *   provider copy reaches core as an accepted sync transaction, which is
 *   held while any optimistic transaction is persisting, so `applied` takes
 *   `provider` only when no mutation is pending.
 * - `heldRows` lists the accepted writes whose sync transaction is held, in
 *   author order: each keeps its held optimistic row until that transaction
 *   applies (glossary: accepted sync transaction, held optimistic row).
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
  provider: Map<number, string>
  applied: Map<number, string>
  heldRows: Array<PendingWrite>
  pending: Array<PendingWrite>
  /** Answered writes whose copies are not delivered, in commit order. */
  echoes: Array<PendingWrite>
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
  const provider = new Map(seed.map((row) => [row.id, rowValue(row)]))
  return {
    undefinedField: domain.undefinedField ?? `own`,
    fieldUpdates: domain.capabilities.has(`field-updates`),
    ordered: !domain.capabilities.has(`application-handlers`),
    logOrdered: domain.capabilities.has(`log-ordered-echoes`),
    answersInOrder: domain.capabilities.has(`ordered-answers`),
    mergedUpdates: domain.capabilities.has(`merged-updates`),
    provider,
    applied: new Map(provider),
    heldRows: [],
    pending: [],
    echoes: [],
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
  step: Extract<MutationStep, { kind: `write` }>,
  held: string | undefined,
): ConformanceRow {
  // A held `note` stays an own `undefined`: removed when it held a value,
  // kept when it already was one.
  const removesNote =
    step.type === `update` &&
    step.note === undefined &&
    held !== undefined &&
    (JSON.parse(held) as [string, Array<unknown>])[1].length > 0
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
  if (write.plan.outcome === `reject`) {
    state.settlements[write.index] = { rejected: write.plan.error }
    retire(state, write)
    return
  }
  if (write.type === `delete`) state.provider.delete(write.id)
  else {
    const copy = rowValue(copyOf(state, write))
    state.provider.set(write.id, copy)
    if (write.plan.rewrite !== `none` && copy !== write.value) state.rewritten++
    if (
      state.mergedUpdates &&
      write.type === `update` &&
      !Object.hasOwn(rowOf(write.id, write.value!), `note`) &&
      Object.hasOwn(storedFields(state, write), `note`)
    )
      state.mergeKept++
  }
  // A copy is withheld by its own plan or waits behind an undelivered one:
  // any earlier one from a log, an earlier one for its key otherwise, since
  // every provider keeps one key's copies in commit order.
  if (
    write.plan.echoHeld ||
    state.echoes.some((earlier) => blocks(state, earlier, write))
  ) {
    write.answered = true
    write.withheld = write.plan.echoHeld
    state.echoes.push(write)
  } else confirm(state, write)
}

/**
 * The oldest withheld copy arrives, and from a log every later copy queued
 * behind it, up to the next one its own plan withheld.
 */
function deliverEchoes(state: MutationModel): Array<RowState> {
  confirm(state, state.echoes.shift()!)
  const states = [visible(state)]
  for (;;) {
    const next = state.echoes.find(
      (write, index) =>
        !write.withheld &&
        state.echoes
          .slice(0, index)
          .every((earlier) => !blocks(state, earlier, write)),
    )
    if (!next) return states
    state.echoes.splice(state.echoes.indexOf(next), 1)
    confirm(state, next)
    states.push(visible(state))
  }
}

/** Whether an undelivered copy holds back a later write's copy. */
function blocks(
  state: MutationModel,
  earlier: PendingWrite,
  later: PendingWrite,
): boolean {
  return state.logOrdered || earlier.id === later.id
}

/** An accepted write's copy arrives: it fulfills. */
function confirm(state: MutationModel, write: PendingWrite): void {
  state.heldRows.push(write)
  state.settlements[write.index] = `fulfilled`
  retire(state, write)
}

function retire(state: MutationModel, write: PendingWrite): void {
  state.pending.splice(state.pending.indexOf(write), 1)
  // The last persisting transaction settled: every held sync transaction
  // applies in its publication.
  if (state.pending.length === 0) {
    state.applied = new Map(state.provider)
    state.heldRows = []
  }
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
      next.requested = true
      state.requests.push({
        type: next.type,
        id: next.id,
        ...(next.sent === undefined
          ? {}
          : {
              // A merged update's write is the merge, as the provider
              // stores it; nothing commits on its key before it is decided.
              value: requestValue(
                state.mergedUpdates && next.type === `update`
                  ? storedFields(state, next)
                  : next.sent,
              ),
            }),
      })
      if (!state.ordered) continue
    }
    if (next.plan.held) return states
    decide(state, next)
    states.push(visible(state))
  }
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
  | { kind: `foreign` }

/**
 * Applies one step to the model. Returns undefined when the step is not
 * legal now, without moving the model, and otherwise what it did and the
 * public rows after each change it publishes, in order.
 */
function stepModel(
  state: MutationModel,
  step: MutationStep,
  plan: (step: Extract<MutationStep, { kind: `write` }>) => WritePlan,
): { done: StepDone; published: Array<RowState> } | undefined {
  switch (step.kind) {
    case `write`: {
      const held = new Map(visible(state))
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
      const legal =
        step.type === `insert` ? !held.has(step.id) : held.has(step.id)
      const over = held.get(step.id)
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
      const fields =
        row && step.type === `update` && state.fieldUpdates
          ? changedFields(row, rowOf(step.id, over!))
          : row
      const write: PendingWrite = {
        index: state.settlements.length,
        type: step.type,
        id: step.id,
        ...(row && {
          value: rowValue(row),
          sent: sentFields(fields!, state.undefinedField, fields === row),
        }),
        plan: plan(step),
        requested: false,
        answered: false,
        withheld: false,
      }
      state.settlements.push(`pending`)
      state.pending.push(write)
      state.writes.push(write)
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
    case `foreign`: {
      if (state.pending.length > 0) return undefined
      if (step.change.type === `upsert`)
        state.provider.set(step.change.row.id, rowValue(step.change.row))
      else state.provider.delete(step.change.id)
      state.applied = new Map(state.provider)
      return { done: { kind: `foreign` }, published: [visible(state)] }
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
 * The writes a step settled, and each row's values while they settle in any
 * order: the public rows with any subset of them settled. Settlements at one
 * step are in no order a law fixes, so a publication may show any of these.
 */
function settlementValues(
  state: MutationModel,
  start: StepStart,
): { settled: number; values: Map<number, Set<string | null>> } {
  const pending = [...start.pending, ...state.writes.slice(start.writes)]
  const settled = pending.filter(
    (write) => state.settlements[write.index] !== `pending`,
  )
  const values = new Map<number, Set<string | null>>()
  for (let mask = 0; mask < 1 << settled.length; mask++) {
    const done = new Set(settled.filter((_, bit) => mask & (1 << bit)))
    const still = pending.filter((write) => !done.has(write))
    // Held rows and the applied rows change only when nothing is pending.
    const rows =
      still.length === 0
        ? state.applied
        : fold(
            fold(start.applied, [
              ...start.heldRows,
              ...pending.filter(
                (write) =>
                  done.has(write) &&
                  state.settlements[write.index] === `fulfilled`,
              ),
            ]),
            still,
          )
    const ids = new Set([...rows.keys(), ...start.applied.keys()])
    for (const id of [...ids, ...pending.map((write) => write.id)]) {
      const set = values.get(id) ?? new Set()
      set.add(rows.get(id) ?? null)
      values.set(id, set)
    }
  }
  return { settled: settled.length, values }
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

const capabilityOfState: Partial<
  Record<MutationReachState, MutationCapability>
> = {
  'write-rejected': `write-rejection`,
  'held-write-pending': `held-writes`,
  'write-queued-behind-held': `held-writes`,
  'held-write-rejected': `held-writes`,
  'foreign-commit': `foreign-commits`,
  'held-optimistic-row': `held-writes`,
  'server-rewrote-copy': `server-rewrites`,
  'echo-held': `held-echoes`,
  'merge-kept-field': `merged-updates`,
  'echo-queued-behind-withheld': `held-echoes`,
}

/** The declared states a driver's capabilities let histories reach. */
export function mutationReachStatesFor(
  domain: Pick<MutationDriver, `capabilities` | `rejectionKinds`>,
): Array<MutationReachState> {
  const kinds = domain.capabilities.has(`write-rejection`)
    ? (domain.rejectionKinds ?? []).map(
        (kind): MutationReachState => `rejected-as-${kind}`,
      )
    : []
  return [
    ...mutationReachStates.filter((state) => {
      const capability = capabilityOfState[state]
      if (state === `held-write-rejected`)
        return (
          domain.capabilities.has(`held-writes`) &&
          domain.capabilities.has(`write-rejection`)
        )
      // Only an adapter that orders writes holds one back (MUT-10).
      if (state === `write-queued-behind-held`)
        return (
          domain.capabilities.has(`held-writes`) &&
          !domain.capabilities.has(`application-handlers`)
        )
      // A write stays pending past its step only when held or confirmed late.
      if (state === `same-key-pending`)
        return (
          domain.capabilities.has(`held-writes`) ||
          domain.capabilities.has(`held-echoes`)
        )
      return capability === undefined || domain.capabilities.has(capability)
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
async function settle(fixture: MutationFixture): Promise<void> {
  for (let turn = 0; turn < 3; turn++) await sleep(0)
  await fixture.settle?.()
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
  const failures: Array<Error> = []
  let accepted = 0
  let skipped = 0
  let wrote = 0
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
    await settle(fixture)
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
    if (JSON.stringify(requests) !== JSON.stringify(state.requests))
      throw violation(
        requests.length > state.requests.length
          ? `MUT-10/MUT-13 (provider requests)`
          : `MUT-8 (provider requests)`,
        stepIndex,
        state.requests,
        requests,
      )
    const quiescent = state.pending.length === 0
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
        .map((write) => write.index),
    )
    state.settlements.forEach((expected, index) => {
      const got = receipts[index]!.current
      const ok =
        expected === `pending` || expected === `fulfilled`
          ? got === expected
          : typeof got === `object` && matches(got.rejected, expected.rejected)
      if (!ok)
        throw violation(
          typeof expected === `object`
            ? `MUT-2 (settlement)`
            : answered.has(index)
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
    if (wrote > 0) reach(`quiescent-after-writes`)
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
    // Writes that settle at one step settle in an order no law fixes. Then
    // each row may show only a value it has with some of them settled, and
    // changes at most once per settled write and once for the step's own
    // optimistic state; an earlier synced value or an extra change still
    // shows.
    const { settled, values } = settlementValues(state, from)
    const ok =
      settled > 1
        ? [...values].every(([id, allowed]) => {
            const path = [start, ...got].map(
              (rows) => rows.find(([key]) => key === id)?.[1] ?? null,
            )
            const changes = path.filter(
              (value, index) => index > 0 && value !== path[index - 1],
            ).length
            return (
              path.every((value) => allowed.has(value)) &&
              changes <= settled + 1
            )
          }) &&
          [...got.flatMap((rows) => rows.map(([id]) => id))].every((id) =>
            values.has(id),
          )
        : got.length === owed.length &&
          got.every((rows, index) => sameRows(rows, owed[index]!))
    if (!ok) throw violation(`${law} (publication)`, stepIndex, owed, got)
  }

  let rewritten = 0
  // The plan the model decided the last write by; the provider gets it too.
  let lastPlan: WritePlan | undefined
  const planFor = (
    step: Extract<MutationStep, { kind: `write` }>,
  ): WritePlan => {
    const error = new Error(`conformance write rejected ${failures.length}`)
    failures.push(error)
    lastPlan = {
      outcome: step.outcome,
      held: step.held,
      echoHeld: step.echoHeld,
      rewrite: step.rewrite,
      ...(step.rejectionKind === undefined
        ? {}
        : { rejectionKind: step.rejectionKind }),
      error,
    }
    return lastPlan
  }

  try {
    await collection.preload()
    publications = recordPublications(collection)
    await compare(-1)
    for (const [index, step] of steps.entries()) {
      const before = visible(state)
      const from = stepStart(state)
      const result = stepModel(state, step, planFor)
      if (result === undefined) {
        skipped++
        continue
      }
      accepted++
      const { done } = result
      let law = `MUT-1`
      switch (done.kind) {
        case `write`: {
          const write = step as Extract<MutationStep, { kind: `write` }>
          provider.plan(lastPlan!)
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
          wrote++
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
        case `release`:
          await provider.release()
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
          break
      }
      if (state.heldRows.length > 0) reach(`held-optimistic-row`)
      if (state.rewritten > rewritten) reach(`server-rewrote-copy`)
      if (state.mergeKept > 0) reach(`merge-kept-field`)
      if (state.pending.some((write) => write.answered)) reach(`echo-held`)
      if (state.echoes.some((write) => !write.withheld))
        reach(`echo-queued-behind-withheld`)
      rewritten = state.rewritten
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
    while (state.pending.length > 0) {
      const before = visible(state)
      const from = stepStart(state)
      const step: MutationStep = undecided(state)
        ? { kind: `release` }
        : { kind: `deliver` }
      const result = stepModel(state, step, planFor)
      if (result === undefined) break
      if (state.heldRows.length > 0) reach(`held-optimistic-row`)
      if (state.rewritten > rewritten) reach(`server-rewrote-copy`)
      if (state.mergeKept > 0) reach(`merge-kept-field`)
      if (state.pending.some((write) => write.answered)) reach(`echo-held`)
      if (state.echoes.some((write) => !write.withheld))
        reach(`echo-queued-behind-withheld`)
      rewritten = state.rewritten
      if (step.kind === `deliver`) await provider.deliver!()
      else await provider.release()
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
    await collection.cleanup()
    await settle(fixture)
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
      const law =
        error instanceof ConformanceViolation
          ? error.law
          : `failure outside the comparison`
      target ??= law
      if (law === target) throw error
    }
  })
}

// Exported for calibration tests: the model's prediction for a history.
export const mutationModel = {
  initial: initialModel,
  step: stepModel,
  visible,
  owedPublications,
}
