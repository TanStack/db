import { expectTypeOf, test } from 'vitest'
import {
  createRootRouteWithContext,
  createRouter,
} from '@tanstack/react-router'
import { DbClient } from '@tanstack/react-db'
import { routerWithDbClient } from '../src'

test(`requires DbClient in router context and preserves the router type`, () => {
  const dbClient = new DbClient()
  const rootRoute = createRootRouteWithContext<{ dbClient: DbClient }>()()
  const router = createRouter({
    routeTree: rootRoute,
    context: { dbClient },
  })

  expectTypeOf(routerWithDbClient(router, dbClient)).toEqualTypeOf(router)

  const invalidRootRoute = createRootRouteWithContext<{}>()()
  const invalidRouter = createRouter({
    routeTree: invalidRootRoute,
    context: {},
  })

  // @ts-expect-error router context must contain dbClient
  routerWithDbClient(invalidRouter, dbClient)
})
