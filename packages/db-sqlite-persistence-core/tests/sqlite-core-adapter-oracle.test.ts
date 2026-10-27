/**
 * Oracle owner for two SQLite core adapter laws. The shared contract suite
 * (sqlite-core-adapter-contract-suite.ts) registers these tests in every host
 * package and in the sqlite3 CLI runtime test.
 *
 * - Reset/resume baseline lineage: a schema reset clears collection metadata
 *   together with the persisted baseline it belongs to, while same-schema
 *   reopen and raw row loss keep both. The model is a two-generation lineage
 *   relation (expectedResetResumeMetadata), and the check compares each
 *   observed checkpoint with it (expectResetResumeLaw).
 * - Subset binding capacity: a loadSubset predicate returns exactly its
 *   matching rows without a statement above the connection's binding cap. The
 *   model computes each row's result from the declared clauses
 *   (expectedBindingRows), and the check compares the observed rows and
 *   statement bindings with it (violation).
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fc } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { SQLiteCorePersistenceAdapter, createPersistedTableName } from '../src'
import {
  declareOracle,
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRuns,
  recordOracleReplay,
} from '../../db/tests/oracle-config.js'
import { runSQLiteBindingCapacityUnitTests } from './sqlite-core-adapter-binding-units'
import {
  bigintBoundary,
  chunkBoundary,
  dual,
  escapedStringCase,
  expectedBindingRows,
  legalSpec,
  mixed,
  nested,
  observe,
  single,
  violation,
} from './sqlite-core-adapter-binding-support'
import type {
  Kind,
  Spec,
  Violation,
} from './sqlite-core-adapter-binding-support'
import type {
  SQLiteCoreAdapterHarnessFactory,
  Todo,
} from './sqlite-core-adapter-support'

declareOracle({
  check: [expectResetResumeLaw, violation],
  model: [expectedResetResumeMetadata, expectedBindingRows],
})

type ResetResumeHistory = {
  fromSchemaVersion: number
  rows: Array<Todo>
  resumeKind: `none` | `reset` | `resume`
  transition:
    | `compatible-reopen`
    | `schema-reset`
    | `partial-restore`
    | `external-row-loss`
  reopensBeforeTransition: number
  reopensAfterTransition: number
  unrelatedMetadataKeys: Array<string>
}

type ResetResumeObservation = {
  checkpoint: `after-persistence-transition-reopen`
  resetEpoch: number
  schemaVersion: number
  durableRows: ReadonlyArray<unknown>
  tombstones: ReadonlyArray<{ key: string; rowVersion: number }>
  appliedTransactions: ReadonlyArray<{ txId: string; rowVersion: number }>
  latestRowVersion: number
  metadataKeys: ReadonlyArray<string>
  resumeState: unknown
}

type ResetResumeExpectation = {
  metadataKeys: ReadonlyArray<string>
  resumeKind: unknown
}

function destroysPersistedBaseline(history: ResetResumeHistory): boolean {
  return (
    history.transition === `schema-reset` ||
    history.transition === `partial-restore`
  )
}

function expectedResetResumeMetadata(
  history: ResetResumeHistory,
): ResetResumeExpectation {
  if (destroysPersistedBaseline(history)) {
    return { metadataKeys: [], resumeKind: undefined }
  }

  return {
    metadataKeys: [
      ...(history.resumeKind === `none` ? [] : [`electric:resume`]),
      ...history.unrelatedMetadataKeys.map((key) => `oracle:${key}`),
    ].sort(),
    resumeKind: history.resumeKind === `none` ? undefined : history.resumeKind,
  }
}

class ResetResumeOracleViolation extends Error {
  readonly law: string = `reset-resume.baseline-lineage`
  readonly discriminant: string
  readonly history: ResetResumeHistory
  readonly observation: ResetResumeObservation
  readonly cleanupEvidence: string
  readonly expected: ResetResumeExpectation
  readonly actual: ResetResumeExpectation

  constructor(
    history: ResetResumeHistory,
    observation: ResetResumeObservation,
    cleanupEvidence: string,
    cause: unknown,
  ) {
    super(
      `A persisted-baseline transition violated collection-metadata lineage at the ` +
        `${observation.checkpoint}. ` +
        `history=${JSON.stringify(history)} ` +
        `observation=${JSON.stringify(observation)} ` +
        `cleanup=${cleanupEvidence}`,
      { cause },
    )
    this.name = `ResetResumeOracleViolation`
    this.history = structuredClone(history)
    this.observation = structuredClone(observation)
    this.cleanupEvidence = cleanupEvidence
    this.expected = expectedResetResumeMetadata(history)
    this.actual = {
      metadataKeys: [...observation.metadataKeys],
      resumeKind: resumeKindOf(observation.resumeState),
    }
    this.discriminant = destroysPersistedBaseline(history)
      ? `reset-retained-metadata`
      : `non-reset-metadata-changed`
  }
}

function hasSameResetResumeFailure(
  left: ResetResumeOracleViolation,
  right: ResetResumeOracleViolation,
): boolean {
  const signature = (failure: ResetResumeOracleViolation): string =>
    JSON.stringify({
      law: String(failure.law),
      discriminant: String(failure.discriminant),
      checkpoint: String(failure.observation.checkpoint),
      expectedMetadataClass:
        failure.expected.metadataKeys.length === 0 ? `empty` : `nonempty`,
      actualMetadataClass:
        failure.actual.metadataKeys.length === 0 ? `empty` : `nonempty`,
    })
  return signature(left) === signature(right)
}

function resumeKindOf(value: unknown): unknown {
  return value && typeof value === `object`
    ? (value as Record<string, unknown>).kind
    : undefined
}

function expectResetResumeLaw(
  history: ResetResumeHistory,
  observation: ResetResumeObservation,
): void {
  // The core adapter owns the reset transaction: it must clear every metadata
  // record coupled to the destroyed baseline. Compatible reopen and raw
  // external row loss do not give this generic layer authority to interpret an
  // Electric cursor, so they preserve the metadata exactly at this checkpoint.
  expect(
    {
      metadataKeys: observation.metadataKeys,
      resumeKind: resumeKindOf(observation.resumeState),
    },
    `reset clears all collection metadata; non-reset core transitions preserve it`,
  ).toEqual(expectedResetResumeMetadata(history))
}

function attachResetResumeCleanupDiagnostics(
  primary: unknown,
  cleanupEvidence: string,
  cleanupFailure: unknown,
): Error {
  const error =
    primary instanceof Error
      ? primary
      : new Error(`Reset/resume oracle failed with a non-Error value`, {
          cause: primary,
        })
  if (!(`cleanupEvidence` in error)) {
    Object.defineProperty(error, `cleanupEvidence`, {
      value: cleanupEvidence,
      enumerable: true,
    })
  }
  if (cleanupFailure !== undefined) {
    Object.defineProperty(error, `cleanupFailure`, {
      value: cleanupFailure,
      enumerable: true,
    })
  }
  return error
}

async function observeResetResumeHistory(
  history: ResetResumeHistory,
  harnessFactory: SQLiteCoreAdapterHarnessFactory,
): Promise<ResetResumeObservation> {
  let harness: ReturnType<SQLiteCoreAdapterHarnessFactory> | undefined
  const collectionId = `reset-resume-oracle`
  let observation!: ResetResumeObservation
  let primaryFailure: unknown
  let cleanupFailure: unknown
  let failurePhase: `setup` | `reach` | `law` | undefined
  let cleanupEvidence = `not-run`
  const expectedRows = structuredClone(history.rows)
  const seedRows = structuredClone(history.rows)
  const restoreRows = structuredClone(history.rows)

  try {
    harness = harnessFactory({ schemaVersion: history.fromSchemaVersion })
    await harness.adapter.applyCommittedTx(
      { kind: `eager`, collectionId: collectionId },
      {
        txId: `seed-baseline`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          ...seedRows.map((row) => ({
            type: `insert` as const,
            key: row.id,
            value: structuredClone(row),
          })),
          {
            type: `delete` as const,
            key: `deleted-before-baseline`,
            value: {
              id: `deleted-before-baseline`,
              title: `baseline tombstone`,
              createdAt: `2026-01-01T00:00:00.000Z`,
              score: -1,
            },
          },
        ],
        collectionMetadataMutations: [
          ...(history.resumeKind === `none`
            ? []
            : [
                {
                  type: `set` as const,
                  key: `electric:resume`,
                  value:
                    history.resumeKind === `reset`
                      ? { kind: `reset`, updatedAt: 1 }
                      : {
                          kind: `resume`,
                          offset: `10_0`,
                          handle: `handle-before-reset`,
                          shapeId: `shape-before-reset`,
                          updatedAt: 1,
                        },
                },
              ]),
          ...history.unrelatedMetadataKeys.map((key, index) => ({
            type: `set` as const,
            key: `oracle:${key}`,
            value: { index },
          })),
        ],
      },
    )

    for (let index = 0; index < history.reopensBeforeTransition; index++) {
      const reopened = new SQLiteCorePersistenceAdapter({
        driver: harness.driver,
        schemaVersion: history.fromSchemaVersion,
      })
      await reopened.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        {},
      )
      await reopened.loadCollectionMetadata({
        kind: `eager`,
        collectionId: collectionId,
      })
    }

    const usesSchemaReset = destroysPersistedBaseline(history)
    const nextSchemaVersion = usesSchemaReset
      ? history.fromSchemaVersion + 1
      : history.fromSchemaVersion
    let reopened = new SQLiteCorePersistenceAdapter({
      driver: harness.driver,
      schemaVersion: nextSchemaVersion,
      schemaMismatchPolicy: `sync-present-reset`,
    })
    await reopened.loadSubset({ kind: `eager`, collectionId: collectionId }, {})

    if (history.transition === `partial-restore`) {
      await reopened.applyCommittedTx(
        { kind: `eager`, collectionId: collectionId },
        {
          txId: `partial-restore`,
          term: 2,
          seq: 1,
          rowVersion: 2,
          mutations: restoreRows.slice(0, -1).map((row) => ({
            type: `insert` as const,
            key: row.id,
            value: structuredClone(row),
          })),
        },
      )
    } else if (history.transition === `external-row-loss`) {
      const collectionTable = createPersistedTableName(collectionId, `c`)
      await harness.driver.run(
        `DELETE FROM "${collectionTable}" WHERE json_extract(value, '$.id') = ?`,
        [history.rows[0]!.id],
      )
    }

    for (let index = 0; index < history.reopensAfterTransition; index++) {
      reopened = new SQLiteCorePersistenceAdapter({
        driver: harness.driver,
        schemaVersion: nextSchemaVersion,
        schemaMismatchPolicy: `sync-present-reset`,
      })
      await reopened.loadSubset(
        { kind: `eager`, collectionId: collectionId },
        {},
      )
    }

    const metadata = await reopened.loadCollectionMetadata({
      kind: `eager`,
      collectionId: collectionId,
    })
    const resetEpochRows = await harness.driver.query<{ reset_epoch: number }>(
      `SELECT reset_epoch FROM collection_reset_epoch WHERE collection_id = ?`,
      [collectionId],
    )
    const registryRows = await harness.driver.query<{ schema_version: number }>(
      `SELECT schema_version FROM collection_registry WHERE collection_id = ?`,
      [collectionId],
    )
    const tombstoneTable = createPersistedTableName(collectionId, `t`)
    const tombstones = await harness.driver.query<{
      key: string
      row_version: number
    }>(`SELECT key, row_version FROM "${tombstoneTable}" ORDER BY key`)
    const appliedTransactions = await harness.driver.query<{
      tx_id: string
      row_version: number
    }>(
      `SELECT tx_id, row_version FROM applied_tx WHERE collection_id = ? ORDER BY term, seq`,
      [collectionId],
    )
    const versionRows = await harness.driver.query<{
      latest_row_version: number
    }>(
      `SELECT latest_row_version FROM collection_version WHERE collection_id = ?`,
      [collectionId],
    )
    observation = {
      checkpoint: `after-persistence-transition-reopen`,
      resetEpoch: resetEpochRows[0]?.reset_epoch ?? -1,
      schemaVersion: registryRows[0]?.schema_version ?? -1,
      durableRows: (
        await reopened.loadSubset(
          { kind: `eager`, collectionId: collectionId },
          {},
        )
      ).sort((a, b) => String(a.key).localeCompare(String(b.key))),
      tombstones: tombstones.map(({ key, row_version }) => ({
        key,
        rowVersion: row_version,
      })),
      appliedTransactions: appliedTransactions.map(
        ({ tx_id, row_version }) => ({
          txId: tx_id,
          rowVersion: row_version,
        }),
      ),
      latestRowVersion: versionRows[0]?.latest_row_version ?? -1,
      metadataKeys: metadata.map(({ key }) => key).sort(),
      resumeState: metadata.find(({ key }) => key === `electric:resume`)?.value,
    }

    try {
      // Positive reach evidence is separate from the semantic accusation.
      expect(observation.schemaVersion).toBe(nextSchemaVersion)
      expect(observation.resetEpoch).toBe(usesSchemaReset ? 1 : 0)
      expect(observation.durableRows).toEqual(
        (history.transition === `schema-reset`
          ? []
          : history.transition === `partial-restore`
            ? expectedRows.slice(0, -1)
            : history.transition === `external-row-loss`
              ? expectedRows.slice(1)
              : expectedRows
        )
          .map((value) => ({ key: value.id, value }))
          .sort((a, b) => String(a.key).localeCompare(String(b.key))),
      )
      expect(observation.tombstones).toEqual(
        usesSchemaReset
          ? []
          : [{ key: `s:deleted-before-baseline`, rowVersion: 1 }],
      )
      expect(observation.appliedTransactions).toEqual(
        history.transition === `schema-reset`
          ? []
          : history.transition === `partial-restore`
            ? [{ txId: `partial-restore`, rowVersion: 2 }]
            : [{ txId: `seed-baseline`, rowVersion: 1 }],
      )
      expect(observation.latestRowVersion).toBe(
        history.transition === `schema-reset`
          ? 0
          : history.transition === `partial-restore`
            ? 2
            : 1,
      )
    } catch (error) {
      failurePhase = `reach`
      primaryFailure = error
    }

    if (primaryFailure === undefined) {
      try {
        expectResetResumeLaw(history, observation)
      } catch (error) {
        failurePhase = `law`
        primaryFailure = error
      }
    }
  } catch (error) {
    if (primaryFailure === undefined) {
      failurePhase = `setup`
      primaryFailure = error
    }
  } finally {
    if (harness) {
      try {
        await harness.cleanup()
        cleanupEvidence =
          `dbPath` in harness && typeof harness.dbPath === `string`
            ? existsSync(harness.dbPath)
              ? `failed: SQLite file still exists`
              : `passed: SQLite file removed after captured checkpoint`
            : `passed: registered harness cleanup completed after captured checkpoint`
      } catch (cleanupError) {
        cleanupEvidence = `failed: ${String(cleanupError)}`
        cleanupFailure = cleanupError
      }
    }
  }

  if (primaryFailure !== undefined) {
    const failure =
      failurePhase === `law`
        ? new ResetResumeOracleViolation(
            history,
            observation,
            cleanupEvidence,
            primaryFailure,
          )
        : primaryFailure
    throw attachResetResumeCleanupDiagnostics(
      failure,
      cleanupEvidence,
      cleanupFailure,
    )
  }
  if (cleanupFailure !== undefined) throw cleanupFailure
  if (!cleanupEvidence.startsWith(`passed:`)) {
    throw new Error(cleanupEvidence)
  }
  return observation
}

/**
 * Reset/resume lineage registration. It takes the harness factory of the
 * contract suite that calls it, so the tests run against the same adapters.
 */
