import { isDeepStrictEqual } from 'node:util'
import { fc } from '@fast-check/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCollection } from '@tanstack/db'
import { ShapeStream } from '@electric-sql/client'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { electricCollectionOptions } from '../src/electric'
import type { Message, Row } from '@electric-sql/client'
import type {
  PersistedCollectionCoordinator,
  PersistedTx,
  PersistenceAdapter,
  ProtocolEnvelope,
} from '../../db-sqlite-persistence-core/src'
import type { ElectricCollectionUtils, ElectricSyncMode } from '../src/electric'

/**
 * # Does persisted Electric recovery publish only complete source snapshots?
 *
 * Contract and source: persisted dual-source readiness, authoritative truncate
 * replacement, and Electric resume/reset semantics. SQLite hydration and the
 * upstream source are independent startup authorities; a valid resume may merge
 * deltas, while an invalid resume must replace omitted cached rows only when the
 * new source snapshot is complete.
 *
 * The fixture's `rows` and `metadata` Maps model durable state independently of
 * the Collection. The generated property's `expected` Map models complete public
 * and durable rows. `expectWholeRecoveryTrace` allows only monotonic movement
 * through the explicitly listed public snapshots; it does not copy production's
 * replay state machine.
 *
 * Histories cross eager, progressive, and on-demand sync modes; external
 * coordinator publication and ShapeStream deltas; full reload and delta paths;
 * insert, update, and delete; valid and invalid resume; empty and non-empty
 * replacement; and hydration before or after the final source commit.
 *
 * The production driver is `persistedCollectionOptions` composed with
 * `electricCollectionOptions` and mocked installed ShapeStream callbacks.
 * Observation cuts include coordinator metadata publication, `up-to-date`,
 * restart, resume metadata, and exact public and durable rows.
 *
 * Normal runs retain one fixed campaign and add one seedless campaign over the
 * same property. Set both TANSTACK_DB_ELECTRIC_RECOVERY_ORACLE_SEED and
 * TANSTACK_DB_ELECTRIC_RECOVERY_ORACLE_PATH to run only that replay. The named
 * trace fault control rejects the plausible wrong answer that omits an observed
 * stale publication. This is a fixed matrix plus a bounded generated property
 * over a mocked ShapeStream, not a live Electric service or PowerSync authority.
 */

type Item = Row & { id: number; name: string; stable: string }
type Subscriber = (messages: Array<Message<Item>>) => void
type Exposure = { cut: string; rows: Array<Item> }
type RecoveryCommand = {
  id: number
  name: string
  deleted: boolean
  fullReload: boolean
  splitCommitControl: boolean
}
type RecoveryHistory = {
  startupOrder: `hydrate-before-ready` | `ready-before-hydrate`
  commands: Array<RecoveryCommand>
}
type RecoveryCampaign = {
  name: `fixed` | `random` | `replay`
  seed: number | undefined
  path: string | undefined
}

const FIXED_RECOVERY_SEED = 1_869_1659
const RECOVERY_SEED_ENV = `TANSTACK_DB_ELECTRIC_RECOVERY_ORACLE_SEED`
const RECOVERY_PATH_ENV = `TANSTACK_DB_ELECTRIC_RECOVERY_ORACLE_PATH`
const RECOVERY_RUNS_ENV = `TANSTACK_DB_ELECTRIC_RECOVERY_ORACLE_RUNS`

