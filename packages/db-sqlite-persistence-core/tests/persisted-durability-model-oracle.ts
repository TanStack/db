/**
 * The models, checks, and generated grammar of the durability laws in
 * persisted-oracle.test.ts: the scoped and targeted snapshot models, the
 * on-demand evidence law, the append-only durability ledger, the observation
 * checks of the source-order, abort-graph, owner-isolation, open-transaction,
 * and request-local-failure laws, and the generated persistence grammars with
 * their reconstruction. Owns nothing and registers no tests: the oracle drives
 * production with them, and persisted-model-calibration.test.ts calibrates them.
 */
import { expect } from 'vitest'
import { fc } from '@fast-check/vitest'
import { oracleFixedSeed, oracleRuns } from '../../db/tests/oracle-config.js'
import { oracleAssertion } from '../../db/tests/oracle-assertion-adapter'
import type { Todo } from './persisted-support'

// A complete durable row is a value, including its exact set of fields. The
// model deliberately uses only Maps and authored input rows; it does not
// classify production sync writes or copy their update/replace algorithm.
// Active complete demand admits every durable key. Without demand, a notice
// may validate previously public keys, but cannot publish an unseen key.
// DbClient hydration seeds remain source-owned until confirmed by the source.
// Other rows in this model came from an earlier durable read; accepted source
// rows belong to the separate source-precedence model below. Copy authored
// values so a subject mutation cannot alter the expected result by aliasing.
export function expectedScopedSnapshot(
  previouslyPublic: ReadonlyMap<string, Todo>,
  durable: ReadonlyMap<string, Todo>,
  protectedSeeds: ReadonlyMap<string, Todo>,
  completeDemand: boolean,
): Map<string, Todo> {
  const expected = completeDemand
    ? new Map(
        Array.from(
          durable,
          ([key, row]) => [key, structuredClone(row)] as const,
        ),
      )
    : new Map(
        Array.from(previouslyPublic.keys())
          .filter((key) => durable.has(key))
          .map((key) => [key, structuredClone(durable.get(key)!)] as const),
      )
  for (const [key, row] of protectedSeeds)
    expected.set(key, structuredClone(row))
  return expected
}

// Targeted notices are changes to the durable relation, not complete rows in
// the message. An active predicate admits the durable rows it matches; after
// demand retirement, only keys that were public remain eligible for checking.
// This simple title predicate is the model's authored scope, independent of
// the production predicate compiler and targeted-invalidation classifier.
export function expectedTargetedSnapshot(
  previouslyPublic: ReadonlyMap<string, Todo>,
  durable: ReadonlyMap<string, Todo>,
  activeTitle: string | undefined,
): Map<string, Todo> {
  return new Map(
    Array.from(durable)
      .filter(([key, row]) =>
        activeTitle === undefined
          ? previouslyPublic.has(key)
          : row.title === activeTitle,
      )
      .map(([key, row]) => [key, structuredClone(row)] as const),
  )
}

export const persistedKeySetEvidenceStatuses = [
  `consistent`,
  `unknown`,
  `incompatible`,
] as const

export type OnDemandEvidenceObservation = {
  status: (typeof persistedKeySetEvidenceStatuses)[number]
  route: `loadSubset` | `forceReloadSubset`
  baselineVisible: boolean | `not-observed`
  onDemandVisible: boolean
}

export function expectOnDemandEvidenceLaw(
  observation: OnDemandEvidenceObservation,
): void {
  try {
    oracleAssertion('existing comparison at 207', () =>
      expect(observation).toEqual({
        status: observation.status,
        route: observation.route,
        baselineVisible:
          observation.route === `loadSubset`
            ? observation.status !== `incompatible`
            : `not-observed`,
        onDemandVisible: true,
      }),
    )
  } catch (cause) {
    throw new Error(
      `on-demand rows must not inherit baseline evidence rejection`,
      { cause },
    )
  }
}

export type DurabilityLedgerEvent =
  | { type: `begin`; transactionId: string }
  | { type: `write`; transactionId: string; row: Todo }
  | { type: `commit`; transactionId: string }
  | { type: `abort`; transactionId: string }

