/**
 * Real receiving path for the source-prefix grammar in the multi-tab owner.
 * A real Electric HTTP response containing the first membership change waits
 * in tab B while A applies a later change. B then commits that older response.
 * A advances with an empty batch or disjoint change, and B reopens. PostgreSQL
 * supplies the head to the shared judgment; no expected answer is restated.
 * The drain branch is the neighboring control. These finite real-host cells
 * receive the generated Node law; they do not cover arbitrary browser schedules.
 */
import { expect, test } from '@playwright/test'
import { makePgClient } from '../../db-collection-e2e/support/global-setup'
import { sourceHeadViolation } from '../tests/electric-convergence-oracle'
import { createOracleReach } from '../../db/tests/oracle-reach'
import { declareOracle } from '../../db/tests/oracle-declaration'
import type { Page } from '@playwright/test'
import type {} from './electric-source-prefix.opfs'

type Cell = {
  present: boolean
  advance: `empty` | `disjoint`
  drain: boolean
  legacy: boolean
  callerCursor: `none` | `initial-offset` | `handle` | `resume` | `now`
  interrupted?: boolean
}
const cells: Array<Cell> = [true, false]
  .flatMap((present) =>
    ([`empty`, `disjoint`] as const).flatMap((advance) =>
      [false, true].map((drain) => ({
        present,
        advance,
        drain,
        legacy: false,
        callerCursor: `none` as const,
      })),
    ),
  )
  .concat(
    [true, false].map((present) => ({
      present,
      advance: `disjoint` as const,
      drain: false,
      legacy: true,
      callerCursor: `none` as const,
    })),
  )
// Repeat the legal explicit resumed position over both membership failures
// and both current/legacy evidence. Initial-offset and handle-only options
// request a complete snapshot and supply the distinguishing neighbors.
cells.push(
  ...([`resume`, `now`] as const).flatMap((callerCursor) =>
    [true, false].flatMap((present) =>
      [false, true].map((legacy): Cell => ({
        present,
        advance: `disjoint`,
        drain: false,
        legacy,
        callerCursor,
      })),
    ),
  ),
  ...([`initial-offset`, `handle`] as const).map((callerCursor): Cell => ({
    present: true,
    advance: `disjoint`,
    drain: false,
    legacy: false,
    callerCursor,
  })),
)
// Interrupt recovery before the first SDK response can publish its snapshot.
// The real eager adapter durably records reset; numeric/now positions cannot
// turn that marker into a certified baseline. The other forms are controls.
cells.push(
  ...([`none`, `initial-offset`, `handle`, `resume`, `now`] as const).flatMap(
    (callerCursor) =>
      [true, false].map((present): Cell => ({
        present,
        advance: `disjoint`,
        drain: false,
        legacy: false,
        callerCursor,
        interrupted: true,
      })),
  ),
)
const observe = (page: Page) =>
  page.evaluate(() => window.__electricSourcePrefix!.observe())
const rowIds = async (page: Page) =>
  (await observe(page)).rows.map(({ id }) => id)

