import { describe, expect } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { DbClient, collectionOptions } from '../src/client.js'
import { oracleProperty } from './oracle-config.js'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from './oracle-assertion-adapter.js'
import {
  compareObservedMetadata,
  cursorKey,
  describeNested,
  describeWrite,
  expectedHeldReads,
  expectedNestedMetadata,
  expectedProductionPathMetadata,
  histories,
  laterKey,
  laterMetadata,
  nestedHistories,
  nestedMetadata,
  nestedSetMetadata,
  rebuiltHistories,
  startMetadata,
  writeMetadata,
} from './collection-row-metadata-composition-model-oracle.js'
import type {
  EarlierWrite,
  HeldOpen,
  HeldReads,
  NestedHistory,
  ProductionPath,
  Start,
  Write,
} from './collection-row-metadata-composition-model-oracle.js'
import type { SyncConfig } from '../src/types.js'

/**
 * # Which row metadata survives one sync transaction?
 *
 * A sync source writes row metadata inside one transaction in three ways:
 * through `metadata.row.set` and `metadata.row.delete`, through the `metadata`
 * field of a row message, and through `truncate`. Writes that carry metadata
 * replace earlier values, so the last such write wins. `collection.test.ts`
 * covers that rule with fixed examples. A maintainer decision on 2026-10-05 (recorded in
 * `docs/contributing/oracle-reviews/2026-10-05-state-mutation-round-3.md`)
 * fixes the writes that carry none:
 *
 * - An insert of an absent key names the row's whole metadata. Without
 *   `metadata`, it clears any earlier value.
 * - An insert equal to the held row is an idempotent re-insert. Without
 *   `metadata`, it keeps the current value, like an update.
 * - An update without `metadata` keeps the current value.
 * - A row delete clears the value, even when the message carries metadata.
 * - A truncate clears the value.
 * - `metadata.row.set` after a delete or a truncate keeps metadata for the
 *   absent row.
 *
 * This oracle covers one key, one transaction of up to three writes, and four
 * variants: immediate, held, rebuilt, and nested. The nested variant applies a
 * nested transaction or a hydration seed before the open transaction. When a
 * rebuild changes an insert into an equal re-insert, or the reverse, the rule
 * follows the write that applies. The model judges the reclassified sequence.
 * It does not judge metadata-only publication batches or other keys. The
 * collection-metadata publication oracle owns publication batches; the sync
 * metadata session oracle owns reads across transactions, seeds, and the
 * consumer view.
 *
 * ## What does the source read before a held transaction applies?
 *
 * An accepted sync transaction always applies, in commit order (glossary,
 * "accepted sync transaction"). A sync-side metadata read therefore returns
 * the value that the source's accepted writes and its open transaction
 * determine. Whether a persisting optimistic transaction still holds those
 * writes does not change the read. The persisted wrapper states the same rule
 * for its staged writes: the open transaction's write, then the newest staged
 * one, then the stored value, with a truncate hiding older row metadata.
 * `collection.base` is a different observation: it is the applied view and
 * excludes queued writes.
 *
 * The held-window variant checks this rule for `metadata.row.get`,
 * `metadata.collection.get`, and `metadata.collection.list`. The history's
 * explicit `set` and `unset` writes also write one collection key. A later
 * accepted transaction writes another key. A read sees both before and after
 * the hold ends. The variant does not judge a read between writes of one open
 * transaction, nested transactions, or wrapper-deferred transactions.
 */

type Row = { id: number; v: number }
type SyncActions = Parameters<SyncConfig<Row, number>[`sync`]>[0]

