import { fc } from '@fast-check/vitest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DbClient, collectionOptions } from '../src/client.js'
import { DuplicateKeySyncError } from '../src/errors.js'
import { oracleReplayRequested, oracleRoute } from './oracle-config.js'
import { oracleProperty } from './oracle-property.js'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
  rejectAt,
} from './oracle-assertion-adapter.js'
import {
  absentMarker,
  describeMismatch,
  flatGrammar,
  historyRegimes,
  modelCheckpoints,
  nestedConflictGrammar,
  nestedGrammar,
  nestedSeedGrammar,
  runHoldInvariance,
  runKeyIndependence,
  runSeedOrderInvariance,
  runSessionHistory,
  seedFullGrammar,
  seedGrammar,
  sessionCollectionKeys,
  sessionHistoryArbitrary,
} from './sync-metadata-session-oracle.js'
import { declareOracle } from './oracle-declaration.js'
import type { Verdict } from './oracle-property.js'
import type {
  ReceiptState,
  SessionAction,
  SessionDriver,
  SessionGrammar,
  SessionModel,
} from './sync-metadata-session-oracle.js'
import type { SyncConfig } from '../src/types.js'

// What this oracle owns: the gap report judges the DbClient Collection's sync
// path, which applies sources, seeds, holds, and commits, by this file's tests.
// The contract, model, and grammar live in sync-metadata-session-oracle.ts.
declareOracle({ owns: [`src/client.ts`, `src/collection/sync.ts`] })

/**
 * Core driver for the sync metadata session oracle. The contract, model,
 * grammar, and comparison live in `sync-metadata-session-oracle.ts`.
 *
 * The production path is a `DbClient` Collection with a real sync function.
 * Each action calls the sync API that the sync function received. The hold is
 * a persisting optimistic insert of a fresh fixture key (1000 and up), which
 * no source action or truncate names; `release` resolves its mutation
 * function. A seed is `DbClient.hydrate` with one row and its
 * metadata. Cancel is `commit(signal)` with an aborted signal.
 *
 * Checkpoint: after each action returns, the driver reads `metadata.row.get`
 * for rows 1 and 2, `metadata.collection.get` for each collection key,
 * `metadata.collection.list()` and `list('gc:')` sorted by key, and
 * `collection.base` for rows 1 and 2. A final checkpoint follows release of
 * any hold, cancellation of any open transaction, and every receipt.
 */

type Row = { id: number; v: unknown }
type SyncActions = Parameters<SyncConfig<Row, number>[`sync`]>[0]

let collectionCount = 0