function readRecoveryCampaigns(
  environment: Record<string, string | undefined>,
): { campaigns: Array<RecoveryCampaign>; numRuns: number } {
  const seedText = environment[RECOVERY_SEED_ENV]
  const path = environment[RECOVERY_PATH_ENV]
  const runsText = environment[RECOVERY_RUNS_ENV] ?? `20`
  const numRuns = Number(runsText)
  if (
    runsText.trim() === `` ||
    !Number.isSafeInteger(numRuns) ||
    numRuns <= 0
  ) {
    throw new Error(`${RECOVERY_RUNS_ENV} must be a positive integer`)
  }
  if (seedText === undefined && path === undefined) {
    return {
      campaigns: [
        { name: `fixed`, seed: FIXED_RECOVERY_SEED, path: undefined },
        { name: `random`, seed: undefined, path: undefined },
      ],
      numRuns,
    }
  }
  if (seedText === undefined) {
    throw new Error(`${RECOVERY_PATH_ENV} requires ${RECOVERY_SEED_ENV}`)
  }
  if (path === undefined) {
    throw new Error(`${RECOVERY_SEED_ENV} requires ${RECOVERY_PATH_ENV}`)
  }
  const seed = Number(seedText)
  if (seedText.trim() === `` || !Number.isSafeInteger(seed)) {
    throw new Error(`${RECOVERY_SEED_ENV} must be an integer`)
  }
  if (path.trim() === `` || !/^\d+(?::\d+)*$/.test(path)) {
    throw new Error(
      `${RECOVERY_PATH_ENV} must contain colon-separated nonnegative integers`,
    )
  }
  return {
    campaigns: [{ name: `replay`, seed, path }],
    numRuns,
  }
}

/**
 * The pinned examples reconstruct the retained insert/delete/full-reload
 * witness and both startup orders. Removing startupOrder loses the independent
 * ready/hydrate boundary; removing delete or fullReload loses membership or
 * peer-reload transitions; removing splitCommitControl loses legal callback
 * partitioning. IDs 2..4 permit same-key and disjoint histories, names include
 * empty/bounded strings, and 1..8 commands include the one-step marginal case.
 * A change batch without up-to-date/subset-end is intentionally excluded: it is
 * open protocol state, not a completed Electric publication.
 */
const recoveryHistoryArbitrary = fc.record({
  startupOrder: fc.constantFrom(
    `hydrate-before-ready` as const,
    `ready-before-hydrate` as const,
  ),
  commands: fc.array(
    fc.record({
      id: fc.integer({ min: 2, max: 4 }),
      name: fc.string({ maxLength: 8 }),
      deleted: fc.boolean(),
      fullReload: fc.boolean(),
      splitCommitControl: fc.boolean(),
    }),
    { minLength: 1, maxLength: 8 },
  ),
})

const recoveryExamples: Array<[RecoveryHistory]> = [
  [
    {
      startupOrder: `hydrate-before-ready`,
      commands: [
        {
          id: 2,
          name: `external`,
          deleted: false,
          fullReload: false,
          splitCommitControl: false,
        },
        {
          id: 2,
          name: `removed`,
          deleted: true,
          fullReload: true,
          splitCommitControl: true,
        },
      ],
    },
  ],
  [
    {
      startupOrder: `ready-before-hydrate`,
      commands: [
        {
          id: 3,
          name: `ready-first`,
          deleted: false,
          fullReload: true,
          splitCommitControl: false,
        },
      ],
    },
  ],
]

const recoveryConfig = readRecoveryCampaigns(process.env)

function recoveryCampaignParameters(campaign: RecoveryCampaign) {
  return {
    numRuns: recoveryConfig.numRuns,
    examples: recoveryExamples,
    ...(campaign.seed === undefined ? {} : { seed: campaign.seed }),
    ...(campaign.path === undefined ? {} : { path: campaign.path }),
  }
}

function expectWholeRecoveryTrace(
  entries: Array<Exposure>,
  allowed: Array<Array<Item>>,
) {
  let position = 0
  for (const entry of entries) {
    while (
      position < allowed.length &&
      !isDeepStrictEqual(entry.rows, allowed[position])
    )
      position++
    expect(position, JSON.stringify({ entry, allowed, entries })).toBeLessThan(
      allowed.length,
    )
  }
}
const subscribers: Array<Subscriber> = []
const mockSubscribe = vi.fn((callback: Subscriber) => {
  subscribers.push(callback)
  return vi.fn()
})

