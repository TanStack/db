/**
 * IndexedDB settled-history oracle.
 *
 * Authority: the package's CRUD/persistence, per-store isolation, clear/import,
 * export and cross-tab APIs; Collection optimistic settlement and cleanup.
 * At each completed mutation/utility call and delivered source notification,
 * public rows, subscription rows and durable rows must equal the authored data.
 * Reopening must reconstruct that same data. Versions exist exactly for stored
 * keys, change when row values change and remain unchanged for unrelated keys.
 * An authored no-op may reuse or refresh its version; that is not an API law.
 *
 * The independent model is just two arrays of authored rows. It deliberately
 * combines settled source and optimistic state: there is no unsettled work at
 * its checkpoint. The separate boundary oracle covers pending/rejected work.
 * No cache, version classification or production transition computes truth.
 *
 * Limits: fake-indexeddb plus controlled BroadcastChannel delivery, bounded
 * scalar keys/rows, sequential settled actions. This does not prove browser
 * event scheduling, crash durability, overlapping writers, or cleanup during
 * in-flight work. See ORACLE.md and the repository coverage map.
 */
import { createTransaction } from '@tanstack/db'
import { fc } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import {
  Channel,
  assertRows,
  readStore,
  seed,
  sorted,
  userRow,
  withHarness,
} from './harness'
import type { Row } from './harness'

const keys = [0, '0', 1, '1'] as const
const kinds = [
  'write',
  'delete',
  'clear',
  'import',
  'reopen',
  'manual',
] as const
type Step = {
  kind: (typeof kinds)[number]
  slot: number
  key: number
  value: number
  optional: boolean
}
const step = fc.record({
  kind: fc.constantFrom(...kinds),
  slot: fc.integer({ min: 0, max: 1 }),
  key: fc.integer({ min: 0, max: 3 }),
  value: fc.integer({ min: -2, max: 2 }),
  optional: fc.boolean(),
})
const history = fc.array(step, { minLength: 0, maxLength: 20 })

// Constructive grammar: write inserts an absent key or updates an existing key;
// delete chooses an existing key, or authors then deletes one in the empty case.
// Thus shrinking never turns an update/delete into an invalid missing-key call.
// Reused and number/string-equal keys, empty/nonempty replacement, and both stores
// are independent axes. No-op steps are allowed; every authored history ends in
// a reopen witness. Removing an axis loses the corresponding law (ORACLE.md).
async function runHistory(steps: Array<Step>) {
  await withHarness(async (h) => {
    const names = ['items', 'other']
    const model: Array<Array<Row>> = [
      [{ id: 0, name: 'restored', optional: 1 }],
      [],
    ]
    await seed(h.db, 'items', model[0]!)
    const subjects = await Promise.all(names.map((name) => h.open(name)))
    const peer = await h.open()
    const record = (collection: (typeof subjects)[number]) => {
      const rows = new Map<string | number, Row>()
      collection.subscribeChanges(
        (changes) => {
          for (const change of changes) {
            if (change.type === 'delete') rows.delete(change.key)
            else rows.set(change.key, userRow(change.value))
          }
        },
        { includeInitialState: true },
      )
      return rows
    }
    const mirrors = subjects.map(record)
    let checks = 0
    async function checkpoint(cut: string) {
      for (const [slot, name] of names.entries()) {
        assertRows(subjects[slot]!.values(), model[slot]!, cut + ': public')
        assertRows(
          mirrors[slot]!.values(),
          model[slot]!,
          cut + ': subscription',
        )
        assertRows(
          (await readStore<Row>(h.db, name)).rows,
          model[slot]!,
          cut + ': durable',
        )
        assertRows(
          await subjects[slot]!.utils.exportData(),
          model[slot]!,
          cut + ': export',
        )
      }
      assertRows(peer.values(), model[0]!, cut + ': peer')
      const versions = await readStore<{
        versionKey: string
        updatedAt: number
      }>(h.db, '_versions')
      expect(
        versions.keys.map(String).sort(),
        cut + ': version ownership',
      ).toEqual(
        model
          .flatMap((rows, slot) =>
            rows.map((row) => String([names[slot], row.id])),
          )
          .sort(),
      )
      // Typed key comparison avoids String conflating number 0 with string "0".
      expect(versions.keys.map((key) => JSON.stringify(key)).sort()).toEqual(
        model
          .flatMap((rows, slot) =>
            rows.map((row) => JSON.stringify([names[slot], row.id])),
          )
          .sort(),
      )
      for (const value of versions.rows) {
        expect(value.versionKey).toEqual(expect.any(String))
        expect(value.updatedAt).toEqual(expect.any(Number))
      }
      checks++
    }
    await checkpoint('populated startup')
    for (const [index, action] of steps.entries()) {
      const { slot } = action
      const collection = subjects[slot]!
      const key = keys[action.key]!
      const row: Row = {
        id: key,
        name: String(action.value),
        ...(action.optional ? { optional: action.value } : {}),
      }
      const before = await readStore<{ versionKey: string }>(h.db, '_versions')
      const touched = new Set<string>()
      const changed = new Set<string>()
      function remember(at: number, value: Row) {
        const versionKey = JSON.stringify([names[at], value.id])
        const previous = model[at]!.find((item) => item.id === value.id)
        touched.add(versionKey)
        if (
          !previous ||
          previous.name !== value.name ||
          previous.optional !== value.optional
        )
          changed.add(versionKey)
        model[at] = [
          ...model[at]!.filter((item) => item.id !== value.id),
          value,
        ]
      }
      function write(at: number, value: Row) {
        const target = subjects[at]!
        return model[at]!.some((item) => item.id === value.id)
          ? target.update(value.id, (draft) => {
              draft.name = value.name
              if ('optional' in value) draft.optional = value.optional
              else delete draft.optional
            })
          : target.insert(value)
      }
      switch (action.kind) {
        case 'write':
          await write(slot, row).isPersisted.promise
          remember(slot, row)
          break
        case 'delete': {
          if (!model[slot]!.length) {
            await collection.insert(row).isPersisted.promise
            remember(slot, row)
            await Channel.deliver()
          }
          const removed = model[slot]![action.key % model[slot]!.length]!
          await collection.delete(removed.id).isPersisted.promise
          model[slot] = model[slot]!.filter((item) => item.id !== removed.id)
          touched.add(JSON.stringify([names[slot], removed.id]))
          break
        }
        case 'clear':
        case 'import': {
          const rows =
            action.kind === 'clear' || action.value === 0 ? [] : [row]
          for (const old of model[slot]!)
            touched.add(JSON.stringify([names[slot], old.id]))
          if (action.kind === 'clear') await collection.utils.clearObjectStore()
          else await collection.utils.importData(rows)
          model[slot] = rows
          for (const value of rows)
            touched.add(JSON.stringify([names[slot], value.id]))
          break
        }
        case 'manual': {
          const other: Row = { ...row, name: 'other:' + row.name }
          const tx = createTransaction({
            mutationFn: async ({ transaction }) => {
              await subjects[0]!.utils.acceptMutations(transaction)
              await subjects[1]!.utils.acceptMutations(transaction)
            },
          })
          tx.mutate(() => {
            write(0, row)
            write(1, other)
          })
          await tx.isPersisted.promise
          remember(0, row)
          remember(1, other)
          break
        }
        case 'reopen':
          await collection.cleanup()
          await collection.preload()
          mirrors[slot] = record(collection)
          break
      }
      await Channel.deliver()
      await checkpoint('step ' + index + ': ' + action.kind)
      const after = await readStore<{ versionKey: string }>(h.db, '_versions')
      for (const [at, oldKey] of before.keys.entries()) {
        const next = after.keys.findIndex(
          (value) => JSON.stringify(value) === JSON.stringify(oldKey),
        )
        if (next < 0) continue
        if (changed.has(JSON.stringify(oldKey)))
          expect(after.rows[next]!.versionKey).not.toBe(
            before.rows[at]!.versionKey,
          )
        else if (!touched.has(JSON.stringify(oldKey)))
          expect(after.rows[next]!.versionKey).toBe(before.rows[at]!.versionKey)
      }
    }
    for (const [slot, name] of names.entries()) {
      const reopened = await h.open(name)
      assertRows(reopened.values(), model[slot]!, 'fresh Collection restore')
    }
    expect(checks).toBe(steps.length + 1)
  })
}

