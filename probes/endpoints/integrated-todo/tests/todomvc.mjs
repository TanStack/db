import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const url = process.env.PROBE_URL ?? 'http://127.0.0.1:4191'
const browser = await chromium.launch({
  headless: true,
  executablePath:
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
})
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const control = async (data) =>
    (await page.request.post(`${url}/probe-control`, { data })).json()
  await control({
    reset: true,
    writeDelay: 0,
    readDelay: 0,
    rejectWrite: false,
    failNextRead: false,
  })
  await page.goto(url)
  const saved = () =>
    page.waitForFunction(
      () => document.querySelector('#status')?.textContent === 'Saved',
    )
  const rows = () => page.locator('li[data-id]')
  const row = (text) =>
    rows().filter({ has: page.getByText(text, { exact: true }) })
  const add = async (text) => {
    await page.getByLabel('One thing to do').fill(text)
    await page.getByRole('button', { name: 'Add task' }).click()
    await saved()
  }
  const toggle = page.getByRole('checkbox', { name: 'Toggle all', includeHidden: true })
  const mixed = () => toggle.evaluate((input) => input.indeterminate)
  assert.equal(await mixed(), false)
  await add('First task')
  await add('Second task')
  assert.deepEqual(await page.locator('.todo-text').allTextContents(), [
    'First task',
    'Second task',
  ])
  await page.getByRole('link', { name: 'Active', exact: true }).click()
  await control({ writeDelay: 1000 })
  await row('First task').getByRole('checkbox').click()
  await page.waitForFunction(
    () => document.querySelectorAll('li[data-id]').length === 1,
  )
  assert.equal(await page.locator('#status').textContent(), 'Saving')
  assert.equal(
    (await control({})).rows.find((r) => r.text === 'First task').completed,
    false,
    'optimistic filter updates before persistence',
  )
  await saved()
  assert.equal(
    (await control({})).rows.find((r) => r.text === 'First task').completed,
    true,
  )
  assert.equal(await mixed(), true, 'partial completion shows mixed state')
  const reads = (await control({})).events.filter(
    (e) => e === 'query:alice',
  ).length
  await page.getByRole('link', { name: 'Completed', exact: true }).click()
  await page.getByText('First task', { exact: true }).waitFor()
  assert.equal(await rows().count(), 1)
  assert.equal(
    (await control({})).events.filter((e) => e === 'query:alice').length,
    reads,
    'filter is client only',
  )
  await page.getByRole('link', { name: 'All', exact: true }).click()
  await row('Second task').getByText('Second task', { exact: true }).dblclick()
  await page.getByRole('textbox', { name: 'Edit task' }).fill('Renamed task')
  await page.getByRole('textbox', { name: 'Edit task' }).press('Enter')
  await saved()
  await row('Renamed task')
    .getByText('Renamed task', { exact: true })
    .dblclick()
  await page.getByRole('textbox', { name: 'Edit task' }).fill('Discard this')
  await page.getByRole('textbox', { name: 'Edit task' }).press('Escape')
  assert.equal(await page.getByText('Discard this', { exact: true }).count(), 0)
  await control({ rejectWrite: true })
  await row('Renamed task').getByRole('checkbox').check()
  await page.waitForFunction(() =>
    document
      .querySelector('[role=alert]')
      ?.textContent.includes('Fixture write rejected'),
  )
  assert.equal(
    await row('Renamed task').getByRole('checkbox').isChecked(),
    false,
  )
  assert.equal(await mixed(), true, 'rollback restores mixed state')
  await control({ rejectWrite: false, writeDelay: 0 })
  await page.getByRole('checkbox', { name: 'Toggle all', includeHidden: true }).check()
  await saved()
  assert.equal(await page.getByText('0 items left', { exact: true }).count(), 1)
  assert.equal(await mixed(), false, 'all complete clears mixed state')
  await page.reload()
  await page.getByText('Renamed task', { exact: true }).waitFor()
  assert.equal(
    await row('Renamed task').getByRole('checkbox').isChecked(),
    true,
  )
  await page.getByRole('checkbox', { name: 'Toggle all', includeHidden: true }).uncheck()
  await saved()
  assert.equal(await mixed(), false, 'all active clears mixed state')
  await row('First task').hover()
  await row('First task').getByRole('button', { name: 'Delete task' }).click()
  await saved()
  await row('Renamed task')
    .getByText('Renamed task', { exact: true })
    .dblclick()
  await page.getByRole('textbox', { name: 'Edit task' }).fill('Blur saved')
  await page.getByRole('textbox', { name: 'Edit task' }).press('Tab')
  await saved()
  await row('Blur saved').getByText('Blur saved', { exact: true }).dblclick()
  await page.getByRole('textbox', { name: 'Edit task' }).fill(' ')
  await page.getByRole('textbox', { name: 'Edit task' }).press('Enter')
  await saved()
  assert.equal(await rows().count(), 0)
  await add('Keep active')
  await add('Clear me')
  await row('Clear me').getByRole('checkbox').check()
  await saved()
  await page.getByRole('button', { name: 'Clear completed' }).click()
  await saved()
  assert.deepEqual(
    (await control({})).rows.map((r) => r.text),
    ['Keep active'],
  )
  assert.equal(await mixed(), false, 'clear completed clears mixed state')
  await page.goto(`${url}/?scope=bob`)
  await page.getByLabel('One thing to do').waitFor()
  assert.equal(await rows().count(), 0)
  assert.deepEqual(errors, [])
  await page.goto(url)
  await page.getByText('Keep active', { exact: true }).waitFor()
  await page.screenshot({ path: 'evidence/todomvc.png', fullPage: true })
  console.log(
    'PASS TodoMVC: ordering, optimistic filtering, no filter RPC, edit/escape/blur, rollback, toggle all, delete/empty edit, clear completed, reload, user isolation',
  )
} finally {
  await browser.close()
}
