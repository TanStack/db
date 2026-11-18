import { afterEach, beforeEach, describe, expect } from 'vitest'
import { DbClient, collectionOptions } from '../src/client.js'
import { DuplicateKeySyncError } from '../src/errors.js'
import { oracleReplayRequested } from './oracle-config.js'
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
import { witnesses } from './sync-metadata-session-witness-grammar-oracle.js'
import type { Verdict } from './oracle-property.js'
import type {
  ReceiptState,
  SessionAction,
  SessionDriver,
  SessionGrammar,
} from './sync-metadata-session-oracle.js'
import type { SyncConfig } from '../src/types.js'

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
  // Each named witness, through the same driver and comparison as the
  // generated campaigns. The witnesses span several grammars, so they run as
  // one enumerated property, named by witness.
  oracleProperty({
    id: `sync-metadata-session.witnesses`,
    law: {
      statement: `Source reads include accepted and open writes in the independent session order, while rows and receipts follow atomic application.`,
      authority: `The borrowed consistency laws, maintainer decisions and independent model in sync-metadata-session-oracle.ts.`,
      limits: `The named witnesses in sync-metadata-session-witness-grammar-oracle.ts, each in its own grammar, with the core hold and DbClient hydration boundary.`,
    },
    owns: [`src/client.ts`, `src/collection/sync.ts`],
    histories: Object.keys(witnesses) as Array<keyof typeof witnesses>,
    label: (name) => `keeps the session law on witness ${name}`,
    resolve: (name) => ({ name, ...witnesses[name] }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(
        `sync-metadata-session.witnesses`,
        plan,
        observe,
        () => assertSessionHistory(plan.grammar, plan.history),
      ),
    check: forwardAssertionJudgment,
  })
})

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

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
        statement: `Source reads are independent of publication holds.`,
        authority: `The independent session laws and runHoldInvariance relation in sync-metadata-session-oracle.ts.`,
        limits: `The existing bounded ${grammar.name} action grammar and core DbClient driver.`,
      },
      // What this oracle owns: the gap report judges the DbClient Collection's sync
      // path, which applies sources, seeds, holds, and commits, by this file's tests.
      // The contract, model, and grammar live in sync-metadata-session-oracle.ts.
      owns: [`src/client.ts`, `src/collection/sync.ts`],
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
          statement: formulation.title,
          authority: `The independent key-independence and seed-order relations in sync-metadata-session-oracle.ts.`,
          limits: `The unchanged ${grammar.name} action grammar and receiving core path.`,
        },
        owns: [`src/client.ts`, `src/collection/sync.ts`],
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
          statement: `Source reads include accepted and open writes in the independent session order, while rows and receipts follow atomic application.`,
          authority: `The borrowed consistency laws, maintainer decisions and independent model in sync-metadata-session-oracle.ts.`,
          limits: `The unchanged ${grammar.name} grammar, core hold and DbClient hydration boundary.`,
        },
        owns: [`src/client.ts`, `src/collection/sync.ts`],
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
