import { createRouter as createTanstackRouter } from "@tanstack/solid-router"

// Import the generated route tree
import { routeTree } from "./routeTree.gen"
import { NotFound } from "./components/NotFound"

import "./styles.css"

// Create a new router instance
export const createRouter = () => {
  const router = createTanstackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultNotFoundComponent: NotFound,
  })

  return router
}

// Register the router instance for type safety
declare module "@tanstack/solid-router" {
  interface Register {
    router: ReturnType<typeof createRouter>
  }
}
