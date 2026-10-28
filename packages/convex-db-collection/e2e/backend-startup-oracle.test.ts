/**
 * The real public-app setup must start on a free loopback port when no port
 * override was requested, even if the fixture's former fixed port is occupied.
 * Authority: Convex CLI's supported default local-backend port allocation and
 * this suite's promise to own an isolated backend instead of requiring a
 * particular machine-wide port. Explicit user port overrides remain fail-fast.
 *
 * The independent judgment is resource based: a listener already owns 43320,
 * so the newly provided URL must name another port and serve an empty instance
 * of the pinned upstream messages query. The test never calculates which free
 * port the CLI should choose or reads the launcher's selection logic.
 *
 * This fixed history holds the old port, calls the actual public-pagination
 * global setup, observes its provided URL, then executes the public query.
 * EADDRINUSE is also a valid occupied-port precondition, and its external owner
 * is never closed. All resources acquired here are released independently while
 * preserving a primary mismatch. This is native startup conformance, not a
 * generated port-allocation or concurrent-startup proof. External occupancy is
 * observed at bind time, not held by a lease owned by this test.
 *
 * Calibration: restoring the former fixed 43320 setup argument rejects this
 * startup-fulfillment assertion with the actual CLI's "Requested port 43320 is
 * not available" failure. The public query checkpoint is not reached in that
 * control. Removing the fixed argument permits startup and the empty query.
 */
import { createServer } from 'node:net'
import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
import { expect, it, vi } from 'vitest'
import { withTestCleanup } from '../tests/helpers'
import setupPublicPagination from './public-pagination-setup'
import type { PaginationOptions, PaginationResult } from 'convex/server'
import type { TestProject } from 'vitest/node'

it(`starts the actual public app when its former fixed port is occupied`, async () => {
  const blocker = createServer((socket) => socket.destroy())
  let ownsBlocker = false
  let stopBackend: (() => Promise<void>) | undefined
  let providedUrl: string | undefined
  const project: Pick<TestProject, `provide`> = {
    provide: (key, value) => {
      expect(key).toBe(`publicPaginationUrl`)
      if (typeof value !== `string`)
        throw new TypeError(`Expected the public app's loopback URL`)
      providedUrl = value
    },
  }
  await withTestCleanup(
    async () => {
      vi.stubEnv(`CONVEX_TEST_PORT`, undefined)
      ownsBlocker = await new Promise<boolean>((resolve, reject) => {
        blocker.once(`error`, (error: NodeJS.ErrnoException) => {
          if (error.code === `EADDRINUSE`) resolve(false)
          else reject(error)
        })
        blocker.listen(43320, `127.0.0.1`, () => resolve(true))
      })
      const startup = setupPublicPagination(project).then((cleanup) => {
        stopBackend = cleanup
        return cleanup
      })
      await expect(startup).resolves.toBeTypeOf(`function`)
      if (!providedUrl)
        throw new Error(`Public app setup did not provide a URL`)
      const url = new URL(providedUrl)
      expect(url.hostname).toBe(`127.0.0.1`)
      expect(Number(url.port)).not.toBe(43320)
      const query = makeFunctionReference<
        `query`,
        { paginationOpts: PaginationOptions },
        PaginationResult<{ author: string; body: string }>
      >(`messages:list`)
      const response = await new ConvexHttpClient(providedUrl).query(query, {
        paginationOpts: { cursor: null, numItems: 1 },
      })
      expect(response.page).toEqual([])
      expect(response.isDone).toBe(true)
    },
    async () => {
      await stopBackend?.()
    },
    async () => {
      if (ownsBlocker)
        await new Promise<void>((resolve, reject) =>
          blocker.close((error) => (error ? reject(error) : resolve())),
        )
    },
    () => {
      vi.unstubAllEnvs()
    },
  )
}, 180000)
