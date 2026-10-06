/**
 * Real same-origin pages receive the controlled transaction-scope premise.
 * An import's native completion admits a test-owned blocking transaction before
 * the adapter broadcasts. Two native message callbacks then start readonly
 * transactions while that blocker remains live. No callback is manually
 * dispatched and no transaction awaits an unrelated promise.
 *
 * The authored two-row replacement is the reference. A local held insert is
 * independently overlaid under the core optimistic contract. The split mutant
 * requires the observed overlap, publishes a partial replacement, then repairs
 * it. Runner-owned raw evidence must retain the same atomic-publication failure
 * after closing the receiver while its local handler is still pending.
 */
import { expect, test } from '@playwright/test'
import fc from 'fast-check'
import {
  OracleMismatch,
  apply,
  assertPublicationHistory,
  assertReplay,
  assertSnapshot,
  assertStatuses,
} from '../tests/cross-tab-oracle'
import { runCampaign } from '../tests/campaign'
import { retainedDocument } from './browser-evidence-oracle'
import type { BrowserContext, Page } from '@playwright/test'
import type { BrowserEvidence } from './browser'
import type { Change, OracleRow } from '../tests/cross-tab-oracle'

async function open(
  context: BrowserContext,
  database: string,
  tab: string,
  split = false,
  options = '',
) {
  const page = await context.newPage()
  await page.goto(
    `/e2e/browser.html?database=${database}&tab=${tab}&fault=${split ? 'split' : 'none'}${options}`,
  )
  await installed(page)
  if (!options.includes('hold=startup'))
    await page.evaluate(() => window.crossTab!.ready())
  return page
}
async function installed(page: Page) {
  await page.waitForFunction(
    () => window.crossTab !== undefined || window.crossTabFailure !== undefined,
  )
  const failure = await page.evaluate(() => window.crossTabFailure)
  if (failure) throw new Error(failure)
}
async function awaitRestore(page: Page) {
  await installed(page)
  await page.evaluate(() => window.crossTab!.ready())
}
const observe = (page: Page) => page.evaluate(() => window.crossTab!.observe())

async function closePages(context: BrowserContext) {
  const failures: Array<unknown> = []
  for (const page of context.pages()) {
    for (const action of [
      () => page.evaluate(() => window.crossTab?.flushEvidence()),
      () => page.evaluate(() => window.crossTab?.cleanup()),
      () => page.evaluate(() => window.crossTab?.flushEvidence()),
      () => page.close(),
    ]) {
      try {
        await action()
      } catch (error) {
        failures.push(error)
      }
    }
  }
  return failures
}

async function withPages(
  context: BrowserContext,
  run: (events: Array<BrowserEvidence>, database: string) => Promise<void>,
) {
  const events: Array<BrowserEvidence> = []
  const errors: Array<string> = []
  await context.exposeBinding(
    'retainOracleEvent',
    (_source, event: BrowserEvidence) => {
      events.push(event)
    },
  )
  context.on('page', (page) =>
    page.on('pageerror', (error) => errors.push(String(error))),
  )
  let primary: unknown
  try {
    await run(events, `oracle-${crypto.randomUUID()}`)
  } catch (error) {
    primary = error
  }
  const cleanup = await closePages(context)
  await test.info().attach('native-evidence', {
    body: JSON.stringify({
      engine: test.info().project.name,
      browserVersion: context.browser()!.version(),
      events,
      errors,
      primary: String(primary ?? ''),
      cleanup: cleanup.map(String),
    }),
    contentType: 'application/json',
  })
  if (primary !== undefined) {
    if (cleanup.length)
      throw new AggregateError(cleanup, 'Native oracle and cleanup failed', {
        cause: primary,
      })
    throw primary
  }
  expect(errors, 'unexpected page errors').toEqual([])
  expect(cleanup, 'cleanup failures').toEqual([])
}