async function createCoreDriver(fullRows = false): Promise<SessionDriver> {
  const id = `sync-metadata-session-${collectionCount++}`
  let sync!: SyncActions
  let resolveMutation: (() => void) | undefined
  const client = new DbClient()
  const collection = client.collection(
    collectionOptions<Row, number>({
      id,
      getKey: (row) => row.id,
      sync: {
        rowUpdateMode: fullRows ? `full` : `partial`,
        sync: (actions) => {
          sync = actions
          actions.begin()
          actions.commit()
          actions.markReady()
        },
      },
      onInsert: () =>
        new Promise<void>((resolve) => {
          resolveMutation = resolve
        }),
    }),
  )
  await collection.preload()

  let depth = 0
  let holdCount = 0
  let blocker: { when: (state: 'settled') => Promise<unknown> } | undefined
  const receipts: Array<Promise<void>> = []
  const rejections: Array<string> = []
  const receiptStates: Array<ReceiptState> = []
  const track = (receipt: true | Promise<void>, expectAbort: boolean) => {
    if (receipt === true) return
    receipts.push(
      receipt.then(
        () => {
          if (expectAbort) rejections.push(`cancelled transaction applied`)
        },
        (error: unknown) => {
          if (
            !expectAbort ||
            !(error instanceof Error) ||
            error.name !== `AbortError`
          )
            rejections.push(
              error instanceof Error
                ? `${error.name}: ${error.message}`
                : String(error),
            )
        },
      ),
    )
  }
  const abort = () => {
    const controller = new AbortController()
    controller.abort()
    track(sync.commit(controller.signal), true)
    depth--
  }
  const metadata = () => sync.metadata!
  const read = (value: unknown) => (value === undefined ? absentMarker : value)
  const release = async () => {
    const pending = blocker
    blocker = undefined
    resolveMutation?.()
    resolveMutation = undefined
    await pending?.when('settled')
  }

  return {
    begin: () => {
      sync.begin()
      depth++
    },
    commit: () => {
      const index = receiptStates.length
      const receipt = sync.commit()
      depth--
      if (receipt === true) {
        receiptStates.push(`applied`)
        return
      }
      receiptStates.push(`pending`)
      receipts.push(
        receipt.then(
          () => {
            receiptStates[index] = `applied`
          },
          () => {
            receiptStates[index] = `rejected`
          },
        ),
      )
    },
    cancel: abort,
    rowSet: (key, value) => metadata().row.set(key, value),
    rowDelete: (key) => metadata().row.delete(key),
    insert: (_key, value, rowMetadata) =>
      sync.write({
        type: `insert`,
        value: value as Row,
        ...(rowMetadata === undefined
          ? {}
          : { metadata: rowMetadata as Record<string, unknown> }),
      }),
    update: (_key, value, rowMetadata) =>
      sync.write({
        type: `update`,
        value: value as Row,
        ...(rowMetadata === undefined
          ? {}
          : { metadata: rowMetadata as Record<string, unknown> }),
      }),
    delete: (key) => sync.write({ type: `delete`, key }),
    truncate: () => sync.truncate(),
    collectionSet: (key, value) => metadata().collection.set(key, value),
    collectionDelete: (key) => metadata().collection.delete(key),
    hold: () => {
      // Core grammars never generate a store hold. A fresh fixture key each time: no source action or truncate names it.
      blocker = collection.insert({ id: 1000 + holdCount++, v: 0 })
    },
    release,
    isDuplicateKeyError: (error) => error instanceof DuplicateKeySyncError,
    seed: (key, row, rowMetadata) =>
      client.hydrate({
        collections: [
          {
            collectionId: id,
            rows: [
              {
                key,
                value: row as Row,
                metadata: rowMetadata as Record<string, unknown>,
              },
            ],
          },
        ],
      }),
    observe: () => ({
      rowMetadata: {
        1: read(metadata().row.get(1)),
        2: read(metadata().row.get(2)),
      },
      collection: {
        ...Object.fromEntries(
          sessionCollectionKeys.map((key) => [
            key,
            read(metadata().collection.get(key)),
          ]),
        ),
      },
      list: sortedEntries(metadata().collection.list()),
      prefixList: sortedEntries(metadata().collection.list(`gc:`)),
      base: {
        1: read(collection.base.get(1)),
        2: read(collection.base.get(2)),
      },
      receipts: [...receiptStates],
    }),
    flush: () => new Promise((resolve) => setTimeout(resolve, 0)),
    settle: async () => {
      await release()
      while (depth > 0) abort()
      await Promise.all(receipts)
      return rejections
    },
    cleanup: () => collection.cleanup(),
  }
}

function sortedEntries(
  entries: ReadonlyArray<{ key: string; value: unknown }>,
): Array<[string, unknown]> {
  return [...entries]
    .map(({ key, value }): [string, unknown] => [key, value])
    .sort(([a], [b]) => a.localeCompare(b))
}

async function assertSessionHistory(
  grammar: SessionGrammar,
  history: ReadonlyArray<SessionAction>,
): Promise<void> {
  const { mismatch } = await runSessionHistory(grammar, history, () =>
    createCoreDriver(grammar.fullRows),
  )
  if (mismatch)
    rejectAt(
      `sync metadata session comparison`,
      new Error(describeMismatch(history, mismatch)),
    )
}

// ---------------------------------------------------------------------------
// Named witnesses
// ---------------------------------------------------------------------------

const a = (
  type: SessionAction[`type`],
  key?: number | string,
  metadata?: boolean,
) =>
  ({
    type,
    ...(key === undefined ? {} : { key }),
    ...(metadata === undefined ? {} : { metadata }),
  }) as SessionAction

/**
 * Each witness reaches one law's premise. The model expectations below are
 * derived by hand from the laws, so they also check the model against the
 * wrong answers that production gives on `30175be48`.
 */