vi.mock(`@electric-sql/client`, async () => ({
  ...(await vi.importActual(`@electric-sql/client`)),
  ShapeStream: vi.fn(() => ({
    subscribe: mockSubscribe,
    requestSnapshot: vi.fn().mockResolvedValue(undefined),
    fetchSnapshot: vi.fn().mockResolvedValue({ metadata: {}, data: [] }),
    forceDisconnectAndRefresh: vi.fn().mockResolvedValue(undefined),
    isUpToDate: false,
    shapeHandle: `shape-current`,
    lastOffset: `20_0`,
  })),
}))

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

const oldRow: Item = { id: 1, name: `old`, stable: `stable-1` }
const freshRow: Item = { id: 2, name: `fresh`, stable: `stable-2` }
const upToDate: Message<Item> = { headers: { control: `up-to-date` } }

function change(
  operation: `insert` | `update` | `delete`,
  value: Partial<Item>,
): Message<Item> {
  return { key: String(value.id), value: value as Item, headers: { operation } }
}

function fixture(
  syncMode: ElectricSyncMode,
  coordinator?: PersistedCollectionCoordinator,
) {
  const rows = new Map<string | number, Item>([[oldRow.id, { ...oldRow }]])
  const metadata = new Map<string, unknown>([
    [
      `electric:resume`,
      {
        kind: `resume`,
        requiresTagState: false,
        offset: `10_0`,
        handle: `shape-old`,
        shapeId: `{"params":{"table":"test_table"},"url":"http://test-url"}`,
        updatedAt: 1,
      },
    ],
  ])
  let hydrationGate = Promise.resolve()
  const commits: Array<PersistedTx> = []
  const adapter: PersistenceAdapter = {
    loadSubset: () => {
      const snapshot = Array.from(rows, ([key, value]) => ({
        key,
        value: { ...value },
      }))
      return hydrationGate.then(() => snapshot)
    },
    loadCollectionMetadata: () =>
      Promise.resolve(
        Array.from(metadata, ([key, value]) => ({
          key,
          value: structuredClone(value),
        })),
      ),
    applyCommittedTx: (_collectionId, tx) => {
      for (const mutation of tx.collectionMetadataMutations ?? []) {
        if (mutation.type === `delete`) metadata.delete(mutation.key)
        else metadata.set(mutation.key, structuredClone(mutation.value))
      }
      if (tx.truncate) rows.clear()
      for (const mutation of tx.mutations) {
        if (mutation.type === `delete`) rows.delete(mutation.key)
        else {
          rows.set(mutation.key, {
            ...rows.get(mutation.key),
            ...structuredClone(mutation.value),
          } as Item)
        }
      }
      commits.push(structuredClone(tx))
      return Promise.resolve()
    },
    ensureIndex: () => Promise.resolve(),
  }
  const collection = createCollection(
    persistedCollectionOptions<
      Item,
      string | number,
      never,
      ElectricCollectionUtils<Item>
    >({
      ...electricCollectionOptions<Item>({
        id: `persisted-recovery-${syncMode}`,
        shapeOptions: {
          url: `http://test-url`,
          params: { table: `test_table` },
        },
        syncMode,
        getKey: (row) => row.id,
        startSync: false,
      }),
      persistence: { adapter, coordinator },
    }),
  )
  const publicRows = () =>
    Array.from(collection.values(), ({ id, name, stable }) => ({
      id,
      name,
      stable,
    })).sort((a, b) => a.id - b.id)
  const durableRows = () =>
    structuredClone([...rows.values()].sort((a, b) => a.id - b.id))
  const exposures: Array<Exposure> = []
  const record = (cut: string) => {
    exposures.push({ cut, rows: structuredClone(publicRows()) })
  }
  let stopObserving = () => {}
  const start = () => {
    stopObserving()
    collection.startSyncImmediate()
    const subscription = collection.subscribeChanges(() => record(`event`), {
      includeInitialState: false,
    })
    stopObserving = () => subscription.unsubscribe()
    record(`started`)
  }
  return {
    collection,
    rows,
    metadata,
    commits,
    publicRows,
    durableRows,
    exposures,
    record,
    start,
    stopObserving: () => stopObserving(),
    pauseHydration: (gate: Promise<void>) => {
      hydrationGate = gate
    },
  }
}