async function overlap(
  context: BrowserContext,
  events: Array<BrowserEvidence>,
  database: string,
  split: boolean,
) {
  const writer = await open(context, database, 'writer')
  const before = [
    { id: 1, name: 'old a', optional: 7 },
    { id: 2, name: 'old b', optional: 8 },
  ]
  const after = [
    { id: 1, name: 'new a' },
    { id: 2, name: 'new b' },
  ]
  await writer.evaluate((rows) => window.crossTab!.import(rows), before)
  const receiver = await open(context, database, 'receiver', split)
  await receiver.evaluate(() => window.crossTab!.holdInsert())
  const held = { id: 'held', name: 'unaccepted local intent' }
  const initial = await observe(receiver)
  assertSnapshot(
    initial.rows,
    [...before, held],
    'held handler before native overlap',
  )
  await writer.evaluate(() => window.crossTab!.armWriteBarrier())
  await writer.evaluate((rows) => window.crossTab!.repeatImport(rows), after)
  await receiver.waitForFunction(
    () =>
      window.crossTab!.observe().reads.filter((status) => status === 'pending')
        .length >= 2,
  )
  const pending = await observe(receiver)
  expect(
    pending.callbacks.started - pending.callbacks.completed,
    'two native callbacks overlap',
  ).toBe(2)
  expect(pending.handlerStatus).toBe('pending')
  await writer.evaluate(() => window.crossTab!.releaseBarrier())
  await receiver.waitForFunction(() => {
    const state = window.crossTab!.observe()
    return (
      state.callbacks.completed === 2 &&
      state.reads.every((status) => status !== 'pending')
    )
  })
  const finished = await observe(receiver)
  assertSnapshot(
    finished.rows,
    [...after, held],
    'native final rows including optimistic intent',
  )
  assertStatuses(
    finished.statuses,
    ['idle', 'loading', 'ready'],
    'native receiver status',
  )
  expect(finished.failures).toEqual([])
  const receipt = await receiver.evaluate(() =>
    window.crossTab!.flushEvidence(),
  )
  expect(
    receipt.handlerStatus,
    'evidence transfer did not settle the handler',
  ).toBe('pending')
  const retained = retainedDocument(events, receipt)
  const publications = retained
    .filter(
      (event) =>
        event.sequence >= initial.sequence && event.type === 'publication',
    )
    .map((event) => {
      if (event.type !== 'publication') throw new Error('not a publication')
      return event.publication
    })
  // Destruction is real. All checking below uses runner-owned values.
  await receiver.close()
  expect(retainedDocument(events, receipt)).toEqual(retained)
  expect(() =>
    retainedDocument(
      events.filter(
        (event) => event.document !== receipt.document || event.sequence !== 0,
      ),
      receipt,
    ),
  ).toThrow('evidence capture at page destruction')
  let failure: unknown
  try {
    assertPublicationHistory(
      [...before, held],
      publications,
      [{ rows: [...after, held], deletes: [], replace: true }],
      'native replacement',
    )
  } catch (error) {
    failure = error
  }
  if (split) {
    expect(finished.injected, 'schedule-dependent mutant reached').toBe(1)
    expect(failure).toBeInstanceOf(OracleMismatch)
    expect(failure).toMatchObject({
      law: 'atomic publication',
      checkpoint: 'native replacement publication 0',
    })
  } else if (failure !== undefined) throw failure
  const restored = await open(context, database, 'restored')
  assertSnapshot(
    (await observe(restored)).rows,
    after,
    'fresh restore excludes unaccepted closed-page intent',
  )
  await restored.evaluate(() =>
    window.crossTab!.write({ id: 'suffix', name: 'ordinary write' }),
  )
  assertSnapshot(
    (await observe(restored)).rows,
    [...after, { id: 'suffix', name: 'ordinary write' }],
    'successful suffix after page close',
  )
  await writer.evaluate(() => window.crossTab!.cleanup())
  await writer.close()
  await restored.evaluate(() => window.crossTab!.cleanup())
  await restored.close()
  return {
    inputReconstructed: true,
    premiseReached:
      pending.callbacks.started - pending.callbacks.completed === 2,
    sameFailure:
      failure instanceof OracleMismatch &&
      failure.law === 'atomic publication' &&
      failure.checkpoint === 'native replacement publication 0',
  }
}