const witnesses = {
  // A later seed beneath an open re-insert does not change its kind, but a
  // source update that merges over that seed and commits ahead does: the
  // re-insert then lands on a different row (decision 10).
  lateSeedUnderMergedUpdate: {
    grammar: nestedSeedGrammar,
    history: [
      a(`seed`, 1),
      a(`begin`),
      a(`upsert`, 1, true),
      a(`reinsert`, 1, false),
      a(`begin`),
      { type: `seed`, key: 1, bare: true },
      a(`upsert`, 1, false),
      a(`commit`),
    ] as Array<SessionAction>,
  },
  // The same under a hold: the inner commit stays accepted but unapplied, so
  // the seed still marks the row.
  heldLateSeedUnderMergedUpdate: {
    grammar: nestedSeedGrammar,
    history: [
      a(`hold`),
      a(`seed`, 1),
      a(`begin`),
      a(`upsert`, 1, true),
      a(`reinsert`, 1, false),
      a(`begin`),
      { type: `seed`, key: 1, bare: true },
      a(`upsert`, 1, false),
      a(`commit`),
    ] as Array<SessionAction>,
  },
  // Issue #2220: a held earlier write must stay visible after a later commit.
  heldCursor: {
    grammar: flatGrammar,
    history: [
      a(`hold`),
      a(`begin`),
      { type: `collectionSet`, key: `cursor` },
      a(`commit`),
      a(`begin`),
      a(`upsert`, 1, false),
      a(`commit`),
    ] as Array<SessionAction>,
  },
  // The open transaction overlays every held one, not only the newest.
  openOverHeld: {
    grammar: flatGrammar,
    history: [
      a(`hold`),
      a(`begin`),
      a(`rowSet`, 1),
      { type: `collectionSet`, key: `gc:a` },
      a(`commit`),
      a(`begin`),
    ] as Array<SessionAction>,
  },
  // Independent transactions: an outer abort keeps an inner commit.
  outerAbortKeepsInnerCommit: {
    grammar: nestedGrammar,
    history: [
      a(`begin`),
      a(`begin`),
      a(`upsert`, 1, true),
      a(`commit`),
      a(`cancel`),
    ] as Array<SessionAction>,
  },
  // Commit order: the outer transaction commits after the inner one, so its
  // earlier write wins, and a hold does not change that order.
  commitOrderDuringHold: {
    grammar: nestedGrammar,
    history: [
      a(`hold`),
      a(`begin`),
      a(`rowSet`, 1),
      a(`begin`),
      a(`rowSet`, 1),
      a(`commit`),
      a(`commit`),
      a(`release`),
    ] as Array<SessionAction>,
  },
  // During a hold, the outer transaction can still write and commit after an
  // inner one commits.
  outerContinuesAfterInnerDuringHold: {
    grammar: nestedGrammar,
    history: [
      a(`hold`),
      a(`begin`),
      a(`begin`),
      a(`rowSet`, 1),
      a(`commit`),
      a(`rowSet`, 2),
      a(`commit`),
    ] as Array<SessionAction>,
  },
  // An inner truncate applies at its own commit, at once despite a hold.
  innerTruncateAppliesAtItsCommit: {
    grammar: nestedGrammar,
    history: [
      a(`begin`),
      a(`upsert`, 1, true),
      a(`commit`),
      a(`hold`),
      a(`begin`),
      a(`begin`),
      a(`truncate`),
      a(`commit`),
      a(`commit`),
    ] as Array<SessionAction>,
  },
  // A seed that arrives under an open update changes the update's merge base,
  // but never makes the source's equal re-insert a duplicate, and the
  // re-insert still replaces the row: the late seed's extra field goes.
  seedUnderOpenReinsert: {
    grammar: seedGrammar,
    history: [
      a(`begin`),
      { type: `seed`, key: 1, narrow: true, bare: true },
      a(`upsert`, 1, false),
      a(`reinsert`, 1, false),
      { type: `seed`, key: 1, bare: true },
      a(`commit`),
    ] as Array<SessionAction>,
  },
  // A seed never supersedes a source metadata write on a row the source did not write.
  seedUnderMetadataOnlyWrite: {
    grammar: seedGrammar,
    history: [
      a(`begin`),
      a(`rowSet`, 1),
      a(`commit`),
      a(`seed`, 1),
    ] as Array<SessionAction>,
  },
  // A seed arriving under the source's open insert sits beneath it: the
  // insert replaces the seeded row and clears its metadata. Consumers see the
  // seed until the insert's transaction applies.
  seedUnderOpenInsert: {
    grammar: seedGrammar,
    history: [
      a(`begin`),
      a(`upsert`, 1, false),
      a(`seed`, 1),
      a(`commit`),
    ] as Array<SessionAction>,
  },
  // The same history with the insert committed before the seed arrives: the
  // outcome does not depend on arrival order.
  seedAfterCommittedInsert: {
    grammar: seedGrammar,
    history: [
      a(`begin`),
      a(`upsert`, 1, false),
      a(`commit`),
      a(`seed`, 1),
    ] as Array<SessionAction>,
  },
  // A source insert equal to a seeded row is still an insert: the source never
  // wrote the row, so the insert names its metadata and clears the seed's.
  equalInsertOverSeed: {
    grammar: seedGrammar,
    history: [
      a(`seed`, 1),
      a(`begin`),
      a(`reinsert`, 1, false),
    ] as Array<SessionAction>,
  },
  // The latest seed of a row no source write has written wins whole, so a
  // narrow seed drops the earlier seed's other field.
  laterSeedReplacesSeed: {
    grammar: seedGrammar,
    history: [
      a(`seed`, 1),
      { type: `seed`, key: 1, narrow: true },
    ] as Array<SessionAction>,
  },
  // Once the source has updated a seeded row, a later seed is ignored for the
  // row's data; the update wrote no metadata, so the late seed supplies it.
  partialUpdateThenLateSeed: {
    grammar: seedGrammar,
    history: [
      a(`seed`, 1),
      a(`begin`),
      a(`upsert`, 1, false),
      a(`commit`),
      { type: `seed`, key: 1, narrow: true },
    ] as Array<SessionAction>,
  },
  // The latest seed wins whole: a later seed without metadata leaves none.
  bareLaterSeedClearsMetadata: {
    grammar: seedGrammar,
    history: [
      a(`seed`, 1),
      { type: `seed`, key: 1, bare: true },
    ] as Array<SessionAction>,
  },
  // A fresh source insert over a row only a seed supplied replaces the row
  // and, naming no metadata, clears the seed's.
  insertOverSeedReplaces: {
    grammar: seedGrammar,
    history: [
      a(`seed`, 1),
      a(`begin`),
      a(`insertOverSeed`, 1, false),
      a(`commit`),
    ] as Array<SessionAction>,
  },
  // A source update merges over a seeded row under partial row updates, so the
  // seed's other field and its metadata stay.
  updateOverSeed: {
    grammar: seedGrammar,
    history: [
      a(`seed`, 1),
      a(`begin`),
      a(`upsert`, 1, false),
      a(`commit`),
    ] as Array<SessionAction>,
  },
  // Under full row updates the update replaces the seeded row; its metadata
  // stays, because the update names none.
  updateOverSeedFullRows: {
    grammar: seedFullGrammar,
    history: [
      a(`seed`, 1),
      a(`begin`),
      a(`upsert`, 1, false),
      a(`commit`),
    ] as Array<SessionAction>,
  },
  // An open truncate hides a held row write: a row read stops at the truncate.
  openTruncateHidesHeldRow: {
    grammar: flatGrammar,
    history: [
      a(`hold`),
      a(`begin`),
      a(`rowSet`, 1),
      a(`commit`),
      a(`begin`),
      a(`truncate`),
    ] as Array<SessionAction>,
  },
  // An open delete hides a held collection entry from `list()`.
  openDeleteHidesHeldListEntry: {
    grammar: flatGrammar,
    history: [
      a(`hold`),
      a(`begin`),
      a(`collectionSet`, `gc:a`),
      a(`commit`),
      a(`begin`),
      a(`collectionDelete`, `gc:a`),
    ] as Array<SessionAction>,
  },
  // `list('gc:')` includes the key equal to the prefix and excludes `gc`.
  prefixBoundary: {
    grammar: flatGrammar,
    history: [
      a(`begin`),
      a(`collectionSet`, `gc`),
      a(`collectionSet`, `gc:`),
    ] as Array<SessionAction>,
  },
  // Under full row updates a held update replaces the row, so a later insert
  // of the updated row is an equal re-insert, not a duplicate. A classifier
  // that merged the held update would keep the inserted row's field `m`.
  fullUpdateThenEqualInsertDuringHold: {
    grammar: seedFullGrammar,
    history: [
      a(`begin`),
      a(`upsert`, 1, true),
      a(`commit`),
      a(`hold`),
      a(`begin`),
      a(`upsert`, 1, false),
      a(`commit`),
      a(`begin`),
      a(`reinsert`, 1, false),
    ] as Array<SessionAction>,
  },
} satisfies Record<
  string,
  { grammar: SessionGrammar; history: Array<SessionAction> }
