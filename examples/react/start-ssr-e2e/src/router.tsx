import { createRouter as createTanstackRouter } from '@tanstack/react-router'
import { createIsomorphicFn } from '@tanstack/react-start'
import { DbClient } from '@tanstack/react-db'
import { routerWithDbClient } from '@tanstack/react-router-with-db'
import { routeTree } from './routeTree.gen'
import './styles.css'

export type RouterContext = {
  dbClient: DbClient
}

const getRuntime = createIsomorphicFn()
  .server(() => `server` as const)
  .client(() => `browser` as const)

export function getRouter() {
  const dbClient = new DbClient({
    runtime: getRuntime(),
  })
  const router = createTanstackRouter({
    routeTree,
    context: { dbClient },
    scrollRestoration: true,
  })

  return routerWithDbClient(router, dbClient)
}