test('native overlapping reads publish whole snapshots and retain evidence across page close', async ({
  context,
}) => {
  await withPages(context, (events, database) =>
    overlap(context, events, database, false).then(() => {}),
  )
})
test('replays the same schedule-dependent publication violation after evidence survives page close', async ({
  context,
}) => {
  await withPages(context, async (events, database) => {
    const first = await overlap(context, events, database, true)
    const replay = await overlap(context, events, `${database}-replay`, true)
    assertReplay(first)
    assertReplay(replay)
    await test.info().attach('replay', {
      body: JSON.stringify({
        first,
        replay,
        law: 'atomic publication',
        checkpoint: 'native replacement publication 0',
      }),
      contentType: 'application/json',
    })
  })
})

type NativeStep = {
  kind: 'write' | 'clear' | 'import' | 'parallel' | 'reload'
  tab: number
  value: number
  optional: boolean
}
const nativeHistory = fc.array(
  fc.record({
    kind: fc.constantFrom(
      'write' as const,
      'clear' as const,
      'import' as const,
      'parallel' as const,
      'reload' as const,
    ),
    tab: fc.integer({ min: 0, max: 1 }),
    value: fc.integer({ min: -2, max: 2 }),
    optional: fc.boolean(),
  }),
  { maxLength: 8 },
)

async function nativeHistoryRun(
  context: BrowserContext,
  events: Array<BrowserEvidence>,
  database: string,
  steps: Array<NativeStep>,
  reach: Set<string>,
) {
  const pages = [
    await open(context, database, 'a'),
    await open(context, database, 'b'),
  ]
  reach.add('native pages')
  let expected: Array<OracleRow> = []
  for (const [index, step] of steps.entries()) {
    const tab = step.tab
    if (step.kind === 'reload') {
      const receipt = await pages[tab]!.evaluate(() =>
        window.crossTab!.flushEvidence(),
      )
      retainedDocument(events, receipt)
      await pages[tab]!.reload()
      await awaitRestore(pages[tab]!)
      retainedDocument(events, receipt)
      assertSnapshot(
        (await observe(pages[tab]!)).rows,
        expected,
        'generated reload restore',
      )
      continue
    }
    const before = await Promise.all(pages.map(observe))
    const rows = [0, 1].map((owner) => ({
      id: `${owner}:${index}`,
      name: `value ${step.value}`,
      ...(step.optional ? { optional: step.value } : {}),
    }))
    const changes: Array<Change> =
      step.kind === 'parallel'
        ? rows.map((row) => ({ rows: [row], deletes: [], replace: false }))
        : [
            {
              rows: step.kind === 'clear' ? [] : [rows[tab]!],
              deletes: [],
              replace: step.kind === 'clear' || step.kind === 'import',
            },
          ]
    if (step.kind === 'parallel')
      await Promise.all(
        pages.map((page, owner) =>
          page.evaluate((row) => window.crossTab!.write(row), rows[owner]!),
        ),
      )
    else if (step.kind === 'clear')
      await pages[tab]!.evaluate(() => window.crossTab!.clear())
    else if (step.kind === 'import')
      await pages[tab]!.evaluate(
        (items) => window.crossTab!.import(items),
        rows,
      )
    else
      await pages[tab]!.evaluate(
        (row) => window.crossTab!.write(row),
        rows[tab]!,
      )
    if (step.kind === 'import') changes[0]!.rows = rows
    const written = await Promise.all(pages.map(observe))
    for (const owner of [0, 1]) {
      const count =
        before[owner]!.callbacks.completed +
        written[1 - owner]!.callbacks.posts -
        before[1 - owner]!.callbacks.posts
      await pages[owner]!.waitForFunction(
        (target) => window.crossTab!.observe().callbacks.completed >= target,
        count,
      )
    }
    const next = changes.reduce(apply, expected)
    for (const owner of [0, 1]) {
      const actual = await observe(pages[owner]!)
      assertSnapshot(actual.rows, next, `native generated ${index}`)
      assertStatuses(
        actual.statuses,
        ['idle', 'loading', 'ready'],
        `native generated ${index}`,
      )
      assertPublicationHistory(
        expected,
        actual.publications.slice(before[owner]!.publications.length),
        changes,
        `native generated ${index}`,
      )
      expect(actual.failures).toEqual([])
    }
    expected = next
  }
}