>

/**
 * Each grammar's replay names: its campaign, and the paired formulations that
 * apply to it (key independence without full row updates, seed order with
 * seeds).
 */
const grammars = [
  {
    grammar: flatGrammar,
    property: `sync-metadata-session.flat`,
    paired: {
      'hold-invariance': `sync-metadata-session.flat.hold-invariance`,
      'key-independence': `sync-metadata-session.flat.key-independence`,
    },
    seed: 2_220_001,
  },
  {
    grammar: nestedGrammar,
    property: `sync-metadata-session.nested`,
    paired: {
      'hold-invariance': `sync-metadata-session.nested.hold-invariance`,
      'key-independence': `sync-metadata-session.nested.key-independence`,
    },
    seed: 2_220_002,
  },
  {
    grammar: seedGrammar,
    property: `sync-metadata-session.seeds`,
    paired: {
      'hold-invariance': `sync-metadata-session.seeds.hold-invariance`,
      'key-independence': `sync-metadata-session.seeds.key-independence`,
      'seed-order': `sync-metadata-session.seeds.seed-order`,
    },
    seed: 2_220_003,
    // A seed beneath an open update needs both on one row, and duplicate
    // inserts share the grammar's weight, so it runs more fixed histories.
    runs: 150,
  },
  {
    grammar: seedFullGrammar,
    property: `sync-metadata-session.seeds-full`,
    paired: {
      'hold-invariance': `sync-metadata-session.seeds-full.hold-invariance`,
      'seed-order': `sync-metadata-session.seeds-full.seed-order`,
    },
    seed: 2_220_004,
  },
  {
    grammar: nestedSeedGrammar,
    property: `sync-metadata-session.nested-seeds`,
    paired: {
      'hold-invariance': `sync-metadata-session.nested-seeds.hold-invariance`,
      'key-independence': `sync-metadata-session.nested-seeds.key-independence`,
      'seed-order': `sync-metadata-session.nested-seeds.seed-order`,
    },
    seed: 2_220_005,
  },
  {
    grammar: nestedConflictGrammar,
    property: `sync-metadata-session.nested-conflicts`,
    paired: {
      'hold-invariance': `sync-metadata-session.nested-conflicts.hold-invariance`,
      'key-independence': `sync-metadata-session.nested-conflicts.key-independence`,
    },
    seed: 2_220_006,
    // Invalidation needs an outer insert, an inner write to the same row,
    // and the inner commit, so this grammar runs more fixed histories.
    runs: 450,
  },
] as const