async function observeMetadata(
  productionPath: ProductionPath,
  start: Start,
  sequence: ReadonlyArray<Write>,
  id: string,
  earlier: EarlierWrite = { key: 2, kind: `update` },
): Promise<unknown> {
  let sync!: SyncActions
  let release!: () => void
  const collection = createCollection<Row, number>({
    id,
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      sync: (actions) => {
        sync = actions
        actions.begin()
        actions.write({ type: `insert`, value: { id: 2, v: 0 } })
        if (start !== `absent`) {
          actions.write({
            type: `insert`,
            value: { id: 1, v: 0 },
            ...(start === `present-with-metadata`
              ? { metadata: startMetadata }
              : {}),
          })
        }
        actions.commit()
        actions.markReady()
      },
    },
    onUpdate: () => new Promise<void>((resolve) => (release = resolve)),
  })
  try {
    await collection.stateWhenReady()
    const blocker =
      productionPath === `immediate`
        ? undefined
        : collection.update(2, (draft) => {
            draft.v = 9
          })
    let earlierReceipt: true | Promise<void> = true
    if (productionPath === `rebuilt`) {
      sync.begin()
      if (earlier.kind === `delete`) sync.write({ type: `delete`, key: 1 })
      else
        sync.write({
          type: earlier.kind,
          value: { id: earlier.key, v: 100 },
        })
      earlierReceipt = sync.commit()
    }
    // A re-insert writes the row exactly as the source holds it.
    let held: number | undefined = start === `absent` ? undefined : 0
    if (productionPath === `rebuilt` && earlier.key === 1)
      held = earlier.kind === `delete` ? undefined : 100
    sync.begin()
    sequence.forEach((write, step) => {
      const metadata = writeMetadata(step)
      if (write.kind === `insert` || write.kind === `update`) held = step + 1
      else if (write.kind === `delete` || write.kind === `truncate`)
        held = undefined
      if (write.kind === `set`) sync.metadata!.row.set(1, metadata)
      else if (write.kind === `unset`) sync.metadata!.row.delete(1)
      else if (write.kind === `truncate`) sync.truncate()
      else if (write.kind === `delete`)
        sync.write({
          type: `delete`,
          key: 1,
          ...(write.metadata ? { metadata } : {}),
        })
      else if (write.kind === `reinsert`)
        sync.write({
          type: `insert`,
          value: { id: 1, v: held! },
          ...(write.metadata ? { metadata } : {}),
        })
      else
        sync.write({
          type: write.kind,
          value: { id: 1, v: step + 1 },
          ...(write.metadata ? { metadata } : {}),
        })
    })
    if (productionPath === `rebuilt`) {
      expect(earlierReceipt).not.toBe(true)
      release()
      await blocker!.when(`settled`)
      await earlierReceipt
    }
    const receipt = sync.commit()
    if (productionPath === `immediate`) expect(receipt).toBe(true)
    if (productionPath === `held`) {
      // A truncate applies at once; the request holds every other transaction.
      if (sequence.some((write) => write.kind === `truncate`))
        expect(receipt).toBe(true)
      else expect(receipt).not.toBe(true)
      release()
      await blocker!.when(`settled`)
    }
    await receipt
    return sync.metadata!.row.get(1)
  } finally {
    await collection.cleanup()
  }
}

const readHeld = (sync: SyncActions): HeldReads => ({
  row: sync.metadata!.row.get(1),
  cursor: sync.metadata!.collection.get(cursorKey),
  // List order is not part of the contract.
  list: [...sync.metadata!.collection.list()].sort((a, b) =>
    a.key.localeCompare(b.key),
  ),
})

/**
 * The held-window driver holds the history's transaction T1 behind a
 * persisting optimistic update. It then commits T2, which updates key 2 and
 * sets `later`. T1 is held unless it truncates, and T2 is always held. The
 * driver reads at three checkpoints:
 *
 * - `committed`: after T2's commit returns, with no open transaction.
 * - `open`: inside an open T3 that is empty or truncates.
 * - `applied`: after T3 is canceled and the hold ends.
 *
 * T3 is canceled with an aborted signal, so the applied checkpoint expects
 * T1 and T2 only.
 */