declareOracle({ check: [sourceHeadViolation], grammar: [cells] })
for (const cell of cells) {
  test(`recovers ${cell.present ? `lost` : `resurrected`} rows after ${cell.advance} advancement${cell.drain ? ` with peer drain` : ``}${cell.legacy ? ` from legacy progress` : ``}${cell.callerCursor !== `none` ? ` with explicit ${cell.callerCursor}` : ``}${cell.interrupted ? ` after interrupted recovery` : ``}`, async ({
    context,
  }) => {
    const reach = createOracleReach(
      `browser.electric-source-prefix.opfs`,
      [
        `held earlier SDK response`,
        `stale commit applied`,
        `later advancement applied`,
        `reopened source compared`,
        ...(cell.interrupted ? [`interrupted recovery reset persisted`] : []),
        ...(cell.callerCursor === `none`
          ? []
          : [`explicit ${cell.callerCursor} supplied at recovery`]),
      ],
      { replaying: false },
    )
    reach.beginHistory()
    const token = crypto.randomUUID().replaceAll(`-`, ``).slice(0, 12)
    const table = `electric_prefix_${token}`
    const collectionId = `prefix-${token}`
    const parameters = new URLSearchParams({
      table,
      collectionId,
      databaseId: collectionId,
    })
    const url = `/e2e/electric-source-prefix.opfs.html?${parameters}`
    const pg = makePgClient()
    const pages: Array<Page> = []
    const diagnostics: Array<string> = []
    const close = async (page: Page) => {
      if (page.isClosed()) return
      diagnostics.push(
        ...(await page.evaluate(
          () => window.__electricSourcePrefix?.cleanup() ?? [],
        )),
      )
      await page.close()
    }
    let primary: unknown
    let connected = false
    try {
      await pg.connect()
      connected = true
      await pg.query(
        `CREATE TABLE public.${table} (id TEXT PRIMARY KEY, label TEXT NOT NULL)`,
      )
      await pg.query(`INSERT INTO public.${table} VALUES ('anchor', 'anchor')`)
      if (cell.present)
        await pg.query(`INSERT INTO public.${table} VALUES ('target', 'old')`)
      const open = async (
        callerPosition: Record<string, string> = {},
        holdInitial = false,
      ) => {
        const page = await context.newPage()
        pages.push(page)
        page.on(`pageerror`, (error) => diagnostics.push(error.message))
        await page.goto(
          `${url}&${new URLSearchParams({
            ...callerPosition,
            ...(holdInitial ? { holdInitial: `true` } : {}),
          })}`,
        )
        await page.waitForFunction(
          () => window.__electricSourcePrefix !== undefined,
        )
        if (holdInitial) return page
        await expect
          .poll(async () => (await observe(page)).status, { timeout: 30_000 })
          .toBe(`ready`)
        await expect
          .poll(async () => (await observe(page)).commits, { timeout: 30_000 })
          .toBeGreaterThan(0)
        return page
      }
      const a = await open()
      const b = await open()
      await b.evaluate(() => window.__electricSourcePrefix!.arm())
      const bCommits = (await observe(b)).commits
      // The first change reverses membership; the second restores it. A has
      // already applied the first before the second is issued to PostgreSQL.
      if (cell.present)
        await pg.query(`DELETE FROM public.${table} WHERE id = 'target'`)
      else
        await pg.query(`INSERT INTO public.${table} VALUES ('target', 'old')`)
      await expect
        .poll(() => rowIds(a), { timeout: 30_000 })
        .toEqual(cell.present ? [`anchor`] : [`anchor`, `target`])
      // Empty long-poll responses can precede the row response. Deliver those
      // without releasing the first actual changed-row response.
      await expect
        .poll(
          async () => {
            const state = await observe(b)
            if (state.pending[0] === 0)
              await b.evaluate(() =>
                window.__electricSourcePrefix!.releaseOne(),
              )
            return (await observe(b)).pending[0] ?? 0
          },
          { timeout: 30_000 },
        )
        .toBeGreaterThan(0)
      reach.reach(`held earlier SDK response`)
      if (cell.present)
        await pg.query(`INSERT INTO public.${table} VALUES ('target', 'new')`)
      else await pg.query(`DELETE FROM public.${table} WHERE id = 'target'`)
      await expect
        .poll(() => rowIds(a), { timeout: 30_000 })
        .toEqual(cell.present ? [`anchor`, `target`] : [`anchor`])
      await b.evaluate(() => window.__electricSourcePrefix!.releaseOne())
      await expect
        .poll(async () => (await observe(b)).commits)
        .toBeGreaterThan(bCommits)
      await expect
        .poll(() => rowIds(a))
        .toEqual(cell.present ? [`anchor`] : [`anchor`, `target`])
      reach.reach(`stale commit applied`)
      const beforeAdvance = await observe(a)
      if (cell.advance === `disjoint`) {
        await pg.query(
          `UPDATE public.${table} SET label = 'advanced' WHERE id = 'anchor'`,
        )
        await expect
          .poll(
            async () =>
              (await observe(a)).rows.find(({ id }) => id === `anchor`)?.label,
            { timeout: 30_000 },
          )
          .toBe(`advanced`)
      } else {
        // Ask the real server for a non-live catch-up response on A's next
        // SDK request. The current live request may first time out.
        await a.evaluate(() => window.__electricSourcePrefix!.refresh())
        await expect
          .poll(async () => (await observe(a)).emptyCommits, {
            timeout: 70_000,
          })
          .toBeGreaterThan(beforeAdvance.emptyCommits)
      }
      reach.reach(`later advancement applied`)
      if (cell.drain) {
        await expect
          .poll(async () => (await observe(b)).pending.length, {
            timeout: 30_000,
          })
          .toBeGreaterThan(0)
        await b.evaluate(() => window.__electricSourcePrefix!.releaseOne())
        await expect
          .poll(() => rowIds(b), { timeout: 30_000 })
          .toEqual(cell.present ? [`anchor`, `target`] : [`anchor`])
      }
      await close(b)
      if (cell.legacy)
        await a.evaluate(() => window.__electricSourcePrefix!.legacy())
      const callerPosition: Record<string, string> = {}
      if (cell.callerCursor !== `none`) {
        const { resume } = await observe(a)
        if (
          !resume ||
          typeof resume !== `object` ||
          !(`offset` in resume) ||
          typeof resume.offset !== `string` ||
          !(`handle` in resume) ||
          typeof resume.handle !== `string`
        )
          throw new Error(`No complete real Electric position at recovery`)
        if (
          cell.callerCursor !== `initial-offset` &&
          cell.callerCursor !== `now`
        )
          callerPosition.handle = resume.handle
        if (cell.callerCursor === `resume`)
          callerPosition.offset = resume.offset
        if (cell.callerCursor === `initial-offset`) callerPosition.offset = `-1`
        if (cell.callerCursor === `now`) callerPosition.offset = `now`
        reach.reach(`explicit ${cell.callerCursor} supplied at recovery`)
      }
      if (cell.interrupted) {
        // Preserve the real position above before recovery replaces its
        // resume record with reset. Hold A too, so an empty peer response
        // cannot overwrite that marker while this boundary is observed.
        await a.evaluate(() => window.__electricSourcePrefix!.arm())
        const pendingRecovery = await open({}, true)
        await expect
          .poll(async () => (await observe(pendingRecovery)).pending.length, {
            timeout: 30_000,
          })
          .toBeGreaterThan(0)
        await expect
          .poll(
            async () => {
              const { resume } = await observe(pendingRecovery)
              return resume && typeof resume === `object` && `kind` in resume
                ? resume.kind
                : undefined
            },
            { timeout: 30_000 },
          )
          .toBe(`reset`)
        reach.reach(`interrupted recovery reset persisted`)
        await close(pendingRecovery)
      }
      const reopened = await open(callerPosition)
      // Source readiness follows an applied SDK receipt. The wrapper may
      // still propagate its notice to A, so poll the shared settled judgment.
      const source = await pg.query<{ id: string; label: string }>(
        `SELECT id, label FROM public.${table} ORDER BY id`,
      )
      reach.reach(`reopened source compared`)
      await expect
        .poll(
          async () => {
            const states = await Promise.all([observe(a), observe(reopened)])
            return sourceHeadViolation(source.rows, {
              durableRows: states[1].durableRows,
              tabs: states,
            })
          },
          { timeout: 10_000 },
        )
        .toBeUndefined()
      console.info(
        `real prefix reach`,
        cell,
        Object.fromEntries(reach.counts()),
      )
      reach.assertReached()
    } catch (error) {
      primary = error
      for (const page of pages) {
        if (!page.isClosed()) {
          try {
            diagnostics.push(JSON.stringify(await observe(page)))
          } catch (diagnosticError) {
            diagnostics.push(String(diagnosticError))
          }
        }
      }
    } finally {
      for (const page of [...pages].reverse()) {
        try {
          await close(page)
        } catch (error) {
          diagnostics.push(String(error))
        }
      }
      if (connected) {
        try {
          await pg.query(`DROP TABLE IF EXISTS public.${table}`)
        } catch (error) {
          diagnostics.push(String(error))
        }
        await pg.end()
      }
    }
    if (primary !== undefined)
      throw new Error(
        `real prefix comparison failed; diagnostics=${JSON.stringify(diagnostics)}`,
        { cause: primary },
      )
    expect(diagnostics).toEqual([])
  })
}