export function runSQLiteResetResumeOracleTests(
  harnessFactory: SQLiteCoreAdapterHarnessFactory,
): void {
  /**
   * Reset/resume oracle card
   *
   * Law and source: a destructive schema reset creates a new persisted
   * baseline and clears every collection-metadata record in that reset
   * transaction. Same-schema adapter reopens preserve metadata, including
   * for a genuinely empty baseline. The production reset policy above and the
   * independently reproduced history in
   * https://github.com/TanStack/db/issues/1589 establish this narrow law.
   *
   * Domain and legal histories: zero-to-four committed rows; absent, reset,
   * or non-initial resume metadata; same-schema adapter reopen, vN -> vN+1
   * sync-present-reset, a partial restore after reset, or out-of-band row
   * loss; adapter reopens on either side; unrelated metadata.
   *
   * Reference: a two-generation lineage relation. Same-schema reopen and raw
   * external loss keep the core generation/metadata record; schema reset
   * replaces the generation and starts with no metadata. This model does not
   * inspect the adapter's SQL branches or infer compatibility from row
   * cardinality.
   *
   * Production path and checkpoint: SQLiteCorePersistenceAdapter commits a
   * real SQLite baseline, then a new adapter instance reaches
   * ensureCollectionReady/handleSchemaMismatch. At the
   * after-persistence-transition-reopen checkpoint we inspect registry
   * version, reset epoch/generation, complete durable rows, tombstones,
   * applied transactions, and collection metadata.
   *
   * Observed result and known omissions: exact settled rows, exact metadata
   * keys, and whether the durable Electric state is absent/reset/resume. The
   * external-loss lane proves the generic adapter leaves metadata reachable;
   * only the persisted+Electric suite judges whether that cursor is safe to
   * consume. The injected loss is not a claim that arbitrary SQL is a
   * supported public API. Partial resumed updates and SDK framing retain
   * their executable owners in the Electric recovery and framing suites.
   *
   * Trust: reset_epoch and schema_version prove reach; retained metadata
   * after reset is the whole-path fault control, while compatible and
   * external-loss histories calibrate preservation. Every generated database
   * is removed after evidence capture. The failure reports first and reduced
   * histories plus a verified fast-check seed/path replay.
   */
  oracleReplayTest(it, `sqlite-resume.baseline-lineage`)(
    `resets collection metadata with its persisted baseline across generated adapter reopen histories`,
    async () => {
      const historyArbitrary = fc
        .constantFrom<ResetResumeHistory[`transition`]>(
          `compatible-reopen`,
          `schema-reset`,
          `partial-restore`,
          `external-row-loss`,
        )
        .chain((transition) =>
          fc.record<ResetResumeHistory>({
            fromSchemaVersion: fc.integer({ min: 1, max: 4 }),
            rows: fc
              .uniqueArray(fc.integer({ min: 0, max: 20 }), {
                minLength:
                  transition === `partial-restore`
                    ? 2
                    : transition === `external-row-loss`
                      ? 1
                      : 0,
                maxLength: 4,
              })
              .map((ids) =>
                ids
                  .sort((left, right) => left - right)
                  .map((id) => ({
                    id: String(id),
                    title: `row-${id}`,
                    createdAt: `2026-01-01T00:00:00.000Z`,
                    score: id,
                  })),
              ),
            resumeKind: fc.constantFrom(`none`, `reset`, `resume`),
            transition: fc.constant(transition),
            reopensBeforeTransition: fc.integer({ min: 0, max: 2 }),
            reopensAfterTransition: fc.integer({ min: 0, max: 2 }),
            unrelatedMetadataKeys: fc.uniqueArray(
              fc.constantFrom(`gc`, `provider`, `custom`),
              { maxLength: 3 },
            ),
          }),
        )

      // A seed-only shared run reseeds this campaign. Ordinary runs keep the
      // fixed seed 1659, and a path replay runs once from its recorded path.
      const parameters = oraclePropertyOptions(
        24,
        `sqlite-resume.baseline-lineage`,
      )

      let originalFailure: ResetResumeOracleViolation | undefined
      const property = fc.asyncProperty(historyArbitrary, async (history) => {
        try {
          await observeResetResumeHistory(history, harnessFactory)
        } catch (error) {
          if (
            originalFailure === undefined &&
            error instanceof ResetResumeOracleViolation
          ) {
            originalFailure = error
          }
          throw error
        }
      })
      const failure = await fc.check(property, {
        ...parameters,
        seed: parameters.seed ?? 1659,
        ...(parameters.path === undefined ? {} : { endOnFailure: true }),
      })
      if (!failure.failed) return
      if (
        !(failure.errorInstance instanceof ResetResumeOracleViolation) ||
        originalFailure === undefined ||
        failure.counterexamplePath === null
      ) {
        throw failure.errorInstance
      }
      if (!hasSameResetResumeFailure(originalFailure, failure.errorInstance)) {
        throw new Error(
          `Shrinking changed the reset/resume law or observation checkpoint`,
        )
      }

      const replay = await fc.check(
        fc.asyncProperty(historyArbitrary, async (history) => {
          await observeResetResumeHistory(history, harnessFactory)
        }),
        {
          seed: failure.seed,
          path: failure.counterexamplePath,
          endOnFailure: true,
        },
      )
      if (
        !replay.failed ||
        !(replay.errorInstance instanceof ResetResumeOracleViolation) ||
        JSON.stringify(replay.counterexample) !==
          JSON.stringify(failure.counterexample) ||
        !hasSameResetResumeFailure(failure.errorInstance, replay.errorInstance)
      ) {
        throw new Error(
          `Reset/resume oracle replay did not reproduce the intended violation`,
        )
      }

      const reducedFailure = failure.errorInstance
      throw new Error(
        `Reset/resume baseline-lineage violation. ` +
          `seed=${failure.seed} path=${failure.counterexamplePath} ` +
          `law=${reducedFailure.law} ` +
          `discriminant=${reducedFailure.discriminant} ` +
          `checkpoint=${reducedFailure.observation.checkpoint} ` +
          `originalTrace=${JSON.stringify(originalFailure.history)} ` +
          `reducedTrace=${JSON.stringify(reducedFailure.history)} ` +
          `expected=${JSON.stringify(reducedFailure.expected)} ` +
          `actual=${JSON.stringify(reducedFailure.actual)} ` +
          `observation=${JSON.stringify(reducedFailure.observation)} ` +
          `replay=verified ` +
          `cleanup=${reducedFailure.cleanupEvidence}`,
        { cause: reducedFailure },
      )
    },
    120_000,
  )

  it(`leaves externally inconsistent metadata reachable for consumer validation`, async () => {
    const observation = await observeResetResumeHistory(
      {
        fromSchemaVersion: 1,
        rows: [
          {
            id: `1`,
            title: `lost externally`,
            createdAt: `2026-01-01T00:00:00.000Z`,
            score: 1,
          },
          {
            id: `2`,
            title: `survives`,
            createdAt: `2026-01-01T00:00:00.000Z`,
            score: 2,
          },
        ],
        resumeKind: `resume`,
        transition: `external-row-loss`,
        reopensBeforeTransition: 1,
        reopensAfterTransition: 1,
        unrelatedMetadataKeys: [`provider`],
      },
      harnessFactory,
    )

    expect(observation.metadataKeys).toEqual([
      `electric:resume`,
      `oracle:provider`,
    ])
    expect(resumeKindOf(observation.resumeState)).toBe(`resume`)
  }, 30_000)

  it(`requires complete metadata reset while preserving non-reset metadata`, () => {
    const compatibleEmpty: ResetResumeHistory = {
      fromSchemaVersion: 1,
      rows: [],
      resumeKind: `resume`,
      transition: `compatible-reopen`,
      reopensBeforeTransition: 0,
      reopensAfterTransition: 1,
      unrelatedMetadataKeys: [`provider`],
    }
    const observation: ResetResumeObservation = {
      checkpoint: `after-persistence-transition-reopen`,
      resetEpoch: 0,
      schemaVersion: 1,
      durableRows: [],
      tombstones: [],
      appliedTransactions: [],
      latestRowVersion: 1,
      metadataKeys: [`electric:resume`, `oracle:provider`],
      resumeState: { kind: `resume`, offset: `10_0` },
    }
    expect(() =>
      expectResetResumeLaw(compatibleEmpty, observation),
    ).not.toThrow()
    expect(() =>
      expectResetResumeLaw(
        { ...compatibleEmpty, transition: `external-row-loss` },
        observation,
      ),
    ).not.toThrow()
    expect(() =>
      expectResetResumeLaw(
        { ...compatibleEmpty, transition: `schema-reset` },
        { ...observation, resetEpoch: 1, schemaVersion: 2 },
      ),
    ).toThrowError(expect.objectContaining({ name: `AssertionError` }))
    expect(() =>
      expectResetResumeLaw(
        { ...compatibleEmpty, transition: `schema-reset` },
        {
          ...observation,
          resetEpoch: 1,
          schemaVersion: 2,
          metadataKeys: [`oracle:provider`],
          resumeState: undefined,
        },
      ),
    ).toThrowError(expect.objectContaining({ name: `AssertionError` }))
    expect(() =>
      expectResetResumeLaw(
        { ...compatibleEmpty, transition: `schema-reset` },
        {
          ...observation,
          resetEpoch: 1,
          schemaVersion: 2,
          metadataKeys: [],
          resumeState: undefined,
        },
      ),
    ).not.toThrow()
  })
}

