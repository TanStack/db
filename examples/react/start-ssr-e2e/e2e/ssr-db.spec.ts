import { expect, test } from '@playwright/test'

test(`TanStack Start hydrates DB collection rows and applies streamed chunks`, async ({
  page,
  request,
}) => {
  const response = await request.get(`/ssr-db`)
  expect(response.ok()).toBe(true)

  const html = await response.text()
  expect(html).toContain(`Pay invoices`)
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
  await expect(page.getByTestId(`ssr-todo-list`)).toContainText(`Pay invoices`)
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
