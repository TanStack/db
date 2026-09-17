import { expect, test } from '@playwright/test'

test(`Next.js streams a DB result snapshot and hands off to browser sync`, async ({
  page,
  request,
}) => {
  const response = await request.get(`/`)
  expect(response.ok()).toBe(true)
  const html = await response.text()
  expect(html).toContain(`Streamed from Next.js`)
  expect(html).not.toContain(`NEXT_SOURCE_ONLY_DO_NOT_TRANSPORT`)

  const browserErrors: Array<string> = []
  page.on(`console`, (message) => {
    if (message.type() === `error`) browserErrors.push(message.text())
  })
  page.on(`pageerror`, (error) => {
    browserErrors.push(error.message)
  })

  await page.goto(`/`, { waitUntil: `commit` })

  await expect(page.getByTestId(`stream-fallback`)).toBeVisible()
  await expect(page.getByTestId(`streamed-todo-next-server-1`)).toHaveText(
    `Streamed from Next.js`,
  )
  await expect(page.getByTestId(`stream-fallback`)).not.toBeVisible()
  await expect(
    page.getByTestId(`streamed-todo-next-server-1`),
  ).not.toBeVisible()
  await expect(page.getByTestId(`streamed-todo-next-browser-1`)).toHaveText(
    `Reconciled by Next.js browser sync`,
  )
  expect(browserErrors).toEqual([])
})