/**
 * # Can a SQLite subset predicate exceed the connection's binding capacity?
 *
 * Contract: `SQLiteCorePersistenceAdapter.loadSubset` accepts supported `IN`,
 * `and`, `or`, and scalar predicates. The core owner's 1,200-value case at
 * `packages/db-sqlite-persistence-core/tests/sqlite-core-adapter.test.ts:2459`
 * promises large-list support. Issue #1993 requests a total statement bound.
 * On a connection with a declared variable limit, a valid request must return
 * exactly its matching persisted rows without asking SQLite to prepare a
 * statement above that limit, even if its transaction driver omits the limit.
 *
 * Scope: finite primitive values; one or two list predicates, including an
 * empty list, and up to one scalar equality; a fixed 100/101-scalar conjunction;
 * two or three persisted rows; one cursor route. Null, nonfinite,
 * container values, unsupported expressions, and concurrency remain outside.
 * Index DDL has a separate literal-expression context. This Node `node:sqlite`
 * witness does not prove browser, mobile, or Tauri execution, multi-process WAL,
 * or host-specific availability of JSON functions.
 *
 * Model: compute each row's result directly from the declared `and`/`or` clauses
 * using typed equality. The model does not read SQL, compiler fragments, or
 * SQLite results. A `specification case` below is model-only input data; each
 * clause maps to one IR predicate in the production driver.
 *
 * History grammar: seed three rows, choose one/two list clauses and optionally
 * one scalar clause, choose string/number/boolean/date/bigint values, choose
 * list lengths near 999 and above it, then call `loadSubset` once. Fixed cases
 * reconstruct reported one-large, two-small, and two-large forms. Generated
 * cases vary list counts, lengths, connective, and type. Nulls,
 * >signed-64-bit bigint, unsupported fields, and index DDL with runtime
 * bindings are outside the domain. A scalar clause without one value is an
 * invalid model input. Removing any list-count or length axis loses one of
 * the three capacity forms. Kind and connective challenge value preservation.
 * The 998/999/1000 margins distinguish a misplaced cap; 499+500 versus
 * 500+500 distinguishes statement-wide counting. A distinct transaction
 * driver without a cap crosses a 100/101-variable host boundary.
 *
 * Production driver: use the real core adapter with prepared SQLite statements.
 * Newer Node versions apply `variableNumber: 999` or `100` natively; older
 * versions use a driver boundary that rejects over-cap bindings before prepare.
 * Record every attempted driver statement, including a capacity failure.
 * The observation cut is `loadSubset` fulfillment/rejection, typed returned
 * values, ordered keys when requested, and attempted statement bind counts.
 *
 * Refinement: require the exact rows, reached predicate SELECTs, no
 * SQLite error, and no statement above its declared binding cap. The original 900-item
 * OR-chunk lowering is the hostile design: it reaches the intended SELECT and
 * fails the public result/binding comparison. The legacy CLI test interpolates
 * literals, so it cannot exercise this boundary.
 *
 * Replay: `TANSTACK_DB_ORACLE_PATH` with `TANSTACK_DB_ORACLE_SEED` and
 * `TANSTACK_DB_ORACLE_PROPERTY=sqlite-persistence.binding-capacity` replays the
 * recorded random-campaign history. The normal package test runs fixed and
 * random campaigns.
 */
