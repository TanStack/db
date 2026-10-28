/**
 * Receiving witness for the official role-based Convex Auth application pinned
 * in auth-app/README.md. Its server functions define read/write/admin access.
 * The independent role table predicts which operations may change the messages:
 * read permits observation, write permits send, admin also permits deletion.
 * A genuine Anonymous signIn issues the JWT used by both SDK WebSocket clients.
 * Rejected operations must leave the public Collection unchanged; successful
 * sends and deletions must reach its rows after awaitSync accepts the source.
 *
 * These are bounded authored role histories through the upstream application,
 * not a model of OAuth, token refresh, role administration security, or browsers.
 * The upstream demo deliberately allows self-service role changes. A separate
 * unauthenticated client and an invalid token distinguish server authentication
 * from trusting an asserted client identity. No setAdminAuth is used.
 */
import { ConvexClient, ConvexHttpClient } from 'convex/browser'
import { ConvexReactClient } from 'convex/react'
import { makeFunctionReference } from 'convex/server'
import { createCollection } from '@tanstack/db'
import { expect, inject, it } from 'vitest'
import { convexCollectionOptions } from '../src/index'
import { withTestCleanup } from '../tests/helpers'

declare module 'vitest' {
  interface ProvidedContext {
    authAppUrl: string
  }
}
type Message = { _id: string; body: string; userId: string; author?: string }
const list = makeFunctionReference<`query`, {}, Array<Message>>(`messages:list`)
const send = makeFunctionReference<`mutation`, { body: string }, null>(
  `messages:send`,
)
const remove = makeFunctionReference<`mutation`, { messageId: string }, null>(
  `messages:deleteMessage`,
)
const role = makeFunctionReference<
  `mutation`,
  { role: `read` | `write` | `admin` },
  null
>(`auth:updateRole`)
const signIn = makeFunctionReference<
  `action`,
  { provider: string },
  { tokens: { token: string; refreshToken: string } | null }
>(`auth:signIn`)
const url = inject(`authAppUrl`)
type Role = `read` | `write` | `admin`
type Operation = `send` | `delete`
// This set-valued policy is independent of upstream's numeric role hierarchy.
// The message multiset contains authored bodies, never server-assigned IDs.
const permitted: Record<Role, ReadonlyArray<Operation>> = {
  read: [],
  write: [`send`],
  admin: [`send`, `delete`],
}
const history: ReadonlyArray<{ role: Role; operation: Operation }> = [
  { role: `read`, operation: `send` },
  { role: `write`, operation: `send` },
  { role: `write`, operation: `delete` },
  { role: `read`, operation: `send` },
  { role: `read`, operation: `delete` },
  { role: `admin`, operation: `send` },
  { role: `admin`, operation: `delete` },
  { role: `admin`, operation: `delete` },
]

it.each([`javascript`, `react`] as const)(
  `receives genuine authenticated role transitions with the %s client`,
  async (kind) => {
    const http = new ConvexHttpClient(url)
    await expect(http.query(list, {})).rejects.toThrow(`Not signed in`)
    const result = await http.action(signIn, { provider: `anonymous` })
    expect(result.tokens?.token.split(`.`)).toHaveLength(3)
    const token = result.tokens!.token
    const invalid = new ConvexHttpClient(url)
    invalid.setAuth(`${token.slice(0, -3)}bad`)
    await expect(invalid.query(list, {})).rejects.toThrow()
    const makeClient = () =>
      kind === `javascript`
        ? new ConvexClient(url, { unsavedChangesWarning: false, logger: false })
        : new ConvexReactClient(url, {
            unsavedChangesWarning: false,
            logger: false,
          })
    const unauthenticated = makeClient()
    const denied = createCollection(
      convexCollectionOptions({
        client: unauthenticated,
        query: list,
        queryArgs: {},
        getKey: (row) => row._id,
        gcTime: 0,
      }),
    )
    await withTestCleanup(
      async () => {
        await expect(denied.preload()).rejects.toThrow(`Not signed in`)
        expect([...denied.values()]).toEqual([])
      },
      () => denied.cleanup(),
      () => unauthenticated.close(),
    )
    const client = makeClient()
    client.setAuth(() => Promise.resolve(token))
    const collection = createCollection(
      convexCollectionOptions({
        client,
        query: list,
        queryArgs: {},
        getKey: (row) => row._id,
        gcTime: 0,
      }),
    )
    const marker = `auth-${kind}-${crypto.randomUUID()}`
    await withTestCleanup(
      async () => {
        await collection.preload()
        const model: Array<string> = []
        for (const step of history) {
          // This is the upstream demo's public role selector, not admin auth.
          await client.mutation(role, { role: step.role })
          const allowed = permitted[step.role].includes(step.operation)
          const inserted = [...collection.values()].find(
            (row) => row.body === marker,
          )
          const attempt =
            step.operation === `send`
              ? client.mutation(send, { body: marker })
              : client.mutation(remove, { messageId: inserted!._id })
          if (allowed) {
            await attempt
            if (step.operation === `send`) model.push(marker)
            else model.splice(model.indexOf(marker), 1)
          } else
            await expect(attempt).rejects.toThrow(`Insufficient permissions`)
          await collection.utils.awaitSync()
          // Compare at every accepted source checkpoint, including denials and
          // demotion. Two successful equal-body sends remain two model rows.
          expect(
            [...collection.values()]
              .filter((row) => row.body === marker)
              .map((row) => row.body)
              .sort(),
          ).toEqual([...model].sort())
        }
      },
      () => collection.cleanup(),
      () => client.close(),
    )
  },
)
