/** Host receiving laws: page/worker writes converge; changing a legal store
 * name preserves replacement/clear isolation. The independent model is an
 * authored list per store, with replacement and emptying as ordinary list laws.
 * At each settled delivery cut compare public rows, export and raw storage in
 * both hosts. Two typed keys in one insertion also receive the core payload law.
 * Dedicated workers are live throughout; suspension/service workers are outside
 * this grammar. Native forced-close receiving uses Chromium DevTools clearing,
 * whose storage deletion differs from the controlled provider's retained disk.
 */
import { expect, test } from '@playwright/test'
import type {} from './host-browser'
import type { HostCommand, HostRow } from './host-driver'
import type { Page } from '@playwright/test'

async function open(
  page: Page,
  database: string,
  stores: Array<string>,
  worker = false,
) {
  await page.goto('/e2e/indexed-db/host.html')
  await page.waitForFunction(() => Boolean(window.createHost))
  await page.evaluate(
    async (options) => {
      window.host = await window.createHost(options)
    },
    { database, stores },
  )
  if (worker)
    await page.evaluate(
      async (options) => {
        window.workerHost = await window.createWorker(options)
      },
      { database, stores },
    )
}
function call(page: Page, command: HostCommand, worker = false) {
  return page.evaluate(
    ({ command: action, worker: inWorker }) =>
      inWorker ? window.workerHost(action) : window.host(action),
    { command, worker },
  )
}
function expected(stores: Array<string>, model: Map<string, Array<HostRow>>) {
  return stores.map((store) => {
    const rows = [...model.get(store)!].sort((a, b) =>
      JSON.stringify(a.id).localeCompare(JSON.stringify(b.id)),
    )
    return { store, status: 'ready', rows, durable: rows, exported: rows }
  })
}
async function cleanup(
  actions: Array<() => Promise<unknown>>,
  run: () => Promise<void>,
) {
  let failed = false,
    primary: unknown
  try {
    await run()
  } catch (error) {
    failed = true
    primary = error
  }
  const results = await Promise.allSettled(actions.map((action) => action()))
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason as unknown] : [],
  )
  if (failures.length)
    throw new AggregateError(
      failed ? [primary, ...failures] : failures,
      'host oracle cleanup',
      { cause: failed ? primary : failures[0] },
    )
  if (failed) throw primary
}

for (const store of [
  'items',
  'constructor',
  '__proto__',
  'toString',
  '雪/é',
  'a:b[0]',
]) {
  test(`preserves native replacement and clear isolation for ${store}`, async ({
    context,
  }) => {
    const pages = await Promise.all([context.newPage(), context.newPage()])
    const database = crypto.randomUUID()
    const stores = [store, store + '-neighbor', 'anchor']
    const model = new Map(stores.map((name) => [name, [] as Array<HostRow>]))
    await cleanup(
      pages.map((page) => () => call(page, { type: 'cleanup' })),
      async () => {
        await Promise.all(pages.map((page) => open(page, database, stores)))
        async function checkpoint() {
          for (const page of pages)
            await expect
              .poll(() => call(page, { type: 'observe' }))
              .toEqual(expected(stores, model))
        }
        for (const name of stores) {
          const rows = [
            { id: 0, name: 'number' },
            { id: '0', name: 'string' },
          ]
          await call(pages[0], { type: 'insert', store: name, rows })
          model.set(name, rows)
        }
        await checkpoint()
        await call(pages[1], { type: 'update', store, key: 0, name: 'updated' })
        model.set(store, [
          { id: 0, name: 'updated' },
          { id: '0', name: 'string' },
        ])
        await checkpoint()
        const replacement = [{ id: 'new', name: 'replacement' }]
        await call(pages[0], { type: 'import', store, rows: replacement })
        model.set(store, replacement)
        await checkpoint()
        await call(pages[1], { type: 'clear', store })
        model.set(store, [])
        await checkpoint()
        await call(pages[0], { type: 'cleanup' })
        await open(pages[0], database, stores)
        await checkpoint()
      },
    )
  })
}

test('dedicated worker and page preserve writes, restore and closure', async ({
  page,
}) => {
  const database = crypto.randomUUID(),
    store = 'items',
    stores = [store]
  const model = new Map<string, Array<HostRow>>([[store, []]])
  await cleanup(
    [
      () => call(page, { type: 'cleanup' }),
      () => call(page, { type: 'cleanup' }, true),
    ],
    async () => {
      await open(page, database, stores, true)
      async function checkpoint() {
        for (const worker of [false, true])
          await expect
            .poll(() => call(page, { type: 'observe' }, worker))
            .toEqual(expected(stores, model))
      }
      const rows = [
        { id: 0, name: 'number' },
        { id: '0', name: 'string' },
      ]
      await call(page, { type: 'insert', store, rows }, true)
      model.set(store, rows)
      await checkpoint()
      await call(page, { type: 'update', store, key: '0', name: 'page update' })
      model.set(store, [
        { id: 0, name: 'number' },
        { id: '0', name: 'page update' },
      ])
      await checkpoint()
      await call(
        page,
        {
          type: 'import',
          store,
          rows: [{ id: 'replacement', name: 'worker' }],
        },
        true,
      )
      model.set(store, [{ id: 'replacement', name: 'worker' }])
      await checkpoint()
      await call(page, { type: 'close' }, true)
      expect(await call(page, { type: 'status' }, true)).toEqual({
        nativeClose: 0,
        collections: [{ store, status: 'error', rows: model.get(store) }],
      })
      await expect(
        call(
          page,
          { type: 'insert', store, rows: [{ id: 'late', name: 'rejected' }] },
          true,
        ),
      ).rejects.toThrow()
      await call(page, { type: 'cleanup' }, true)
      await page.evaluate(
        async (options) => {
          window.workerHost = await window.createWorker(options)
        },
        { database, stores },
      )
      await checkpoint()
    },
  )
})

test('native storage clearing reports abnormal closure and retains the public snapshot', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'DevTools forced storage closure is Chromium-specific',
  )
  const disposers: Array<() => Promise<unknown>> = [
    () => call(page, { type: 'cleanup' }),
  ]
  await cleanup(disposers, async () => {
    await open(page, crypto.randomUUID(), ['items'])
    const rows = [{ id: 1, name: 'retained' }]
    await call(page, { type: 'insert', store: 'items', rows })
    const cdp = await context.newCDPSession(page)
    disposers.push(() => cdp.detach())
    await cdp.send('Storage.clearDataForOrigin', {
      origin: new URL(page.url()).origin,
      storageTypes: 'indexeddb',
    })
    await expect
      .poll(() => call(page, { type: 'status' }))
      .toEqual({
        nativeClose: 1,
        collections: [{ store: 'items', status: 'error', rows }],
      })
    await expect(
      call(page, {
        type: 'insert',
        store: 'items',
        rows: [{ id: 2, name: 'late' }],
      }),
    ).rejects.toThrow()
  })
})