const replaySeed = process.env.TANSTACK_INDEXEDDB_BROWSER_SEED
const replayPath = process.env.TANSTACK_INDEXEDDB_BROWSER_PATH
for (const seed of replaySeed ? [Number(replaySeed)] : [1179, undefined])
  test(`native authored histories preserve every publication (${seed === undefined ? 'fresh' : 'fixed'})`, async ({
    context,
  }) => {
    await withPages(context, async (events, database) => {
      let count = 0
      await runCampaign(
        `native-${test.info().project.name}`,
        nativeHistory,
        async (steps, receipt) => {
          let primary: unknown
          try {
            await nativeHistoryRun(
              context,
              events,
              `${database}-${count++}`,
              steps,
              receipt.reach,
            )
          } catch (error) {
            primary = error
          }
          const cleanup = await closePages(context)
          if (cleanup.length)
            throw new AggregateError(cleanup, 'Native history cleanup failed', {
              cause: primary,
            })
          if (primary !== undefined) throw primary
        },
        {
          runs: 10,
          seed,
          path: replayPath,
          environment: `${test.info().project.name} ${context.browser()!.version()}`,
        },
      )
    })
  })

// Explicit manual acceptance creates ordered storage transactions before either
// notification can run. Automatic write ordering has a separate native witness.
// The write-complete gate is queued after both writes, before their reads.
// B therefore receives a normal full-row update, without any truncate.
test('native ordered delete and reinsert removes omitted fields through an ordinary update', async ({
  context,
}) => {
  await withPages(context, async (events, database) => {
    const writer = await open(context, database, 'writer')
    const before = { id: 0, name: 'before', optional: 7 }
    const after = { id: 0, name: 'after' }
    await writer.evaluate((row) => window.crossTab!.write(row), before)
    const receiver = await open(context, database, 'receiver')
    const initial = await observe(receiver)
    await writer.evaluate(() => window.crossTab!.armWriteBarrier())
    await writer.evaluate((row) => window.crossTab!.omit(row), after)
    await receiver.waitForFunction(
      () => window.crossTab!.observe().callbacks.started === 2,
    )
    const pending = await observe(receiver)
    expect(pending.callbacks.completed).toBe(0)
    expect(pending.reads.filter((status) => status === 'pending')).toHaveLength(
      2,
    )
    await writer.evaluate(() => window.crossTab!.releaseBarrier())
    await receiver.waitForFunction(
      () => window.crossTab!.observe().callbacks.completed === 2,
    )
    const received = await observe(receiver)
    expect(received.syncWrites.slice(initial.syncWrites.length)).toEqual([
      'update',
    ])
    expect(received.truncates).toBe(initial.truncates)
    assertSnapshot(received.rows, [after], 'native omission')
    assertPublicationHistory(
      [before],
      received.publications.slice(initial.publications.length),
      [{ rows: [after], deletes: [], replace: false }],
      'native omission',
    )
    retainedDocument(
      events,
      await receiver.evaluate(() => window.crossTab!.flushEvidence()),
    )
  })
})

for (const operation of ['upgrade', 'delete'] as const)
  test(`managed versionchange retains in-flight native work during ${operation}`, async ({
    context,
  }) => {
    await withPages(context, async (_events, database) => {
      const a = await open(context, database, 'a')
      const row = { id: 1, name: 'retained' }
      await a.evaluate((value) => window.crossTab!.write(value), row)
      const b = await open(context, database, 'b')
      await a.evaluate(() => window.crossTab!.holdStorage())
      await b.evaluate(
        (action) => window.crossTab!.startSchema(action),
        operation,
      )
      await a.waitForFunction(
        () => window.crossTab!.observe().versionChanges === 1,
      )
      expect((await observe(b)).schema.status).toBe('pending')
      await a.evaluate(() => window.crossTab!.releaseBarrier())
      await b.waitForFunction(
        () => window.crossTab!.observe().schema.status === 'complete',
      )
      expect((await observe(b)).versionChanges).toBe(1)
      const outcome = await a.evaluate(async () => {
        try {
          await window.crossTab!.write({ id: 'closed', name: 'closed' })
          return 'fulfilled'
        } catch {
          return 'rejected'
        }
      })
      expect(outcome).toBe('rejected')
      assertSnapshot(
        (await observe(a)).rows,
        [row],
        'closed descriptor rollback',
      )
      const fresh = await open(
        context,
        database,
        'fresh',
        false,
        operation === 'upgrade' ? '&version=2' : '',
      )
      assertSnapshot(
        (await observe(fresh)).rows,
        operation === 'upgrade' ? [row] : [],
        'native schema restore',
      )
      await fresh.evaluate(() =>
        window.crossTab!.write({ id: 'suffix', name: 'suffix' }),
      )
    })
  })