const scenarios = ([`eager`, `progressive`] as const).flatMap((syncMode) =>
  [false, true].flatMap((empty) =>
    ([`before`, `after`] as const).map((hydration) => ({
      syncMode,
      empty,
      hydration,
    })),
  ),
)

describe(`persisted Electric recovery laws`, () => {
  beforeEach(() => {
    subscribers.length = 0
    vi.clearAllMocks()
  })

  it(`selects only a validated seed-and-path replay when requested`, () => {
    expect(
      readRecoveryCampaigns({
        [RECOVERY_SEED_ENV]: `42`,
        [RECOVERY_PATH_ENV]: `0:3:1`,
        [RECOVERY_RUNS_ENV]: `7`,
      }),
    ).toEqual({
      campaigns: [{ name: `replay`, seed: 42, path: `0:3:1` }],
      numRuns: 7,
    })
  })

  it.each([
    [{ [RECOVERY_PATH_ENV]: `0` }, `requires ${RECOVERY_SEED_ENV}`],
    [{ [RECOVERY_SEED_ENV]: `42` }, `requires ${RECOVERY_PATH_ENV}`],
    [
      { [RECOVERY_SEED_ENV]: `nope`, [RECOVERY_PATH_ENV]: `0` },
      `must be an integer`,
    ],
    [
      { [RECOVERY_SEED_ENV]: `42`, [RECOVERY_PATH_ENV]: `0:-1` },
      `colon-separated nonnegative integers`,
    ],
    [{ [RECOVERY_RUNS_ENV]: `0` }, `must be a positive integer`],
  ])(
    `rejects an invalid recovery replay configuration`,
    (environment, text) => {
      expect(() => readRecoveryCampaigns(environment)).toThrow(text)
    },
  )

  it(`rejects the wrong whole-trace answer that omits a stale intermediate publication`, async () => {
    const f = fixture(`eager`)
    try {
      f.start()
      await vi.waitFor(() => expect(f.publicRows()).toEqual([oldRow]))
      await vi.waitFor(() => expect(subscribers).toHaveLength(1))
      const cut = f.exposures.length
      f.record(`before`)
      subscribers[0]!([change(`update`, { id: 1, name: `wrong` }), upToDate])
      subscribers[0]!([change(`update`, { id: 1, name: `correct` }), upToDate])
      f.record(`repaired`)
      const correct = [{ ...oldRow, name: `correct` }]
      expect(f.publicRows()).toEqual(correct)
      const entries = f.exposures.slice(cut)
      expect(entries[0]!.rows).toEqual([oldRow])
      expect(
        entries.some(
          ({ cut: kind, rows }) =>
            kind === `event` && rows[0]?.name === `wrong`,
        ),
      ).toBe(true)
      const wrongAnswer = [[oldRow], correct]
      expect(() => expectWholeRecoveryTrace(entries, wrongAnswer)).toThrow()
      expectWholeRecoveryTrace(entries, [
        [oldRow],
        [{ ...oldRow, name: `wrong` }],
        correct,
      ])
    } finally {
      f.stopObserving()
      await f.collection.cleanup()
    }
  })

  function externalPublisher() {
    let receive: ((message: ProtocolEnvelope<unknown>) => void) | undefined
    let id = ``
    let term = 100
    const coordinator: PersistedCollectionCoordinator = {
      getNodeId: () => `local`,
      subscribe: (collectionId, callback) => {
        id = collectionId
        receive = callback
        return () => {
          receive = undefined
        }
      },
      publish: () => {},
      isLeader: () => true,
      ensureLeadership: () => Promise.resolve(),
      requestEnsurePersistedIndex: () => Promise.resolve(),
      requestEnsureRemoteSubset: () => Promise.resolve(),
    }
    return {
      coordinator,
      publish: (
        row: Item,
        deleted: boolean,
        fullReload: boolean,
        metadata: Map<string, unknown>,
      ) => {
        const revision = term++
        metadata.set(`oracle:publication`, revision)
        receive?.({
          v: 1,
          dbName: id,
          collectionId: id,
          senderId: `peer`,
          ts: Date.now(),
          payload: {
            type: `tx:committed`,
            term: revision,
            seq: 1,
            txId: `peer-${term}`,
            latestRowVersion: term,
            requiresFullReload: fullReload,
            changedRows: deleted ? [] : [{ key: row.id, value: row }],
            deletedKeys: deleted ? [row.id] : [],
            collectionMetadataMutations: [
              { type: `set`, key: `oracle:publication`, value: revision },
            ],
          },
        })
        return revision
      },
    }
  }

  it.each(
    ([`eager`, `progressive`, `on-demand`] as const).flatMap((syncMode) =>
      [false, true].map((fullReload) => ({ syncMode, fullReload })),
    ),
  )(
    `$syncMode merges stream deltas into independently published rows, fullReload=$fullReload`,
    async ({ syncMode, fullReload }) => {
      const peer = externalPublisher()
      const f = fixture(syncMode, peer.coordinator)
      try {
        f.start()
        await vi.waitFor(() => expect(subscribers).toHaveLength(1))
        if (syncMode === `on-demand`) await f.collection._sync.loadSubset({})
        await vi.waitFor(() => expect(f.publicRows()).toEqual([oldRow]))
        subscribers[0]!([upToDate])
        const cut = f.exposures.length
        f.record(`before peer`)
        f.rows.set(freshRow.id, structuredClone(freshRow))
        peer.publish(freshRow, false, fullReload, f.metadata)
        f.record(`after peer delivery`)
        await vi.waitFor(() =>
          expect(f.publicRows()).toEqual([oldRow, freshRow]),
        )
        f.record(`peer settled`)
        expectWholeRecoveryTrace(f.exposures.slice(cut), [
          [oldRow],
          [oldRow, freshRow],
        ])
        const streamCut = f.exposures.length
        f.record(`before stream delta`)
        subscribers[0]!([
          change(`update`, { id: freshRow.id, name: `changed` }),
          upToDate,
        ])
        const expected = [oldRow, { ...freshRow, name: `changed` }]
        f.record(`after stream delta`)
        expect(f.publicRows()).toEqual(expected)
        await vi.waitFor(() => expect(f.durableRows()).toEqual(expected))
        expectWholeRecoveryTrace(f.exposures.slice(streamCut), [
          [oldRow, freshRow],
          expected,
        ])
      } finally {
        f.stopObserving()
        await f.collection.cleanup()
      }
    },
  )

  const independentPublicationProperty = fc.asyncProperty(
    recoveryHistoryArbitrary,
    async ({ startupOrder, commands }) => {
      subscribers.length = 0
      const peer = externalPublisher()
      const f = fixture(`on-demand`, peer.coordinator)
      const expected = new Map([[oldRow.id, structuredClone(oldRow)]])
      const expectedRows = () =>
        structuredClone([...expected.values()].sort((a, b) => a.id - b.id))
      try {
        f.start()
        await vi.waitFor(() => expect(subscribers).toHaveLength(1), {
          interval: 1,
        })

        // These two legal startup orders ablate the only readiness boundary in
        // this history. On-demand hydration alone is not upstream readiness.
        if (startupOrder === `hydrate-before-ready`) {
          await f.collection._sync.loadSubset({})
          expect(f.collection.status).toBe(`loading`)
          subscribers[0]!([upToDate])
        } else {
          subscribers[0]!([upToDate])
          await vi.waitFor(() => expect(f.collection.status).toBe(`ready`), {
            interval: 1,
          })
          await f.collection._sync.loadSubset({})
        }
        await vi.waitFor(() => expect(f.collection.status).toBe(`ready`), {
          interval: 1,
        })
        expect(f.publicRows()).toEqual(expectedRows())

        for (const command of commands) {
          const before = expectedRows()
          const cut = f.exposures.length
          f.record(`before peer ${JSON.stringify(command)}`)
          const row = {
            id: command.id,
            name: command.name,
            stable: `peer-${command.id}`,
          }
          if (command.deleted) {
            f.rows.delete(row.id)
            expected.delete(row.id)
          } else {
            f.rows.set(row.id, structuredClone(row))
            expected.set(row.id, structuredClone(row))
          }
          const revision = peer.publish(
            row,
            command.deleted,
            command.fullReload,
            f.metadata,
          )
          f.record(`after peer revision ${revision}`)
          // An unchanged row set is not proof that the peer publication ran.
          // Its metadata marker commits with the rows, including empty deletes.
          await vi.waitFor(
            () =>
              expect(
                f.collection._state.syncedCollectionMetadata.get(
                  `oracle:publication`,
                ),
              ).toBe(revision),
            { interval: 1 },
          )
          expect(f.publicRows()).toEqual(expectedRows())
          expect(f.collection.status).toBe(`ready`)
          f.record(`peer revision ${revision} settled`)
          const afterPeer = expectedRows()
          expectWholeRecoveryTrace(f.exposures.slice(cut), [before, afterPeer])
          const streamCut = f.exposures.length
          f.record(`before stream revision ${revision}`)
          const streamUpdate = change(`update`, {
            id: row.id,
            name: `stream`,
          })
          if (command.splitCommitControl) {
            subscribers[0]!([streamUpdate])
            f.record(`after uncommitted stream data ${revision}`)
            expect(f.publicRows()).toEqual(afterPeer)
            expect(f.durableRows()).toEqual(afterPeer)
            expect(f.collection.status).toBe(`ready`)
            subscribers[0]!([upToDate])
          } else {
            subscribers[0]!([streamUpdate, upToDate])
          }
          if (!command.deleted) expected.set(row.id, { ...row, name: `stream` })
          f.record(`after stream revision ${revision}`)
          expect(
            f.publicRows(),
            JSON.stringify({
              command,
              publicRows: f.publicRows(),
              durableRows: f.durableRows(),
              expectedRows: expectedRows(),
              status: f.collection.status,
            }),
          ).toEqual(expectedRows())
          expect(f.collection.status).toBe(`ready`)
          await vi.waitFor(
            () => expect(f.durableRows()).toEqual(expectedRows()),
            { interval: 1 },
          )
          expectWholeRecoveryTrace(f.exposures.slice(streamCut), [
            afterPeer,
            expectedRows(),
          ])
        }
      } finally {
        f.stopObserving()
        await f.collection.cleanup()
      }
    },
  )

  it.each(recoveryConfig.campaigns)(
    `independent persistence publications and stream deltas agree with complete-row state ($name campaign)`,
    async (campaign) => {
      await fc.assert(
        independentPublicationProperty,
        recoveryCampaignParameters(campaign),
      )
    },
  )

  it.each(scenarios)(
    `$syncMode invalid resume replaces omitted cached rows: empty=$empty, hydration=$hydration callback`,
    async ({ syncMode, empty, hydration }) => {
      const f = fixture(syncMode)
      const gate = deferred()
      try {
        f.start()
        await vi.waitFor(() => expect(f.publicRows()).toEqual([oldRow]))
        await vi.waitFor(() => expect(subscribers).toHaveLength(1))
        expect(vi.mocked(ShapeStream).mock.calls[0]?.[0]).toMatchObject({
          offset: `10_0`,
          handle: `shape-old`,
        })
        const invalidCut = f.exposures.length
        f.record(`before invalid resume`)
        subscribers[0]!([
          change(`delete`, { id: 1 }),
          change(`update`, { id: 2, name: `partial` }),
          upToDate,
        ])
        f.record(`after invalid resume`)
        await vi.waitFor(() =>
          expect(f.collection.status).toBe(
            syncMode === `eager` ? `ready` : `error`,
          ),
        )
        await vi.waitFor(() =>
          expect(f.metadata.get(`electric:resume`)).toMatchObject({
            kind: `reset`,
          }),
        )
        expect(f.publicRows()).toEqual([oldRow])
        expect(f.durableRows()).toEqual([oldRow])
        expectWholeRecoveryTrace(f.exposures.slice(invalidCut), [[oldRow]])

        f.stopObserving()
        await f.collection.cleanup()
        f.pauseHydration(gate.promise)
        const recoveryCut = f.exposures.length
        f.start()
        await vi.waitFor(() => expect(subscribers).toHaveLength(2))
        expect(vi.mocked(ShapeStream).mock.calls[1]?.[0]).toMatchObject({
          offset: undefined,
          handle: undefined,
        })
        // Fresh progressive mode hydrates persisted rows only on demand.
        const hydrationDone =
          syncMode === `progressive`
            ? Promise.resolve(f.collection._sync.loadSubset({ limit: 10 }))
            : undefined
        const hydrationOutcome = hydrationDone?.then(
          () => undefined,
          (error: unknown) => ({ error }),
        )
        const awaitHydration = async () => {
          const outcome = await hydrationOutcome
          if (outcome) throw outcome.error
        }
        if (hydration === `before`) {
          gate.resolve()
          await awaitHydration()
          await vi.waitFor(() => expect(f.publicRows()).toEqual([oldRow]))
        }
        f.record(`before replacement data`)
        const partialCut = f.exposures.length
        const expected = empty ? [] : [freshRow]
        subscribers[1]!(
          expected.map((row) => change(`insert`, structuredClone(row))),
        )
        f.record(`after replacement data`)
        subscribers[1]!([{ headers: { control: `subset-end` } }])
        f.record(`after subset completion`)
        expectWholeRecoveryTrace(f.exposures.slice(partialCut), [
          hydration === `before` ? [oldRow] : [],
        ])
        subscribers[1]!([upToDate])
        f.record(`after replacement commit`)
        // Preserve the original hydration-after-commit cells: the final
        // control is delivered before releasing the paused hydration gate.
        gate.resolve()
        await awaitHydration()
        await vi.waitFor(() => expect(f.collection.status).toBe(`ready`))
        await vi.waitFor(() =>
          expect(f.metadata.get(`electric:resume`)).toMatchObject({
            kind: `resume`,
            requiresTagState: false,
            offset: `20_0`,
          }),
        )
        // The source's complete snapshot defines both results. A reset marker
        // plus a fresh offset is not proof that the old materialization left.
        expect.soft(f.publicRows()).toEqual(expected)
        expect.soft(f.durableRows()).toEqual(expected)
        f.record(`replacement ready`)
        expectWholeRecoveryTrace(f.exposures.slice(recoveryCut), [
          [],
          [oldRow],
          expected,
        ])
      } finally {
        gate.resolve()
        f.stopObserving()
        await f.collection.cleanup()
      }
    },
  )

  it.each([`eager`, `progressive`] as const)(
    `%s valid resume retains cached rows and their unchanged fields`,
    async (syncMode) => {
      const f = fixture(syncMode)
      try {
        f.start()
        await vi.waitFor(() => expect(f.publicRows()).toEqual([oldRow]))
        await vi.waitFor(() => expect(subscribers).toHaveLength(1))
        subscribers[0]!([
          change(`update`, { id: 1, name: `changed` }),
          upToDate,
        ])
        await vi.waitFor(() => expect(f.collection.status).toBe(`ready`))
        const expected = [{ ...oldRow, name: `changed` }]
        expect(f.publicRows()).toEqual(expected)
        await vi.waitFor(() => expect(f.durableRows()).toEqual(expected))
        expect(f.commits.every((tx) => !tx.truncate)).toBe(true)
      } finally {
        f.stopObserving()
        await f.collection.cleanup()
      }
    },
  )
})