/**
 * Declared reach (ORC-015): the states each grammar's laws need, and how many
 * fixed-campaign histories must enter each. A seed over a source insert or an
 * open update needs both on one row, and a write to an invalid transaction
 * needs an invalidation first, so those minimums are lower.
 */
const common = 11
const rare = 5
const declaredReach: Record<string, Array<[string, number]>> = {
  flat: [
    [`read with two held transactions`, common],
    [`open transaction over a held transaction`, common],
    [`truncate during a hold`, common],
    [`duplicate source insert`, rare],
  ],
  nested: [
    [`nested commit`, common],
    [`nested commit during a hold`, common],
    [`abort keeps an inner commit`, common],
    [`open transaction over a held transaction`, common],
  ],
  seeds: [
    [`seed`, common],
    [`seed under a source insert`, rare],
    [`seed under an open update`, rare],
    [`open transaction over a held transaction`, common],
    [`duplicate source insert over a seeded row`, rare],
    [`duplicate source insert during a hold`, rare],
  ],
  'nested-seeds': [
    [`seed`, common],
    [`nested commit`, common],
    [`inner write to an enclosing row`, rare],
    [`seed under a source insert`, rare],
    [`seed under an open update`, rare],
    [`duplicate source insert over a seeded row`, rare],
  ],
  'seeds-full': [
    [`seed`, common],
    [`seed under a source insert`, rare],
    [`open transaction over a held transaction`, common],
  ],
  'nested-conflicts': [
    [`inner write to an enclosing row`, common],
    [`nested commit during a hold`, common],
    [`transaction invalidated`, common],
    [`commit of an invalid transaction`, common],
    [`write to an invalid transaction`, rare],
  ],
}

