import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
const url = process.env.PROBE_URL ?? 'http://127.0.0.1:4191'
const browser = await chromium.launch({
  headless: true,
  executablePath:
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
})
try {
  const page = await browser.newPage()
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
  await input.waitFor()
  await page.waitForFunction(
    () => !document.querySelector('#todo-input').disabled,
  )
  const observed = {}
  observed.empty = {
    focused: await input.evaluate((el) => el === document.activeElement),
    listToolsVisible: await page.locator('.list-tools').isVisible(),
    summaryVisible: await page.locator('.list-summary').isVisible(),
    clearVisible: await page
      .getByRole('button', { name: 'Clear completed' })
      .isVisible(),
  }
  await input.fill('   ')
  await input.press('Enter')
  assert.equal((await control({})).rows.length, 0)
  observed.blankRejected = true
  await input.fill('  Trimmed task  ')
  await input.press('Enter')
  await page.waitForFunction(
    () => document.querySelector('#status').textContent === 'Saved',
  )
  assert.equal((await control({})).rows[0].text, 'Trimmed task')
  assert.equal(await input.inputValue(), '')
  observed.enterTrimsCreatesAndClears = true
  observed.focusAfterAdd = await input.evaluate(
    (el) => el === document.activeElement,
  )
  await page.getByText('Trimmed task', { exact: true }).dblclick()
  const edit = page.getByRole('textbox', { name: 'Edit task' })
  observed.editing = {
    focused: await edit.evaluate((el) => el === document.activeElement),
    checkboxVisible: await page.locator('li input[type=checkbox]').isVisible(),
    deleteVisible: await page
      .getByRole('button', { name: 'Delete task' })
      .isVisible(),
    editingClass: await page
      .locator('li[data-id]')
      .evaluate((el) => el.classList.contains('editing')),
  }
  await edit.fill('  Edited task  ')
  await edit.press('Enter')
  await page.waitForFunction(
    () => document.querySelector('#status').textContent === 'Saved',
  )
  assert.equal((await control({})).rows[0].text, 'Edited task')
  observed.editTrimmed = true
  await page.getByText('Edited task', { exact: true }).dblclick()
  await edit.fill('Uncommitted edit')
  await page.reload()
  await page.getByLabel('One thing to do').waitFor()
  observed.editNotPersisted = (await edit.count()) === 0
  observed.counterStrong = await page.locator('.list-summary strong').count()
  await page.mouse.move(0, 0)
  await input.focus()
  observed.deleteVisibleWithoutHover = await page
    .getByRole('button', { name: 'Delete task' })
    .isVisible()
  await page.getByRole('link', { name: 'Completed', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelectorAll('li[data-id]').length === 0,
  )
  observed.filterURL = page.url()
  await page.reload()
  await page.getByLabel('One thing to do').waitFor()
  observed.filterAfterReload = await page
    .locator('nav .selected')
    .textContent()
  await page.goto(`${url}/#/completed`)
  await page.getByLabel('One thing to do').waitFor()
  observed.hashRouteSelected = await page
    .locator('nav .selected')
    .textContent()
  await writeFile(
    'evidence/todomvc-audit-after.json',
    JSON.stringify(observed, null, 2) + '\n',
  )
  console.log(JSON.stringify(observed, null, 2))
} finally {
  await browser.close()
}