describe('settled histories', () => {
  // Reconstruction witnesses preserve all action kinds even if random sampling
  // or shrinking selects an empty history.
  it('reconstructs replacement, ownership, typed keys and restart histories', async () => {
    await runHistory(
      kinds.flatMap((kind, i) => [
        { kind, slot: 0, key: i % 4, value: 1, optional: true },
        { kind, slot: 1, key: (i + 1) % 4, value: 0, optional: false },
      ]),
    )
  })
  it('clears a previously confirmed update without retaining optimistic data', async () => {
    await runHistory([
      { kind: 'write', slot: 0, key: 0, value: 0, optional: false },
      { kind: 'clear', slot: 0, key: 0, value: 0, optional: false },
    ])
  })
  it('preserves rows through authored no-op updates', async () => {
    const repeated: Step = {
      kind: 'write',
      slot: 0,
      key: 0,
      value: 0,
      optional: false,
    }
    await runHistory([repeated, repeated])
  })
  it('rejects wrong snapshots without erasing extra fields or typed keys', () => {
    const expected = [{ id: 0, name: 'value' }]
    for (const wrong of [
      [],
      [...expected, ...expected],
      [{ id: '0', name: 'value' }],
      [{ ...expected[0]!, optional: 1 }],
    ]) {
      expect(() => assertRows(wrong, expected, 'hostile snapshot')).toThrow()
    }
    expect(sorted(expected)).toEqual(expected)
  })

  const seedText = process.env.INDEXEDDB_ORACLE_SEED
  const path = process.env.INDEXEDDB_ORACLE_PATH
  if ((seedText === undefined) !== (path === undefined))
    throw new Error(
      'Replay requires INDEXEDDB_ORACLE_SEED and INDEXEDDB_ORACLE_PATH together',
    )
  if (
    seedText !== undefined &&
    (!/^-?\d+$/.test(seedText) || !/^\d+(?::\d+)*$/.test(path!))
  )
    throw new Error('Invalid oracle replay coordinates')
  const campaigns =
    seedText === undefined
      ? [{ mode: 'fixed', seed: 1179001 }, { mode: 'random' }]
      : [{ mode: 'replay', seed: Number(seedText), path }]
  for (const { mode, ...parameters } of campaigns) {
    it(
      'matches authored data through ' + mode + ' histories',
      async () => {
        console.info('indexeddb.persistence campaign', mode, {
          numRuns: 30,
          ...parameters,
        })
        await fc.assert(fc.asyncProperty(history, runHistory), {
          numRuns: 30,
          verbose: true,
          ...parameters,
          asyncReporter: async (details) => {
            console.info('indexeddb.persistence completed', {
              mode,
              seed: details.seed,
              path: details.counterexamplePath,
              runs: details.numRuns,
              failed: details.failed,
            })
            const report = await fc.asyncDefaultReportMessage(details)
            if (report !== undefined)
              throw new Error(report, { cause: details.errorInstance })
          },
        })
      },
      30_000,
    )
  }
})