async function observeHeldReads(
  start: Start,
  sequence: ReadonlyArray<Write>,
  open: HeldOpen,
  id: string,
): Promise<Record<`committed` | `open` | `applied`, HeldReads>> {
  let sync!: SyncActions
  let release!: () => void
  const collection = createCollection<Row, number>({
    id,
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      sync: (actions) => {
        sync = actions
        actions.begin()
        actions.write({ type: `insert`, value: { id: 2, v: 0 } })
        if (start !== `absent`) {
          actions.write({
            type: `insert`,
            value: { id: 1, v: 0 },
            ...(start === `present-with-metadata`
              ? { metadata: startMetadata }
              : {}),
          })
        }
        if (start === `present-with-metadata`)
          actions.metadata!.collection.set(cursorKey, startMetadata)
        actions.commit()
        actions.markReady()
      },
    },
    onUpdate: () => new Promise<void>((resolve) => (release = resolve)),
  })
  try {
    await collection.stateWhenReady()
    const blocker = collection.update(2, (draft) => {
      draft.v = 9
    })
    let held: number | undefined = start === `absent` ? undefined : 0
    sync.begin()
    sequence.forEach((write, step) => {
      const metadata = writeMetadata(step)
      if (write.kind === `insert` || write.kind === `update`) held = step + 1
      else if (write.kind === `delete` || write.kind === `truncate`)
        held = undefined
      if (write.kind === `set`) {
        sync.metadata!.row.set(1, metadata)
        sync.metadata!.collection.set(cursorKey, metadata)
      } else if (write.kind === `unset`) {
        sync.metadata!.row.delete(1)
        sync.metadata!.collection.delete(cursorKey)
      } else if (write.kind === `truncate`) sync.truncate()
      else if (write.kind === `delete`)
        sync.write({
          type: `delete`,
          key: 1,
          ...(write.metadata ? { metadata } : {}),
        })
      else if (write.kind === `reinsert`)
        sync.write({
          type: `insert`,
          value: { id: 1, v: held! },
          ...(write.metadata ? { metadata } : {}),
        })
      else
        sync.write({
          type: write.kind,
          value: { id: 1, v: step + 1 },
          ...(write.metadata ? { metadata } : {}),
        })
    })
    const firstReceipt = sync.commit()
    if (sequence.some((write) => write.kind === `truncate`))
      expect(firstReceipt).toBe(true)
    else expect(firstReceipt).not.toBe(true)
    sync.begin()
    sync.write({ type: `update`, value: { id: 2, v: 100 } })
    sync.metadata!.collection.set(laterKey, laterMetadata)
    const laterReceipt = sync.commit()
    expect(laterReceipt).not.toBe(true)
    const committed = readHeld(sync)

    sync.begin()
    if (open === `truncated`) sync.truncate()
    const openReads = readHeld(sync)
    const abort = new AbortController()
    abort.abort()
    await expect(sync.commit(abort.signal)).rejects.toThrow()

    release()
    await blocker.when('settled')
    await firstReceipt
    await laterReceipt
    return { committed, open: openReads, applied: readHeld(sync) }
  } finally {
    await collection.cleanup()
  }
}

/**
 * The nested driver writes T1 through a real Collection's sync API, then
 * applies the nested write and commits both. A seed goes through
 * `DbClient.hydrate`, so that history uses a Collection that a `DbClient`
 * owns. When `held`, a persisting optimistic update of key 2 holds both
 * transactions until T1 has committed. The driver reads `metadata.row.get`
 * after T1 applies.
 */
