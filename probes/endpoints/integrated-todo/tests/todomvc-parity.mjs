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
  const control = async (data) =>
    (await page.request.post(`${url}/probe-control`, { data })).json()
  await control({
    reset: true,
    readDelay: 0,
    writeDelay: 0,
    rejectWrite: false,
    failNextRead: false,
  })
  await page.goto(url)
  const input = page.getByLabel('One thing to do')
  await page.waitForFunction(
    () => !document.querySelector('#todo-input')?.disabled,
  )
  assert.equal(
    await input.evaluate((el) => el === document.activeElement),
    true,
    'initial focus',
  )
  assert.equal(await page.locator('.list-tools').isVisible(), false)
  assert.equal(await page.locator('.list-summary').isVisible(), false)
  const saved = () =>
    page.waitForFunction(
      () => document.querySelector('#status').textContent === 'Saved',
    )
  const add = async (text) => {
    await input.fill(text)
    await input.press('Enter')
  }
  await control({ writeDelay: 1500 })
  await add('First')
  await add('Second')
  assert.equal(await input.isEnabled(), true)
  assert.equal(
    await input.evaluate((el) => el === document.activeElement),
    true,
    'focus retained',
  )
  assert.equal(
    await page.locator('li[data-id]').count(),
    2,
    'both inserts optimistic',
  )
  assert.equal((await control({})).rows.length, 0, 'no server write yet')
  await saved()
  await control({ writeDelay: 0 })
  await page
    .getByRole('checkbox', { name: 'Complete First', exact: true })
    .check()
  assert.equal(
    await page
      .getByRole('checkbox', { name: 'Complete First', exact: true })
      .isChecked(),
    true,
  )
  await saved()
  assert.equal(
    (await control({})).rows.find((r) => r.text === 'First').completed,
    true,
    'completion persists',
  )
  await control({ writeDelay: 0 })
  await page.getByRole('link', { name: 'Completed', exact: true }).click()
  assert.match(page.url(), /#\/completed$/)
  await page.reload()
  await page.getByText('First', { exact: true }).waitFor()
  assert.equal(await page.locator('li[data-id]').count(), 1)
  await page.getByRole('link', { name: 'Active', exact: true }).click()
  await page.getByText('Second', { exact: true }).waitFor()
  await page.goBack()
  await page.getByText('First', { exact: true }).waitFor()
  await page.goForward()
  await page.getByText('Second', { exact: true }).waitFor()
  await page.getByText('Second', { exact: true }).dblclick()
  const edit = page.getByRole('textbox', { name: 'Edit task' })
  assert.equal(await page.locator('li.editing').count(), 1)
  assert.equal(
    await page.locator('li.editing input[type=checkbox]').isVisible(),
    false,
  )
  assert.equal(await page.locator('li.editing .delete-task').isVisible(), false)
  await edit.press('Escape')
  assert.equal(await page.locator('.list-summary strong').textContent(), '1')
  await page.getByRole('button', { name: 'Clear completed' }).click()
  await saved()
  assert.equal(
    await page.getByRole('button', { name: 'Clear completed' }).isVisible(),
    false,
  )
  await page.getByRole('link', { name: 'All', exact: true }).click()
  await control({ rejectWrite: true, writeDelay: 500 })
  await add('Will roll back')
  await input.fill('Keep my new draft')
  await page.waitForFunction(() =>
    document
      .querySelector('[role=alert]')
      ?.textContent.includes('Fixture write rejected'),
  )
  assert.equal(
    await page.getByText('Will roll back', { exact: true }).count(),
    0,
  )
  assert.equal(
    await input.inputValue(),
    'Keep my new draft',
    'rollback never overwrites newer typing',
  )
  assert.equal(await input.isEnabled(), true)
  await page.screenshot({ path: 'evidence/error-toast.png', fullPage: true })
  await page.getByRole('button', { name: 'Dismiss error' }).click()
  assert.equal(await page.getByRole('alert').count(), 0)
  await control({ rejectWrite: false, writeDelay: 0 })
  console.log(
    'PASS parity: focus, nonblocking writes, concurrent inserts, rollback, URL/reload/back/forward, edit/empty/clear visibility, counter',
  )
} finally {
  await browser.close()
}