// RFC #1659 durability law: a source commit remains one append-only obligation
// across a persistence hydration boundary. The independent fold deliberately
// has no hydration phase, queue, generation, or production transaction helper.
// These fixtures exercise the core adapter contract with in-memory storage;
// they do not claim native SQLite host or device execution.
export function foldDurabilityLedger(
  events: ReadonlyArray<DurabilityLedgerEvent>,
): {
  committedRows: Map<string, Todo>
  commitOrder: Array<string>
} {
  const open = new Map<string, Array<Todo>>()
  const committedRows = new Map<string, Todo>()
  const commitOrder: Array<string> = []

  for (const event of events) {
    if (event.type === `begin`) {
      open.set(event.transactionId, [])
    } else if (event.type === `write`) {
      open.get(event.transactionId)?.push(structuredClone(event.row))
    } else if (event.type === `abort`) {
      open.delete(event.transactionId)
    } else {
      const rows = open.get(event.transactionId)
      if (!rows) continue
      for (const row of rows) committedRows.set(row.id, row)
      commitOrder.push(event.transactionId)
      open.delete(event.transactionId)
    }
  }

  return { committedRows, commitOrder }
}

export type SourceFifoOrderingObservation = {
  publicRows: Array<Todo>
  durableRows: Array<Todo>
  status: string
  pendingMarkers: number
}

export function expectSourceFifoOrderingObservation(
  actual: SourceFifoOrderingObservation,
  expectedRows: ReadonlyArray<Todo>,
): void {
  oracleAssertion('existing comparison at 279', () =>
    expect(actual).toEqual({
      publicRows: expectedRows,
      durableRows: expectedRows,
      status: `ready`,
      pendingMarkers: 0,
    }),
  )
}

export type AbortGraphObservation = {
  predecessorStatus: `fulfilled` | `rejected`
  predecessorName: string | undefined
  successorStatus: `fulfilled` | `rejected`
  sameFailure: boolean
  status: string
  publicSuccessor: Todo | undefined
  durableSuccessor: Todo | undefined
  pendingMarkers: number
}

export function expectAbortGraphObservation(
  actual: AbortGraphObservation,
  relationship: `independent` | `same-key`,
  successorKey: string,
  successorTitle: string,
): void {
  oracleAssertion('existing comparison at 304', () =>
    expect(actual).toEqual(
      relationship === `same-key`
        ? {
            predecessorStatus: `rejected`,
            predecessorName: `AbortError`,
            successorStatus: `rejected`,
            sameFailure: true,
            status: `crashed`,
            publicSuccessor: undefined,
            durableSuccessor: undefined,
            pendingMarkers: 0,
          }
        : {
            predecessorStatus: `rejected`,
            predecessorName: `AbortError`,
            successorStatus: `fulfilled`,
            sameFailure: false,
            status: `ready`,
            publicSuccessor: { id: successorKey, title: successorTitle },
            durableSuccessor: { id: successorKey, title: successorTitle },
            pendingMarkers: 0,
          },
    ),
  )
}

export type OwnerIsolationAdmissionObservation = {
  exactError: boolean
  strayVisible: boolean
}

export function expectOwnerIsolationAdmission(
  actual: OwnerIsolationAdmissionObservation,
): void {
  oracleAssertion('existing comparison at 337', () =>
    expect(actual).toEqual({ exactError: true, strayVisible: false }),
  )
}

export type OpenTransactionBoundaryObservation = {
  status: string
  pendingMarkers: number
}

export type RequestLocalFailureObservation = {
  receiptStatus: `pending` | `fulfilled` | `rejected`
  publicRows: Array<Todo>
  durableRows: Array<Todo>
  status: string
  publicError: unknown
}

export function expectOpenTransactionBoundaryObservation(
  actual: OpenTransactionBoundaryObservation,
  boundary: `abort` | `cleanup` | `terminal-failure`,
): void {
  oracleAssertion('existing comparison at 357', () =>
    expect(actual).toEqual({
      status:
        boundary === `cleanup`
          ? `cleaned-up`
          : boundary === `abort`
            ? `ready`
            : `crashed`,
      pendingMarkers: 0,
    }),
  )
}

export function expectRequestLocalFailureObservation(
  actual: RequestLocalFailureObservation,
  expectedRows: ReadonlyArray<Todo>,
): void {
  oracleAssertion('existing comparison at 372', () =>
    expect(actual).toEqual({
      receiptStatus: `fulfilled`,
      publicRows: expectedRows,
      durableRows: expectedRows,
      status: `ready`,
      publicError: undefined,
    }),
  )
}

export type GeneratedPersistenceHistory = {
  axes: Array<string>
  titles: Array<string>
}