for (const obsolete of [false, true])
  test(`native receiver abort reports ${obsolete ? 'obsolete' : 'active'} Collection status`, async ({
    context,
  }) => {
    await withPages(context, async (_events, database) => {
      const writer = await open(context, database, 'writer')
      const receiver = await open(context, database, 'receiver')
      if (obsolete)
        await writer.evaluate(() => window.crossTab!.armWriteBarrier())
      else await receiver.evaluate(() => window.crossTab!.abortNextRead())
      await writer.evaluate(() =>
        window.crossTab!.write({ id: 1, name: 'durable' }),
      )
      await receiver.waitForFunction(
        () => window.crossTab!.observe().callbacks.started === 1,
      )
      if (obsolete) {
        expect((await observe(receiver)).callbacks.completed).toBe(0)
        await receiver.evaluate(() => window.crossTab!.restart(true))
        await writer.evaluate(() => window.crossTab!.releaseBarrier())
        await receiver.evaluate(() => window.crossTab!.ready())
      }
      await receiver.waitForFunction(
        () => window.crossTab!.observe().callbacks.completed === 1,
      )
      const state = await observe(receiver)
      expect(state.reads).toContain('abort')
      expect(state.status).toBe(obsolete ? 'ready' : 'error')
      if (obsolete)
        assertStatuses(
          state.statuses,
          ['idle', 'loading', 'ready', 'cleaned-up'],
          'obsolete native abort',
        )
      else expect(state.requestProgress).toBe(1)
      assertSnapshot(
        state.rows,
        obsolete ? [{ id: 1, name: 'durable' }] : [],
        'native abort rows',
      )
    })
  })

test('subscriptions acquired before and during native startup observe peer progress', async ({
  context,
}) => {
  await withPages(context, async (_events, database) => {
    const writer = await open(context, database, 'writer')
    const before = [{ id: 'before', name: 'before' }]
    await writer.evaluate((rows) => window.crossTab!.import(rows), before)
    const receiver = await open(
      context,
      database,
      'receiver',
      false,
      '&hold=startup',
    )
    expect((await observe(receiver)).status).toBe('loading')
    await receiver.evaluate(() => window.crossTab!.subscribe(false))
    const changed = { id: 'peer', name: 'peer' }
    const pending = writer.evaluate(
      (row) => window.crossTab!.write(row),
      changed,
    )
    void pending.catch(() => undefined)
    await writer.waitForFunction(() =>
      window.crossTab!.observe().writes.some((status) => status === 'pending'),
    )
    await receiver.evaluate(() => window.crossTab!.releaseBarrier())
    await pending
    await receiver.evaluate(() => window.crossTab!.ready())
    await receiver.waitForFunction(
      () => window.crossTab!.observe().callbacks.completed === 1,
    )
    await receiver.evaluate(() => window.crossTab!.subscribe(true))
    const state = await observe(receiver)
    const traces = await receiver.evaluate(() =>
      window.crossTab!.subscriptions(),
    )
    const effects = [
      { rows: before, deletes: [], replace: false },
      { rows: [changed], deletes: [], replace: false },
    ]
    assertPublicationHistory([], state.publications, effects, 'native startup')
    assertPublicationHistory(
      [],
      traces[0]!,
      effects,
      'subscription during startup',
    )
    assertPublicationHistory(
      [],
      traces[1]!,
      [{ rows: [...before, changed], deletes: [], replace: false }],
      'subscription after startup',
    )
    assertSnapshot(
      (await observe(await open(context, database, 'fresh'))).rows,
      [...before, changed],
      'startup independent restore',
    )
  })
})