const BINDING_FIXED_SEED = 1_993_999
const BINDING_RUNS = 12

const fixed: Array<Spec> = [
  single('string', 0),
  single('string', 998),
  single('string', 999),
  single('string', 1000),
  single('string', 1200),
  chunkBoundary(),
  escapedStringCase(),
  dual('string', 499, 500, 'or'),
  dual('string', 500, 500, 'or'),
  dual('string', 600, 600, 'and'),
  dual('string', 1000, 1000, 'or'),
  mixed('string', 998),
  mixed('string', 999),
  nested('string', 500, 500),
  single('number', 2),
  single('boolean', 2),
  single('date', 2),
  single('bigint', 2),
  bigintBoundary(-9_223_372_036_854_775_808n, 'bigint-signed-min'),
  bigintBoundary(9_223_372_036_854_775_807n, 'bigint-signed-max'),
  single('bigint', 1000),
]
assert.ok(fixed.every(legalSpec))
assert.equal(
  legalSpec({
    label: 'invalid-empty-eq',
    valueKind: 'string',
    connective: 'and',
    clauses: [{ field: 'a', kind: 'eq', values: [] }],
  }),
  false,
)

const kindArbitrary = fc.constantFrom<Kind>(
  'string',
  'number',
  'boolean',
  'date',
  'bigint',
)
const lengthArbitrary = fc.constantFrom(
  498,
  499,
  500,
  600,
  998,
  999,
  1000,
  1200,
)
const secondLengthArbitrary = fc.constantFrom(499, 500, 600, 1000)
const generated = fc.oneof(
  fc
    .tuple(kindArbitrary, lengthArbitrary)
    .map(([kind, length]) => single(kind, length)),
  fc
    .tuple(
      kindArbitrary,
      lengthArbitrary,
      secondLengthArbitrary,
      fc.constantFrom<'and' | 'or'>('and', 'or'),
    )
    .map(([kind, a, b, connective]) => dual(kind, a, b, connective)),
  fc
    .tuple(kindArbitrary, lengthArbitrary)
    .map(([kind, length]) => mixed(kind, length)),
  fc
    .tuple(kindArbitrary, lengthArbitrary, secondLengthArbitrary)
    .map(([kind, a, b]) => nested(kind, a, b)),
)