async function observeNested(
  { start, nested, nestedSet, sequence }: NestedHistory,
  id: string,
  held = false,
): Promise<unknown> {
  let sync!: SyncActions
  let release!: () => void
  const row = { id: 1, v: 0 }
  const config = {
    id,
    getKey: (value: Row) => value.id,
    sync: {
      sync: (actions: SyncActions) => {
        sync = actions
        actions.begin()
        actions.write({ type: `insert`, value: { id: 2, v: 0 } })
        if (start !== `absent`)
          actions.write({
            type: `insert`,
            value: row,
            ...(start === `present-with-metadata`
              ? { metadata: startMetadata }
              : {}),
          })
        actions.commit()
        actions.markReady()
      },
    },
    onUpdate: () => new Promise<void>((resolve) => (release = resolve)),
  }
  const client = new DbClient()
  const collection =
    nested === `seed`
      ? client.collection(collectionOptions<Row, number>(config))
      : createCollection<Row, number>({ ...config, startSync: true })
  try {
    await collection.stateWhenReady()
    const blocker = held
      ? collection.update(2, (draft) => {
          draft.v = 9
        })
      : undefined
    sync.begin()
    sequence.forEach((write, step) => {
      const metadata = writeMetadata(step)
      if (write.kind === `set`) sync.metadata!.row.set(1, metadata)
      else if (write.kind === `unset`) sync.metadata!.row.delete(1)
      else if (write.kind === `truncate`) sync.truncate()
      else if (write.kind === `delete`)
        sync.write({
          type: `delete`,
          key: 1,
          ...(write.metadata ? { metadata } : {}),
        })
      else
        sync.write({
          type: write.kind === `update` ? `update` : `insert`,
          value: row,
          ...(write.metadata ? { metadata } : {}),
        })
    })
    let nestedReceipt: true | Promise<void> = true
    if (nested === `seed`)
      client.hydrate({
        collections: [
          {
            collectionId: id,
            rows: [{ key: 1, value: row, metadata: nestedMetadata }],
          },
        ],
      })
    else {
      sync.begin()
      if (nested === `delete`) sync.write({ type: `delete`, key: 1 })
      else sync.write({ type: `insert`, value: row, metadata: nestedMetadata })
      if (nestedSet) sync.metadata!.row.set(1, nestedSetMetadata)
      nestedReceipt = sync.commit()
    }
    const receipt = sync.commit()
    if (blocker) {
      release()
      await blocker.when('settled')
    }
    await nestedReceipt
    await receipt
    return sync.metadata!.row.get(1)
  } finally {
    await collection.cleanup()
  }
}

// Each production path's driver runs the whole bounded grammar and compares
// every observation with the model, recording mismatches by history label.
async function runNestedPathCase(path: `immediate` | `held`): Promise<void> {
  const mismatches: Array<string> = []
  for (const [index, history] of nestedHistories.entries()) {
    const label = describeNested(history)
    let actual: unknown
    try {
      actual = await observeNested(
        history,
        `row-metadata-composition-nested-${path}-${index}`,
        path === `held`,
      )
    } catch (error) {
      mismatches.push(`${label} threw ${String(error)}`)
      continue
    }
    compareObservedMetadata(
      mismatches,
      label,
      actual,
      expectedNestedMetadata(history),
    )
  }
  expect(mismatches).toEqual([])
}

async function runHeldWindowCase(open: HeldOpen): Promise<void> {
  const mismatches: Array<string> = []
  for (const [index, { start, sequence }] of histories.entries()) {
    const label = `${start}: ${sequence.map(describeWrite).join(`, `)}`
    let actual: Awaited<ReturnType<typeof observeHeldReads>>
    try {
      actual = await observeHeldReads(
        start,
        sequence,
        open,
        `row-metadata-composition-held-window-${open}-${index}`,
      )
    } catch (error) {
      mismatches.push(`${label} threw ${String(error)}`)
      continue
    }
    for (const checkpoint of [`committed`, `open`, `applied`] as const) {
      const expected = expectedHeldReads(
        start,
        sequence,
        checkpoint === `open` ? open : `applied`,
      )
      if (JSON.stringify(actual[checkpoint]) !== JSON.stringify(expected))
        mismatches.push(
          `${label} at ${checkpoint} read ${JSON.stringify(actual[checkpoint])}, expected ${JSON.stringify(expected)}`,
        )
    }
  }
  expect(mismatches).toEqual([])
}