describe(`sync metadata session oracle`, () => {
  it(`derives the named witnesses from the laws`, async () => {
    oracleRoute(`fixed history`)
    type Observation = ReturnType<SessionModel[`observe`]>
    const at = async (name: keyof typeof witnesses, step: number) => {
      const { grammar, history } = witnesses[name]
      return (await modelCheckpoints(grammar, history)).get(step) as Observation
    }
    // Wrong answer on 30175be48: the held cursor reads as absent.
    const held = await at(`heldCursor`, 6)
    expect(held.collection.cursor).toEqual({ s: 2 })
    expect(held.base[1]).toBe(absentMarker)
    // Wrong answer: the open transaction hides every held write.
    const open = await at(`openOverHeld`, 5)
    expect(open.rowMetadata[1]).toEqual({ s: 2 })
    expect(open.prefixList).toEqual([[`gc:a`, { s: 3 }]])
    // Wrong answer under closed nesting: the outer abort undoes the inner
    // commit, and its receipt waits for the outer commit.
    const innerCommitted = await at(`outerAbortKeepsInnerCommit`, 3)
    const insertedRow = { id: 1, v: { s: 2 }, m: { s: 2 } }
    expect(innerCommitted.rowMetadata[1]).toEqual({ s: 2 })
    expect(innerCommitted.base[1]).toEqual(insertedRow)
    expect(innerCommitted.receipts).toEqual([`applied`])
    const outerAborted = await at(`outerAbortKeepsInnerCommit`, 4)
    expect(outerAborted.rowMetadata[1]).toEqual({ s: 2 })
    expect(outerAborted.base[1]).toEqual(insertedRow)
    // Wrong answers: issue order (the inner write wins), and on 30175be48 a
    // held inner commit read over the open outer write and applied after it.
    expect((await at(`commitOrderDuringHold`, 4)).rowMetadata[1]).toEqual({
      s: 4,
    })
    expect((await at(`commitOrderDuringHold`, 5)).rowMetadata[1]).toEqual({
      s: 2,
    })
    const released = await at(`commitOrderDuringHold`, 7)
    expect(released.rowMetadata[1]).toEqual({ s: 2 })
    expect(released.receipts).toEqual([`applied`, `applied`])
    // Wrong answer on 30175be48: the outer transaction cannot write after an
    // inner one commits during a hold.
    const continued = await at(`outerContinuesAfterInnerDuringHold`, 6)
    expect(continued.rowMetadata).toEqual({ 1: { s: 3 }, 2: { s: 5 } })
    expect(continued.receipts).toEqual([`pending`, `pending`])
    // Wrong answer under closed nesting: the inner truncate waits for the
    // outer commit.
    const innerTruncated = await at(`innerTruncateAppliesAtItsCommit`, 7)
    expect(innerTruncated.base[1]).toBe(absentMarker)
    expect(innerTruncated.rowMetadata[1]).toBe(absentMarker)
    expect(innerTruncated.receipts).toEqual([`applied`, `applied`])
    expect((await at(`innerTruncateAppliesAtItsCommit`, 8)).receipts).toEqual([
      `applied`,
      `applied`,
      `pending`,
    ])
    // Wrong answers: replay makes the re-insert a duplicate and invalidates
    // the source's transaction, so only the late seed remains; or the
    // re-insert merges and keeps the late seed's field.
    const reinserted = await at(`seedUnderOpenReinsert`, 5)
    expect(reinserted.base[1]).toEqual({ id: 1, v: { s: 2 } })
    expect(reinserted.receipts).toEqual([`applied`])
    // Wrong answer: the seed's metadata replaces the source's metadata write.
    const seeded = await at(`seedUnderMetadataOnlyWrite`, 3)
    expect(seeded.rowMetadata[1]).toEqual({ s: 1 })
    expect(seeded.base[1]).toEqual({ id: 1, v: { s: 3 }, seeded: { s: 3 } })
    // Wrong answer on 30175be48: the open insert becomes an update over the
    // late seed, so the seed's metadata and other field survive it.
    const underOpen = await at(`seedUnderOpenInsert`, 2)
    expect(underOpen.rowMetadata[1]).toBe(absentMarker)
    expect(underOpen.base[1]).toEqual({ id: 1, v: { s: 2 }, seeded: { s: 2 } })
    const openCommitted = await at(`seedUnderOpenInsert`, 3)
    expect(openCommitted.rowMetadata[1]).toBe(absentMarker)
    expect(openCommitted.base[1]).toEqual({ id: 1, v: { s: 1 } })
    const afterCommit = await at(`seedAfterCommittedInsert`, 3)
    expect(afterCommit.rowMetadata[1]).toBe(absentMarker)
    expect(afterCommit.base[1]).toEqual({ id: 1, v: { s: 1 } })
    // Wrong answer on 30175be48: core counts it as an equal re-insert.
    const equalInsert = await at(`equalInsertOverSeed`, 2)
    expect(equalInsert.rowMetadata[1]).toBe(absentMarker)
    const truncated = await at(`openTruncateHidesHeldRow`, 5)
    expect(truncated.rowMetadata[1]).toBe(absentMarker)
    const deleted = await at(`openDeleteHidesHeldListEntry`, 5)
    expect(deleted.list).toEqual([])
    expect(deleted.prefixList).toEqual([])
    const boundary = await at(`prefixBoundary`, 2)
    expect(boundary.prefixList).toEqual([[`gc:`, { s: 2 }]])
    expect(boundary.list).toEqual([
      [`gc`, { s: 1 }],
      [`gc:`, { s: 2 }],
    ])
    const equalAfterFullUpdate = await at(
      `fullUpdateThenEqualInsertDuringHold`,
      8,
    )
    expect(equalAfterFullUpdate.rowMetadata[1]).toEqual({ s: 1 })
    expect(equalAfterFullUpdate.base[1]).toEqual({
      id: 1,
      v: { s: 1 },
      m: { s: 1 },
    })
    const laterSeed = await at(`laterSeedReplacesSeed`, 1)
    expect(laterSeed.rowMetadata[1]).toEqual({ s: 1 })
    expect(laterSeed.base[1]).toEqual({ id: 1, v: { s: 1 } })
    // Wrong answer on 30175be48: the late seed is dropped with its metadata.
    const lateSeed = await at(`partialUpdateThenLateSeed`, 4)
    expect(lateSeed.rowMetadata[1]).toEqual({ s: 4 })
    expect(lateSeed.base[1]).toEqual({ id: 1, v: { s: 2 }, seeded: { s: 0 } })
    // Wrong answer on 30175be48: the earlier seed's metadata survives.
    const bare = await at(`bareLaterSeedClearsMetadata`, 1)
    expect(bare.rowMetadata[1]).toBe(absentMarker)
    expect(bare.base[1]).toEqual({ id: 1, v: { s: 1 }, seeded: { s: 1 } })
    // Wrong answer on 30175be48: the insert merges over the seed as an update.
    const replacedSeed = await at(`insertOverSeedReplaces`, 3)
    expect(replacedSeed.rowMetadata[1]).toBe(absentMarker)
    expect(replacedSeed.base[1]).toEqual({ id: 1, v: { s: 2 } })
    const merged = await at(`updateOverSeed`, 3)
    expect(merged.rowMetadata[1]).toEqual({ s: 0 })
    expect(merged.base[1]).toEqual({ id: 1, v: { s: 2 }, seeded: { s: 0 } })
    const replaced = await at(`updateOverSeedFullRows`, 3)
    expect(replaced.rowMetadata[1]).toEqual({ s: 0 })
    expect(replaced.base[1]).toEqual({ id: 1, v: { s: 2 } })
  })

  it.each(Object.entries(witnesses))(
    `keeps the session law on witness %s`,
    async (_name, { grammar, history }) => {
      oracleRoute(`fixed history`)
      await assertSessionHistory(grammar, history)
    },
  )
})

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

