/**
 * Receiving oracle for the actual public get-convex/convex-demos pagination app
 * at 2fac21e360bfcceae6065096f1b81480bd8c6fd5, deployed unchanged at runtime by
 * public-pagination-setup.ts. Its messages:list orders newest first;
 * listWithExtraArg restricts that order to an indexed author; and
 * listWithTransformation returns author initials and uppercase body text.
 * Source: https://github.com/get-convex/convex-demos/blob/2fac21e360bfcceae6065096f1b81480bd8c6fd5/pagination/convex/messages.ts
 *
 * The independent model is an append-only ledger of successful sends. Reverse
 * insertion order gives the complete source, with an optional author predicate
 * and the declared text transformation. It never asks the adapter or a paged
 * server query for expected rows. Every body is unique, including after case
 * conversion, to provide the stable key omitted by the transformed upstream
 * query. These tests do not claim that arbitrary transformed rows have keys.
 *
 * Both actual SDK clients run all three public queries at pageSize 3. Each
 * history adds enough messages for several ranges and includes another author,
 * then appends while subscribed. A transparent TCP gate next destroys the
 * adapter client's real connections; a separate direct writer commits while
 * disconnected. The old public snapshot must remain until reconnect, then the
 * complete Collection and select-boundary order must equal the ledger.
 *
 * This is finite public-app conformance, not a browser-render test, a generated
 * history campaign, a total network-work bound, or a test of cloud hosting.
 * Calibration: disabling adapter continuation is rejected immediately after
 * initial preload at the select-order comparison, three received rows versus
 * seventeen expected for JavaScript (and three versus thirty-four for React).
 * The fixed replay selector is `-t 'mirrors list through'`; no timeout or setup
 * failure is counted as that rejection. The repaired full six-case run passes.
 *
 * The upstream source declares Convex 1.48.0; this receiving fixture deliberately
 * deploys its functions with this package's installed Convex 1.47 SDK/backend.
 */
import { createCollection } from '@tanstack/db'
import { ConvexClient } from 'convex/browser'
import { ConvexReactClient } from 'convex/react'
import { makeFunctionReference } from 'convex/server'
import { describe, expect, inject, it } from 'vitest'
import { convexPaginatedCollectionOptions } from '../src/index'
import { withTestCleanup } from '../tests/helpers'
import { createNetworkGate } from './network-gate'
import type { PaginationOptions, PaginationResult } from 'convex/server'

type Message = { author: string; body: string }
const ledger: Array<Message> = []
const send = makeFunctionReference<`mutation`, Message, null>(`messages:send`)
const backend = inject(`publicPaginationUrl`)
const queries = [`list`, `listWithExtraArg`, `listWithTransformation`] as const
type QueryName = (typeof queries)[number]

function expectedRows(name: QueryName, author: string): Array<Message> {
  return [...ledger]
    .reverse()
    .filter(
      (message) => name !== `listWithExtraArg` || message.author === author,
    )
    .map((message) =>
      name === `listWithTransformation`
        ? { author: message.author.charAt(0), body: message.body.toUpperCase() }
        : { ...message },
    )
}

// The backend starts with a new runtime directory and empty database. File and
// test execution are sequential, so this ledger includes all successful writes
// across the six histories, including rows outside the requested author scope.
describe.each([`javascript`, `react`] as const)(
  `public pagination app with %s client`,
  (kind) => {
    it.each(queries)(
      `mirrors %s through live writes and a real reconnect`,
      async (name) => {
        const gate = await createNetworkGate(backend)
        const writer = new ConvexClient(backend, {
          unsavedChangesWarning: false,
          logger: false,
        })
        const client =
          kind === `javascript`
            ? new ConvexClient(gate.url, {
                unsavedChangesWarning: false,
                logger: false,
              })
            : new ConvexReactClient(gate.url, {
                unsavedChangesWarning: false,
                logger: false,
              })
        const author = `author:${kind}:${name}`
        const query = makeFunctionReference<
          `query`,
          { paginationOpts: PaginationOptions; author?: string },
          PaginationResult<Message>
        >(`messages:${name}`)
        let selected: ReadonlyArray<Message> = []
        const collection = createCollection(
          convexPaginatedCollectionOptions({
            client,
            query,
            queryArgs: name === `listWithExtraArg` ? { author } : {},
            pageSize: 3,
            select: (rows) => {
              selected = rows.map(({ author: from, body }) => ({
                author: from,
                body,
              }))
              return rows
            },
            getKey: (row) => row.body,
            gcTime: 0,
          }),
        )
        const publish = async (from: string) => {
          const message = {
            author: from,
            body: `message ${ledger.length} from ${from}`,
          }
          await writer.mutation(send, message)
          ledger.push(message)
        }
        const check = async (waitForUpdate = true) => {
          const expected = expectedRows(name, author)
          if (waitForUpdate)
            await expect
              .poll(() => selected, { timeout: 15000 })
              .toEqual(expected)
          else expect(selected).toEqual(expected)
          await collection.utils.awaitSync()
          expect(
            [...collection.values()]
              .map(({ author: from, body }) => ({ author: from, body }))
              .sort((a, b) => a.body.localeCompare(b.body)),
          ).toEqual([...expected].sort((a, b) => a.body.localeCompare(b.body)))
        }
        await withTestCleanup(
          async () => {
            for (let index = 0; index < 17; index++)
              await publish(index % 2 === 0 ? author : `other:${author}`)
            await collection.preload()
            await check(false)
            await publish(author)
            await check()
            await publish(`other:${author}`)
            await check()
            const before = [...selected]
            gate.disconnect()
            await expect
              .poll(() => client.connectionState().isWebSocketConnected)
              .toBe(false)
            await publish(author)
            await publish(`other:${author}`)
            expect(selected).toEqual(before)
            expect(
              [...collection.values()]
                .map(({ author: from, body }) => ({ author: from, body }))
                .sort((a, b) => a.body.localeCompare(b.body)),
            ).toEqual([...before].sort((a, b) => a.body.localeCompare(b.body)))
            gate.reconnect()
            await check()
          },
          () => collection.cleanup(),
          () => client.close(),
          () => writer.close(),
          () => gate.close(),
        )
      },
      45000,
    )
  },
)
