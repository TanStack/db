import { expect, test } from '@playwright/test'

test(`TanStack Start hydrates, reconciles, and incrementally applies DB rows`, async ({
  page,
  request,
}) => {
  const response = await request.get(`/ssr-db`)
  expect(response.ok()).toBe(true)

  const html = await response.text()
  expect(html).toContain(`Pay invoices`)
  expect(html).not.toContain(`Pay invoices (reconciled from sync)`)
  expect(html).toContain(`Review pull requests`)
  expect(html).toContain(`ssr`)
  expect(html).not.toContain(`Streamed from collection chunk`)

  const browserErrors: Array<string> = []
  page.on(`console`, (message) => {
    if (message.type() === `error`) {
      browserErrors.push(message.text())
    }
  })
  page.on(`pageerror`, (error) => {
    browserErrors.push(error.message)
  })

  await page.goto(`/ssr-db`)

  await expect(page.getByTestId(`hydration-state`)).toHaveText(`hydrated`)
  await expect(page.getByTestId(`ready-state`)).toHaveText(`ready`)
  await expect(page.getByTestId(`streamed-status`)).toHaveText(`waiting`)
  await expect(page.getByTestId(`ssr-row-count`)).toHaveText(`2`)
  await expect(page.getByTestId(`ssr-todo-list`)).toContainText(
    `Pay invoices (reconciled from sync)`,
  )
  await expect(page.getByTestId(`ssr-todo-server-1`)).toContainText(`(sync)`)
  await expect(page.getByTestId(`ssr-todo-list`)).toContainText(
    `Review pull requests`,
  )
  await expect(page.getByTestId(`ssr-todo-list`)).not.toContainText(
    `Archived roadmap`,
  )

  await page.getByTestId(`apply-stream-chunk`).click()

  await expect(page.getByTestId(`streamed-status`)).toHaveText(`streamed`)
  await expect(page.getByTestId(`ssr-row-count`)).toHaveText(`3`)
  await expect(page.getByTestId(`ssr-todo-streamed-1`)).toBeVisible()
  await expect(page.getByTestId(`ssr-todo-streamed-1`)).toContainText(
    `Streamed from collection chunk`,
  )
  expect(browserErrors).toEqual([])
})

test(`TanStack Start streams a DB result snapshot and hands off to browser sync`, async ({
  page,
  request,
}) => {
  const response = await request.get(`/ssr-db-stream`)
  expect(response.ok()).toBe(true)
  const html = await response.text()
  expect(html).toContain(`Streamed while rendering`)
  expect(html).not.toContain(`SOURCE_ONLY_DO_NOT_TRANSPORT`)

  const browserErrors: Array<string> = []
  page.on(`console`, (message) => {
    if (message.type() === `error`) {
      browserErrors.push(message.text())
    }
  })
  page.on(`pageerror`, (error) => {
    browserErrors.push(error.message)
  })

  await page.goto(`/ssr-db-stream`, { waitUntil: `commit` })

  await expect(page.getByTestId(`critical-todo-server-1`)).toContainText(
    `Pay invoices`,
  )
  await expect(page.getByTestId(`stream-fallback`)).toBeVisible()
  await expect(page.getByTestId(`streamed-todo-list`)).not.toBeVisible()
  await expect(page.getByTestId(`streamed-todo-streamed-server-1`)).toHaveText(
    `Streamed while rendering`,
  )
  await expect(page.getByTestId(`stream-fallback`)).not.toBeVisible()
  await expect(
    page.getByTestId(`streamed-todo-streamed-server-1`),
  ).not.toBeVisible()
  await expect(page.getByTestId(`streamed-todo-streamed-browser-1`)).toHaveText(
    `Reconciled from browser sync`,
  )
  expect(browserErrors).toEqual([])
})