/**
 * Grammar ablation: each generated axis exists for a regime. Removing the
 * axis must remove its regime from the fixed campaign, or the axis adds
 * nothing the laws need.
 */
describe(`sync metadata session grammar ablation`, () => {
  const ablations: Array<{
    grammar: SessionGrammar
    drop: (action: SessionAction) => boolean
    regime: string
  }> = [
    {
      grammar: flatGrammar,
      drop: (x) => x.type === `hold`,
      regime: `read with two held transactions`,
    },
    {
      grammar: flatGrammar,
      drop: (x) => x.type === `truncate`,
      regime: `truncate during a hold`,
    },
    {
      grammar: flatGrammar,
      drop: (x) => x.type === `reinsert`,
      regime: `equal re-insert`,
    },
    {
      grammar: flatGrammar,
      drop: (x) => x.type === `collectionSet` && x.undefinedValue === true,
      regime: `undefined collection value`,
    },
    {
      grammar: nestedGrammar,
      drop: (x) => x.type === `cancel`,
      regime: `abort keeps an inner commit`,
    },
    {
      grammar: { ...nestedGrammar, maxDepth: 1 },
      drop: () => false,
      regime: `nested commit`,
    },
    { grammar: seedGrammar, drop: (x) => x.type === `seed`, regime: `seed` },
  ]
  it.each(ablations.map((ablation) => [ablation.regime, ablation] as const))(
    `removing the axis for %s removes that regime`,
    (_regime, { grammar, drop, regime }) => {
      oracleRoute(`fixed seed`)
      const count = (filter: (action: SessionAction) => boolean) =>
        fc
          .sample(sessionHistoryArbitrary(grammar), {
            seed: 2_220_100,
            numRuns: 200,
          })
          .filter((history) =>
            historyRegimes(grammar, history.filter(filter)).has(regime),
          ).length
      const fullGrammar =
        grammar.maxDepth === 1 && regime === `nested commit`
          ? nestedGrammar
          : grammar
      const full = fc
        .sample(sessionHistoryArbitrary(fullGrammar), {
          seed: 2_220_100,
          numRuns: 200,
        })
        .filter((history) =>
          historyRegimes(fullGrammar, history).has(regime),
        ).length
      expect(full).toBeGreaterThan(10)
      expect(count((action) => !drop(action))).toBe(0)
    },
  )
})

/**
 * Second formulation: production against itself, with and without holds.
 * It does not consult the model's reads, so it cannot share a fault in them.
 */
describe(`sync metadata session hold invariance`, () => {
  for (const { grammar, paired, seed } of grammars) {
    const invariance = paired[`hold-invariance`]
    const run = async (history: Array<SessionAction>) => {
      const mismatch = await runHoldInvariance(grammar, history, () =>
        createCoreDriver(grammar.fullRows),
      )
      if (mismatch)
        rejectAt(
          `sync metadata session comparison`,
          new Error(describeMismatch(history, mismatch)),
        )
    }
    oracleProperty<Array<SessionAction>, Verdict>({
      id: invariance,
      law: {
        owner: `Sync metadata session hold invariance`,
        statement: `Source reads are independent of publication holds.`,
        authority: `The independent session laws and runHoldInvariance relation in sync-metadata-session-oracle.ts.`,
        limits: `The existing bounded ${grammar.name} action grammar and core DbClient driver.`,
      },
      histories: {
        arbitrary: sessionHistoryArbitrary(grammar),
        runs: 50,
        fixedSeeds: [seed + 100],
      },
      model: recordedAssertionJudgment,
      driver: (history, observe) =>
        recordAssertionJudgment(invariance, history, observe, () =>
          run(history),
        ),
      check: forwardAssertionJudgment,
      timeout: 60_000,
    })
  }
})