test('an unmanaged native blocker preserves pending deletion until it closes', async ({
  context,
}) => {
  await withPages(context, async (_events, database) => {
    const owner = await open(context, database, 'owner')
    const row = { id: 1, name: 'retained while blocked' }
    await owner.evaluate((value) => window.crossTab!.write(value), row)
    await owner.evaluate(() => window.crossTab!.openBlocker())
    await owner.evaluate(() => window.crossTab!.startSchema('delete'))
    await owner.waitForFunction(
      () => window.crossTab!.observe().schema.blocked === 1,
    )
    const blocked = await observe(owner)
    expect(blocked.schema.status).toBe('pending')
    assertSnapshot(blocked.rows, [row], 'native blocked deletion')
    await owner.evaluate(() => window.crossTab!.closeBlocker())
    await owner.waitForFunction(
      () => window.crossTab!.observe().schema.status === 'complete',
    )
    assertSnapshot(
      (await observe(await open(context, database, 'restored'))).rows,
      [],
      'native deletion restore',
    )
  })
})

test('native write abort after request progress rejects without durable rows or versions', async ({
  context,
}) => {
  await withPages(context, async (_events, database) => {
    const writer = await open(context, database, 'writer')
    const peer = await open(context, database, 'peer')
    const original = { id: 1, name: 'retained' }
    await writer.evaluate((row) => window.crossTab!.write(row), original)
    await peer.waitForFunction(
      () => window.crossTab!.observe().callbacks.completed === 1,
    )
    const versions = await writer.evaluate(() => window.crossTab!.versions())
    const before = await observe(writer)
    await writer.evaluate(() => window.crossTab!.abortNextWrite())
    const result = await writer.evaluate(async () => {
      try {
        await window.crossTab!.write({ id: 2, name: 'aborted' })
        return 'fulfilled'
      } catch {
        return 'rejected'
      }
    })
    expect(result).toBe('rejected')
    const after = await observe(writer)
    expect(after.requestProgress).toBe(1)
    expect(after.callbacks.posts).toBe(before.callbacks.posts)
    assertSnapshot(after.rows, [original], 'native aborted public')
    assertSnapshot(
      await writer.evaluate(() => window.crossTab!.durable()),
      [original],
      'native aborted durable',
    )
    expect(await writer.evaluate(() => window.crossTab!.versions())).toEqual(
      versions,
    )
    assertSnapshot(
      (await observe(peer)).rows,
      [original],
      'native aborted peer',
    )
    await writer.evaluate(() =>
      window.crossTab!.write({ id: 3, name: 'suffix' }),
    )
    assertSnapshot(
      (await observe(await open(context, database, 'fresh'))).rows,
      [original, { id: 3, name: 'suffix' }],
      'native aborted successful suffix',
    )
  })
})

for (const accept of [false, true])
  test(`a held native insert ${accept ? 'confirms' : 'rolls back'} after ordered peer persistence`, async ({
    context,
  }) => {
    await withPages(context, async (_events, database) => {
      const writer = await open(context, database, 'writer')
      const receiver = await open(context, database, 'receiver')
      await receiver.evaluate(() => window.crossTab!.holdInsert())
      const peer = { id: 'held', name: 'accepted peer' }
      const local = { id: 'held', name: 'unaccepted local intent' }
      await writer.evaluate((row) => window.crossTab!.write(row), peer)
      await receiver.waitForFunction(
        () => window.crossTab!.observe().callbacks.completed === 1,
      )
      const pending = await observe(receiver)
      expect(pending.handlerStatus).toBe('pending')
      assertSnapshot(pending.rows, [local], 'native pending whole-row intent')
      await receiver.evaluate(
        (success) => window.crossTab!.settleInsert(success),
        accept,
      )
      await receiver.waitForFunction(
        () => window.crossTab!.observe().handlerStatus !== 'pending',
      )
      expect((await observe(receiver)).handlerStatus).toBe(
        accept ? 'fulfilled' : 'rejected',
      )
      const expected = accept ? local : peer
      assertSnapshot(
        (await observe(receiver)).rows,
        [expected],
        'native settled intent',
      )
      if (accept)
        await writer.waitForFunction(
          () => window.crossTab!.observe().callbacks.completed === 1,
        )
      assertSnapshot(
        (await observe(writer)).rows,
        [expected],
        'native settled peer',
      )
      assertSnapshot(
        (await observe(await open(context, database, 'fresh'))).rows,
        [expected],
        'native settled restore',
      )
    })
  })

