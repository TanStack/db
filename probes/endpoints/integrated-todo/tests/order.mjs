import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'

const url = process.env.PROBE_URL ?? 'http://127.0.0.1:4193'
const label = process.env.PROBE_LABEL ?? 'order'
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const evidence = { url, checks: [] }
let page
try {
  page = await browser.newPage()
  await page.goto(url)
  await page.waitForFunction(() => window.todoProbe)
  await page.evaluate(() => window.todoProbe.view.preload())
  await page.evaluate(() => {
    const { client, collection } = window.todoProbe
    window.orderTransaction = client.core.createTransaction({ autoCommit: false, mutationFn: async () => {} })
    window.orderTransaction.mutate(() => {
      for (const [id, createdAt] of [['order-a', '2099-01-03'], ['order-z', '2099-01-01'], ['order-c', '2099-01-02'], ['order-b', '2099-01-02']]) {
        collection.insert({ id, text: id, completed: false, createdAt: new Date(createdAt) })
      }
    })
  })
  await page.waitForFunction(() => document.querySelectorAll('li[data-id^="order-"]').length === 4)
  const collectionOrder = await page.evaluate(() => [...window.todoProbe.view.values()].filter(row => row.id.startsWith('order-')).map(row => row.id))
  assert.deepEqual(collectionOrder, ['order-z', 'order-b', 'order-c', 'order-a'])
  evidence.checks.push({ name: 'bound ordered collection preserves server order for optimistic rows', observed: collectionOrder })
  const observed = await page.locator('li[data-id^="order-"]').evaluateAll(rows => rows.map(row => row.dataset.id))
  assert.deepEqual(observed, ['order-z', 'order-b', 'order-c', 'order-a'])
  evidence.checks.push({ name: 'optimistic rows sort by creation time then ID despite insertion and key order', observed })
  await page.evaluate(() => window.orderTransaction.rollback())
  await page.reload()
  await page.waitForFunction(() => window.todoProbe)
  await page.evaluate(() => window.todoProbe.view.preload())
  const expected = await page.evaluate(() => [...window.todoProbe.collection.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(row => row.id))
  await page.waitForFunction(count => document.querySelectorAll('li[data-id]').length === count, expected.length)
  assert.deepEqual(await page.locator('li[data-id]').evaluateAll(rows => rows.map(row => row.dataset.id)), expected)
  evidence.checks.push({ name: 'reloaded server rows retain creation-time order', expected })
  evidence.status = 'PASS'
} catch (error) {
  evidence.status = 'FAIL'
  evidence.error = String(error)
  process.exitCode = 1
} finally {
  await page?.evaluate(() => { if (window.orderTransaction?.state === 'pending') window.orderTransaction.rollback() }).catch(() => {})
  await browser.close()
  await writeFile(`evidence/${label}.json`, JSON.stringify(evidence, null, 2))
}
console.log(JSON.stringify(evidence))