/**
 * Two more production-against-production formulations. Key independence
 * removes every action on row 2; seed order performs every seed first.
 */
const pairedFormulations = [
  {
    suffix: `key-independence`,
    title: `keeps row 1 independent of row 2`,
    run: runKeyIndependence,
    grammars: grammars.filter((entry) => `key-independence` in entry.paired),
  },
  {
    suffix: `seed-order`,
    title: `keeps outcomes independent of seed arrival`,
    run: runSeedOrderInvariance,
    grammars: grammars.filter((entry) => `seed-order` in entry.paired),
  },
] as const

describe(`sync metadata session paired formulations`, () => {
  for (const formulation of pairedFormulations)
    for (const { grammar, paired, seed } of formulation.grammars) {
      const name = (paired as Record<string, string>)[formulation.suffix]!
      const run = async (history: Array<SessionAction>) => {
        const mismatch = await formulation.run(grammar, history, () =>
          createCoreDriver(grammar.fullRows),
        )
        if (mismatch)
          rejectAt(
            `sync metadata session comparison`,
            new Error(describeMismatch(history, mismatch)),
          )
      }
      oracleProperty<Array<SessionAction>, Verdict>({
        id: name,
        law: {
          owner: `Sync metadata session paired formulations`,
          statement: formulation.title,
          authority: `The independent key-independence and seed-order relations in sync-metadata-session-oracle.ts.`,
          limits: `The unchanged ${grammar.name} action grammar and receiving core path.`,
        },
        histories: {
          arbitrary: sessionHistoryArbitrary(grammar),
          runs: 50,
          fixedSeeds: [seed + 200],
        },
        model: recordedAssertionJudgment,
        driver: (history, observe) =>
          recordAssertionJudgment(name, history, observe, () => run(history)),
        check: forwardAssertionJudgment,
        timeout: 60_000,
      })
    }
})

describe(`sync metadata session campaigns`, () => {
  for (const entry of grammars)
    describe(entry.grammar.name, () => {
      const { grammar, property, seed } = entry
      const states = declaredReach[grammar.name]!
      let counts = new Map<string, number>()
      let fixedCampaign = false
      const histories = {
        arbitrary: sessionHistoryArbitrary(grammar),
        runs: 100,
        fixedSeeds: [seed],
        measured: states.map(([state]) => state),
      }
      // Native registration reads the budget when the campaign executes. Keep
      // the original fixed150/450 exceptions and the random100 budget.
      beforeEach(({ task }) => {
        fixedCampaign = task.name.startsWith(`fixed seed `)
        histories.runs = fixedCampaign && `runs` in entry ? entry.runs : 100
        counts = new Map(states.map(([state]) => [state, 0]))
      })
      afterEach(({ task }) => {
        if (!fixedCampaign || task.result?.state === `fail`) return
        process.stdout.write(
          `${property} fixed minimums ${JSON.stringify(Object.fromEntries(counts))}\n`,
        )
        if (oracleReplayRequested()) return
        for (const [state, minimum] of states)
          expect(
            counts.get(state),
            `${property}: ${state} history minimum`,
          ).toBeGreaterThanOrEqual(minimum)
      })
      oracleProperty<Array<SessionAction>, Verdict>({
        id: property,
        law: {
          owner: `Sync metadata session`,
          statement: `Source reads include accepted and open writes in the independent session order, while rows and receipts follow atomic application.`,
          authority: `The borrowed consistency laws, maintainer decisions and independent model in sync-metadata-session-oracle.ts.`,
          limits: `The unchanged ${grammar.name} grammar, core hold and DbClient hydration boundary.`,
        },
        histories,
        model: recordedAssertionJudgment,
        driver: (history, observe) =>
          recordAssertionJudgment(property, history, observe, async () => {
            const regimes = historyRegimes(grammar, history)
            for (const [state] of states)
              if (regimes.has(state)) {
                observe(`reach`, state)
                if (fixedCampaign) counts.set(state, counts.get(state)! + 1)
              }
            await assertSessionHistory(grammar, history)
          }),
        check: forwardAssertionJudgment,
        timeout: 120_000,
      })
    })
})