async function runProductionPathCase(
  productionPath: ProductionPath,
): Promise<void> {
  const cases =
    productionPath === `rebuilt`
      ? rebuiltHistories
      : histories.map((history) => ({ ...history, earlier: undefined }))
  const mismatches: Array<string> = []
  for (const [index, { start, sequence, earlier }] of cases.entries()) {
    const label = `${start}${earlier ? ` after ${earlier.kind} ${earlier.key}` : ``}: ${sequence.map(describeWrite).join(`, `)}`
    let actual: unknown
    try {
      actual = await observeMetadata(
        productionPath,
        start,
        sequence,
        `row-metadata-composition-${productionPath}-${index}`,
        earlier,
      )
    } catch (error) {
      mismatches.push(`${label} threw ${String(error)}`)
      continue
    }
    compareObservedMetadata(
      mismatches,
      label,
      actual,
      expectedProductionPathMetadata(start, sequence, earlier),
    )
  }
  expect(mismatches).toEqual([])
}

describe(`row metadata composition oracle`, () => {
  oracleProperty({
    id: `row-metadata-composition.nested`,
    law: {
      statement: `After a nested transaction or hydration seed, the open transaction's row metadata follows last-write-wins as the model judges the reclassified sequence.`,
      authority: `The maintainer decision of 2026-10-05 and the glossary's accepted sync transaction, as stated above`,
      limits: `The 1925 nested histories, one key, on the immediate and held paths.`,
    },
    // What this oracle owns: the gap report judges how a sync transaction's row
    // metadata writes are applied and read, in sync.ts and state.ts, across the
    // immediate, held, and rebuilt production paths.
    owns: [`src/collection/sync.ts`, `src/collection/state.ts`],
    histories: [`immediate`, `held`] as const,
    label: (path) =>
      `matches last-write-wins metadata after a nested write (${path})`,
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`row metadata nested write`, plan, observe, () =>
        runNestedPathCase(plan.history),
      ),
    check: forwardAssertionJudgment,
    timeout: 120_000,
  })

  oracleProperty({
    id: `row-metadata-composition.held-window`,
    law: {
      statement: `A sync-side metadata read returns the value that the accepted writes and the open transaction determine, whether or not a persisting optimistic transaction holds them.`,
      authority: `The maintainer decision of 2026-10-05 and the glossary's accepted sync transaction, as stated above`,
      limits: `The 1457 one-key histories, read at the committed, open, and applied checkpoints, with an open transaction that is empty or truncates; no read between writes of one open transaction.`,
    },
    // What this oracle owns: the gap report judges how a sync transaction's row
    // metadata writes are applied and read, in sync.ts and state.ts, across the
    // immediate, held, and rebuilt production paths.
    owns: [`src/collection/sync.ts`, `src/collection/state.ts`],
    histories: [`empty`, `truncated`] as const,
    label: (open) =>
      `reads accepted metadata during a hold, then in an open transaction that is ${open}`,
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`row metadata held window`, plan, observe, () =>
        runHeldWindowCase(plan.history),
      ),
    check: forwardAssertionJudgment,
    timeout: 120_000,
  })

  oracleProperty({
    id: `row-metadata-composition.production-path`,
    law: {
      statement: `One sync transaction's row metadata follows last-write-wins, with the maintainer's rules for writes that carry no metadata, on every production path.`,
      authority: `The maintainer decision of 2026-10-05 and the glossary's accepted sync transaction, as stated above`,
      limits: `The 1457 one-key histories on the immediate and held paths and the 1767 rebuilt histories; no publication batches or other keys.`,
    },
    // What this oracle owns: the gap report judges how a sync transaction's row
    // metadata writes are applied and read, in sync.ts and state.ts, across the
    // immediate, held, and rebuilt production paths.
    owns: [`src/collection/sync.ts`, `src/collection/state.ts`],
    histories: [`immediate`, `held`, `rebuilt`] as const,
    label: (productionPath) =>
      `matches last-write-wins metadata on the ${productionPath} path`,
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(
        `row metadata production path`,
        plan,
        observe,
        () => runProductionPathCase(plan.history),
      ),
    check: forwardAssertionJudgment,
    timeout: 120_000,
  })
})