test('native reload readiness waits for its establishing storage read', async ({
  context,
}) => {
  await withPages(context, async (events, database) => {
    const page = await open(context, database, 'reloaded')
    const rows = [{ id: 1, name: 'durable restore' }]
    await page.evaluate((items) => window.crossTab!.import(items), rows)
    const receipt = await page.evaluate(() => window.crossTab!.flushEvidence())
    await page.goto(
      `/e2e/browser.html?database=${database}&tab=reloaded&hold=startup`,
    )
    await page.waitForFunction(() => window.crossTab !== undefined)
    retainedDocument(events, receipt)
    const pending = await observe(page)
    expect(pending.status).toBe('loading')
    expect(pending.reads).toContain('pending')
    expect(() =>
      assertSnapshot(
        pending.rows,
        rows,
        'reload before native restore completes',
      ),
    ).toThrow('public rows')
    await page.evaluate(() => window.crossTab!.releaseBarrier())
    await page.evaluate(() => window.crossTab!.ready())
    assertSnapshot(
      (await observe(page)).rows,
      rows,
      'reload after native restore completes',
    )
  })
})

test('cleanup retains a primary mismatch and closes every page after an injected cleanup failure', async ({
  context,
}) => {
  const primary = new OracleMismatch(
    'calibration',
    'before cleanup',
    'expected',
    'wrong',
  )
  await expect(
    withPages(context, async (_events, database) => {
      await open(context, database, 'first', false, '&cleanupFailure=1')
      await open(context, database, 'second')
      throw primary
    }),
  ).rejects.toMatchObject({ cause: primary })
  expect(context.pages()).toHaveLength(0)
})

// Native receiving witness for the connection-scoped deletion law. Hold only
// the deleting page's success callback, then let a second page actually create,
// write and receive the old notification over native BroadcastChannel.
test('late deletion notification preserves a recreated database snapshot', async ({
  context,
}) => {
  await withPages(context, async (_events, database) => {
    const old = await open(context, database, 'deleted')
    await old.evaluate(() => window.crossTab!.holdDeletionReceipt())
    const fresh = await open(context, database, 'recreated')
    const expected = [{ id: 1, name: 'new incarnation' }]
    await fresh.evaluate((rows) => window.crossTab!.import(rows), expected)
    const before = await observe(fresh)
    await old.evaluate(() => window.crossTab!.releaseDeletionReceipt())
    await fresh.waitForFunction(
      (count) => window.crossTab!.observe().callbacks.completed > count,
      before.callbacks.completed,
    )
    const after = await observe(fresh)
    assertSnapshot(after.rows, expected, 'native stale deletion: public')
    assertSnapshot(
      await fresh.evaluate(() => window.crossTab!.durable()),
      expected,
      'native stale deletion: durable',
    )
    const restored = await open(context, database, 'restored')
    assertSnapshot(
      (await observe(restored)).rows,
      expected,
      'native stale deletion: fresh restore',
    )
  })
})

// The native host receives the same held-earlier/accepted-later premise as the
// local-write-order owner. Public optimistic rows are separate from durability.
test('persists a later local update after a held insert in mutation order', async ({
  context,
}) => {
  await withPages(context, async (_events, database) => {
    const writer = await open(context, database, 'local-order')
    await writer.evaluate(() => window.crossTab!.holdInsert())
    const expected = [{ id: 'held', name: 'newer edit' }]
    const later = writer.evaluate(
      (row) => window.crossTab!.write(row),
      expected[0]!,
    )
    await writer.waitForFunction(() =>
      window.crossTab!.observe().rows.some((row) => row.name === 'newer edit'),
    )
    const before = await writer.evaluate(() => window.crossTab!.durable())
    await writer.evaluate(() => window.crossTab!.settleInsert(true))
    await later
    assertSnapshot(before, [], 'native earlier handler held: durable')
    assertSnapshot(
      await writer.evaluate(() => window.crossTab!.durable()),
      expected,
      'native local order: durable',
    )
    assertSnapshot(
      (await observe(writer)).rows,
      expected,
      'native local order: public',
    )
    const fresh = await open(context, database, 'local-order-restore')
    assertSnapshot(
      (await observe(fresh)).rows,
      expected,
      'native local order: restore',
    )
  })
})