export type GeneratedPersistenceGrammar = {
  property: string
  axes: ReadonlyArray<string>
  axisContribution: Readonly<Record<string, string>>
  titleCount: number
  witness: GeneratedPersistenceHistory
}

export const sourceFifoOrderingAxes = [`same-key`, `disjoint`] as const
export const abortGraphAxes = [`independent`, `same-key`] as const
export const ownerIsolationAxes = [`write`, `commit`, `truncate`] as const
export const openTransactionBoundaryAxes = [
  `abort`,
  `cleanup`,
  `terminal-failure`,
] as const
export const requestLocalFailureAxes = [
  `partial-update`,
  `delete`,
  `insert`,
] as const
export const generatedTitleMaxLength = 12
export const generatedPersistenceFixedSeeds = {
  sourceFifoOrdering: 18_530_101,
  abortGraph: 18_530_102,
  ownerIsolation: 18_530_103,
  openTransactionBoundary: 18_530_104,
  requestLocalFailure: 18_530_105,
} as const

export const generatedPersistenceGrammars: ReadonlyArray<GeneratedPersistenceGrammar> =
  [
    {
      property: `sqlite-persistence.source-fifo-order`,
      axes: sourceFifoOrderingAxes,
      axisContribution: {
        [`same-key`]: `the later source value wins in source order`,
        disjoint: `both unrelated values and receipts survive`,
      },
      titleCount: 2,
      witness: {
        axes: [`same-key`, `disjoint`],
        titles: [`older`, `newer`],
      },
    },
    {
      property: `sqlite-persistence.abort-graph`,
      axes: abortGraphAxes,
      axisContribution: {
        independent: `an unrelated sibling survives the abort`,
        [`same-key`]: `a dependent suffix shares the predecessor failure`,
      },
      titleCount: 2,
      witness: {
        axes: [`independent`, `same-key`],
        titles: [`predecessor`, `successor`],
      },
    },
    {
      property: `sqlite-persistence.owner-isolation`,
      axes: ownerIsolationAxes,
      axisContribution: {
        write: `bare write rejects without publishing a stray row`,
        commit: `bare commit rejects without settling another owner`,
        truncate: `bare truncate rejects without clearing another owner`,
      },
      titleCount: 1,
      witness: {
        axes: [`write`, `commit`, `truncate`],
        titles: [`queued`],
      },
    },
    {
      property: `sqlite-persistence.open-transaction-boundary`,
      axes: openTransactionBoundaryAxes,
      axisContribution: {
        abort: `explicit abort leaves no core transaction`,
        cleanup: `cleanup leaves no core transaction`,
        [`terminal-failure`]: `fail-stop leaves no core transaction`,
      },
      titleCount: 1,
      witness: {
        axes: [`abort`, `cleanup`, `terminal-failure`],
        titles: [`hydrated`],
      },
    },
    {
      property: `sqlite-persistence.request-local-failure-buffered-source`,
      axes: requestLocalFailureAxes,
      axisContribution: {
        [`partial-update`]: `an unseen persisted baseline is reconstructed`,
        delete: `a buffered delete settles without resurrection`,
        insert: `a complete buffered insert settles without duplication`,
      },
      titleCount: 2,
      witness: {
        axes: [`partial-update`, `delete`, `insert`],
        titles: [`baseline`, `source`],
      },
    },
  ]

export function reconstructGeneratedPersistenceHistory(
  grammar: GeneratedPersistenceGrammar,
  history: GeneratedPersistenceHistory,
): GeneratedPersistenceHistory {
  const requiredAxes = new Set(grammar.axes)
  const axesAreExact =
    history.axes.length === grammar.axes.length &&
    new Set(history.axes).size === grammar.axes.length &&
    history.axes.every((axis) => requiredAxes.has(axis))
  const titlesAreInRange =
    history.titles.length === grammar.titleCount &&
    history.titles.every(
      (title) => [...title].length <= generatedTitleMaxLength,
    )
  if (!axesAreExact || !titlesAreInRange) {
    throw new Error(
      `invalid generated persistence history: ${grammar.property}`,
    )
  }
  return {
    axes: [...history.axes],
    titles: [...history.titles],
  }
}

export function fullAxisOrder<Axis extends string>(
  axes: ReadonlyArray<Axis>,
): fc.Arbitrary<Array<Axis>> {
  return fc.shuffledSubarray([...axes], {
    minLength: axes.length,
    maxLength: axes.length,
  })
}