const BINDING_PROPERTY = `sqlite-persistence.binding-capacity`
const bindingFixedIt = oracleReplayTest(it)

export function runSQLiteBindingCapacityOracleSuite(): void {
  describe(`SQLite subset binding-capacity oracle`, () => {
    runSQLiteBindingCapacityUnitTests()

    bindingFixedIt(
      `returns exact rows at single-list, statement-total, and typed boundaries`,
      async () => {
        const failures: Array<string> = []
        for (const spec of fixed) {
          const observation = await observe(spec)
          const problem = violation(spec, observation)
          if (problem)
            failures.push(
              `${spec.label}: ${problem.kind}@${problem.checkpoint}: ${problem.message}`,
            )
        }
        expect(failures).toEqual([])
      },
    )

    bindingFixedIt(
      `honors total capacity through transactionWithDriver`,
      async () => {
        const failures: Array<string> = []
        for (const spec of [
          single(`string`, 999),
          single(`string`, 1000),
          dual(`string`, 500, 500, `or`),
          single(`bigint`, 1000),
        ]) {
          const observation = await observe(spec, true)
          const problem = violation(spec, observation)
          if (problem)
            failures.push(
              `${spec.label}: ${problem.kind}@${problem.checkpoint}: ${problem.message}`,
            )
        }
        expect(failures).toEqual([])
      },
    )

    bindingFixedIt(
      `honors the root connection limit when a distinct transaction driver omits it`,
      async () => {
        for (const count of [100, 101]) {
          const spec: Spec = {
            label: `${count}-scalar-conjunction`,
            valueKind: `string`,
            connective: `and`,
            clauses: Array.from({ length: count }, () => ({
              field: `a`,
              kind: `eq`,
              values: [`target`],
            })),
          }
          const observation = await observe(spec, true, 100, true)
          expect(violation(spec, observation, 100)).toBeUndefined()
          const predicateReads = observation.attempts.filter((entry) =>
            entry.sql.startsWith(`SELECT key, value, metadata, row_version`),
          )
          expect(predicateReads).toHaveLength(1)
          expect(predicateReads[0]?.bindings).toBe(count === 100 ? 100 : 0)
        }
      },
    )

    bindingFixedIt(
      `never submits an over-capacity statement with many scalar predicates`,
      async () => {
        const scalarStress: Spec = {
          label: `1000-scalar-conjunction`,
          valueKind: `string`,
          connective: `and`,
          clauses: Array.from({ length: 1000 }, () => ({
            field: `a`,
            kind: `eq`,
            values: [`target`],
          })),
        }
        const observation = await observe(scalarStress)
        expect(violation(scalarStress, observation)).toBeUndefined()
        const predicateReads = observation.attempts.filter((entry) =>
          entry.sql.startsWith(`SELECT key, value, metadata, row_version`),
        )
        expect(predicateReads).toHaveLength(1)
        expect(predicateReads[0]?.bindings).toBe(0)
      },
    )

    async function campaign(
      label: string,
      parameters: { numRuns: number; seed?: number; path?: string },
    ) {
      let firstFailure: Violation | undefined
      const property = fc.asyncProperty(generated, async (spec) => {
        assert.ok(legalSpec(spec))
        const observation = await observe(spec)
        const problem = violation(spec, observation)
        if (problem) {
          firstFailure ??= problem
          throw new Error(
            `${spec.label}: ${problem.kind}@${problem.checkpoint}: ${problem.message}${observation.cleanupError ? `; cleanup=${observation.cleanupError}` : ``}`,
          )
        }
      })
      const details = await fc.check(property, parameters)
      recordOracleReplay(BINDING_PROPERTY, details)
      const reduced = details.counterexample?.[0]
      const reducedProblem = reduced
        ? violation(reduced, await observe(reduced))
        : undefined
      const sameViolation =
        !details.failed ||
        Boolean(
          firstFailure &&
          reducedProblem &&
          firstFailure.kind === reducedProblem.kind &&
          firstFailure.checkpoint === reducedProblem.checkpoint,
        )
      expect(
        details.failed,
        `${label}: seed=${details.seed} path=${details.counterexamplePath ?? ``} first=${firstFailure?.kind ?? ``}@${firstFailure?.checkpoint ?? ``} reduced=${reducedProblem?.kind ?? ``}@${reducedProblem?.checkpoint ?? ``} sameViolation=${sameViolation}; ${details.error ?? ``}`,
      ).toBe(false)
    }

    bindingFixedIt(
      `preserves exact rows across fixed-seed binding histories`,
      async () => {
        await campaign(`fixed seed`, {
          numRuns: oracleRuns(BINDING_RUNS),
          seed: BINDING_FIXED_SEED,
        })
      },
    )
    // Runs in ordinary and seed-only runs, and as the replay of its property.
    oracleReplayTest(it, BINDING_PROPERTY)(
      `preserves exact rows across random-seed binding histories`,
      async () => {
        await campaign(
          `random seed`,
          oraclePropertyOptions(BINDING_RUNS, BINDING_PROPERTY),
        )
      },
    )
  })
}