export const generatedTitle = fc.string({ maxLength: generatedTitleMaxLength })

export type SourceFifoOrderingHistory = {
  relations: Array<`same-key` | `disjoint`>
  titles: [string, string]
}

export type AbortGraphHistory = {
  relationships: Array<`independent` | `same-key`>
  titles: [string, string]
}

export type OwnerIsolationHistory = {
  operations: Array<`write` | `commit` | `truncate`>
  queuedTitle: string
}

export type OpenTransactionBoundaryHistory = {
  boundaries: Array<`abort` | `cleanup` | `terminal-failure`>
  hydratedTitle: string
}

export type RequestLocalFailureOperation =
  `partial-update` | `delete` | `insert`

export type RequestLocalFailureHistory = {
  operations: Array<RequestLocalFailureOperation>
  titles: [string, string]
}

export const sourceFifoOrderingHistory: fc.Arbitrary<SourceFifoOrderingHistory> =
  fc.record({
    relations: fullAxisOrder(sourceFifoOrderingAxes),
    titles: fc.tuple(generatedTitle, generatedTitle),
  })

export const abortGraphHistory: fc.Arbitrary<AbortGraphHistory> = fc.record({
  relationships: fullAxisOrder(abortGraphAxes),
  titles: fc.tuple(generatedTitle, generatedTitle),
})

export const ownerIsolationHistory: fc.Arbitrary<OwnerIsolationHistory> =
  fc.record({
    operations: fullAxisOrder(ownerIsolationAxes),
    queuedTitle: generatedTitle,
  })

export const openTransactionBoundaryHistory: fc.Arbitrary<OpenTransactionBoundaryHistory> =
  fc.record({
    boundaries: fullAxisOrder(openTransactionBoundaryAxes),
    hydratedTitle: generatedTitle,
  })

export const requestLocalFailureHistory: fc.Arbitrary<RequestLocalFailureHistory> =
  fc.record({
    operations: fullAxisOrder(requestLocalFailureAxes),
    titles: fc.tuple(generatedTitle, generatedTitle),
  })

export function generatedPersistenceGrammarSamples(): ReadonlyArray<{
  grammar: GeneratedPersistenceGrammar
  histories: Array<GeneratedPersistenceHistory>
}> {
  const grammar = (property: string): GeneratedPersistenceGrammar => {
    const match = generatedPersistenceGrammars.find(
      (candidate) => candidate.property === property,
    )
    if (match === undefined) throw new Error(`missing grammar: ${property}`)
    return match
  }
  const sampleOptions = (seed: number) =>
    oracleFixedSeed(seed, { numRuns: oracleRuns(4) })
  return [
    {
      grammar: grammar(`sqlite-persistence.source-fifo-order`),
      histories: fc
        .sample(
          sourceFifoOrderingHistory,
          sampleOptions(generatedPersistenceFixedSeeds.sourceFifoOrdering),
        )
        .map((history) => ({
          axes: history.relations,
          titles: [...history.titles],
        })),
    },
    {
      grammar: grammar(`sqlite-persistence.abort-graph`),
      histories: fc
        .sample(
          abortGraphHistory,
          sampleOptions(generatedPersistenceFixedSeeds.abortGraph),
        )
        .map((history) => ({
          axes: history.relationships,
          titles: [...history.titles],
        })),
    },
    {
      grammar: grammar(`sqlite-persistence.owner-isolation`),
      histories: fc
        .sample(
          ownerIsolationHistory,
          sampleOptions(generatedPersistenceFixedSeeds.ownerIsolation),
        )
        .map((history) => ({
          axes: history.operations,
          titles: [history.queuedTitle],
        })),
    },
    {
      grammar: grammar(`sqlite-persistence.open-transaction-boundary`),
      histories: fc
        .sample(
          openTransactionBoundaryHistory,
          sampleOptions(generatedPersistenceFixedSeeds.openTransactionBoundary),
        )
        .map((history) => ({
          axes: history.boundaries,
          titles: [history.hydratedTitle],
        })),
    },
    {
      grammar: grammar(
        `sqlite-persistence.request-local-failure-buffered-source`,
      ),
      histories: fc
        .sample(
          requestLocalFailureHistory,
          sampleOptions(generatedPersistenceFixedSeeds.requestLocalFailure),
        )
        .map((history) => ({
          axes: history.operations,
          titles: [...history.titles],
        })),
    },
  ]
}
